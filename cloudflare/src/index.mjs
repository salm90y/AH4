const encoder = new TextEncoder();

const ROOM_ROLES = ["host", "moderator", "member"];
const ROOM_VISIBILITIES = ["public", "private"];
const GRANTABLE_PERMISSIONS = ["control_source", "control_playback", "search_youtube", "moderate_chat", "manage_members"];
const HOST_PERMISSIONS = [...GRANTABLE_PERMISSIONS];
const MODERATOR_PERMISSIONS = ["moderate_chat", "manage_members"];
const MEMBER_ACTIONS = ["mute", "unmute", "block_camera", "allow_camera", "kick"];

function corsHeaders(headers = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    ...headers,
  };
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: corsHeaders({ "Content-Type": "application/json; charset=utf-8" }) });
}

function validParticipantId(value) { return typeof value === "string" && /^[a-zA-Z0-9_-]{8,96}$/.test(value); }
function validDisplayName(value) { return typeof value === "string" && value.trim().length >= 1 && value.trim().length <= 40; }
function validRoomCode(value) { return typeof value === "string" && /^AH4-[A-F0-9]{8}$/.test(value); }
function validMessageId(value) { return typeof value === "string" && /^[a-zA-Z0-9_-]{8,120}$/.test(value); }
function validVisibility(value) { return ROOM_VISIBILITIES.includes(value); }

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
function fromBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return fromBase64(`${normalized}${"=".repeat((4 - (normalized.length % 4)) % 4)}`);
}
function safelyEquals(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}
function normalizedPermissions(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((permission) => typeof permission === "string" && GRANTABLE_PERMISSIONS.includes(permission))));
}
function permissionsForRole(role) {
  if (role === "host") return HOST_PERMISSIONS;
  if (role === "moderator") return MODERATOR_PERMISSIONS;
  return [];
}
function memberPermissions(member) {
  if (!member) return [];
  let saved = member.permissions;
  try { if (typeof saved === "string") saved = JSON.parse(saved); } catch { saved = []; }
  return Array.from(new Set([...permissionsForRole(member.role), ...normalizedPermissions(saved)]));
}
function sourcePermissions(member) {
  const sources = [];
  if (!Number(member?.muted)) sources.push("MICROPHONE");
  if (!Number(member?.cameraBlocked)) sources.push("CAMERA");
  return sources;
}

async function hmacSha256(value, secret) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { hash: "SHA-256", name: "HMAC" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

async function createLiveKitToken({ room, participantId, displayName, host, member = {} }, env) {
  if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) return { serverUrl: "", token: "" };
  const now = Math.floor(Date.now() / 1000);
  const header = toBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = toBase64Url(JSON.stringify({
    exp: now + 60 * 60 * 2,
    iat: now,
    iss: env.LIVEKIT_API_KEY,
    name: displayName,
    nbf: now - 5,
    sub: participantId,
    video: { canPublish: sourcePermissions(member).length > 0, canPublishData: true, canPublishSources: sourcePermissions(member), canSubscribe: true, room, roomAdmin: host, roomJoin: true },
  }));
  const unsignedToken = `${header}.${payload}`;
  return { serverUrl: env.LIVEKIT_URL, token: `${unsignedToken}.${toBase64Url(await hmacSha256(unsignedToken, env.LIVEKIT_API_SECRET))}` };
}

async function createRoomAccessToken({ roomCode, participantId }, env) {
  if (!env.LIVEKIT_API_SECRET) return "";
  const now = Math.floor(Date.now() / 1000);
  const header = toBase64Url(JSON.stringify({ alg: "HS256", typ: "AH4" }));
  const payload = toBase64Url(JSON.stringify({ exp: now + 60 * 60 * 6, iat: now, room: roomCode, sub: participantId }));
  const unsignedToken = `${header}.${payload}`;
  return `${unsignedToken}.${toBase64Url(await hmacSha256(unsignedToken, env.LIVEKIT_API_SECRET))}`;
}

