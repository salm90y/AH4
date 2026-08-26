import { getApiBaseUrl } from "@/constants/oauth";

export type CloudRoomResponse = {
  code: string;
  name: string;
  host: boolean;
  passwordProtected: boolean;
  serverUrl: string;
  token: string;
};

type CreateRoomInput = {
  name: string;
  password: string;
  participantId: string;
  displayName: string;
};

type JoinRoomInput = {
  code: string;
  password: string;
  participantId: string;
  displayName: string;
};

function getProductionApiBaseUrl() {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) {
    throw new Error("لم يتم إعداد عنوان خادم الغرف في هذا الإصدار من التطبيق.");
  }
  return baseUrl;
}

async function requestRoom(path: string, input: CreateRoomInput | JoinRoomInput): Promise<CloudRoomResponse> {
  const response = await fetch(`${getProductionApiBaseUrl()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  const payload = (await response.json().catch(() => null)) as
    | CloudRoomResponse
    | { error?: string }
    | null;
  if (!response.ok) {
    const message = payload && "error" in payload ? payload.error : "تعذر الاتصال بخادم الغرف.";
    throw new Error(message || "تعذر الاتصال بخادم الغرف.");
  }
  if (!payload || !("code" in payload) || !("name" in payload)) {
    throw new Error("استجابة خادم الغرف غير صالحة.");
  }
  return payload;
}

export function createCloudRoom(input: CreateRoomInput) {
  return requestRoom("/v1/rooms", input);
}

export function joinCloudRoom(input: JoinRoomInput) {
  return requestRoom("/v1/rooms/join", input);
}
