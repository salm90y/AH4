import { DurableObject } from "cloudflare:workers";

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

function roomResponse(room, participantId) {
  return {
    code: room.code,
    name: room.name,
    passwordProtected: Boolean(room.passwordHash),
    host: room.hostParticipantId === participantId,
    // تُركت فارغة في النسخة الأساسية؛ لا تُنشأ بيانات LiveKit قبل إعادة ميزة الصوت/الكاميرا.
    serverUrl: "",
    token: "",
  };
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

async function derivePasswordHash(password, salt) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 210_000 },
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

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function proxyWithCors(response) {
  if (response.status >= 500) {
    const diagnostic = (await response.text()).slice(0, 500) || "EMPTY_DURABLE_OBJECT_RESPONSE";
    return json(
      {
        error: "فشل مخزن الغرف في Cloudflare.",
        diagnostic: `DURABLE_OBJECT_${response.status}: ${diagnostic}`,
      },
      502,
    );
  }
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders())) headers.set(key, value);
  return new Response(response.body, { status: response.status, headers });
}

export class WatchRoom extends DurableObject {
  constructor(state, env) {
    super(state, env);
    this.state = state;
  }

  async fetch(request) {
    try {
      return await this.handleRequest(request);
    } catch (error) {
      return json(
        {
          error: "فشل خادم الغرفة أثناء معالجة الطلب.",
          diagnostic: error instanceof Error ? error.message : "UNKNOWN_ROOM_ERROR",
        },
        500,
      );
    }
  }

  async handleRequest(request) {
    const url = new URL(request.url);
    const input = await readJson(request);

    if (url.pathname === "/internal/create" && request.method === "POST") {
      const existing = await this.state.storage.get("room");
      if (existing) return json({ error: "ROOM_CODE_EXISTS" }, 409);

      if (!input || typeof input.name !== "string" || input.name.trim().length < 2 || input.name.trim().length > 120) {
        return json({ error: "اسم الغرفة يجب أن يكون بين حرفين و120 حرفًا." }, 400);
      }
      if (typeof input.password !== "string" || input.password.length > 128 || !validParticipantId(input.participantId) || !validDisplayName(input.displayName)) {
        return json({ error: "بيانات إنشاء الغرفة غير صالحة." }, 400);
      }

      let passwordHash = null;
      let passwordSalt = null;
      if (input.password.length > 0) {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        passwordSalt = toBase64(salt);
        passwordHash = toBase64(await derivePasswordHash(input.password, salt));
      }

      const room = {
        code: input.code,
        name: input.name.trim(),
        hostParticipantId: input.participantId,
        passwordHash,
        passwordSalt,
        createdAt: new Date().toISOString(),
      };
      await this.state.storage.put("room", room);
      return json(roomResponse(room, input.participantId), 201);
    }

    if (url.pathname === "/internal/join" && request.method === "POST") {
      const room = await this.state.storage.get("room");
      if (!room) return json({ error: "الغرفة غير موجودة أو انتهت صلاحيتها." }, 404);
      if (!input || typeof input.password !== "string" || input.password.length > 128 || !validParticipantId(input.participantId) || !validDisplayName(input.displayName)) {
        return json({ error: "بيانات الانضمام غير صالحة." }, 400);
      }

      if (room.passwordHash && room.passwordSalt) {
        const candidate = await derivePasswordHash(input.password, fromBase64(room.passwordSalt));
        if (!safelyEquals(candidate, fromBase64(room.passwordHash))) {
          return json({ error: "كلمة مرور الغرفة غير صحيحة." }, 403);
        }
      }
      return json(roomResponse(room, input.participantId));
    }

    return json({ error: "المسار الداخلي غير موجود." }, 404);
  }
}

export default {
  async fetch(request, env) {
    try {
      return await handleApiRequest(request, env);
    } catch (error) {
      return json(
        {
          error: "فشل خادم الغرف قبل معالجة الطلب.",
          diagnostic: error instanceof Error ? error.message : "UNKNOWN_API_ERROR",
        },
        500,
      );
    }
  },
};

async function handleApiRequest(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });

    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ status: "ok", service: "AH4 Watch Party API", storage: "Cloudflare Durable Objects" });
    }

    if (request.method === "POST" && url.pathname === "/v1/rooms") {
      const input = await readJson(request);
      if (!input) return json({ error: "الطلب يجب أن يكون JSON صالحًا." }, 400);

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const code = createRoomCode();
        const id = env.WATCH_ROOMS.idFromName(code);
        const response = await env.WATCH_ROOMS.get(id).fetch("https://room.internal/internal/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...input, code }),
        });
        if (response.status !== 409) return proxyWithCors(response);
      }
      return json({ error: "تعذر تخصيص رمز غرفة فريد. حاول مرة أخرى." }, 503);
    }

    if (request.method === "POST" && url.pathname === "/v1/rooms/join") {
      const input = await readJson(request);
      if (!input || !validRoomCode(input.code)) return json({ error: "رمز الغرفة غير صالح." }, 400);
      const id = env.WATCH_ROOMS.idFromName(input.code);
      const response = await env.WATCH_ROOMS.get(id).fetch("https://room.internal/internal/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      return proxyWithCors(response);
    }

    return json({ error: "المسار غير موجود." }, 404);
}
