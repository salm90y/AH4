import { describe, expect, it } from "vitest";

describe("YouTube Data API credentials", () => {
  it("authenticates a one-result video search", async () => {
    const key = process.env.YOUTUBE_DATA_API_KEY;
    expect(key).toBeTruthy();

    const response = await fetch(`https://www.googleapis.com/youtube/v3/search?part=id&type=video&maxResults=1&q=LiveKit&key=${encodeURIComponent(key!)}`);
    expect(response.ok).toBe(true);
    const body = await response.json() as { items?: unknown[] };
    expect(Array.isArray(body.items)).toBe(true);
  }, 15_000);
});
