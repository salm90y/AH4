import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { AudioSession, isTrackReference, LiveKitRoom, useRoomContext, useTracks, VideoTrack } from "@livekit/react-native";
import { LinearGradient } from "expo-linear-gradient";
import { DataPacket_Kind, RoomEvent, Track } from "livekit-client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { ensureLiveKitGlobals } from "@/lib/livekit-setup";

export type RealtimeRoomCredentials = {
  code: string;
  serverUrl: string;
  token: string;
};

type ChatMessage = { id: string; mine: boolean; sender: string; text: string };

const palette = {
  cyan: "#32D7E7",
  muted: "#9EADD0",
  panel: "#101A34",
  primary: "#8B5CF6",
  success: "#49D59E",
  text: "#F8F8FF",
};

export function RoomRealtimePanel({ credentials }: { credentials: RealtimeRoomCredentials }) {
  ensureLiveKitGlobals();
  if (!credentials.serverUrl || !credentials.token) {
    return (
      <View style={styles.unavailable}>
        <MaterialIcons color={palette.cyan} name="cloud-sync" size={20} />
        <Text style={styles.unavailableText}>يتم تجهيز قناة التواصل الآمن للغرفة. أعد فتح الغرفة بعد اكتمال مزامنة الخادم.</Text>
      </View>
    );
  }

  return (
    <LiveKitRoom audio={false} connect serverUrl={credentials.serverUrl} token={credentials.token} video={false}>
      <RealtimeControls code={credentials.code} />
    </LiveKitRoom>
  );
}