async function readRoomAccessToken(token, env) {
  if (!token || typeof token !== "string" || !env.LIVEKIT_API_SECRET) return null;
  const [header, payload, signature, ...extra] = token.split(".");
  if (!header || !payload || !signature || extra.length > 0) return null;
  const unsignedToken = `${header}.${payload}`;
  const expected = await hmacSha256(unsignedToken, env.LIVEKIT_API_SECRET);
  let supplied; let decoded;
  try { supplied = fromBase64Url(signature); decoded = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))); } catch { return null; }
  if (!safelyEquals(expected, supplied) || !validRoomCode(decoded.room) || !validParticipantId(decoded.sub) || !Number.isFinite(decoded.exp) || decoded.exp <= Math.floor(Date.now() / 1000)) return null;
  return { roomCode: decoded.room, participantId: decoded.sub };
}

async function derivePasswordHash(password, salt) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100_000 }, material, 256);
  return new Uint8Array(bits);
}
async function readJson(request) { try { return await request.json(); } catch { return null; } }

async function findRoom(code, env) {
  return env.ROOMS_DB.prepare("SELECT code, name, host_participant_id AS hostParticipantId, password_hash AS passwordHash, password_salt AS passwordSalt FROM watch_rooms WHERE code = ?").bind(code).first();
}
async function findMember(roomCode, participantId, env) {
  return env.ROOMS_DB.prepare("SELECT m.room_code AS roomCode, m.participant_id AS participantId, m.display_name AS displayName, m.role, m.permissions, COALESCE(mm.muted, 0) AS muted, COALESCE(mm.camera_blocked, 0) AS cameraBlocked, mm.kicked_at AS kickedAt FROM room_members m LEFT JOIN room_member_moderation mm ON mm.room_code = m.room_code AND mm.participant_id = m.participant_id WHERE m.room_code = ? AND m.participant_id = ?").bind(roomCode, participantId).first();
}
async function findRoomSettings(room, env) {
  const saved = await env.ROOMS_DB.prepare("SELECT visibility, settings FROM room_settings WHERE room_code = ?").bind(room.code).first();
  const visibility = saved?.visibility === "public" || saved?.visibility === "private" ? saved.visibility : room.passwordHash ? "private" : "public";
  return { visibility, settings: saved?.settings || "{}" };
}
async function ensureMember(room, participantId, displayName, env) {
  const role = room.hostParticipantId === participantId ? "host" : "member";
  await env.ROOMS_DB.prepare("INSERT OR IGNORE INTO room_members (room_code, participant_id, display_name, role, permissions) VALUES (?, ?, ?, ?, ?)").bind(room.code, participantId, displayName, role, JSON.stringify(permissionsForRole(role))).run();
  await env.ROOMS_DB.prepare("UPDATE room_members SET display_name = ?, updated_at = CURRENT_TIMESTAMP WHERE room_code = ? AND participant_id = ?").bind(displayName, room.code, participantId).run();
  return findMember(room.code, participantId, env);
}
function publicMember(member) {
  return { participantId: member.participantId, displayName: member.displayName, role: member.role, permissions: memberPermissions(member), muted: Boolean(member.muted), cameraBlocked: Boolean(member.cameraBlocked), kicked: Boolean(member.kickedAt) };
}
async function roomResponse(room, participantId, displayName, env) {
  const member = await ensureMember(room, participantId, displayName, env);
  if (!member) throw new Error("Could not establish room membership");
  const settings = await findRoomSettings(room, env);
  return { code: room.code, name: room.name, passwordProtected: settings.visibility === "private", visibility: settings.visibility, host: member.role === "host", role: member.role, permissions: memberPermissions(member), accessToken: await createRoomAccessToken({ roomCode: room.code, participantId }, env), ...(await createLiveKitToken({ displayName: member.displayName, host: member.role === "host", member, participantId, room: room.code }, env)) };
}

