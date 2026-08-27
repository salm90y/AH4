import { describe, expect, it } from "vitest";
import worker from "../cloudflare/src/index.mjs";

type RoomRow = { code: string; name: string; hostParticipantId: string; passwordHash: string | null; passwordSalt: string | null };
type MemberRow = { roomCode: string; participantId: string; displayName: string; role: "host" | "moderator" | "member"; permissions: string };
type MessageRow = { id: string; roomCode: string; authorId: string; authorName: string; text: string; createdAt: string; deletedAt: string | null; deletedBy: string | null };
type SettingsRow = { visibility: "public" | "private"; settings: string };
type ModerationRow = { muted: number; cameraBlocked: number; kickedAt: string | null };

class FakeRoomsDatabase {
  private rooms = new Map<string, RoomRow>();
  private members = new Map<string, MemberRow>();
  private messages = new Map<string, MessageRow>();
  private settings = new Map<string, SettingsRow>();
  private moderation = new Map<string, ModerationRow>();
  private key(roomCode: string, participantId: string) { return `${roomCode}:${participantId}`; }

  prepare(query: string) {
    const database = this;
    let parameters: unknown[] = [];
    return {
      bind(...values: unknown[]) { parameters = values; return this; },
      async run() {
        if (query.startsWith("INSERT INTO watch_rooms")) {
          const [code, name, hostParticipantId, passwordHash, passwordSalt] = parameters as [string, string, string, string | null, string | null];
          if (database.rooms.has(code)) throw new Error("UNIQUE constraint failed");
          database.rooms.set(code, { code, name, hostParticipantId, passwordHash, passwordSalt });
        } else if (query.startsWith("INSERT OR REPLACE INTO room_settings")) {
          const [roomCode, visibility, settings] = parameters as [string, SettingsRow["visibility"], string];
          database.settings.set(roomCode, { visibility, settings });
        } else if (query.startsWith("INSERT OR IGNORE INTO room_members")) {
          const [roomCode, participantId, displayName, role, permissions] = parameters as [string, string, string, MemberRow["role"], string];
          const key = database.key(roomCode, participantId);
          if (!database.members.has(key)) database.members.set(key, { roomCode, participantId, displayName, role, permissions });
        } else if (query.startsWith("UPDATE room_members SET display_name")) {
          const [displayName, roomCode, participantId] = parameters as [string, string, string];
          const member = database.members.get(database.key(roomCode, participantId));
          if (member) member.displayName = displayName;
        } else if (query.startsWith("UPDATE room_members SET role")) {
          const [role, permissions, roomCode, participantId] = parameters as [MemberRow["role"], string, string, string];
          const member = database.members.get(database.key(roomCode, participantId));
          if (member) { member.role = role; member.permissions = permissions; }
        } else if (query.startsWith("UPDATE watch_rooms SET password_hash")) {
          const [passwordHash, passwordSalt, roomCode] = parameters as [string | null, string | null, string];
          const room = database.rooms.get(roomCode);
          if (room) { room.passwordHash = passwordHash; room.passwordSalt = passwordSalt; }
        } else if (query.startsWith("INSERT OR IGNORE INTO room_member_moderation")) {
          const [roomCode, participantId] = parameters as [string, string];
          const key = database.key(roomCode, participantId);
          if (!database.moderation.has(key)) database.moderation.set(key, { muted: 0, cameraBlocked: 0, kickedAt: null });
        } else if (query.startsWith("UPDATE room_member_moderation SET kicked_at")) {
          const [roomCode, participantId] = parameters as [string, string];
          const row = database.moderation.get(database.key(roomCode, participantId));
          if (row) row.kickedAt = new Date().toISOString();
        } else if (query.startsWith("UPDATE room_member_moderation SET muted")) {
          const [muted, roomCode, participantId] = parameters as [number, string, string];
          const row = database.moderation.get(database.key(roomCode, participantId));
          if (row) row.muted = muted;
        } else if (query.startsWith("UPDATE room_member_moderation SET camera_blocked")) {
          const [cameraBlocked, roomCode, participantId] = parameters as [number, string, string];
          const row = database.moderation.get(database.key(roomCode, participantId));
          if (row) row.cameraBlocked = cameraBlocked;
        } else if (query.startsWith("INSERT OR IGNORE INTO room_messages")) {
          const [id, roomCode, authorId, authorName, text] = parameters as [string, string, string, string, string];
          if (!database.messages.has(id)) database.messages.set(id, { id, roomCode, authorId, authorName, text, createdAt: new Date().toISOString(), deletedAt: null, deletedBy: null });
        } else if (query.startsWith("UPDATE room_messages SET deleted_at")) {
          const [deletedBy, id, roomCode] = parameters as [string, string, string];
          const message = database.messages.get(id);
          if (message && message.roomCode === roomCode) { message.deletedAt = new Date().toISOString(); message.deletedBy = deletedBy; }
        } else throw new Error(`Unsupported D1 statement: ${query}`);
        return { success: true };
      },
      async first() {
        if (query.includes("FROM watch_rooms")) return database.rooms.get(parameters[0] as string) ?? null;
        if (query.includes("FROM room_settings")) return database.settings.get(parameters[0] as string) ?? null;
        if (query.includes("FROM room_members")) {
          const member = database.members.get(database.key(parameters[0] as string, parameters[1] as string));
          return member ? { ...member, ...(database.moderation.get(database.key(member.roomCode, member.participantId)) ?? { muted: 0, cameraBlocked: 0, kickedAt: null }) } : null;
        }
        if (query.includes("FROM room_messages")) {
          const message = database.messages.get(parameters[0] as string);
          if (!message || message.roomCode !== parameters[1] || message.deletedAt) return null;
          return message;
        }
        throw new Error(`Unsupported D1 statement: ${query}`);
      },
      async all() {
        if (query.includes("FROM room_members")) return { results: [...database.members.values()].filter((member) => member.roomCode === parameters[0]).map((member) => ({ ...member, ...(database.moderation.get(database.key(member.roomCode, member.participantId)) ?? { muted: 0, cameraBlocked: 0, kickedAt: null }) })) };
        if (query.includes("FROM room_messages")) return { results: [...database.messages.values()].filter((message) => message.roomCode === parameters[0] && !message.deletedAt) };
        throw new Error(`Unsupported D1 statement: ${query}`);
      },
    };
  }
}

