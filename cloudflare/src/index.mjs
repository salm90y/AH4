const encoder = new TextEncoder();

function corsHeaders(headers = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    ...headers,
  };
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: corsHeaders({ "Content-Type": "application/json; charset=utf-8" }),
  });
}

function validParticipantId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{8,96}$/.test(value);
}

function validDisplayName(value) {
  return typeof value === "string" && value.trim().length >= 1 && value.trim().length <= 40;
}

function validRoomCode(value) {
  return typeof value === "string" && /^AH4-[A-F0-9]{8}$/.test(value);
}

function createRoomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return `AH4-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function toBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function toBase64Url(value) {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  return toBase64(bytes).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function createLiveKitToken({ room, participantId, displayName, host }, env) {
  if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) {
    return { serverUrl: "", token: "" };
  }

  const now = Math.floor(Date.now() / 1000);
  const header = toBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = toBase64Url(JSON.stringify({
    exp: now + 60 * 60 * 2,
    iat: now,
    iss: env.LIVEKIT_API_KEY,
    name: displayName,
    nbf: now - 5,
    sub: participantId,
    video: {
      canPublish: true,
      canPublishData: true,
      canSubscribe: true,
      room,
      roomAdmin: host,
      roomJoin: true,
    },
  }));
  const unsignedToken = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(env.LIVEKIT_API_SECRET),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(unsignedToken));
  return { serverUrl: env.LIVEKIT_URL, token: `${unsignedToken}.${toBase64Url(new Uint8Array(signature))}` };
}

async function derivePasswordHash(password, salt) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 100_000 },
    material,
    256,
  );
  return new Uint8Array(bits);
}

function safelyEquals(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function roomResponse(room, participantId, displayName, env) {
  return {
    code: room.code,
    name: room.name,
    passwordProtected: Boolean(room.passwordHash),
    host: room.hostParticipantId === participantId,
    ...(await createLiveKitToken({
      displayName,
      host: room.hostParticipantId === participantId,
      participantId,
      room: room.code,
    }, env)),
  };
}

async function createRoom(input, env) {
  if (
    !input ||
    typeof input.name !== "string" ||
    input.name.trim().length < 2 ||
    input.name.trim().length > 120 ||
    typeof input.password !== "string" ||
    input.password.length > 128 ||
    !validParticipantId(input.participantId) ||
    !validDisplayName(input.displayName)
  ) {
    return json({ error: "بيانات إنشاء الغرفة غير صالحة." }, 400);
  }

  let passwordHash = null;
  let passwordSalt = null;
  if (input.password.length > 0) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    passwordSalt = toBase64(salt);
    passwordHash = toBase64(await derivePasswordHash(input.password, salt));
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const room = {
      code: createRoomCode(),
      name: input.name.trim(),
      hostParticipantId: input.participantId,
      passwordHash,
      passwordSalt,
    };
    try {
      await env.ROOMS_DB.prepare(
        "INSERT INTO watch_rooms (code, name, host_participant_id, password_hash, password_salt) VALUES (?, ?, ?, ?, ?)",
      )
        .bind(room.code, room.name, room.hostParticipantId, room.passwordHash, room.passwordSalt)
        .run();
      return json(await roomResponse(room, input.participantId, input.displayName.trim(), env), 201);
    } catch (error) {
      if (!String(error).toLowerCase().includes("unique")) throw error;
    }
  }
  return json({ error: "تعذر تخصيص رمز غرفة فريد. حاول مرة أخرى." }, 503);
}

async function joinRoom(input, env) {
  if (!input || !validRoomCode(input.code) || typeof input.password !== "string" || input.password.length > 128 || !validParticipantId(input.participantId) || !validDisplayName(input.displayName)) {
    return json({ error: "بيانات الانضمام غير صالحة." }, 400);
  }
  const room = await env.ROOMS_DB.prepare(
    "SELECT code, name, host_participant_id AS hostParticipantId, password_hash AS passwordHash, password_salt AS passwordSalt FROM watch_rooms WHERE code = ?",
  )
    .bind(input.code)
    .first();
  if (!room) return json({ error: "الغرفة غير موجودة أو انتهت صلاحيتها." }, 404);
  if (room.passwordHash && room.passwordSalt) {
    const candidate = await derivePasswordHash(input.password, fromBase64(room.passwordSalt));
    if (!safelyEquals(candidate, fromBase64(room.passwordHash))) {
      return json({ error: "كلمة مرور الغرفة غير صحيحة." }, 403);
    }
  }
  return json(await roomResponse(room, input.participantId, input.displayName.trim(), env));
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ status: "ok", service: "AH4 Watch Party API", storage: "Cloudflare D1" });
    }
    try {
      if (request.method === "POST" && url.pathname === "/v1/rooms") return await createRoom(await readJson(request), env);
      if (request.method === "POST" && url.pathname === "/v1/rooms/join") return await joinRoom(await readJson(request), env);
      return json({ error: "المسار غير موجود." }, 404);
    } catch {
      return json({ error: "تعذر الاتصال بخادم الغرف. حاول مرة أخرى." }, 500);
    }
  },
};

export { createLiveKitToken };
