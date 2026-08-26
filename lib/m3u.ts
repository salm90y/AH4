export type M3uEntry = {
  id: string;
  name: string;
  group: string;
  logo?: string;
  url: string;
};

function attribute(line: string, key: string) {
  const match = line.match(new RegExp(`${key}="([^"]*)"`, "i"));
  return match?.[1]?.trim();
}

export function parseM3uPlaylist(content: string): M3uEntry[] {
  const rows = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  const entries: M3uEntry[] = [];

  for (let index = 0; index < rows.length; index += 1) {
    const metadata = rows[index].trim();
    if (!metadata.startsWith("#EXTINF")) continue;

    const url = rows.slice(index + 1).find((row) => row.trim() && !row.trim().startsWith("#"))?.trim();
    if (!url || !/^https?:\/\//i.test(url)) continue;

    const commaIndex = metadata.lastIndexOf(",");
    const name = (commaIndex >= 0 ? metadata.slice(commaIndex + 1) : "قناة بدون اسم").trim() || "قناة بدون اسم";
    const group = attribute(metadata, "group-title") || "بدون مجموعة";
    const logo = attribute(metadata, "tvg-logo");

    entries.push({
      id: `${index}-${url}`,
      name,
      group,
      logo,
      url,
    });
  }

  return entries;
}
