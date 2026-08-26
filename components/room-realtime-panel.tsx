import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { receiveRoomSync, setRoomSyncPublisher, type RoomSyncEvent } from "@/lib/room-sync";
import { AudioSession, registerGlobals, VideoTrack } from "@livekit/react-native";
import { requestRecordingPermissionsAsync, setAudioModeAsync } from "expo-audio";
import { Camera } from "expo-camera";
import * as Notifications from "expo-notifications";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, FlatList, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { DataPacket_Kind, Room, RoomEvent, Track } from "livekit-client";

if (Platform.OS !== "web") {
  registerGlobals();
}

if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

type VoiceMode = "off" | "call" | "ptt";
type ChatItem = { id: string; author: string; body: string; local: boolean };

export type RealtimeRoomCredentials = {
  code: string;
  serverUrl: string;
  token: string;
};

const colors = {
  border: "#263455",
  cyan: "#40C9FF",
  error: "#FF7080",
  muted: "#99A5C7",
  primary: "#7C5CFC",
  success: "#35D39E",
  surface: "#141C33",
  surfaceElevated: "#1B2746",
  text: "#F5F7FF",
  warning: "#FFB86B",
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function RoomRealtimePanel({ credentials }: { credentials: RealtimeRoomCredentials }) {
  const roomRef = useRef<Room | null>(null);
  const [connectionState, setConnectionState] = useState<"offline" | "connecting" | "online" | "error">("offline");
  const [voiceMode, setVoiceMode] = useState<VoiceMode>("off");
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraTrackRef, setCameraTrackRef] = useState<any>(undefined);
  const [micMuted, setMicMuted] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [chatText, setChatText] = useState("");
  const [chat, setChat] = useState<ChatItem[]>([]);

  const addChat = useCallback((item: ChatItem) => {
    setChat((current) => [...current.slice(-49), item]);
  }, []);

  const connect = useCallback(async () => {
    if (Platform.OS === "web") {
      Alert.alert("تجربة Android مطلوبة", "الصوت والكاميرا الفوريان يحتاجان نسخة Android أصلية مبنية للتطبيق، وليس معاينة المتصفح.");
      return null;
    }
    if (roomRef.current) return roomRef.current;

    setConnectionState("connecting");
    try {
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      await AudioSession.startAudioSession();
      const room = new Room();
      room.on(RoomEvent.Connected, () => setConnectionState("online"));
      room.on(RoomEvent.Disconnected, () => {
        setConnectionState("offline");
        setVoiceMode("off");
        setCameraOn(false);
      });
      room.on(RoomEvent.DataReceived, (payload, participant, kind, topic) => {
        if (kind === DataPacket_Kind.RELIABLE && topic === "ah4-sync") {
          try {
            receiveRoomSync(JSON.parse(decoder.decode(payload)) as RoomSyncEvent);
          } catch {
            // Ignore malformed room-state packets.
          }
          return;
        }
        if (kind !== DataPacket_Kind.RELIABLE || topic !== "ah4-chat") return;
        try {
          const parsed = JSON.parse(decoder.decode(payload)) as { type?: string; body?: string; author?: string; id?: string };
          if (parsed.type !== "chat" || !parsed.body || !participant) return;
          addChat({
            id: parsed.id ?? `${Date.now()}-${participant.identity}`,
            author: parsed.author ?? "عضو",
            body: parsed.body,
            local: false,
          });
          if (notificationsEnabled) {
            void Notifications.scheduleNotificationAsync({
              content: { title: `رسالة من ${parsed.author ?? "عضو"}`, body: parsed.body, data: { roomCode: credentials.code } },
              trigger: null,
            });
          }
        } catch {
          // Ignore malformed data packets from unknown clients.
        }
      });
      await room.connect(credentials.serverUrl, credentials.token);
      roomRef.current = room;
      setRoomSyncPublisher(async (event) => {
        await room.localParticipant.publishData(encoder.encode(JSON.stringify(event)), { reliable: true, topic: "ah4-sync" });
      });
      return room;
    } catch {
      setConnectionState("error");
      Alert.alert("تعذر الاتصال بالغرفة", "تحقق من الإنترنت ثم حاول مرة أخرى.");
      return null;
    }
  }, [addChat, credentials.code, credentials.serverUrl, credentials.token, notificationsEnabled]);

  useEffect(() => {
    void connect();
    return () => {
      roomRef.current?.disconnect();
      roomRef.current = null;
      setRoomSyncPublisher(null);
      if (Platform.OS !== "web") AudioSession.stopAudioSession();
    };
  }, []);

  const requestMicrophone = async () => {
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("إذن الميكروفون مطلوب", "نستخدم الميكروفون فقط أثناء الاتصال أو الضغط على زر الهوكي توكي.");
      return false;
    }
    return true;
  };

  const startVoiceCall = async () => {
    if (!(await requestMicrophone())) return;
    const room = await connect();
    if (!room) return;
    await room.localParticipant.setMicrophoneEnabled(true);
    setMicMuted(false);
    setVoiceMode("call");
  };

  const activatePtt = async () => {
    if (!(await requestMicrophone())) return;
    const room = await connect();
    if (!room) return;
    await room.localParticipant.setMicrophoneEnabled(false);
    setMicMuted(false);
    setVoiceMode("ptt");
  };

  const beginPtt = async () => {
    if (voiceMode !== "ptt" || micMuted) return;
    await roomRef.current?.localParticipant.setMicrophoneEnabled(true);
  };

  const endPtt = async () => {
    if (voiceMode !== "ptt") return;
    await roomRef.current?.localParticipant.setMicrophoneEnabled(false);
  };

  const stopVoice = async () => {
    await roomRef.current?.localParticipant.setMicrophoneEnabled(false);
    setVoiceMode("off");
  };

  const toggleCamera = async () => {
    if (!cameraOn) {
      const permission = await Camera.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("إذن الكاميرا مطلوب", "تُستخدم الكاميرا فقط عند تشغيل زر الكاميرا لمشاركة الفيديو داخل هذه الغرفة.");
        return;
      }
      const room = await connect();
      if (!room) return;
      await room.localParticipant.setCameraEnabled(true);
      const publication = room.localParticipant.getTrackPublication(Track.Source.Camera);
      if (publication) {
        setCameraTrackRef({ participant: room.localParticipant, publication, source: Track.Source.Camera });
      }
      setCameraOn(true);
      return;
    }

    await roomRef.current?.localParticipant.setCameraEnabled(false);
    setCameraTrackRef(undefined);
    setCameraOn(false);
  };

  const toggleMute = async () => {
    const nextMuted = !micMuted;
    setMicMuted(nextMuted);
    if (voiceMode === "call") await roomRef.current?.localParticipant.setMicrophoneEnabled(!nextMuted);
    if (voiceMode === "ptt") await roomRef.current?.localParticipant.setMicrophoneEnabled(false);
  };

  const enableNotifications = async () => {
    if (Platform.OS === "web") {
      Alert.alert("Android مطلوب", "تظهر تنبيهات الغرف في نسخة Android الأصلية.");
      return;
    }
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("room-messages", {
        name: "رسائل الغرف",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 180, 120, 180],
        lightColor: "#7C5CFC",
      });
    }
    const current = await Notifications.getPermissionsAsync();
    const finalStatus = current.granted ? current : await Notifications.requestPermissionsAsync();
    setNotificationsEnabled(finalStatus.granted);
    if (!finalStatus.granted) Alert.alert("التنبيهات متوقفة", "يمكنك تفعيلها لاحقًا من إعدادات النظام لتصلك رسائل وتنبيهات الغرفة.");
  };

  const sendMessage = async () => {
    const body = chatText.trim();
    if (!body) return;
    const room = await connect();
    if (!room) return;

    const message = { type: "chat", id: `${Date.now()}`, author: "أنت", body };
    await room.localParticipant.publishData(encoder.encode(JSON.stringify(message)), { reliable: true, topic: "ah4-chat" });
    addChat({ ...message, local: true });
    setChatText("");
  };

  const voiceLabel = voiceMode === "call" ? "إنهاء الاتصال" : "اتصال";
  const statusLabel = connectionState === "online" ? "متصل" : connectionState === "connecting" ? "جارٍ الاتصال" : connectionState === "error" ? "تعذر الاتصال" : "غير متصل";

  return (
    <View style={styles.panel}>
      <View style={styles.toolsHeader}>
        <View style={styles.connectionPill}>
          <View style={[styles.connectionDot, connectionState === "online" && styles.connectionDotOnline, connectionState === "error" && styles.connectionDotError]} />
          <Text style={styles.connectionText}>{statusLabel}</Text>
        </View>
        <Text style={styles.toolsTitle}>تواصل الغرفة</Text>
      </View>

      <View style={styles.toolRow}>
        <ToolButton active={voiceMode === "call"} icon={voiceMode === "call" ? "call-end" : "call"} label={voiceLabel} onPress={voiceMode === "call" ? stopVoice : startVoiceCall} tone="primary" />
        <ToolButton active={voiceMode === "ptt"} icon="keyboard-voice" label="هوكي توكي" onPress={activatePtt} tone="cyan" />
        <ToolButton active={cameraOn} icon={cameraOn ? "videocam" : "videocam-off"} label="الكاميرا" onPress={toggleCamera} tone="success" />
      </View>

      {voiceMode === "ptt" ? (
        <Pressable onPressIn={() => void beginPtt()} onPressOut={() => void endPtt()} style={({ pressed }) => [styles.pttButton, pressed && styles.pttButtonPressed]}>
          <MaterialIcons color="#FFFFFF" name="keyboard-voice" size={25} />
          <Text style={styles.pttText}>اضغط باستمرار للتحدث</Text>
        </Pressable>
      ) : (
        <Text style={styles.modeHelp}>{voiceMode === "call" ? "الاتصال يعمل الآن. عند تفعيل الهوكي توكي سيتوقف الاتصال تلقائيًا." : "اختر الاتصال للمحادثة المستمرة أو الهوكي توكي للتحدث بالضغط."}</Text>
      )}

      {cameraOn && cameraTrackRef ? (
        <View style={styles.cameraPreview}>
          <VideoTrack mirror objectFit="cover" style={styles.cameraVideo} trackRef={cameraTrackRef} zOrder={1} />
          <View style={styles.cameraPreviewLabel}>
            <MaterialIcons color="#FFFFFF" name="videocam" size={15} />
            <Text style={styles.cameraPreviewText}>الكاميرا قيد المشاركة</Text>
          </View>
        </View>
      ) : null}

      <View style={styles.settingsRow}>
        <Pressable onPress={toggleMute} style={({ pressed }) => [styles.settingAction, pressed && styles.pressed]}>
          <MaterialIcons color={micMuted ? colors.error : colors.text} name={micMuted ? "mic-off" : "mic"} size={19} />
          <Text style={styles.settingText}>{micMuted ? "الميكروفون مكتوم" : "كتم الميكروفون"}</Text>
        </Pressable>
        <Pressable onPress={enableNotifications} style={({ pressed }) => [styles.settingAction, pressed && styles.pressed]}>
          <MaterialIcons color={notificationsEnabled ? colors.success : colors.cyan} name={notificationsEnabled ? "notifications-active" : "notifications-none"} size={19} />
          <Text style={styles.settingText}>{notificationsEnabled ? "التنبيهات مفعلة" : "تفعيل التنبيهات"}</Text>
        </Pressable>
      </View>

      <View style={styles.chatHeader}>
        <View style={styles.chatTitleRow}>
          <MaterialIcons color={colors.cyan} name="chat-bubble-outline" size={20} />
          <Text style={styles.chatTitle}>الدردشة الحية</Text>
        </View>
        <Text style={styles.chatStatus}>{chat.length === 0 ? "ابدأ المحادثة" : `${chat.length} رسالة`}</Text>
      </View>
      <FlatList
        contentContainerStyle={chat.length === 0 ? styles.chatEmptyContent : styles.chatListContent}
        data={chat}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={<Text style={styles.chatEmptyText}>تتزامن الرسائل الفورية مع أعضاء الغرفة بعد الاتصال.</Text>}
        renderItem={({ item }) => (
          <View style={[styles.messageBubble, item.local && styles.localMessage]}>
            <Text style={styles.messageAuthor}>{item.author}</Text>
            <Text style={styles.messageBody}>{item.body}</Text>
          </View>
        )}
        style={styles.chatList}
      />
      <View style={styles.chatComposer}>
        <Pressable accessibilityRole="button" onPress={() => void sendMessage()} style={({ pressed }) => [styles.sendButton, pressed && styles.pressed]}>
          <MaterialIcons color="#FFFFFF" name="send" size={21} />
        </Pressable>
        <TextInput
          onChangeText={setChatText}
          onSubmitEditing={() => void sendMessage()}
          placeholder="اكتب رسالة…"
          placeholderTextColor={colors.muted}
          returnKeyType="send"
          style={styles.chatInput}
          textAlign="right"
          value={chatText}
        />
      </View>
    </View>
  );
}