const env = () => ({ ROOMS_DB: new FakeRoomsDatabase(), LIVEKIT_API_SECRET: "test-worker-secret" });

describe("Cloudflare room Worker", () => {
  it("creates a password-protected room and only joins it with the correct password", async () => {
    const environment = env();
    const createResponse = await worker.fetch(new Request("https://api.ahmed1986y.com/v1/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "غرفة الاختبار", password: "secure-room-password", participantId: "host_12345678", displayName: "المضيف" }) }), environment);
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as { code: string; host: boolean; passwordProtected: boolean; role: string; accessToken: string };
    expect(created.code).toMatch(/^AH4-[A-F0-9]{8}$/);
    expect(created).toMatchObject({ host: true, passwordProtected: true, role: "host" });
    expect(created.accessToken).toBeTruthy();

    const deniedResponse = await worker.fetch(new Request("https://api.ahmed1986y.com/v1/rooms/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: created.code, password: "wrong-password", participantId: "guest_1234567", displayName: "ضيف" }) }), environment);
    expect(deniedResponse.status).toBe(403);

    const joinedResponse = await worker.fetch(new Request("https://api.ahmed1986y.com/v1/rooms/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: created.code, password: "secure-room-password", participantId: "guest_1234567", displayName: "ضيف" }) }), environment);
    expect(joinedResponse.status).toBe(200);
    expect((await joinedResponse.json()) as { host: boolean }).toMatchObject({ host: false });
  });

  it("lets only the host grant a moderator role and permits message deletion by the author or moderator", async () => {
    const environment = env();
    const created = await (await worker.fetch(new Request("https://api.ahmed1986y.com/v1/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "صلاحيات", password: "", participantId: "host_87654321", displayName: "مالك الغرفة" }) }), environment)).json() as { code: string; accessToken: string };
    const joined = await (await worker.fetch(new Request("https://api.ahmed1986y.com/v1/rooms/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: created.code, password: "", participantId: "guest_8765432", displayName: "سارة" }) }), environment)).json() as { accessToken: string };

    const grant = await worker.fetch(new Request("https://api.ahmed1986y.com/v1/rooms/members/permissions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roomCode: created.code, accessToken: created.accessToken, targetParticipantId: "guest_8765432", role: "moderator", permissions: ["moderate_chat"] }) }), environment);
    expect(grant.status).toBe(200);
    expect((await grant.json()) as { member: { role: string; permissions: string[] } }).toMatchObject({ member: { role: "moderator", permissions: expect.arrayContaining(["moderate_chat"]) } });

    const state = await worker.fetch(new Request(`https://api.ahmed1986y.com/v1/rooms/${created.code}/state`, { headers: { Authorization: `Bearer ${created.accessToken}` } }), environment);
    expect(state.status).toBe(200);
    expect((await state.json()) as { role: string; members: Array<{ role: string }> }).toMatchObject({ role: "host", members: expect.arrayContaining([expect.objectContaining({ role: "moderator" })]) });

    const post = await worker.fetch(new Request("https://api.ahmed1986y.com/v1/rooms/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roomCode: created.code, accessToken: joined.accessToken, id: "message_12345678", text: "رسالة قابلة للحذف" }) }), environment);
    expect(post.status).toBe(200);

    const remove = await worker.fetch(new Request("https://api.ahmed1986y.com/v1/rooms/messages/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roomCode: created.code, accessToken: joined.accessToken, id: "message_12345678" }) }), environment);
    expect(remove.status).toBe(200);
  });

  it("enforces mute and kick actions in the room state", async () => {
    const environment = env();
    const created = await (await worker.fetch(new Request("https://api.ahmed1986y.com/v1/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "إدارة الأعضاء", password: "", visibility: "public", participantId: "host_99112233", displayName: "المضيف" }) }), environment)).json() as { code: string; accessToken: string };
    const joined = await (await worker.fetch(new Request("https://api.ahmed1986y.com/v1/rooms/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: created.code, password: "", participantId: "guest_9911223", displayName: "عضو" }) }), environment)).json() as { accessToken: string };

    const mute = await worker.fetch(new Request("https://api.ahmed1986y.com/v1/rooms/members/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roomCode: created.code, accessToken: created.accessToken, targetParticipantId: "guest_9911223", action: "mute" }) }), environment);
    expect(mute.status).toBe(200);
    expect((await mute.json()) as { member: { muted: boolean } }).toMatchObject({ member: { muted: true } });

    const kick = await worker.fetch(new Request("https://api.ahmed1986y.com/v1/rooms/members/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roomCode: created.code, accessToken: created.accessToken, targetParticipantId: "guest_9911223", action: "kick" }) }), environment);
    expect(kick.status).toBe(200);
    const denied = await worker.fetch(new Request(`https://api.ahmed1986y.com/v1/rooms/${created.code}/state`, { headers: { Authorization: `Bearer ${joined.accessToken}` } }), environment);
    expect(denied.status).toBe(401);
  });

  it("persists the host source so a guest receives it on joining and state refresh", async () => {
    const environment = env();
    const created = await (await worker.fetch(new Request("https://api.ahmed1986y.com/v1/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "مصدر مشترك", password: "", participantId: "host_22334455", displayName: "المضيف" }) }), environment)).json() as { code: string; accessToken: string };
    const source = { sourceLabel: "فيديو الغرفة", sourceType: "youtube", sourceUrl: "https://www.youtube.com/watch?v=abc123xyz00" };
    const saved = await worker.fetch(new Request("https://api.ahmed1986y.com/v1/rooms/source", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roomCode: created.code, accessToken: created.accessToken, source }) }), environment);
    expect(saved.status).toBe(200);

    const joined = await (await worker.fetch(new Request("https://api.ahmed1986y.com/v1/rooms/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: created.code, password: "", participantId: "guest_2233445", displayName: "ضيف" }) }), environment)).json() as { accessToken: string; source: typeof source };
    expect(joined.source).toEqual(source);

    const state = await (await worker.fetch(new Request(`https://api.ahmed1986y.com/v1/rooms/${created.code}/state`, { headers: { Authorization: `Bearer ${joined.accessToken}` } }), environment)).json() as { source: typeof source };
    expect(state.source).toEqual(source);

    const playback = { playing: true, position: 42.5, sentAt: 1_700_000_000_000 };
    const savedPlayback = await worker.fetch(new Request("https://api.ahmed1986y.com/v1/rooms/playback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roomCode: created.code, accessToken: created.accessToken, playback }) }), environment);
    expect(savedPlayback.status).toBe(200);
    const refreshed = await (await worker.fetch(new Request(`https://api.ahmed1986y.com/v1/rooms/${created.code}/state`, { headers: { Authorization: `Bearer ${joined.accessToken}` } }), environment)).json() as { playback: typeof playback };
    expect(refreshed.playback).toEqual(playback);
  });
});
