import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";

const encoder = new TextEncoder();

function liveKitHttpUrl(url: string) {
  return url.replace(/^wss:/, "https:").replace(/^ws:/, "http:").replace(/\/$/, "");
}

describe("LiveKit credentials", () => {
  it("signs a short-lived room-list grant and reaches the room service", async () => {
    const url = process.env.LIVEKIT_URL;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    expect(url).toBeTruthy();
    expect(apiKey).toBeTruthy();
    expect(apiSecret).toBeTruthy();

    const token = await new SignJWT({ video: { roomList: true } })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer(apiKey!)
      .setSubject("ah4-livekit-credential-check")
      .setIssuedAt()
      .setExpirationTime("2m")
      .sign(encoder.encode(apiSecret!));

    const response = await fetch(`${liveKitHttpUrl(url!)}/twirp/livekit.RoomService/ListRooms`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });

    const body = await response.text();
    expect(response.ok, body).toBe(true);
  }, 15_000);
});