async function createRoom(input, env) {
  if (!input || typeof input.name !== "string" || input.name.trim().length < 2 || input.name.trim().length > 120 || typeof input.password !== "string" || input.password.length > 128 || !validParticipantId(input.participantId) || !validDisplayName(input.displayName) || (input.visibility !== undefined && !validVisibility(input.visibility))) return json({ error: "بيانات إنشاء الغرفة غير صالحة." }, 400);
  const visibility = input.visibility === "private" || (input.visibility === undefined && input.password.length > 0) ? "private" : "public";
  if (visibility === "private" && input.password.length < 4) return json({ error: "الغرفة الخاصة تحتاج كلمة مرور من 4 أحرف على الأقل." }, 400);
  let passwordHash = null; let passwordSalt = null;
  if (visibility === "private") {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    passwordSalt = toBase64(salt);
    passwordHash = toBase64(await derivePasswordHash(input.password, salt));
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const room = { code: createRoomCode(), name: input.name.trim(), hostParticipantId: input.participantId, passwordHash, passwordSalt };
    try {
      await env.ROOMS_DB.prepare("INSERT INTO watch_rooms (code, name, host_participant_id, password_hash, password_salt) VALUES (?, ?, ?, ?, ?)").bind(room.code, room.name, room.hostParticipantId, room.passwordHash, room.passwordSalt).run();
      await env.ROOMS_DB.prepare("INSERT OR REPLACE INTO room_settings (room_code, visibility, settings, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)").bind(room.code, visibility, "{}").run();
      return json(await roomResponse(room, input.participantId, input.displayName.trim(), env), 201);
    } catch (error) { if (!String(error).toLowerCase().includes("unique")) throw error; }
  }
  return json({ error: "تعذر تخصيص رمز غرفة فريد. حاول مرة أخرى." }, 503);
}

async function joinRoom(input, env) {
  if (!input || !validRoomCode(input.code) || typeof input.password !== "string" || input.password.length > 128 || !validParticipantId(input.participantId) || !validDisplayName(input.displayName)) return json({ error: "بيانات الانضمام غير صالحة." }, 400);
  const room = await findRoom(input.code, env);
  if (!room) return json({ error: "الغرفة غير موجودة أو انتهت صلاحيتها." }, 404);
  const settings = await findRoomSettings(room, env);
  if (settings.visibility === "private" && room.passwordHash && room.passwordSalt) {
    const candidate = await derivePasswordHash(input.password, fromBase64(room.passwordSalt));
    if (!safelyEquals(candidate, fromBase64(room.passwordHash))) return json({ error: "كلمة مرور الغرفة غير صحيحة." }, 403);
  }
  const previousMember = await findMember(room.code, input.participantId, env);
  if (previousMember?.kickedAt) return json({ error: "تمت إزالة هذا العضو من الغرفة بواسطة الإدارة." }, 403);
  return json(await roomResponse(room, input.participantId, input.displayName.trim(), env));
}

async function authorizedMember(roomCode, accessToken, env) {
  const access = await readRoomAccessToken(accessToken, env);
  if (!access || access.roomCode !== roomCode) return null;
  const [room, member] = await Promise.all([findRoom(roomCode, env), findMember(roomCode, access.participantId, env)]);
  if (!room || !member || member.kickedAt) return null;
  return { room, member, participantId: access.participantId };
}
function accessTokenFromRequest(request) {
  const authorization = request.headers.get("Authorization") || "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
}

async function roomState(roomCode, accessToken, env) {
  const actor = await authorizedMember(roomCode, accessToken, env);
  if (!actor) return json({ error: "انتهت صلاحية دخول الغرفة. انضم إلى الغرفة مرة أخرى." }, 401);
  const [memberRows, messageRows, settings] = await Promise.all([
    env.ROOMS_DB.prepare("SELECT m.participant_id AS participantId, m.display_name AS displayName, m.role, m.permissions, COALESCE(mm.muted, 0) AS muted, COALESCE(mm.camera_blocked, 0) AS cameraBlocked, mm.kicked_at AS kickedAt FROM room_members m LEFT JOIN room_member_moderation mm ON mm.room_code = m.room_code AND mm.participant_id = m.participant_id WHERE m.room_code = ? AND mm.kicked_at IS NULL ORDER BY m.joined_at ASC").bind(roomCode).all(),
    env.ROOMS_DB.prepare("SELECT id, author_participant_id AS authorId, author_name AS authorName, text, created_at AS createdAt FROM room_messages WHERE room_code = ? AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 60").bind(roomCode).all(),
    findRoomSettings(actor.room, env),
  ]);
  return json({ code: actor.room.code, name: actor.room.name, role: actor.member.role, permissions: memberPermissions(actor.member), member: publicMember(actor.member), members: memberRows.results.map(publicMember), messages: messageRows.results, visibility: settings.visibility });
}

