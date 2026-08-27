import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Camera } from "expo-camera";
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from "expo-audio";
import { AndroidAudioTypePresets, AudioSession, isTrackReference, LiveKitRoom, useRoomContext, useTracks, VideoTrack } from "@livekit/react-native";
import { DataPacket_Kind, RoomEvent, Track } from "livekit-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, FlatList, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { deleteRoomMessage, getRoomState, performRoomMemberAction, postRoomMessage, updateRoomMemberPermissions, type RoomChatMessage, type RoomMember, type RoomMemberAction, type RoomPermission, type RoomRole, type RoomSource } from "@/lib/room-api";
import { ensureLiveKitGlobals } from "@/lib/livekit-setup";
import { receiveRoomSync, setRoomSyncPublisher, type RoomSyncEvent } from "@/lib/room-sync";

export type RealtimeRoomCredentials = { code: string; serverUrl: string; token: string };
type ChatMessage = RoomChatMessage & { mine: boolean };
type ActivePane = "chat" | "camera" | "members" | "settings" | null;
type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";
type PermissionSnapshot = { granted: boolean; canAskAgain: boolean; status: string };

const palette = { cyan: "#8E65FF", muted: "#98A4C0", panel: "#10182A", text: "#F8F8FF" };
const permissionLabels: Record<RoomPermission, string> = { control_source: "تغيير المصدر", control_playback: "التحكم بالفيديو", search_youtube: "بحث YouTube", moderate_chat: "إدارة الدردشة", manage_members: "إدارة الأعضاء" };

function permissionFailure(permission: PermissionSnapshot, device: "camera" | "microphone") {
  const deviceName = device === "camera" ? "الكاميرا" : "الميكروفون";
  return permission.canAskAgain ? `رفض Android إذن ${deviceName} لهذه المحاولة.` : `تم حظر إذن ${deviceName} نهائيًا من إعدادات Android.`;
}

function actionFailure(action: string, error: unknown, connectionStatus: ConnectionStatus) {
  const raw = error instanceof Error ? error.message.toLowerCase() : "";
  if (raw.includes("blocked")) return { title: `تعذر تشغيل ${action}`, detail: `إذن Android محظور نهائيًا. افتح إعدادات التطبيق، اسمح بالوصول، ثم أعد دخول الغرفة.\nالحالة: ${connectionStatus}.`, openSettings: true };
  if (raw.includes("permission")) return { title: `تعذر تشغيل ${action}`, detail: `لم يُمنح الإذن المطلوب. وافق على طلب Android عند ظهوره ثم اضغط الزر مرة أخرى.\nالحالة: ${connectionStatus}.`, openSettings: false };
  if (raw.includes("realtime") || connectionStatus !== "connected") return { title: `تعذر تشغيل ${action}`, detail: `قناة LiveKit ليست متصلة الآن (${connectionStatus === "connecting" ? "جارٍ الاتصال" : "منقطعة أو فشلت"}). لا يمكن فتح الميكروفون أو الكاميرا قبل ظهور «متصل».`, openSettings: false };
  return { title: `تعذر تشغيل ${action}`, detail: "مُنح الإذن لكن تعذر تشغيل جهاز الوسائط. افتح «إعدادات الاتصال» ثم أرسل نص التشخيص الظاهر.", openSettings: false };
}

function safeLiveKitError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error || "خطأ غير معروف");
  return raw.replace(/Bearer\s+[^\s]+/gi, "Bearer [محجوب]").replace(/eyJ[a-zA-Z0-9._-]+/g, "[رمز محجوب]").slice(0, 180);
}