function RealtimeControls({ code }: { code: string }) {
  const room = useRoomContext();
  const [activePane, setActivePane] = useState<"chat" | "camera" | null>("chat");
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [connected, setConnected] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [callOn, setCallOn] = useState(false);
  const [talking, setTalking] = useState(false);
  const [busy, setBusy] = useState(false);
  const pendingPress = useRef(false);
  const cameraTracks = useTracks([Track.Source.Camera]);

  useEffect(() => {
    let mounted = true;
    void AudioSession.startAudioSession().then(() => mounted && setConnected(true)).catch(() => mounted && setConnected(false));
    const onData = (payload: Uint8Array, participant?: { name?: string; identity?: string }, kind?: DataPacket_Kind) => {
      if (kind !== DataPacket_Kind.RELIABLE) return;
      try {
        const message = JSON.parse(new TextDecoder().decode(payload)) as { kind?: string; text?: string; id?: string };
        if (message.kind !== "ah4-chat" || !message.text?.trim()) return;
        const text = message.text.trim();
        setChat((current) => [...current, { id: message.id ?? `${Date.now()}`, mine: false, sender: participant?.name || participant?.identity || "عضو", text }].slice(-24));
      } catch {
        // Ignore non-chat data packets from the room.
      }
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => {
      mounted = false;
      room.off(RoomEvent.DataReceived, onData);
      void room.localParticipant.setCameraEnabled(false);
      void room.localParticipant.setMicrophoneEnabled(false);
      void AudioSession.stopAudioSession();
    };
  }, [room]);

  const participantCount = useMemo(() => room.remoteParticipants.size + 1, [room.remoteParticipants.size]);

  const setOpenCall = async () => {
    if (busy) return;
    try {
      setBusy(true);
      const next = !callOn;
      await room.localParticipant.setMicrophoneEnabled(next);
      setCallOn(next);
      if (next) setTalking(false);
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
      setActivePane(next ? "camera" : null);
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
    await room.localParticipant.setMicrophoneEnabled(false);
    setTalking(false);
  };

  const sendChat = async () => {
    const text = draft.trim();
    if (!text) return;
    const outgoing = { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, kind: "ah4-chat", text };
    setDraft("");
    setChat((current) => [...current, { id: outgoing.id, mine: true, sender: "أنت", text }].slice(-24));
    try {
      await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(outgoing)), { reliable: true, topic: "ah4-chat" });
    } catch {
      setChat((current) => current.filter((message) => message.id !== outgoing.id));
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.panel}>
      <View style={styles.toolsRow}>
        <View style={styles.membersTool}>
          <View style={[styles.connectionDot, connected && styles.connectionDotLive]} />
          <MaterialIcons color="#CABEFF" name="group" size={25} />
          <View style={styles.membersBadge}><Text style={styles.membersBadgeText}>{participantCount}</Text></View>
        </View>
        <Tool active={cameraOn} icon={cameraOn ? "videocam" : "videocam-off"} label="كاميرا" tone="camera" onPress={() => void setCamera()} />
        <Pressable onPressIn={() => void startTalking()} onPressOut={() => void stopTalking()} style={({ pressed }) => [styles.talkTool, talking && styles.talkToolLive, pressed && styles.toolPressed]}>
          <MaterialIcons color={talking ? "#FFFFFF" : "#8EF7D9"} name="keyboard-voice" size={23} />
          <Text style={[styles.toolLabel, talking && styles.toolLabelLive]}>تحدث</Text>
        </Pressable>
        <Tool active={false} icon="auto-awesome" label="مزامنة" tone="sync" onPress={() => Alert.alert("المزامنة مفعّلة", "يتابع التطبيق مصدر الغرفة وحالة التشغيل تلقائيًا، ويصحح فرق الوقت عند الحاجة.")} />
        <Tool active={callOn} icon={callOn ? "call" : "phone-in-talk"} label={callOn ? "إنهاء" : "اتصال"} tone="call" onPress={() => void setOpenCall()} />
        <Tool active={activePane === "chat"} icon="chat-bubble-outline" label="دردشة" tone="chat" onPress={() => setActivePane(activePane === "chat" ? null : "chat")} />
      </View>

      {activePane === "chat" ? (
        <View style={styles.chatPane}>
          <View style={styles.chatHead}>
            <Pressable accessibilityLabel="إخفاء الدردشة" accessibilityRole="button" onPress={() => setActivePane(null)} style={({ pressed }) => [styles.closePane, pressed && styles.toolPressed]}><Text style={styles.closePaneText}>إغلاق</Text></Pressable>
            <View style={styles.chatHeadInfo}>
              <View style={styles.chatPresence}><Text style={styles.chatPresenceText}>{connected ? `${participantCount} متصل` : "جاري الاتصال"}</Text></View>
              <Text style={styles.paneTitle}>الدردشة الحية</Text>
              <MaterialIcons color="#68A9FF" name="chat-bubble-outline" size={24} />
            </View>
          </View>
          <View style={styles.messages}>
            {chat.length === 0 ? <View style={styles.emptyWrap}><MaterialIcons color="#33669E" name="chat-bubble-outline" size={48} /><Text style={styles.emptyTitle}>لا توجد رسائل بعد</Text><Text style={styles.emptyText}>كن أول من يكتب في الدردشة المباشرة!</Text></View> : chat.map((message) => (
              <View key={message.id} style={[styles.messageBubble, message.mine && styles.messageMine]}>
                <Text style={styles.messageSender}>{message.sender}</Text>
                <Text style={styles.messageText}>{message.text}</Text>
              </View>
            ))}
          </View>
          <View style={styles.composer}>
            <Pressable accessibilityLabel="إرسال الرسالة" accessibilityRole="button" onPress={() => void sendChat()} style={({ pressed }) => [styles.send, pressed && styles.toolPressed]}><MaterialIcons color="#A8C7FF" name="send" size={23} /></Pressable>
            <TextInput onChangeText={setDraft} placeholder="اكتب رسالة في الدردشة المباشرة…" placeholderTextColor="#7383AA" returnKeyType="send" style={styles.chatInput} textAlign="right" value={draft} onSubmitEditing={() => void sendChat()} />
            <MaterialIcons color="#9AA7C1" name="insert-photo" size={25} />
            <MaterialIcons color="#9AA7C1" name="sentiment-satisfied-alt" size={25} />
          </View>
        </View>
      ) : null}

      {activePane === "camera" ? (
        <View style={styles.cameraPane}>
          <View style={styles.chatHead}><Text style={styles.paneTitle}>كاميرات الغرفة</Text><Text style={styles.cameraStatusText}>{cameraOn ? "مشاركتك ظاهرة" : ""}</Text></View>
          <View style={styles.cameraGrid}>
            {cameraTracks.length === 0 ? <Text style={styles.emptyText}>شغّل الكاميرا لتظهر معاينتك، وستظهر كاميرات الأعضاء هنا.</Text> : cameraTracks.slice(0, 4).map((track, index) => isTrackReference(track) ? <VideoTrack key={track.publication.trackSid} style={styles.videoTrack} trackRef={track} /> : <View key={`placeholder-${index}`} style={styles.videoPlaceholder} />)}
          </View>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

function Tool({ active, icon, label, tone, onPress }: { active: boolean; icon: React.ComponentProps<typeof MaterialIcons>["name"]; label: string; tone: "camera" | "call" | "chat" | "sync"; onPress: () => void }) {
  const toneStyle = tone === "camera" ? styles.toolCamera : tone === "call" ? styles.toolCall : tone === "sync" ? styles.toolSync : styles.toolChat;
  return (
    <Pressable accessibilityLabel={label} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.tool, toneStyle, active && styles.toolActive, active && tone === "call" && styles.toolCallActive, active && tone === "chat" && styles.toolChatActive, pressed && styles.toolPressed]}>
      <MaterialIcons color={active ? "#FFFFFF" : "#BBC7E7"} name={icon} size={21} />
      <Text style={[styles.toolLabel, active && styles.toolLabelLive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cameraGrid: { flexDirection: "row-reverse", flexWrap: "wrap", gap: 8, minHeight: 135 },
  cameraPane: { backgroundColor: "#101A2D", borderColor: "#284876", borderRadius: 21, borderWidth: 1, marginTop: 13, overflow: "hidden", padding: 12 },
  cameraStatusText: { color: "#62E2B0", fontSize: 11, fontWeight: "800" },
  chatHead: { alignItems: "center", borderBottomColor: "#2B3850", borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", marginHorizontal: -13, marginTop: -3, paddingBottom: 13, paddingHorizontal: 13 },
  chatHeadInfo: { alignItems: "center", flexDirection: "row-reverse", gap: 9 },
  chatInput: { backgroundColor: "#151D2C", borderColor: "#35425A", borderRadius: 16, borderWidth: 1, color: palette.text, flex: 1, fontSize: 13, height: 45, paddingHorizontal: 13 },
  chatPane: { backgroundColor: "#151D2E", borderColor: "#365C95", borderRadius: 22, borderWidth: 1, flex: 1, marginTop: 13, overflow: "hidden", padding: 13 },
  chatPresence: { backgroundColor: "#10336A", borderRadius: 10, paddingHorizontal: 9, paddingVertical: 5 },
  chatPresenceText: { color: "#68A9FF", fontSize: 11, fontWeight: "900" },
  closePane: { backgroundColor: "#303A4B", borderColor: "#475469", borderRadius: 10, borderWidth: 1, paddingHorizontal: 11, paddingVertical: 7 },
  closePaneText: { color: "#E8EEFF", fontSize: 11, fontWeight: "800" },
  composer: { alignItems: "center", borderTopColor: "#26324A", borderTopWidth: 1, flexDirection: "row", gap: 8, marginHorizontal: -13, paddingHorizontal: 13, paddingTop: 13 },
  connectionDot: { backgroundColor: "#617096", borderRadius: 5, height: 8, width: 8 },
  connectionDotLive: { backgroundColor: palette.success },
  emptyText: { color: palette.muted, fontSize: 12, lineHeight: 19, marginTop: 7, textAlign: "center" },
  emptyTitle: { color: "#D8E0F5", fontSize: 15, fontWeight: "900", marginTop: 13, textAlign: "center" },
  emptyWrap: { alignItems: "center", flex: 1, justifyContent: "center", paddingHorizontal: 12 },
  memberCount: { alignItems: "center", backgroundColor: "rgba(73,213,158,0.10)", borderRadius: 99, flexDirection: "row-reverse", gap: 4, paddingHorizontal: 8, paddingVertical: 5 },
  memberCountText: { color: palette.success, fontSize: 11, fontWeight: "900" },
  messageBubble: { alignSelf: "flex-end", backgroundColor: "#172342", borderRadius: 13, marginBottom: 7, maxWidth: "82%", paddingHorizontal: 10, paddingVertical: 8 },
  messageMine: { alignSelf: "flex-start", backgroundColor: "#483198" },
  messageSender: { color: palette.cyan, fontSize: 10, fontWeight: "900", textAlign: "right" },
  messageText: { color: palette.text, fontSize: 13, lineHeight: 19, marginTop: 2, textAlign: "right" },
  membersBadge: { alignItems: "center", backgroundColor: "#00B77E", borderRadius: 17, height: 24, justifyContent: "center", position: "absolute", right: -8, top: -8, width: 24 },
  membersBadgeText: { color: "#FFFFFF", fontSize: 11, fontWeight: "900" },
  membersTool: { alignItems: "center", backgroundColor: "#272B40", borderColor: "#4B526D", borderRadius: 16, borderWidth: 1, height: 66, justifyContent: "center", width: 65 },
  messages: { flex: 1, minHeight: 110, paddingVertical: 12 },
  panel: { backgroundColor: "transparent", flex: 1, marginHorizontal: 10, paddingTop: 13 },
  paneTitle: { color: palette.text, fontSize: 16, fontWeight: "900" },
  send: { alignItems: "center", backgroundColor: "#123A8A", borderRadius: 16, height: 45, justifyContent: "center", width: 45 },
  talkTool: { alignItems: "center", backgroundColor: "#073F3A", borderColor: "#167A70", borderRadius: 16, borderWidth: 1, flex: 1, gap: 4, minHeight: 66, justifyContent: "center" },
  talkToolLive: { backgroundColor: "#A64E73", borderColor: "#FF9BBA" },
  tool: { alignItems: "center", borderRadius: 16, borderWidth: 1, flex: 1, gap: 4, minHeight: 66, justifyContent: "center" },
  toolActive: { backgroundColor: "#6241D9", borderColor: "#A98AFF" },
  toolCall: { backgroundColor: "#272052", borderColor: "#51479A" },
  toolCallActive: { backgroundColor: "#C72674", borderColor: "#FF7FC2" },
  toolCamera: { backgroundColor: "#3A2C14", borderColor: "#9A6D22" },
  toolChat: { backgroundColor: "#0759D6", borderColor: "#4C9AFF" },
  toolChatActive: { backgroundColor: "#297BFF", borderColor: "#9AC4FF" },
  toolSync: { backgroundColor: "#282052", borderColor: "#5A4BA5" },
  toolLabel: { color: "#C2CBE8", fontSize: 10, fontWeight: "900" },
  toolLabelLive: { color: "#FFFFFF" },
  toolPressed: { opacity: 0.76, transform: [{ scale: 0.97 }] },
  toolsRow: { backgroundColor: "#121A2A", borderColor: "#31415D", borderRadius: 22, borderWidth: 1, flexDirection: "row-reverse", gap: 7, padding: 6 },
  unavailable: { alignItems: "center", backgroundColor: "#101A34", borderColor: "#293B66", borderRadius: 18, borderWidth: 1, flexDirection: "row-reverse", gap: 8, marginHorizontal: 18, marginTop: 13, padding: 13 },
  unavailableText: { color: palette.muted, flex: 1, fontSize: 12, lineHeight: 18, textAlign: "right" },
  videoPlaceholder: { backgroundColor: "#101A34", borderRadius: 12, height: 110, width: "48%" },
  videoTrack: { backgroundColor: "#070B16", borderRadius: 12, height: 110, overflow: "hidden", width: "48%" },
});
