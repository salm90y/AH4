import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export type RoomPasswordDigest = {
  passwordSalt: string | null;
  passwordHash: string | null;
};

export function hashRoomPassword(password: string): RoomPasswordDigest {
  if (!password) return { passwordSalt: null, passwordHash: null };

  const passwordSalt = randomBytes(16).toString("hex");
  const passwordHash = scryptSync(password, passwordSalt, 64).toString("hex");
  return { passwordSalt, passwordHash };
}

export function verifyRoomPassword(
  password: string,
  digest: RoomPasswordDigest,
): boolean {
  if (!digest.passwordSalt || !digest.passwordHash) return true;
  if (!password) return false;

  const candidate = scryptSync(password, digest.passwordSalt, 64);
  const stored = Buffer.from(digest.passwordHash, "hex");
  return stored.length === candidate.length && timingSafeEqual(stored, candidate);
}
