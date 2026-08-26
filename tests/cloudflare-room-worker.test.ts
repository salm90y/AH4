import { describe, expect, it } from "vitest";
import worker, { WatchRoom } from "../cloudflare/src/index.mjs";

class MemoryStorage {
  private values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async put(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }
}

function createEnvironment() {
  const rooms = new Map<string, WatchRoom>();
  return {
    WATCH_ROOMS: {
      idFromName: (name: string) => name,
      get: (id: string) => {
        if (!rooms.has(id)) {
          rooms.set(id, new WatchRoom({ storage: new MemoryStorage() }));
        }
        const room = rooms.get(id)!;
        return {
          fetch: (input: RequestInfo | URL, init?: RequestInit) => {
            const request = input instanceof Request ? input : new Request(input, init);
            return room.fetch(request);
          },
        };
      },
    },
  };
}

describe("Cloudflare room Worker", () => {
  it("creates a password-protected room and only joins it with the correct password", async () => {
    const environment = createEnvironment();
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
      environment as never,
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
      environment as never,
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
      environment as never,
    );
    expect(joinedResponse.status).toBe(200);
    expect((await joinedResponse.json()) as { host: boolean }).toMatchObject({ host: false });
  });
});
