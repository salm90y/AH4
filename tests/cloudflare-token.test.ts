import { describe, expect, it } from "vitest";

describe("Cloudflare deployment token", () => {
  it("is active according to the official verification endpoint", async () => {
    const token = process.env.CLOUDFLARE_API_TOKEN;
    expect(token, "CLOUDFLARE_API_TOKEN must be configured").toBeTruthy();

    const response = await fetch("https://api.cloudflare.com/client/v4/user/tokens/verify", {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    const payload = (await response.json()) as {
      success?: boolean;
      result?: { status?: string };
    };

    expect(response.ok).toBe(true);
    expect(payload.success).toBe(true);
    expect(payload.result?.status).toBe("active");
  }, 20_000);
});
