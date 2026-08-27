import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { AndroidAudioTypePresets, AudioSession, isTrackReference, LiveKitRoom, useRoomContext, useTracks, VideoTrack } from "@livekit/react-native";
import { DataPacket_Kind, RoomEvent, Track } from "livekit-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { deleteRoomMessage, getRoomState, postRoomMessage, updateRoomMemberPermissions, type RoomChatMessage, type RoomMember, type RoomPermission, type RoomRole } from "@/lib/room-api";
import { ensureLiveKitGlobals } from "@/lib/livekit-setup";

export type RealtimeRoomCredentials = { code: string; serverUrl: string; token: string };

type ChatMessage = RoomChatMessage & { mine: boolean };
type ActivePane = "chat" | "camera" | "members" | null;

const palette = {
  cyan: "#4EA9FF",
  muted: "#93A2C4",
  panel: "#111A2D",
  primary: "#8B5CF6",
  success: "#48D8A3",
  text: "#F8F8FF",
};

const permissionLabels: Record<RoomPermission, string> = {
  control_source: "المصدر",
  control_playback: "التشغيل",
  moderate_chat: "الدردشة",
};

export function RoomRealtimePanel({
  accessToken,
  credentials,
  onSelfAccessChange,
  participantId,
  permissions,
  role,
}: {
  accessToken: string;
  credentials: RealtimeRoomCredentials;
  onSelfAccessChange: (access: { role: RoomRole; permissions: RoomPermission[] }) => void;
  participantId: string;
  permissions: RoomPermission[];
  role: RoomRole;
}) {
  ensureLiveKitGlobals();
  const [audioConfigured, setAudioConfigured] = useState(false);

  useEffect(() => {
    let active = true;
    void AudioSession.configureAudio({
      android: {
        preferredOutputList: ["bluetooth", "headset", "speaker", "earpiece"],
        audioTypeOptions: {
          ...AndroidAudioTypePresets.communication,
          manageAudioFocus: false,
          audioFocusMode: "gainTransientMayDuck",
        },
      },
    }).catch(() => undefined).finally(() => active && setAudioConfigured(true));
    return () => { active = false; };
  }, []);

  if (!credentials.serverUrl || !credentials.token) {
    return <View style={styles.unavailable}><MaterialIcons color={palette.cyan} name="cloud-sync" size={20} /><Text style={styles.unavailableText}>يتم تجهيز قناة التواصل الآمن للغرفة. أعد فتح الغرفة بعد اكتمال مزامنة الخادم.</Text></View>;
  }
  if (!audioConfigured) return <View style={styles.compactLoading}><MaterialIcons color={palette.cyan} name="sync" size={18} /></View>;

  return (
    <LiveKitRoom audio={false} connect serverUrl={credentials.serverUrl} token={credentials.token} video={false}>
      <RealtimeControls accessToken={accessToken} code={credentials.code} onSelfAccessChange={onSelfAccessChange} participantId={participantId} permissions={permissions} role={role} />
    </LiveKitRoom>
  );
}

