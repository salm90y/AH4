import { afterEach, describe, expect, it, vi } from "vitest";

import { publishRoomSync, receiveRoomSync, setRoomSyncPublisher, subscribeRoomSync } from "../lib/room-sync";

afterEach(() => setRoomSyncPublisher(null));

describe("room sync channel", () => {
  it("publishes room state only when a realtime publisher is configured", async () => {
    expect(await publishRoomSync({ type: "playback", playing: true, position: 12, sentAt: 1 })).toBe(false);

    const publisher = vi.fn(async () => undefined);
    setRoomSyncPublisher(publisher);
    expect(await publishRoomSync({ type: "playback", playing: false, position: 18, sentAt: 2 })).toBe(true);
    expect(publisher).toHaveBeenCalledOnce();
  });

  it("delivers an incoming source update to subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRoomSync(listener);
    receiveRoomSync({ type: "source", sourceUrl: "https://example.test/live.m3u8", sourceLabel: "Live", sourceType: "hls", sentAt: 3 });
    unsubscribe();

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: "source", sourceLabel: "Live" }));
  });
});