export function RoomRealtimePanel({ accessToken, callVolume, credentials, onSelfAccessChange, onCallVolumeChange, onSourceChange, participantId, permissions, role }: {
  accessToken: string;
  callVolume: number;
  credentials: RealtimeRoomCredentials;
  onSelfAccessChange: (access: { role: RoomRole; permissions: RoomPermission[] }) => void;
  onCallVolumeChange: (volume: number) => void;
  onSourceChange: (source: RoomSource) => void;
  participantId: string;
  permissions: RoomPermission[];
  role: RoomRole;
}) {
  ensureLiveKitGlobals();
  const [audioConfigured, setAudioConfigured] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const [connectionDetail, setConnectionDetail] = useState("يجري فتح قناة LiveKit الأصلية.");
  useEffect(() => {
    setConnectionStatus("connecting");
    setConnectionDetail("يجري فتح قناة LiveKit الأصلية.");
  }, [credentials.serverUrl, credentials.token]);
  useEffect(() => {
    let active = true;
    void AudioSession.configureAudio({ android: { preferredOutputList: ["bluetooth", "headset", "speaker", "earpiece"], audioTypeOptions: { ...AndroidAudioTypePresets.communication, forceHandleAudioRouting: true, manageAudioFocus: false, audioFocusMode: "gainTransientMayDuck" } } }).catch(() => undefined).finally(() => active && setAudioConfigured(true));
    return () => { active = false; };
  }, []);
  if (!credentials.serverUrl || !credentials.token) return <View style={styles.unavailable}><MaterialIcons color={palette.cyan} name="cloud-sync" size={20} /><Text style={styles.unavailableText}>يتم تجهيز قناة التواصل الآمن للغرفة.</Text></View>;
  if (!audioConfigured) return <View style={styles.compactLoading}><MaterialIcons color={palette.cyan} name="sync" size={18} /></View>;
  return <LiveKitRoom audio={false} connect onConnected={() => { setConnectionStatus("connected"); setConnectionDetail("LiveKit متصل وجاهز للصوت والكاميرا."); }} onDisconnected={() => { setConnectionStatus("disconnected"); setConnectionDetail("انقطع اتصال LiveKit؛ تحقق من الإنترنت ثم أعد دخول الغرفة."); }} onError={(error) => { const detail = safeLiveKitError(error); setConnectionStatus("error"); setConnectionDetail(`فشل LiveKit: ${detail}`); Alert.alert("تعذر الاتصال", "تعذر فتح قناة LiveKit. افتح إعدادات الاتصال لعرض التشخيص المختصر."); }} onMediaDeviceFailure={(error) => { setConnectionDetail(`تعذر جهاز الوسائط: ${safeLiveKitError(error)}`); Alert.alert("تعذر تشغيل جهاز الوسائط", "تحقق من سماح Android للميكروفون أو الكاميرا ثم أعد المحاولة."); }} serverUrl={credentials.serverUrl} token={credentials.token} video={false}><RealtimeControls accessToken={accessToken} callVolume={callVolume} code={credentials.code} connectionDetail={connectionDetail} connectionStatus={connectionStatus} onCallVolumeChange={onCallVolumeChange} onSelfAccessChange={onSelfAccessChange} onSourceChange={onSourceChange} participantId={participantId} permissions={permissions} role={role} /></LiveKitRoom>;
}

