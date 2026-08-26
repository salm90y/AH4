import { describe, expect, it } from "vitest";

import { parseM3uPlaylist } from "../lib/m3u";

describe("parseM3uPlaylist", () => {
  it("extracts channel names, groups, logos, and HTTP stream URLs", () => {
    const result = parseM3uPlaylist(`#EXTM3U
#EXTINF:-1 tvg-logo="https://cdn.example.com/news.png" group-title="News",World News
https://media.example.com/world-news.m3u8
#EXTINF:-1 group-title="Sports",Arena Live
https://media.example.com/arena.m3u8
`);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      name: "World News",
      group: "News",
      logo: "https://cdn.example.com/news.png",
      url: "https://media.example.com/world-news.m3u8",
    });
    expect(result[1]).toMatchObject({ name: "Arena Live", group: "Sports" });
  });

  it("ignores entries without a usable HTTP source", () => {
    const result = parseM3uPlaylist(`#EXTM3U
#EXTINF:-1 group-title="Private",Broken Channel
file:///private/stream.m3u8
`);

    expect(result).toEqual([]);
  });
});
