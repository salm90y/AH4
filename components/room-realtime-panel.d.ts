import type { RoomPermission, RoomRole } from "@/lib/room-api";

export type RealtimeRoomCredentials = { code: string; serverUrl: string; token: string };

export declare function RoomRealtimePanel(props: {
  accessToken: string;
  callVolume: number;
  credentials: RealtimeRoomCredentials;
  onCallVolumeChange: (volume: number) => void;
  onSelfAccessChange: (access: { role: RoomRole; permissions: RoomPermission[] }) => void;
  participantId: string;
  permissions: RoomPermission[];
  role: RoomRole;
}): React.JSX.Element;
