export type RoomSyncEvent =
  | { type: "source"; sourceUrl: string; sourceLabel: string; sourceType: "hls" | "m3u" | "youtube"; sentAt: number }
  | { type: "playback"; playing: boolean; position: number; sentAt: number };

type SyncPublisher = (event: RoomSyncEvent) => Promise<void>;

let publisher: SyncPublisher | null = null;
const listeners = new Set<(event: RoomSyncEvent) => void>();

export function setRoomSyncPublisher(nextPublisher: SyncPublisher | null) {
  publisher = nextPublisher;
}

export async function publishRoomSync(event: RoomSyncEvent) {
  if (!publisher) return false;
  await publisher(event);
  return true;
}

export function receiveRoomSync(event: RoomSyncEvent) {
  listeners.forEach((listener) => listener(event));
}

export function subscribeRoomSync(listener: (event: RoomSyncEvent) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