function ToolButton({
  icon,
  label,
  active,
  onPress,
  tone,
}: {
  icon: React.ComponentProps<typeof MaterialIcons>["name"];
  label: string;
  active: boolean;
  onPress: () => void | Promise<void>;
  tone: "primary" | "cyan" | "success";
}) {
  const activeColor = tone === "primary" ? colors.primary : tone === "cyan" ? colors.cyan : colors.success;
  return (
    <Pressable onPress={() => void onPress()} style={({ pressed }) => [styles.toolButton, active && { backgroundColor: activeColor, borderColor: activeColor }, pressed && styles.pressed]}>
      <MaterialIcons color={active ? "#FFFFFF" : colors.text} name={icon} size={24} />
      <Text style={[styles.toolLabel, active && styles.toolLabelActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cameraPreview: { backgroundColor: "#070B16", borderColor: colors.border, borderRadius: 15, borderWidth: 1, height: 150, marginTop: 12, overflow: "hidden" },
  cameraPreviewLabel: { alignItems: "center", alignSelf: "flex-end", backgroundColor: "rgba(11,16,32,0.78)", borderRadius: 99, flexDirection: "row-reverse", gap: 5, margin: 8, paddingHorizontal: 8, paddingVertical: 5 },
  cameraPreviewText: { color: "#FFFFFF", fontSize: 11, fontWeight: "800" },
  cameraVideo: { height: "100%", left: 0, position: "absolute", top: 0, width: "100%" },
  chatComposer: { alignItems: "center", flexDirection: "row", gap: 10, marginTop: 10 },
  chatEmptyContent: { flexGrow: 1, justifyContent: "center" },
  chatEmptyText: { color: colors.muted, fontSize: 13, lineHeight: 19, paddingHorizontal: 12, textAlign: "center" },
  chatHeader: { alignItems: "center", flexDirection: "row-reverse", justifyContent: "space-between", marginTop: 15 },
  chatInput: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 15, borderWidth: 1, color: colors.text, flex: 1, fontSize: 15, height: 46, paddingHorizontal: 14 },
  chatList: { height: 134, marginTop: 8 },
  chatListContent: { gap: 8, paddingBottom: 4 },
  chatStatus: { color: colors.muted, fontSize: 12 },
  chatTitle: { color: colors.text, fontSize: 15, fontWeight: "800" },
  chatTitleRow: { alignItems: "center", flexDirection: "row-reverse", gap: 7 },
  connectionDot: { backgroundColor: colors.muted, borderRadius: 4, height: 7, width: 7 },
  connectionDotError: { backgroundColor: colors.error },
  connectionDotOnline: { backgroundColor: colors.success },
  connectionPill: { alignItems: "center", backgroundColor: "#15223A", borderRadius: 99, flexDirection: "row-reverse", gap: 6, paddingHorizontal: 9, paddingVertical: 5 },
  connectionText: { color: colors.muted, fontSize: 11, fontWeight: "700" },
  localMessage: { backgroundColor: "#2B225B" },
  messageAuthor: { color: colors.cyan, fontSize: 11, fontWeight: "800", textAlign: "right" },
  messageBody: { color: colors.text, fontSize: 14, lineHeight: 20, marginTop: 3, textAlign: "right" },
  messageBubble: { alignSelf: "flex-end", backgroundColor: colors.surface, borderRadius: 14, maxWidth: "82%", paddingHorizontal: 12, paddingVertical: 9 },
  modeHelp: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 12, textAlign: "right" },
  panel: { backgroundColor: "#0F172B", borderColor: colors.border, borderRadius: 20, borderWidth: 1, marginHorizontal: 18, padding: 14 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.97 }] },
  pttButton: { alignItems: "center", backgroundColor: colors.primary, borderRadius: 16, flexDirection: "row-reverse", gap: 9, justifyContent: "center", marginTop: 12, minHeight: 52 },
  pttButtonPressed: { backgroundColor: "#A33DF1", transform: [{ scale: 0.98 }] },
  pttText: { color: "#FFFFFF", fontSize: 14, fontWeight: "900" },
  sendButton: { alignItems: "center", backgroundColor: colors.primary, borderRadius: 15, height: 46, justifyContent: "center", width: 46 },
  settingAction: { alignItems: "center", flex: 1, flexDirection: "row-reverse", gap: 7, justifyContent: "center", paddingVertical: 5 },
  settingText: { color: colors.text, fontSize: 12, fontWeight: "700" },
  settingsRow: { alignItems: "center", backgroundColor: colors.surfaceElevated, borderRadius: 14, flexDirection: "row-reverse", justifyContent: "space-between", marginTop: 12, paddingHorizontal: 6, paddingVertical: 4 },
  toolButton: { alignItems: "center", backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 16, borderWidth: 1, flex: 1, gap: 5, minHeight: 70, justifyContent: "center" },
  toolLabel: { color: colors.muted, fontSize: 11, fontWeight: "800" },
  toolLabelActive: { color: "#FFFFFF" },
  toolRow: { flexDirection: "row-reverse", gap: 8, marginTop: 12 },
  toolsHeader: { alignItems: "center", flexDirection: "row-reverse", justifyContent: "space-between" },
  toolsTitle: { color: colors.text, fontSize: 16, fontWeight: "900" },
});