function RealtimeControls({ accessToken, callVolume, code, connectionDetail, connectionStatus, onCallVolumeChange, onSelfAccessChange, onSourceChange, participantId, permissions, role }: {
  accessToken: string;
  callVolume: number;
  code: string;
  connectionDetail: string;
  connectionStatus: ConnectionStatus;
  onCallVolumeChange: (volume: number) => void;
  onSelfAccessChange: (access: { role: RoomRole; permissions: RoomPermission[] }) => void;
  onSourceChange: (source: RoomSource) => void;
  participantId: string;
  permissions: RoomPermission[];
  role: RoomRole;
}) {
  const room = useRoomContext();
  const [activePane, setActivePane] = useState<ActivePane>("chat");
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [draft, setDraft] = useState("");
  const [cameraOn, setCameraOn] = useState(false);
  const [callOn, setCallOn] = useState(false);
  const [talking, setTalking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [noiseSuppression, setNoiseSuppression] = useState(true);
  const [speakerOutput, setSpeakerOutput] = useState(true);
  const [voiceLevel, setVoiceLevel] = useState(0);
  const [selfModeration, setSelfModeration] = useState<Pick<RoomMember, "muted" | "cameraBlocked">>({ muted: false, cameraBlocked: false });
  const [selectedMember, setSelectedMember] = useState<RoomMember | null>(null);
  const [diagnostic, setDiagnostic] = useState("الفحص: بانتظار تشغيل ميكروفون أو كاميرا.");
  const pendingPress = useRef(false);
  const cameraTracks = useTracks([Track.Source.Camera]);
  const canModerate = permissions.includes("moderate_chat");
  const canManageMembers = role === "host" || permissions.includes("manage_members");
  const audioCaptureOptions = useMemo(() => ({ autoGainControl: true, echoCancellation: true, noiseSuppression }), [noiseSuppression]);

  useEffect(() => setDiagnostic(`فحص القناة: ${connectionDetail}`), [connectionDetail]);

  const hydrateRoom = useCallback(async () => {
    if (!accessToken) return;
    const state = await getRoomState({ code, accessToken });
    setMembers(state.members);
    setSelfModeration({ muted: state.member.muted, cameraBlocked: state.member.cameraBlocked });
    setChat(state.messages.map((message) => ({ ...message, mine: message.authorId === participantId })));
    if (state.source) onSourceChange(state.source);
    if (state.playback) receiveRoomSync({ type: "playback", ...state.playback });
    onSelfAccessChange({ role: state.role, permissions: state.permissions });
  }, [accessToken, code, onSelfAccessChange, onSourceChange, participantId]);

  useEffect(() => {
    void hydrateRoom().catch(() => undefined);
    const refresh = setInterval(() => void hydrateRoom().catch(() => undefined), 4_000);
    return () => clearInterval(refresh);
  }, [hydrateRoom]);

  useEffect(() => {
    room.remoteParticipants.forEach((participant) => participant.setVolume(Math.max(0, Math.min(1, callVolume))));
  }, [callVolume, room, room.remoteParticipants.size]);

  useEffect(() => {
    const interval = setInterval(() => setVoiceLevel(Math.max(0, Math.min(1, room.localParticipant.audioLevel || 0))), 120);
    return () => clearInterval(interval);
  }, [room]);

  useEffect(() => {
    const onData = (payload: Uint8Array, participant?: { name?: string; identity?: string }, kind?: DataPacket_Kind, topic?: string) => {
      if (kind !== DataPacket_Kind.RELIABLE) return;
      try {
        const packet = JSON.parse(new TextDecoder().decode(payload)) as { kind?: string; event?: RoomSyncEvent; id?: string; text?: string; authorId?: string; authorName?: string; createdAt?: string };
        if (topic === "ah4-room-sync" && packet.kind === "ah4-room-sync" && packet.event?.type === "source") { receiveRoomSync(packet.event); return; }
        if (packet.kind === "ah4-chat-delete" && packet.id) { setChat((current) => current.filter((message) => message.id !== packet.id)); return; }
        const id = packet.id; const text = packet.text?.trim();
        if (packet.kind !== "ah4-chat" || !id || !text) return;
        const authorId = packet.authorId || participant?.identity || "member";
        setChat((current) => current.some((message) => message.id === id) ? current : [...current, { id, authorId, authorName: packet.authorName || participant?.name || participant?.identity || "عضو", createdAt: packet.createdAt || new Date().toISOString(), mine: authorId === participantId, text }].slice(-60));
      } catch { /* Ignore non-chat LiveKit data. */ }
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => { room.off(RoomEvent.DataReceived, onData); void room.localParticipant.setCameraEnabled(false); void room.localParticipant.setMicrophoneEnabled(false); void AudioSession.stopAudioSession().catch(() => undefined); };
  }, [participantId, room]);

  useEffect(() => {
    setRoomSyncPublisher(async (event) => {
      await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ kind: "ah4-room-sync", event })), { reliable: true, topic: "ah4-room-sync" });
    });
    return () => setRoomSyncPublisher(null);
  }, [room]);

  useEffect(() => {
    if (selfModeration.muted) { setCallOn(false); setTalking(false); void room.localParticipant.setMicrophoneEnabled(false); }
    if (selfModeration.cameraBlocked) { setCameraOn(false); void room.localParticipant.setCameraEnabled(false); }
  }, [room, selfModeration.cameraBlocked, selfModeration.muted]);

  const memberCount = useMemo(() => Math.max(room.remoteParticipants.size + 1, members.length || 1), [members.length, room.remoteParticipants.size]);
  const assertRealtimeConnected = () => {
    if (connectionStatus !== "connected") throw new Error("realtime-not-connected");
  };
  const reportActionFailure = (action: string, error: unknown) => {
    const result = actionFailure(action, error, connectionStatus);
    setDiagnostic(`فحص ${action}: ${result.detail}`);
    Alert.alert(result.title, result.detail, result.openSettings ? [{ text: "إلغاء", style: "cancel" }, { text: "فتح الإعدادات", onPress: () => void Linking.openSettings() }] : undefined);
  };
  const requestMicrophone = async () => {
    const current = await getRecordingPermissionsAsync();
    const permission = current.granted ? current : await requestRecordingPermissionsAsync();
    setDiagnostic(`فحص الميكروفون: ${permission.granted ? "مسموح" : permissionFailure(permission, "microphone")}. حالة LiveKit: ${connectionStatus}.`);
    if (!permission.granted) throw new Error(permission.canAskAgain ? "microphone-permission-denied" : "microphone-permission-blocked");
  };
  const requestCamera = async () => {
    const currentCamera = await Camera.getCameraPermissionsAsync();
    const cameraPermission = currentCamera.granted ? currentCamera : await Camera.requestCameraPermissionsAsync();
    await requestMicrophone();
    setDiagnostic(`فحص الكاميرا: ${cameraPermission.granted ? "مسموح" : permissionFailure(cameraPermission, "camera")}. حالة LiveKit: ${connectionStatus}.`);
    if (!cameraPermission.granted) throw new Error(cameraPermission.canAskAgain ? "camera-permission-denied" : "camera-permission-blocked");
  };
  const setNoiseControl = async () => {
    const next = !noiseSuppression;
    setNoiseSuppression(next);
    if (!callOn && !talking) return;
    try { await room.localParticipant.setMicrophoneEnabled(false); await room.localParticipant.setMicrophoneEnabled(true, { autoGainControl: true, echoCancellation: true, noiseSuppression: next }); }
    catch { Alert.alert("إعداد الصوت", "تعذر تطبيق إعداد إزالة الضجيج الآن."); }
  };
  const switchOutput = async () => {
    try { await AudioSession.startAudioSession(); const next = speakerOutput ? "earpiece" : "speaker"; await AudioSession.selectAudioOutput(next); setSpeakerOutput(!speakerOutput); }
    catch { Alert.alert("مخرج الصوت", "تعذر تغيير مخرج الصوت على هذا الجهاز."); }
  };
  const openCall = async () => {
    if (busy || selfModeration.muted) { if (selfModeration.muted) Alert.alert("تم إسكاتك", "لا يمكنك بدء الاتصال حتى يزيل المضيف أو المشرف الإسكات."); return; }
    try { setBusy(true); const next = !callOn; if (next) { assertRealtimeConnected(); await requestMicrophone(); await AudioSession.startAudioSession(); await AudioSession.setDefaultRemoteAudioTrackVolume(callVolume); } await room.localParticipant.setMicrophoneEnabled(next, audioCaptureOptions); setCallOn(next); setDiagnostic(`فحص الاتصال الصوتي: ${next ? "تم تشغيل الميكروفون بنجاح" : "تم إيقاف الاتصال"}. حالة LiveKit: ${connectionStatus}.`); if (next) setTalking(false); if (!next) await AudioSession.stopAudioSession(); } catch (error) { reportActionFailure("الاتصال الصوتي", error); } finally { setBusy(false); }
  };
  const toggleCamera = async () => {
    if (busy || selfModeration.cameraBlocked) { if (selfModeration.cameraBlocked) Alert.alert("الكاميرا محظورة", "لا يمكنك تشغيل الكاميرا حتى يزيل المضيف أو المشرف الحظر."); return; }
    try { setBusy(true); const next = !cameraOn; if (next) { assertRealtimeConnected(); await requestCamera(); } await room.localParticipant.setCameraEnabled(next); setCameraOn(next); setDiagnostic(`فحص الكاميرا: ${next ? "تم طلب بث الكاميرا بنجاح" : "تم إيقاف الكاميرا"}. حالة LiveKit: ${connectionStatus}.`); setActivePane(next ? "camera" : "chat"); } catch (error) { reportActionFailure("الكاميرا", error); } finally { setBusy(false); }
  };
  const startTalking = async () => {
    if (busy || callOn || selfModeration.muted || pendingPress.current) return;
    pendingPress.current = true;
    try { assertRealtimeConnected(); await requestMicrophone(); await AudioSession.startAudioSession(); await room.localParticipant.setMicrophoneEnabled(true, audioCaptureOptions); setTalking(true); setDiagnostic(`فحص الهوكي توكي: الميكروفون يعمل أثناء الضغط. حالة LiveKit: ${connectionStatus}.`); } catch (error) { reportActionFailure("الهوكي توكي", error); } finally { pendingPress.current = false; }
  };
  const stopTalking = async () => { if (callOn || !talking) return; try { await room.localParticipant.setMicrophoneEnabled(false); await AudioSession.stopAudioSession(); } finally { setTalking(false); } };
  const sendChat = async () => {
    const text = draft.trim(); if (!text || !accessToken) return;
    const id = `message_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    try { const { message } = await postRoomMessage({ roomCode: code, accessToken, id, text }); setDraft(""); setChat((current) => current.some((item) => item.id === id) ? current : [...current, { ...message, mine: true }].slice(-60)); await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ kind: "ah4-chat", ...message })), { reliable: true, topic: "ah4-chat" }); } catch (error) { Alert.alert("تعذر إرسال الرسالة", error instanceof Error ? error.message : "حاول مرة أخرى."); }
  };
  const removeChat = async (message: ChatMessage) => {
    if (!accessToken || (!message.mine && !canModerate)) return;
    try { await deleteRoomMessage({ roomCode: code, accessToken, id: message.id }); setChat((current) => current.filter((item) => item.id !== message.id)); await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ kind: "ah4-chat-delete", id: message.id })), { reliable: true, topic: "ah4-chat" }); } catch (error) { Alert.alert("تعذر حذف الرسالة", error instanceof Error ? error.message : "حاول مرة أخرى."); }
  };
  const saveMemberAccess = async (member: RoomMember, nextRole: Exclude<RoomRole, "host">, nextPermissions: RoomPermission[]) => {
    if (role !== "host" || member.role === "host") return;
    try { const { member: updated } = await updateRoomMemberPermissions({ roomCode: code, accessToken, targetParticipantId: member.participantId, role: nextRole, permissions: nextPermissions }); setMembers((current) => current.map((item) => item.participantId === updated.participantId ? updated : item)); setSelectedMember(updated); } catch (error) { Alert.alert("تعذر حفظ الصلاحية", error instanceof Error ? error.message : "حاول مرة أخرى."); }
  };
  const applyMemberAction = async (member: RoomMember, action: RoomMemberAction) => {
    try { const { member: updated } = await performRoomMemberAction({ roomCode: code, accessToken, targetParticipantId: member.participantId, action }); if (action === "kick") { setMembers((current) => current.filter((item) => item.participantId !== member.participantId)); setSelectedMember(null); } else { setMembers((current) => current.map((item) => item.participantId === updated.participantId ? updated : item)); setSelectedMember(updated); } } catch (error) { Alert.alert("تعذر تنفيذ الإجراء", error instanceof Error ? error.message : "حاول مرة أخرى."); }
  };

  const statusLabel = connectionStatus === "connected" ? "متصل" : connectionStatus === "connecting" ? "جارٍ الاتصال" : connectionStatus === "disconnected" ? "انقطع الاتصال" : "تعذر الاتصال";
  return <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.panel}>
    <View accessibilityLabel={`حالة التواصل: ${statusLabel}`} style={styles.connectionStatus}><View style={[styles.connectionDot, connectionStatus === "connected" && styles.connectionDotConnected, connectionStatus === "error" && styles.connectionDotError]} /><Text style={styles.connectionStatusText}>{statusLabel}</Text></View>
    <View style={styles.toolsRow}>
      <Tool active={activePane === "chat"} icon="chat-bubble-outline" label="الدردشة" tone="chat" onPress={() => setActivePane("chat")} />
      <Tool active={callOn} disabled={selfModeration.muted} icon={callOn ? "call-end" : "mic-none"} label="اتصال صوتي" tone="call" onPress={() => void openCall()} />
      <Tool active={cameraOn} disabled={selfModeration.cameraBlocked} icon={cameraOn ? "videocam" : "videocam-off"} label="اتصال كاميرا" tone="camera" onPress={() => void toggleCamera()} />
      <Pressable accessibilityLabel="هوكي توكي، اضغط مطولًا للتحدث" accessibilityRole="button" disabled={selfModeration.muted} onPressIn={() => void startTalking()} onPressOut={() => void stopTalking()} style={({ pressed }) => [styles.tool, styles.toolTalk, talking && styles.toolTalkLive, selfModeration.muted && styles.toolDisabled, pressed && styles.toolPressed]}><MaterialIcons color="#C9FCEB" name="radio" size={19} /></Pressable>
      <Tool active={activePane === "members"} icon="groups-2" label={`الموجودون (${memberCount})`} tone="members" onPress={() => setActivePane("members")} />
      <Tool active={activePane === "settings"} icon="tune" label="إعدادات الاتصال" tone="members" onPress={() => setActivePane("settings")} />
    </View>
    {activePane === "chat" ? <View style={styles.chatPane}><FlatList contentContainerStyle={chat.length ? styles.messagesContent : styles.messagesEmpty} data={chat} keyExtractor={(message) => message.id} renderItem={({ item }) => <ChatRow canDelete={item.mine || canModerate} message={item} onDelete={() => void removeChat(item)} />} showsVerticalScrollIndicator={false} style={styles.messages} /><View style={styles.composer}><Pressable accessibilityLabel="إرسال الرسالة" accessibilityRole="button" onPress={() => void sendChat()} style={({ pressed }) => [styles.send, pressed && styles.toolPressed]}><MaterialIcons color="#FFFFFF" name="send" size={22} /></Pressable><TextInput maxLength={800} onChangeText={setDraft} onSubmitEditing={() => void sendChat()} placeholder="اكتب رسالتك…" placeholderTextColor="#7383AA" returnKeyType="send" style={styles.chatInput} textAlign="right" value={draft} /></View></View> : null}
    {activePane === "camera" ? <View style={styles.cameraPane}><View style={styles.cameraGrid}>{cameraTracks.slice(0, 4).map((track, index) => isTrackReference(track) ? <VideoTrack key={track.publication.trackSid} style={styles.videoTrack} trackRef={track} /> : <View key={`placeholder-${index}`} style={styles.videoPlaceholder} />)}</View></View> : null}
    {activePane === "members" ? <MemberPanel canManage={canManageMembers} currentRole={role} members={members} onSelect={setSelectedMember} /> : null}
    {activePane === "settings" ? <View style={styles.connectionPane}><View style={styles.connectionLine}><Text style={styles.connectionTitle}>صوت الاتصال</Text><View style={styles.voiceMeter}>{[0.18, 0.36, 0.62, 0.9].map((threshold, index) => <View key={threshold} style={[styles.voiceMeterBar, voiceLevel >= threshold && styles.voiceMeterBarActive, { height: 8 + index * 5 }]} />)}</View></View><Text selectable style={styles.diagnosticText}>{diagnostic}</Text><LevelSelector value={callVolume} onChange={onCallVolumeChange} /><View style={styles.connectionActions}><Pressable accessibilityLabel="تغيير مخرج الصوت" onPress={() => void switchOutput()} style={({ pressed }) => [styles.connectionButton, pressed && styles.toolPressed]}><MaterialIcons color="#D9DFF1" name={speakerOutput ? "volume-up" : "phone-in-talk"} size={20} /></Pressable><Pressable accessibilityLabel="تبديل إزالة الضجيج" onPress={() => void setNoiseControl()} style={({ pressed }) => [styles.connectionButton, noiseSuppression && styles.connectionButtonActive, pressed && styles.toolPressed]}><MaterialIcons color="#D9DFF1" name="graphic-eq" size={20} /></Pressable><Pressable accessibilityLabel="كتم الميككروفون" onPress={() => void openCall()} style={({ pressed }) => [styles.connectionButton, callOn && styles.connectionButtonActive, pressed && styles.toolPressed]}><MaterialIcons color="#D9DFF1" name={callOn ? "mic" : "mic-off"} size={20} /></Pressable></View></View> : null}
    {selectedMember ? <MemberActionSheet callVolume={callVolume} member={selectedMember} onCallVolumeChange={onCallVolumeChange} onClose={() => setSelectedMember(null)} onMemberAction={applyMemberAction} onSaveAccess={saveMemberAccess} viewerRole={role} /> : null}
  </KeyboardAvoidingView>;
}

function Tool({ active, disabled = false, icon, label, tone, onPress }: { active: boolean; disabled?: boolean; icon: React.ComponentProps<typeof MaterialIcons>["name"]; label: string; tone: "camera" | "call" | "chat" | "members"; onPress: () => void }) {
  const toneStyle = tone === "camera" ? styles.toolCamera : tone === "call" ? styles.toolCall : tone === "members" ? styles.toolMembers : styles.toolChat;
  return <Pressable accessibilityLabel={label} accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.tool, toneStyle, active && styles.toolActive, disabled && styles.toolDisabled, pressed && styles.toolPressed]}><MaterialIcons color={active ? "#FFFFFF" : "#D9DFF1"} name={icon} size={19} /></Pressable>;
}

function ChatRow({ canDelete, message, onDelete }: { canDelete: boolean; message: ChatMessage; onDelete: () => void }) {
  return <View style={styles.messageRow}><View style={[styles.avatar, message.mine && styles.avatarMine]}><Text style={styles.avatarText}>{message.authorName.trim().slice(0, 1).toLocaleUpperCase("ar") || "؟"}</Text></View><View style={[styles.messageBody, message.mine && styles.messageBodyMine]}><View style={styles.messageMeta}><Text style={styles.messageSender}>{message.authorName}</Text>{canDelete ? <Pressable accessibilityLabel="حذف الرسالة" onPress={onDelete}><MaterialIcons color="#A7B6D9" name="delete-outline" size={16} /></Pressable> : null}</View><Text style={styles.messageText}>{message.text}</Text></View></View>;
}

function MemberPanel({ canManage, currentRole, members, onSelect }: { canManage: boolean; currentRole: RoomRole; members: RoomMember[]; onSelect: (member: RoomMember) => void }) {
  return <View style={styles.memberPane}><FlatList data={members} keyExtractor={(member) => member.participantId} ListEmptyComponent={<Text style={styles.memberRole}>لا يوجد أعضاء ظاهرون بعد.</Text>} renderItem={({ item }) => <Pressable disabled={!canManage || item.role === "host" || (currentRole !== "host" && item.role !== "member")} onPress={() => onSelect(item)} style={({ pressed }) => [styles.memberRow, pressed && styles.toolPressed]}><View style={styles.memberAvatar}><Text style={styles.avatarText}>{item.displayName.slice(0, 1).toLocaleUpperCase("ar")}</Text></View><View style={styles.memberInfo}><Text style={styles.memberName}>{item.displayName}</Text><Text style={styles.memberRole}>{item.role === "host" ? "المضيف" : item.role === "moderator" ? "مشرف" : "عضو"}{item.muted ? " · مكتوم" : ""}{item.cameraBlocked ? " · الكاميرا محظورة" : ""}</Text></View><MaterialIcons color="#9D7AFF" name={item.role === "host" ? "workspace-premium" : "more-horiz"} size={22} /></Pressable>} /></View>;
}

function MemberActionSheet({ callVolume, member, onCallVolumeChange, onClose, onMemberAction, onSaveAccess, viewerRole }: { callVolume: number; member: RoomMember; onCallVolumeChange: (value: number) => void; onClose: () => void; onMemberAction: (member: RoomMember, action: RoomMemberAction) => void; onSaveAccess: (member: RoomMember, role: Exclude<RoomRole, "host">, permissions: RoomPermission[]) => void; viewerRole: RoomRole }) {
  const canAssign = viewerRole === "host";
  const currentPermissions = member.permissions;
  return <View style={styles.memberActionSheet}><View style={styles.memberActionTop}><Pressable accessibilityLabel="إغلاق إجراءات العضو" onPress={onClose}><MaterialIcons color="#CBD5EB" name="close" size={22} /></Pressable><View style={styles.memberActionIdentity}><View style={styles.avatar}><Text style={styles.avatarText}>{member.displayName.slice(0, 1)}</Text></View><View><Text style={styles.memberActionName}>{member.displayName}</Text><Text style={styles.memberRole}>{member.role === "moderator" ? "مشرف" : "عضو"}</Text></View></View></View><ScrollView showsVerticalScrollIndicator={false}><Text style={styles.actionGroupTitle}>إدارة العضو</Text><View style={styles.actionGrid}>{canAssign ? <ActionButton icon={member.role === "moderator" ? "remove-moderator" : "admin-panel-settings"} label={member.role === "moderator" ? "إلغاء مشرف" : "تعيين مشرف"} onPress={() => onSaveAccess(member, member.role === "moderator" ? "member" : "moderator", member.role === "moderator" ? [] : currentPermissions)} /> : null}<ActionButton icon={member.muted ? "mic-none" : "mic-off"} label={member.muted ? "إلغاء الإسكات" : "إسكات"} onPress={() => onMemberAction(member, member.muted ? "unmute" : "mute")} /><ActionButton icon={member.cameraBlocked ? "videocam" : "videocam-off"} label={member.cameraBlocked ? "سماح بالكاميرا" : "حظر الكاميرا"} onPress={() => onMemberAction(member, member.cameraBlocked ? "allow_camera" : "block_camera")} /><ActionButton danger icon="person-remove" label="طرد من الغرفة" onPress={() => Alert.alert("طرد العضو", `هل تريد طرد ${member.displayName} من الغرفة؟`, [{ text: "إلغاء", style: "cancel" }, { text: "طرد", style: "destructive", onPress: () => onMemberAction(member, "kick") }])} /></View>{canAssign ? <><Text style={styles.actionGroupTitle}>صلاحيات العضو</Text>{(["control_source", "search_youtube", "control_playback", "moderate_chat", "manage_members"] as RoomPermission[]).map((permission) => <Pressable key={permission} onPress={() => onSaveAccess(member, member.role === "moderator" ? "moderator" : "member", currentPermissions.includes(permission) ? currentPermissions.filter((value) => value !== permission) : [...currentPermissions, permission])} style={({ pressed }) => [styles.permissionRow, currentPermissions.includes(permission) && styles.permissionRowActive, pressed && styles.toolPressed]}><Text style={styles.permissionName}>{permissionLabels[permission]}</Text><MaterialIcons color={currentPermissions.includes(permission) ? "#B9A7FF" : "#7584A6"} name={currentPermissions.includes(permission) ? "check-circle" : "radio-button-unchecked"} size={21} /></Pressable>)}</> : null}<Text style={styles.actionGroupTitle}>صوت الاتصال</Text><LevelSelector value={callVolume} onChange={onCallVolumeChange} /></ScrollView></View>;
}

function ActionButton({ danger = false, icon, label, onPress }: { danger?: boolean; icon: React.ComponentProps<typeof MaterialIcons>["name"]; label: string; onPress: () => void }) {
  return <Pressable accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.actionButton, danger && styles.actionButtonDanger, pressed && styles.toolPressed]}><MaterialIcons color={danger ? "#FF9D9A" : "#CDBEFF"} name={icon} size={21} /><Text style={[styles.actionButtonText, danger && styles.actionButtonDangerText]}>{label}</Text></Pressable>;
}

function LevelSelector({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return <View style={styles.levelSelector}>{[0, 0.25, 0.5, 0.75, 1].map((level) => <Pressable accessibilityLabel={`مستوى الصوت ${Math.round(level * 100)}%`} key={level} onPress={() => onChange(level)} style={({ pressed }) => [styles.levelStep, level <= value && styles.levelStepActive, pressed && styles.toolPressed]} />)}</View>;
}

const styles = StyleSheet.create({
  actionButton: { alignItems: "center", backgroundColor: "#182540", borderColor: "#354B75", borderRadius: 14, borderWidth: 1, flex: 1, gap: 5, minHeight: 70, justifyContent: "center", padding: 6 },
  actionButtonDanger: { backgroundColor: "#381E2A", borderColor: "#914258" }, actionButtonDangerText: { color: "#FFADAB" }, actionButtonText: { color: "#DADFFC", fontSize: 10, fontWeight: "800", textAlign: "center" }, actionGrid: { flexDirection: "row-reverse", flexWrap: "wrap", gap: 7 },
  actionGroupTitle: { color: "#AAB7D6", fontSize: 12, fontWeight: "900", marginBottom: 8, marginTop: 14, textAlign: "right" },
  avatar: { alignItems: "center", backgroundColor: "#28517E", borderRadius: 21, height: 42, justifyContent: "center", width: 42 }, avatarMine: { backgroundColor: "#6846D6" }, avatarText: { color: "#FFFFFF", fontSize: 14, fontWeight: "900" },
  cameraGrid: { flexDirection: "row-reverse", flexWrap: "wrap", gap: 4, minHeight: 118 }, cameraPane: { backgroundColor: "transparent", flex: 1, marginTop: 6, overflow: "hidden", padding: 0 },
  chatHeader: { height: 0 }, chatHeaderTitle: { height: 0 },
  chatInput: { backgroundColor: "#111C31", borderColor: "#2F405E", borderRadius: 13, borderWidth: 1, color: palette.text, flex: 1, fontSize: 14, height: 43, paddingHorizontal: 13 }, chatPane: { backgroundColor: "transparent", flex: 1, marginTop: 5, minHeight: 210, overflow: "hidden", paddingHorizontal: 8, paddingTop: 5 },
  compactLoading: { alignItems: "center", height: 30, justifyContent: "center" }, composer: { alignItems: "center", borderTopColor: "#28364E", borderTopWidth: 1, flexDirection: "row", gap: 7, marginHorizontal: -8, paddingHorizontal: 8, paddingVertical: 6 },
  connectionActions: { flexDirection: "row-reverse", gap: 8, marginTop: 8 }, connectionButton: { alignItems: "center", backgroundColor: "#131E35", borderColor: "#304465", borderRadius: 12, borderWidth: 1, flex: 1, height: 42, justifyContent: "center" }, connectionButtonActive: { backgroundColor: "#3C2A7A", borderColor: "#9676FF" }, connectionLine: { alignItems: "center", flexDirection: "row-reverse", justifyContent: "space-between" }, connectionPane: { backgroundColor: "transparent", flex: 1, marginTop: 6, minHeight: 170, paddingHorizontal: 12, paddingTop: 12 }, connectionTitle: { color: palette.text, fontSize: 14, fontWeight: "900" }, diagnosticText: { backgroundColor: "#10192A", borderColor: "#2D3E5D", borderRadius: 8, borderWidth: 1, color: "#B9C5E2", fontSize: 10, lineHeight: 15, marginTop: 8, paddingHorizontal: 8, paddingVertical: 7, textAlign: "right" },
  levelSelector: { flexDirection: "row-reverse", gap: 6, paddingVertical: 8 }, levelStep: { backgroundColor: "#273652", borderRadius: 4, flex: 1, height: 8 }, levelStepActive: { backgroundColor: "#895DFF" },
  memberActionIdentity: { alignItems: "center", flexDirection: "row-reverse", gap: 9 }, memberActionName: { color: palette.text, fontSize: 14, fontWeight: "900", textAlign: "right" }, memberActionSheet: { backgroundColor: "#0F182A", borderColor: "#6D51C8", borderRadius: 20, borderWidth: 1, bottom: 8, left: 0, maxHeight: 430, padding: 14, position: "absolute", right: 0, shadowColor: "#000", shadowOpacity: 0.4, shadowRadius: 18 }, memberActionTop: { alignItems: "center", borderBottomColor: "#29364E", borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingBottom: 11 },
  memberAvatar: { alignItems: "center", backgroundColor: "#254B76", borderRadius: 17, height: 34, justifyContent: "center", width: 34 }, memberInfo: { flex: 1, marginRight: 9 }, memberName: { color: palette.text, fontSize: 14, fontWeight: "800", textAlign: "right" }, memberPane: { backgroundColor: palette.panel, borderColor: "#2D456D", borderRadius: 18, borderWidth: 1, flex: 1, marginTop: 16, minHeight: 264, padding: 10 }, memberRole: { color: palette.muted, fontSize: 10, marginTop: 2, textAlign: "right" }, memberRow: { alignItems: "center", borderBottomColor: "#263650", borderBottomWidth: 1, flexDirection: "row-reverse", minHeight: 60, paddingVertical: 8 },
  messageBody: { backgroundColor: "#1B2947", borderRadius: 14, flexShrink: 1, maxWidth: "82%", paddingHorizontal: 12, paddingVertical: 8 }, messageBodyMine: { backgroundColor: "#3D2D78" }, messageMeta: { alignItems: "center", flexDirection: "row-reverse", justifyContent: "space-between" }, messageRow: { alignItems: "flex-start", flexDirection: "row-reverse", gap: 9, marginBottom: 12, paddingHorizontal: 1 }, messageSender: { color: "#AE91FF", fontSize: 12, fontWeight: "900", textAlign: "right" }, messageText: { color: palette.text, fontSize: 14, lineHeight: 21, marginTop: 3, textAlign: "right" }, messages: { flex: 1 }, messagesContent: { paddingBottom: 7, paddingTop: 10 }, messagesEmpty: { flexGrow: 1 },
  panel: { backgroundColor: "transparent", flex: 1, marginHorizontal: 0, paddingTop: 4 }, permissionName: { color: "#E4E7F6", fontSize: 12, fontWeight: "700", textAlign: "right" }, permissionRow: { alignItems: "center", backgroundColor: "#141F35", borderColor: "#2D3E5E", borderRadius: 12, borderWidth: 1, flexDirection: "row-reverse", justifyContent: "space-between", marginTop: 7, minHeight: 43, paddingHorizontal: 11 }, permissionRowActive: { backgroundColor: "#281E58", borderColor: "#7A58DF" },
  connectionStatus: { alignItems: "center", alignSelf: "flex-end", flexDirection: "row-reverse", gap: 4, height: 16, paddingHorizontal: 8 }, connectionStatusText: { color: "#91A0C2", fontSize: 9, fontWeight: "800" }, connectionDot: { backgroundColor: "#F2A45A", borderRadius: 3, height: 6, width: 6 }, connectionDotConnected: { backgroundColor: "#54D7A0" }, connectionDotError: { backgroundColor: "#F27882" },
  send: { alignItems: "center", backgroundColor: "#6F43D5", borderRadius: 13, height: 43, justifyContent: "center", width: 48 }, tool: { alignItems: "center", flex: 1, justifyContent: "center", minHeight: 38 }, toolActive: { backgroundColor: "#241C50", borderBottomColor: "#8D63FF", borderBottomWidth: 2 }, toolCall: { backgroundColor: "transparent" }, toolCamera: { backgroundColor: "transparent" }, toolChat: { backgroundColor: "transparent" }, toolDisabled: { opacity: 0.42 }, toolLabel: { height: 0, width: 0 }, toolMembers: { backgroundColor: "transparent" }, toolPressed: { opacity: 0.76, transform: [{ scale: 0.94 }] }, toolTalk: { backgroundColor: "transparent" }, toolTalkLive: { backgroundColor: "#1C665A", borderBottomColor: "#67E2C9", borderBottomWidth: 2 }, toolsRow: { borderBottomColor: "#253653", borderBottomWidth: 1, flexDirection: "row-reverse", minHeight: 38 },
  voiceMeter: { alignItems: "flex-end", flexDirection: "row-reverse", gap: 3, height: 30 }, voiceMeterBar: { backgroundColor: "#2B3A56", borderRadius: 3, width: 5 }, voiceMeterBarActive: { backgroundColor: "#53E0A7" },
  unavailable: { alignItems: "center", backgroundColor: "#101A34", borderColor: "#293B66", borderRadius: 16, borderWidth: 1, flexDirection: "row-reverse", gap: 8, marginHorizontal: 10, marginTop: 8, padding: 12 }, unavailableText: { color: palette.muted, flex: 1, fontSize: 12, lineHeight: 18, textAlign: "right" }, videoPlaceholder: { backgroundColor: "#101A34", borderRadius: 12, height: 110, width: "48%" }, videoTrack: { backgroundColor: "#070B16", borderRadius: 12, height: 110, overflow: "hidden", width: "48%" },
});
