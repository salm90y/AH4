import { getApiBaseUrl } from "@/constants/oauth";

export type RoomPermission = "control_source" | "control_playback" | "search_youtube" | "moderate_chat" | "manage_members";
export type RoomRole = "host" | "moderator" | "member";
export type RoomVisibility = "public" | "private";
export type RoomMemberAction = "mute" | "unmute" | "block_camera" | "allow_camera" | "kick";

export type RoomMember = {
  participantId: string;
  displayName: string;
  role: RoomRole;
  permissions: RoomPermission[];
  muted: boolean;
  cameraBlocked: boolean;
  kicked: boolean;
};

export type RoomChatMessage = { id: string; authorId: string; authorName: string; text: string; createdAt: string };
export type YouTubeSearchResult = { channelTitle: string; thumbnail: string; title: string; videoId: string };

export type CloudRoomResponse = {
  code: string;
  name: string;
  host: boolean;
  passwordProtected: boolean;
  visibility: RoomVisibility;
  role: RoomRole;
  permissions: RoomPermission[];
  accessToken: string;
  serverUrl: string;
  token: string;
};

export type RoomStateResponse = {
  code: string;
  name: string;
  role: RoomRole;
  permissions: RoomPermission[];
  member: RoomMember;
  members: RoomMember[];
  messages: RoomChatMessage[];
  visibility: RoomVisibility;
};

type CreateRoomInput = { name: string; password: string; participantId: string; displayName: string; visibility: RoomVisibility };
type JoinRoomInput = { code: string; password: string; participantId: string; displayName: string };

function getProductionApiBaseUrl() {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) throw new Error("لم يتم إعداد عنوان خادم الغرف في هذا الإصدار من التطبيق.");
  return baseUrl;
}

async function requestJson<T>(path: string, input?: unknown, method: "GET" | "POST" = "POST", accessToken?: string): Promise<T> {
  const response = await fetch(`${getProductionApiBaseUrl()}${path}`, {
    method,
    headers: { ...(input === undefined ? {} : { "Content-Type": "application/json" }), ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    body: input === undefined ? undefined : JSON.stringify(input),
  });
  const payload = (await response.json().catch(() => null)) as T | { error?: string } | null;
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload ? payload.error : "تعذر الاتصال بخادم الغرف.";
    throw new Error(message || "تعذر الاتصال بخادم الغرف.");
  }
  if (!payload) throw new Error("استجابة خادم الغرف غير صالحة.");
  return payload as T;
}

export function createCloudRoom(input: CreateRoomInput) { return requestJson<CloudRoomResponse>("/v1/rooms", input); }
export function joinCloudRoom(input: JoinRoomInput) { return requestJson<CloudRoomResponse>("/v1/rooms/join", input); }
export function getRoomState(input: { code: string; accessToken: string }) { return requestJson<RoomStateResponse>(`/v1/rooms/${encodeURIComponent(input.code)}/state`, undefined, "GET", input.accessToken); }
export function postRoomMessage(input: { roomCode: string; accessToken: string; id: string; text: string }) { return requestJson<{ message: RoomChatMessage }>("/v1/rooms/messages", input); }
export function deleteRoomMessage(input: { roomCode: string; accessToken: string; id: string }) { return requestJson<{ id: string; deleted: boolean }>("/v1/rooms/messages/delete", input); }
export function updateRoomMemberPermissions(input: { roomCode: string; accessToken: string; targetParticipantId: string; role: Exclude<RoomRole, "host">; permissions: RoomPermission[] }) { return requestJson<{ member: RoomMember }>("/v1/rooms/members/permissions", input); }
export function performRoomMemberAction(input: { roomCode: string; accessToken: string; targetParticipantId: string; action: RoomMemberAction }) { return requestJson<{ member: RoomMember; action: RoomMemberAction }>("/v1/rooms/members/action", input); }
export function updateCloudRoomSettings(input: { roomCode: string; accessToken: string; visibility: RoomVisibility; password?: string }) { return requestJson<{ visibility: RoomVisibility; passwordProtected: boolean }>("/v1/rooms/settings", input); }
export function searchRoomYouTube(input: { roomCode: string; accessToken: string; query: string; pageToken?: string | null }) { return requestJson<{ items: YouTubeSearchResult[]; nextPageToken: string | null }>("/v1/rooms/youtube/search", input); }