async function createMessage(input, env) {
  if (!input || !validRoomCode(input.roomCode) || !validMessageId(input.id) || typeof input.text !== "string" || input.text.trim().length < 1 || input.text.trim().length > 800) return json({ error: "بيانات الرسالة غير صالحة." }, 400);
  const actor = await authorizedMember(input.roomCode, input.accessToken, env);
  if (!actor) return json({ error: "انتهت صلاحية دخول الغرفة. انضم إلى الغرفة مرة أخرى." }, 401);
  const text = input.text.trim();
  await env.ROOMS_DB.prepare("INSERT OR IGNORE INTO room_messages (id, room_code, author_participant_id, author_name, text) VALUES (?, ?, ?, ?, ?)").bind(input.id, input.roomCode, actor.participantId, actor.member.displayName, text).run();
  const message = await env.ROOMS_DB.prepare("SELECT id, author_participant_id AS authorId, author_name AS authorName, text, created_at AS createdAt FROM room_messages WHERE id = ? AND room_code = ? AND deleted_at IS NULL").bind(input.id, input.roomCode).first();
  return message ? json({ message }) : json({ error: "تعذر حفظ الرسالة." }, 409);
}
async function deleteMessage(input, env) {
  if (!input || !validRoomCode(input.roomCode) || !validMessageId(input.id)) return json({ error: "بيانات حذف الرسالة غير صالحة." }, 400);
  const actor = await authorizedMember(input.roomCode, input.accessToken, env);
  if (!actor) return json({ error: "انتهت صلاحية دخول الغرفة. انضم إلى الغرفة مرة أخرى." }, 401);
  const message = await env.ROOMS_DB.prepare("SELECT id, author_participant_id AS authorId FROM room_messages WHERE id = ? AND room_code = ? AND deleted_at IS NULL").bind(input.id, input.roomCode).first();
  if (!message) return json({ error: "الرسالة غير موجودة." }, 404);
  if (message.authorId !== actor.participantId && !memberPermissions(actor.member).includes("moderate_chat")) return json({ error: "ليس لديك إذن حذف رسالة هذا العضو." }, 403);
  await env.ROOMS_DB.prepare("UPDATE room_messages SET deleted_at = CURRENT_TIMESTAMP, deleted_by_participant_id = ? WHERE id = ? AND room_code = ?").bind(actor.participantId, input.id, input.roomCode).run();
  return json({ id: input.id, deleted: true });
}

async function setMemberPermissions(input, env) {
  if (!input || !validRoomCode(input.roomCode) || !validParticipantId(input.targetParticipantId) || !ROOM_ROLES.includes(input.role) || input.role === "host") return json({ error: "بيانات صلاحية العضو غير صالحة." }, 400);
  const actor = await authorizedMember(input.roomCode, input.accessToken, env);
  if (!actor) return json({ error: "انتهت صلاحية دخول الغرفة. انضم إلى الغرفة مرة أخرى." }, 401);
  if (actor.member.role !== "host") return json({ error: "المضيف فقط يستطيع تعيين المشرفين والصلاحيات." }, 403);
  const target = await findMember(input.roomCode, input.targetParticipantId, env);
  if (!target || target.role === "host") return json({ error: "لا يمكن تعديل هذا العضو." }, 404);
  const permissions = normalizedPermissions(input.permissions);
  await env.ROOMS_DB.prepare("UPDATE room_members SET role = ?, permissions = ?, updated_at = CURRENT_TIMESTAMP WHERE room_code = ? AND participant_id = ?").bind(input.role, JSON.stringify(permissions), input.roomCode, input.targetParticipantId).run();
  const updated = await findMember(input.roomCode, input.targetParticipantId, env);
  return json({ member: publicMember(updated) });
}