function RealtimeControls({
  accessToken,
  code,
  onSelfAccessChange,
  participantId,
  permissions,
  role,
}: {
  accessToken: string;
  code: string;
  onSelfAccessChange: (access: { role: RoomRole; permissions: RoomPermission[] }) => void;
  participantId: string;
  permissions: RoomPermission[];
  role: RoomRole;
}) {
  const room = useRoomContext();
  const [activePane, setActivePane] = useState<ActivePane>("chat");
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [draft, setDraft] = useState("");
  const [connected, setConnected] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [callOn, setCallOn] = useState(false);
  const [talking, setTalking] = useState(false);
  const [busy, setBusy] = useState(false);
  const pendingPress = useRef(false);
  const cameraTracks = useTracks([Track.Source.Camera]);
  const canModerate = permissions.includes("moderate_chat");

  const hydrateRoom = useCallback(async () => {
    if (!accessToken) return;
    const state = await getRoomState({ code, accessToken });
    setMembers(state.members);
    setChat(state.messages.map((message) => ({ ...message, mine: message.authorId === participantId })));
    onSelfAccessChange({ role: state.role, permissions: state.permissions });
  }, [accessToken, code, onSelfAccessChange, participantId]);

  useEffect(() => {
    let mounted = true;
    void hydrateRoom().catch(() => mounted && undefined);
    const refresh = setInterval(() => void hydrateRoom().catch(() => undefined), 20_000);
    return () => { mounted = false; clearInterval(refresh); };
  }, [hydrateRoom]);

  useEffect(() => {
    const onData = (payload: Uint8Array, participant?: { name?: string; identity?: string }, kind?: DataPacket_Kind) => {
      if (kind !== DataPacket_Kind.RELIABLE) return;
      try {
        const packet = JSON.parse(new TextDecoder().decode(payload)) as { kind?: string; id?: string; text?: string; authorId?: string; authorName?: string; createdAt?: string };
        if (packet.kind === "ah4-chat-delete" && packet.id) {
          setChat((current) => current.filter((message) => message.id !== packet.id));
          return;
        }
        const messageId = packet.id;
        const messageText = packet.text?.trim();
        if (packet.kind !== "ah4-chat" || !messageId || !messageText) return;
        const authorId = packet.authorId || participant?.identity || "member";
        setChat((current) => current.some((message) => message.id === messageId) ? current : [...current, {
          id: messageId,
          authorId,
          authorName: packet.authorName || participant?.name || participant?.identity || "عضو",
          createdAt: packet.createdAt || new Date().toISOString(),
          mine: authorId === participantId,
          text: messageText,
        }].slice(-60));
      } catch {
        // Ignore packets belonging to other realtime features.
      }
    };
    room.on(RoomEvent.DataReceived, onData);
    setConnected(true);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
      void room.localParticipant.setCameraEnabled(false);
      void room.localParticipant.setMicrophoneEnabled(false);
      void AudioSession.stopAudioSession().catch(() => undefined);
    };
  }, [participantId, room]);

  const liveParticipantCount = useMemo(() => room.remoteParticipants.size + 1, [room.remoteParticipants.size]);
  const memberCount = Math.max(liveParticipantCount, members.length || 1);

  const setOpenCall = async () => {
    if (busy) return;
    try {
      setBusy(true);
      const next = !callOn;
      if (next) await AudioSession.startAudioSession();
      await room.localParticipant.setMicrophoneEnabled(next);
      setCallOn(next);
      if (next) setTalking(false);
      if (!next) await AudioSession.stopAudioSession();
    } catch {
      Alert.alert("تعذر تشغيل الاتصال", "تحقق من إذن الميكروفون واتصالك بالإنترنت ثم حاول مرة أخرى.");
    } finally {
      setBusy(false);
    }
  };

  const setCamera = async () => {
    if (busy) return;
    try {
      setBusy(true);
      const next = !cameraOn;
      await room.localParticipant.setCameraEnabled(next);
      setCameraOn(next);
      setActivePane(next ? "camera" : "chat");
    } catch {
      Alert.alert("تعذر تشغيل الكاميرا", "تحقق من إذن الكاميرا ثم حاول مرة أخرى.");
    } finally {
      setBusy(false);
    }
  };

  const startTalking = async () => {
    if (busy || callOn || pendingPress.current) return;
    pendingPress.current = true;
    try {
      await AudioSession.startAudioSession();
      await room.localParticipant.setMicrophoneEnabled(true);
      setTalking(true);
    } catch {
      Alert.alert("تعذر تشغيل الهوكي توكي", "تحقق من إذن الميكروفون ثم اضغط مطولاً مرة أخرى.");
    } finally {
      pendingPress.current = false;
    }
  };

  const stopTalking = async () => {
    if (callOn || !talking) return;
    try {
      await room.localParticipant.setMicrophoneEnabled(false);
      await AudioSession.stopAudioSession();
    } finally {
      setTalking(false);
    }
  };

  const sendChat = async () => {
    const text = draft.trim();
    if (!text || !accessToken) return;
    const id = `message_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    try {
      const { message } = await postRoomMessage({ roomCode: code, accessToken, id, text });
      const outgoing: ChatMessage = { ...message, mine: true };
      setDraft("");
      setChat((current) => current.some((item) => item.id === id) ? current : [...current, outgoing].slice(-60));
      await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ kind: "ah4-chat", ...message })), { reliable: true, topic: "ah4-chat" });
    } catch (error) {
      Alert.alert("تعذر إرسال الرسالة", error instanceof Error ? error.message : "حاول مرة أخرى.");
    }
  };

  const removeChat = async (message: ChatMessage) => {
    if (!accessToken || (!message.mine && !canModerate)) return;
    try {
      await deleteRoomMessage({ roomCode: code, accessToken, id: message.id });
      setChat((current) => current.filter((item) => item.id !== message.id));
      await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ kind: "ah4-chat-delete", id: message.id })), { reliable: true, topic: "ah4-chat" });
    } catch (error) {
      Alert.alert("تعذر حذف الرسالة", error instanceof Error ? error.message : "حاول مرة أخرى.");
    }
  };

  const setMemberAccess = async (member: RoomMember, nextRole: Exclude<RoomRole, "host">, nextPermissions: RoomPermission[]) => {
    if (role !== "host" || member.role === "host") return;
    try {
      const { member: updated } = await updateRoomMemberPermissions({ roomCode: code, accessToken, targetParticipantId: member.participantId, role: nextRole, permissions: nextPermissions });
      setMembers((current) => current.map((item) => item.participantId === updated.participantId ? updated : item));
    } catch (error) {
      Alert.alert("تعذر حفظ الصلاحية", error instanceof Error ? error.message : "حاول مرة أخرى.");
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.panel}>
      <View style={styles.toolsRow}>
        <Pressable accessibilityLabel="إدارة أعضاء الغرفة" accessibilityRole="button" onPress={() => setActivePane(activePane === "members" ? "chat" : "members")} style={({ pressed }) => [styles.membersTool, activePane === "members" && styles.toolActive, pressed && styles.toolPressed]}>
          <MaterialIcons color="#C7D4F2" name="group" size={20} />
          <View style={[styles.connectionDot, connected && styles.connectionDotLive]} />
          <View style={styles.membersBadge}><Text style={styles.membersBadgeText}>{memberCount}</Text></View>
        </Pressable>
        <Tool active={cameraOn} icon={cameraOn ? "videocam" : "videocam-off"} label="الكاميرا" tone="camera" onPress={() => void setCamera()} />
        <Pressable accessibilityLabel="هوكي توكي، اضغط مطولًا للتحدث" accessibilityRole="button" onPressIn={() => void startTalking()} onPressOut={() => void stopTalking()} style={({ pressed }) => [styles.talkTool, talking && styles.talkToolLive, pressed && styles.toolPressed]}>
          <MaterialIcons color={talking ? "#FFFFFF" : "#8EF7D9"} name="keyboard-voice" size={21} />
        </Pressable>
        <Tool active={false} icon="auto-awesome" label="مزامنة المشاهدة" tone="sync" onPress={() => Alert.alert("المزامنة مفعّلة", "يتابع التطبيق المصدر والتشغيل ويصحح فرق الوقت عند الحاجة.")} />
        <Tool active={callOn} icon={callOn ? "call-end" : "phone-in-talk"} label={callOn ? "إنهاء الاتصال" : "اتصال صوتي"} tone="call" onPress={() => void setOpenCall()} />
        <Tool active={activePane === "chat"} icon="chat-bubble-outline" label="الدردشة" tone="chat" onPress={() => setActivePane(activePane === "chat" ? null : "chat")} />
      </View>

      {activePane === "chat" ? <View style={styles.chatPane}>
        <FlatList
          contentContainerStyle={chat.length ? styles.messagesContent : styles.messagesEmpty}
          data={chat}
          keyExtractor={(message) => message.id}
          renderItem={({ item }) => <ChatRow canDelete={item.mine || canModerate} message={item} onDelete={() => void removeChat(item)} />}
          showsVerticalScrollIndicator={false}
          style={styles.messages}
        />
        <View style={styles.composer}>
          <Pressable accessibilityLabel="إرسال الرسالة" accessibilityRole="button" onPress={() => void sendChat()} style={({ pressed }) => [styles.send, pressed && styles.toolPressed]}><MaterialIcons color="#C6DAFF" name="send" size={20} /></Pressable>
          <TextInput maxLength={800} onChangeText={setDraft} placeholder="اكتب رسالة…" placeholderTextColor="#7383AA" returnKeyType="send" style={styles.chatInput} textAlign="right" value={draft} onSubmitEditing={() => void sendChat()} />
        </View>
      </View> : null}

      {activePane === "camera" ? <View style={styles.cameraPane}><View style={styles.cameraGrid}>{cameraTracks.slice(0, 4).map((track, index) => isTrackReference(track) ? <VideoTrack key={track.publication.trackSid} style={styles.videoTrack} trackRef={track} /> : <View key={`placeholder-${index}`} style={styles.videoPlaceholder} />)}</View></View> : null}

      {activePane === "members" ? <MemberPanel currentRole={role} members={members} onChange={setMemberAccess} /> : null}
    </KeyboardAvoidingView>
  );
}

function Tool({ active, icon, label, tone, onPress }: { active: boolean; icon: React.ComponentProps<typeof MaterialIcons>["name"]; label: string; tone: "camera" | "call" | "chat" | "sync"; onPress: () => void }) {
  const toneStyle = tone === "camera" ? styles.toolCamera : tone === "call" ? styles.toolCall : tone === "sync" ? styles.toolSync : styles.toolChat;
  return <Pressable accessibilityLabel={label} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.tool, toneStyle, active && styles.toolActive, active && tone === "call" && styles.toolCallActive, active && tone === "chat" && styles.toolChatActive, pressed && styles.toolPressed]}><MaterialIcons color={active ? "#FFFFFF" : "#C8D1EC"} name={icon} size={20} /></Pressable>;
}

function ChatRow({ canDelete, message, onDelete }: { canDelete: boolean; message: ChatMessage; onDelete: () => void }) {
  const initial = message.authorName.trim().slice(0, 1).toLocaleUpperCase("ar") || "؟";
  return <View style={[styles.messageRow, message.mine && styles.messageRowMine]}>
    <View style={[styles.avatar, message.mine && styles.avatarMine]}><Text style={styles.avatarText}>{initial}</Text></View>
    <View style={[styles.messageBody, message.mine && styles.messageBodyMine]}><View style={styles.messageMeta}><Text style={styles.messageSender}>{message.authorName}</Text>{canDelete ? <Pressable accessibilityLabel="حذف الرسالة" accessibilityRole="button" onPress={onDelete} style={({ pressed }) => [styles.deleteMessage, pressed && styles.toolPressed]}><MaterialIcons color="#A7B6D9" name="delete-outline" size={15} /></Pressable> : null}</View><Text style={styles.messageText}>{message.text}</Text></View>
  </View>;
}

function MemberPanel({ currentRole, members, onChange }: { currentRole: RoomRole; members: RoomMember[]; onChange: (member: RoomMember, role: Exclude<RoomRole, "host">, permissions: RoomPermission[]) => void }) {
  return <View style={styles.memberPane}>
    <FlatList
      data={members}
      keyExtractor={(member) => member.participantId}
      renderItem={({ item }) => <View style={styles.memberRow}>
        <View style={styles.memberAvatar}><Text style={styles.avatarText}>{item.displayName.slice(0, 1).toLocaleUpperCase("ar")}</Text></View>
        <View style={styles.memberInfo}><Text style={styles.memberName}>{item.displayName}</Text><Text style={styles.memberRole}>{item.role === "host" ? "المضيف" : item.role === "moderator" ? "مشرف" : "عضو"}</Text></View>
        {currentRole === "host" && item.role !== "host" ? <View style={styles.memberActions}>
          <Pressable accessibilityLabel={item.role === "moderator" ? "إلغاء الإشراف" : "تعيين مشرف"} onPress={() => onChange(item, item.role === "moderator" ? "member" : "moderator", item.role === "moderator" ? [] : item.permissions)} style={({ pressed }) => [styles.memberAction, item.role === "moderator" && styles.memberActionActive, pressed && styles.toolPressed]}><MaterialIcons color="#FFFFFF" name={item.role === "moderator" ? "verified-user" : "admin-panel-settings"} size={17} /></Pressable>
          {(["control_source", "control_playback", "moderate_chat"] as RoomPermission[]).map((permission) => <Pressable accessibilityLabel={`تبديل صلاحية ${permissionLabels[permission]}`} key={permission} onPress={() => onChange(item, item.role === "moderator" ? "moderator" : "member", item.permissions.includes(permission) ? item.permissions.filter((value) => value !== permission) : [...item.permissions, permission])} style={({ pressed }) => [styles.permissionDot, item.permissions.includes(permission) && styles.permissionDotActive, pressed && styles.toolPressed]}><Text style={styles.permissionDotText}>{permissionLabels[permission].slice(0, 1)}</Text></Pressable>)}
        </View> : null}
      </View>}
      ListEmptyComponent={<Text style={styles.memberRole}>لا يوجد أعضاء ظاهرون بعد.</Text>}
    />
  </View>;
}

const styles = StyleSheet.create({
  avatar: { alignItems: "center", backgroundColor: "#28517E", borderRadius: 18, height: 36, justifyContent: "center", marginTop: 2, width: 36 },
  avatarMine: { backgroundColor: "#6846D6" },
  avatarText: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  cameraGrid: { flexDirection: "row-reverse", flexWrap: "wrap", gap: 8, minHeight: 118 },
  cameraPane: { backgroundColor: "#101A2D", borderColor: "#284876", borderRadius: 18, borderWidth: 1, flex: 1, marginTop: 8, overflow: "hidden", padding: 8 },
  chatInput: { backgroundColor: "#131D30", borderColor: "#31415D", borderRadius: 15, borderWidth: 1, color: palette.text, flex: 1, fontSize: 14, height: 42, paddingHorizontal: 13 },
  chatPane: { backgroundColor: "#111A2D", borderColor: "#314B76", borderRadius: 18, borderWidth: 1, flex: 1, marginTop: 8, minHeight: 168, overflow: "hidden", paddingHorizontal: 9, paddingTop: 5 },
  compactLoading: { alignItems: "center", height: 48, justifyContent: "center" },
  composer: { alignItems: "center", borderTopColor: "#26364F", borderTopWidth: 1, flexDirection: "row", gap: 8, marginHorizontal: -9, paddingHorizontal: 9, paddingVertical: 8 },
  connectionDot: { backgroundColor: "#657493", borderColor: "#101828", borderRadius: 5, borderWidth: 1, bottom: 2, height: 9, position: "absolute", right: 3, width: 9 },
  connectionDotLive: { backgroundColor: palette.success },
  deleteMessage: { padding: 2 },
  memberActions: { alignItems: "center", flexDirection: "row-reverse", gap: 4 },
  memberAction: { alignItems: "center", backgroundColor: "#273551", borderColor: "#4A5E86", borderRadius: 9, borderWidth: 1, height: 31, justifyContent: "center", width: 31 },
  memberActionActive: { backgroundColor: "#6841C4", borderColor: "#B49DFF" },
  memberAvatar: { alignItems: "center", backgroundColor: "#254B76", borderRadius: 15, height: 30, justifyContent: "center", width: 30 },
  memberInfo: { flex: 1, marginRight: 8 },
  memberName: { color: palette.text, fontSize: 13, fontWeight: "800", textAlign: "right" },
  memberPane: { backgroundColor: "#111A2D", borderColor: "#314B76", borderRadius: 18, borderWidth: 1, flex: 1, marginTop: 8, minHeight: 168, padding: 9 },
  memberRole: { color: palette.muted, fontSize: 10, marginTop: 2, textAlign: "right" },
  memberRow: { alignItems: "center", borderBottomColor: "#23314A", borderBottomWidth: 1, flexDirection: "row-reverse", minHeight: 54, paddingVertical: 7 },
  membersBadge: { alignItems: "center", backgroundColor: "#00B77E", borderRadius: 12, height: 18, justifyContent: "center", position: "absolute", right: -4, top: -4, width: 18 },
  membersBadgeText: { color: "#FFFFFF", fontSize: 9, fontWeight: "900" },
  membersTool: { alignItems: "center", backgroundColor: "#202A41", borderColor: "#45536E", borderRadius: 13, borderWidth: 1, height: 42, justifyContent: "center", width: 42 },
  messageBody: { backgroundColor: "#182747", borderBottomLeftRadius: 13, borderBottomRightRadius: 13, borderTopLeftRadius: 13, flexShrink: 1, maxWidth: "82%", paddingHorizontal: 10, paddingVertical: 7 },
  messageBodyMine: { backgroundColor: "#49319B" },
  messageMeta: { alignItems: "center", flexDirection: "row-reverse", gap: 6, justifyContent: "space-between" },
  messageRow: { alignItems: "flex-start", flexDirection: "row-reverse", gap: 7, marginBottom: 9, paddingHorizontal: 1 },
  messageRowMine: { flexDirection: "row" },
  messageSender: { color: "#86BFFF", fontSize: 11, fontWeight: "900", textAlign: "right" },
  messageText: { color: palette.text, fontSize: 13, lineHeight: 19, marginTop: 2, textAlign: "right" },
  messages: { flex: 1 },
  messagesContent: { paddingBottom: 4, paddingTop: 8 },
  messagesEmpty: { flexGrow: 1 },
  panel: { backgroundColor: "transparent", flex: 1, marginHorizontal: 10, paddingTop: 8 },
  permissionDot: { alignItems: "center", backgroundColor: "#1F2A43", borderColor: "#415274", borderRadius: 8, borderWidth: 1, height: 24, justifyContent: "center", width: 24 },
  permissionDotActive: { backgroundColor: "#176C60", borderColor: "#4BDBBD" },
  permissionDotText: { color: "#E5EBFF", fontSize: 10, fontWeight: "900" },
  send: { alignItems: "center", backgroundColor: "#173F91", borderRadius: 14, height: 42, justifyContent: "center", width: 42 },
  talkTool: { alignItems: "center", backgroundColor: "#073F3A", borderColor: "#167A70", borderRadius: 13, borderWidth: 1, flex: 1, height: 42, justifyContent: "center" },
  talkToolLive: { backgroundColor: "#B24873", borderColor: "#FF9BB8" },
  tool: { alignItems: "center", borderRadius: 13, borderWidth: 1, flex: 1, height: 42, justifyContent: "center" },
  toolActive: { backgroundColor: "#6241D9", borderColor: "#AB8DFF" },
  toolCall: { backgroundColor: "#282052", borderColor: "#51479A" },
  toolCallActive: { backgroundColor: "#C72674", borderColor: "#FF7FC2" },
  toolCamera: { backgroundColor: "#372B15", borderColor: "#8B6B2E" },
  toolChat: { backgroundColor: "#0759D6", borderColor: "#4C9AFF" },
  toolChatActive: { backgroundColor: "#297BFF", borderColor: "#9AC4FF" },
  toolPressed: { opacity: 0.76, transform: [{ scale: 0.94 }] },
  toolSync: { backgroundColor: "#282052", borderColor: "#5A4BA5" },
  toolsRow: { alignItems: "center", backgroundColor: "#0E1728", borderColor: "#2D405F", borderRadius: 18, borderWidth: 1, flexDirection: "row-reverse", gap: 5, padding: 5 },
  unavailable: { alignItems: "center", backgroundColor: "#101A34", borderColor: "#293B66", borderRadius: 16, borderWidth: 1, flexDirection: "row-reverse", gap: 8, marginHorizontal: 10, marginTop: 8, padding: 12 },
  unavailableText: { color: palette.muted, flex: 1, fontSize: 12, lineHeight: 18, textAlign: "right" },
  videoPlaceholder: { backgroundColor: "#101A34", borderRadius: 12, height: 110, width: "48%" },
  videoTrack: { backgroundColor: "#070B16", borderRadius: 12, height: 110, overflow: "hidden", width: "48%" },
});
