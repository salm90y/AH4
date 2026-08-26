import { describe, expect, it } from "vitest";

import { hashRoomPassword, verifyRoomPassword } from "../server/room-security";

describe("room password protection", () => {
  it("creates a salted digest without retaining the raw password", () => {
    const digest = hashRoomPassword("watch-party-secret");

    expect(digest.passwordSalt).toHaveLength(32);
    expect(digest.passwordHash).toHaveLength(128);
    expect(digest.passwordHash).not.toContain("watch-party-secret");
  });

  it("accepts only the password that produced the digest", () => {
    const digest = hashRoomPassword("correct-password");

    expect(verifyRoomPassword("correct-password", digest)).toBe(true);
    expect(verifyRoomPassword("wrong-password", digest)).toBe(false);
  });

  it("allows a room with no password", () => {
    expect(verifyRoomPassword("", hashRoomPassword(""))).toBe(true);
  });
});