async function createLiveKitServiceToken(room, env) {
  if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) return "";
  const now = Math.floor(Date.now() / 1000);
  const header = toBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = toBase64Url(JSON.stringify({ exp: now + 90, iat: now, iss: env.LIVEKIT_API_KEY, nbf: now - 5, video: { room, roomAdmin: true, roomList: true } }));
  const unsignedToken = `${header}.${payload}`;
  return `${unsignedToken}.${toBase64Url(await hmacSha256(unsignedToken, env.LIVEKIT_API_SECRET))}`;
}
async function callLiveKitRoomService(method, payload, room, env) {
  const token = await createLiveKitServiceToken(room, env);
  if (!token) return null;
  const origin = env.LIVEKIT_URL.replace(/^wss:/, "https:").replace(/^ws:/, "http:").replace(/\/+$/, "");
  const response = await fetch(`${origin}/twirp/livekit.RoomService/${method}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!response.ok) throw new Error(`LiveKit ${method} failed`);
  return response.json().catch(() => null);
}
async function enforceLiveKitModeration(roomCode, participantId, member, action, env) {
  try {
    if (action === "kick") { await callLiveKitRoomService("RemoveParticipant", { room: roomCode, identity: participantId, revoke_token_ts: Math.floor(Date.now() / 1000) }, roomCode, env); return; }
    const participant = await callLiveKitRoomService("GetParticipant", { room: roomCode, identity: participantId }, roomCode, env);
    if ((action === "mute" || action === "block_camera") && participant?.tracks) {
      const matchTrack = (track) => action === "mute" ? track.source === "MICROPHONE" || track.source === 2 || track.type === "AUDIO" || track.type === 0 : track.source === "CAMERA" || track.source === 1 || track.type === "VIDEO" || track.type === 1;
      await Promise.all(participant.tracks.filter(matchTrack).map((track) => callLiveKitRoomService("MutePublishedTrack", { room: roomCode, identity: participantId, track_sid: track.sid, muted: true }, roomCode, env)));
    }
    const allowedSources = sourcePermissions(member);
    await callLiveKitRoomService("UpdateParticipant", { room: roomCode, identity: participantId, permission: { can_publish: allowedSources.length > 0, can_publish_data: true, can_subscribe: true, can_publish_sources: allowedSources } }, roomCode, env);
  } catch {
    // D1 remains authoritative when a participant is offline or the realtime server is briefly unavailable.
  }
}
async function setMemberAction(input, env) {
  if (!input || !validRoomCode(input.roomCode) || !validParticipantId(input.targetParticipantId) || !MEMBER_ACTIONS.includes(input.action)) return json({ error: "إجراء إدارة العضو غير صالح." }, 400);
  const actor = await authorizedMember(input.roomCode, input.accessToken, env);
  if (!actor) return json({ error: "انتهت صلاحية دخول الغرفة. انضم إلى الغرفة مرة أخرى." }, 401);
  const target = await findMember(input.roomCode, input.targetParticipantId, env);
  const canManage = actor.member.role === "host" || memberPermissions(actor.member).includes("manage_members");
  if (!target || target.role === "host" || !canManage || (actor.member.role !== "host" && target.role !== "member")) return json({ error: "ليس لديك إذن إدارة هذا العضو." }, 403);
  await env.ROOMS_DB.prepare("INSERT OR IGNORE INTO room_member_moderation (room_code, participant_id) VALUES (?, ?)").bind(input.roomCode, input.targetParticipantId).run();
  if (input.action === "kick") await env.ROOMS_DB.prepare("UPDATE room_member_moderation SET kicked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE room_code = ? AND participant_id = ?").bind(input.roomCode, input.targetParticipantId).run();
  if (input.action === "mute" || input.action === "unmute") await env.ROOMS_DB.prepare("UPDATE room_member_moderation SET muted = ?, updated_at = CURRENT_TIMESTAMP WHERE room_code = ? AND participant_id = ?").bind(input.action === "mute" ? 1 : 0, input.roomCode, input.targetParticipantId).run();
  if (input.action === "block_camera" || input.action === "allow_camera") await env.ROOMS_DB.prepare("UPDATE room_member_moderation SET camera_blocked = ?, updated_at = CURRENT_TIMESTAMP WHERE room_code = ? AND participant_id = ?").bind(input.action === "block_camera" ? 1 : 0, input.roomCode, input.targetParticipantId).run();
  const updated = await findMember(input.roomCode, input.targetParticipantId, env);
  await enforceLiveKitModeration(input.roomCode, input.targetParticipantId, updated, input.action, env);
  return json({ member: publicMember(updated), action: input.action });
}
async function updateRoomSettings(input, env) {
  if (!input || !validRoomCode(input.roomCode) || !validVisibility(input.visibility) || (input.password !== undefined && (typeof input.password !== "string" || input.password.length > 128))) return json({ error: "إعدادات الغرفة غير صالحة." }, 400);
  const actor = await authorizedMember(input.roomCode, input.accessToken, env);
  if (!actor || actor.member.role !== "host") return json({ error: "المضيف فقط يستطيع تعديل إعدادات الغرفة." }, 403);
  let passwordHash = null; let passwordSalt = null;
  if (input.visibility === "private") {
    if (typeof input.password !== "string" || input.password.length < 4) return json({ error: "الغرفة الخاصة تحتاج كلمة مرور من 4 أحرف على الأقل." }, 400);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    passwordSalt = toBase64(salt);
    passwordHash = toBase64(await derivePasswordHash(input.password, salt));
  }
  await env.ROOMS_DB.prepare("UPDATE watch_rooms SET password_hash = ?, password_salt = ? WHERE code = ?").bind(passwordHash, passwordSalt, input.roomCode).run();
  await env.ROOMS_DB.prepare("INSERT OR REPLACE INTO room_settings (room_code, visibility, settings, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)").bind(input.roomCode, input.visibility, "{}").run();
  return json({ visibility: input.visibility, passwordProtected: input.visibility === "private" });
}

async function searchYouTube(input, env) {
  if (!input || !validRoomCode(input.roomCode) || typeof input.query !== "string" || input.query.trim().length < 1 || input.query.trim().length > 160 || (input.pageToken !== undefined && (typeof input.pageToken !== "string" || input.pageToken.length > 256))) return json({ error: "عبارة البحث غير صالحة." }, 400);
  const actor = await authorizedMember(input.roomCode, input.accessToken, env);
  if (!actor || !memberPermissions(actor.member).includes("search_youtube")) return json({ error: "ليس لديك إذن البحث في YouTube داخل هذه الغرفة." }, 403);
  if (!env.YOUTUBE_DATA_API_KEY) return json({ error: "لم يُضبط بحث YouTube على الخادم بعد." }, 503);
  const params = new URLSearchParams({ key: env.YOUTUBE_DATA_API_KEY, maxResults: "20", part: "snippet", q: input.query.trim(), type: "video" });
  if (input.pageToken) params.set("pageToken", input.pageToken);
  const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
  if (!response.ok) return json({ error: "تعذر الحصول على نتائج YouTube الآن." }, 502);
  const result = await response.json();
  const items = Array.isArray(result.items) ? result.items.map((item) => ({
    channelTitle: String(item?.snippet?.channelTitle || "YouTube"),
    thumbnail: String(item?.snippet?.thumbnails?.medium?.url || item?.snippet?.thumbnails?.default?.url || ""),
    title: String(item?.snippet?.title || "فيديو"),
    videoId: String(item?.id?.videoId || ""),
  })).filter((item) => item.videoId) : [];
  return json({ items, nextPageToken: typeof result.nextPageToken === "string" ? result.nextPageToken : null });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") return json({ status: "ok", service: "AH4 Watch Party API", storage: "Cloudflare D1" });
    try {
      if (request.method === "POST" && url.pathname === "/v1/rooms") return await createRoom(await readJson(request), env);
      if (request.method === "POST" && url.pathname === "/v1/rooms/join") return await joinRoom(await readJson(request), env);
      if (request.method === "GET" && /^\/v1\/rooms\/AH4-[A-F0-9]{8}\/state$/.test(url.pathname)) return await roomState(url.pathname.split("/")[3], accessTokenFromRequest(request), env);
      if (request.method === "POST" && url.pathname === "/v1/rooms/messages") return await createMessage(await readJson(request), env);
      if (request.method === "POST" && url.pathname === "/v1/rooms/messages/delete") return await deleteMessage(await readJson(request), env);
      if (request.method === "POST" && url.pathname === "/v1/rooms/members/permissions") return await setMemberPermissions(await readJson(request), env);
      if (request.method === "POST" && url.pathname === "/v1/rooms/members/action") return await setMemberAction(await readJson(request), env);
      if (request.method === "POST" && url.pathname === "/v1/rooms/settings") return await updateRoomSettings(await readJson(request), env);
      if (request.method === "POST" && url.pathname === "/v1/rooms/youtube/search") return await searchYouTube(await readJson(request), env);
      return json({ error: "المسار غير موجود." }, 404);
    } catch {
      return json({ error: "تعذر الاتصال بخادم الغرف. حاول مرة أخرى." }, 500);
    }
  },
};

export { createLiveKitToken };
