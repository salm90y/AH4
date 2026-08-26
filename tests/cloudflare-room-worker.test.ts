import { describe, expect, it } from "vitest";
import worker from "../cloudflare/src/index.mjs";

type RoomRow = {
  code: string;
  name: string;
  hostParticipantId: string;
  passwordHash: string | null;
  passwordSalt: string | null;
};

class FakeRoomsDatabase {
  private rooms = new Map<string, RoomRow>();

  prepare(query: string) {
    const database = this;
    let parameters: unknown[] = [];
    return {
      bind(...values: unknown[]) {
        parameters = values;
        return this;
      },
      async run() {
        if (!query.startsWith("INSERT")) throw new Error("Unsupported D1 statement");
        const [code, name, hostParticipantId, passwordHash, passwordSalt] = parameters as [string, string, string, string | null, string | null];
        if (database.rooms.has(code)) throw new Error("UNIQUE constraint failed");
        database.rooms.set(code, { code, name, hostParticipantId, passwordHash, passwordSalt });
        return { success: true };
      },
      async first() {
        return database.rooms.get(parameters[0] as string) ?? null;
      },
    };
  }
}

describe("Cloudflare room Worker", () => {
  it("creates a password-protected room and only joins it with the correct password", async () => {
    const environment = { ROOMS_DB: new FakeRoomsDatabase() };
    const createResponse = await worker.fetch(
      new Request("https://api.ahmed1986y.com/v1/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "غرفة الاختبار",
          password: "secure-room-password",
          participantId: "host_12345678",
          displayName: "المضيف",
        }),
      }),
      environment,
    );

    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as { code: string; host: boolean; passwordProtected: boolean };
    expect(created.code).toMatch(/^AH4-[A-F0-9]{8}$/);
    expect(created.host).toBe(true);
    expect(created.passwordProtected).toBe(true);

    const deniedResponse = await worker.fetch(
      new Request("https://api.ahmed1986y.com/v1/rooms/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: created.code,
          password: "wrong-password",
          participantId: "guest_1234567",
          displayName: "ضيف",
        }),
      }),
      environment,
    );
    expect(deniedResponse.status).toBe(403);

    const joinedResponse = await worker.fetch(
      new Request("https://api.ahmed1986y.com/v1/rooms/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: created.code,
          password: "secure-room-password",
          participantId: "guest_1234567",
          displayName: "ضيف",
        }),
      }),
      environment,
    );
    expect(joinedResponse.status).toBe(200);
    expect((await joinedResponse.json()) as { host: boolean }).toMatchObject({ host: false });
  });
});
