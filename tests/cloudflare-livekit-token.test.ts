import { describe, expect, it } from "vitest";

import { createLiveKitToken } from "../cloudflare/src/index.mjs";

function decodeJwtSegment(segment: string) {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(segment.length / 4) * 4, "=");
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
}

describe("Cloudflare LiveKit room tokens", () => {
  it("issues a short-lived room token with media and data grants", async () => {
    const issued = await createLiveKitToken(
      { displayName: "مضيف", host: true, participantId: "guest_ah4_1234", room: "AH4-1234ABCD" },
      { LIVEKIT_API_KEY: "key", LIVEKIT_API_SECRET: "secret", LIVEKIT_URL: "wss://livekit.example" },
    );

    const [, payload, signature] = issued.token.split(".");
    const claims = decodeJwtSegment(payload);
    expect(issued.serverUrl).toBe("wss://livekit.example");
    expect(signature.length).toBeGreaterThan(20);
    expect(claims.sub).toBe("guest_ah4_1234");
    expect(claims.video).toMatchObject({ canPublish: true, canPublishData: true, room: "AH4-1234ABCD", roomJoin: true });
  });
});
