import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { AudioSession, isTrackReference, LiveKitRoom, useRoomContext, useTracks, VideoTrack } from "@livekit/react-native";
import { LinearGradient } from "expo-linear-gradient";
import { DataPacket_Kind, RoomEvent, Track } from "livekit-client";
import { useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
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
  const [activePane, setActivePane] = useState<"chat" | "camera" | null>(null);
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
      <View style={styles.panelHeader}>
        <View style={styles.panelTitleRow}>
          <View style={[styles.connectionDot, connected && styles.connectionDotLive]} />
          <Text style={styles.panelTitle}>{connected ? "متصلون في الغرفة" : "جاري الاتصال"}</Text>
        </View>
        <View style={styles.memberCount}><MaterialIcons color={palette.success} name="group" size={15} /><Text style={styles.memberCountText}>{participantCount}</Text></View>
      </View>

      <View style={styles.toolsRow}>
        <Tool active={activePane === "chat"} icon="chat-bubble-outline" label="دردشة" onPress={() => setActivePane(activePane === "chat" ? null : "chat")} />
        <Tool active={callOn} icon={callOn ? "call" : "phone-in-talk"} label={callOn ? "إنهاء" : "اتصال"} onPress={() => void setOpenCall()} />
        <Pressable onPressIn={() => void startTalking()} onPressOut={() => void stopTalking()} style={({ pressed }) => [styles.talkTool, talking && styles.talkToolLive, pressed && styles.toolPressed]}>
          <MaterialIcons color={talking ? "#FFFFFF" : "#DCD6FF"} name="keyboard-voice" size={23} />
          <Text style={[styles.toolLabel, talking && styles.toolLabelLive]}>تحدث</Text>
        </Pressable>
        <Tool active={cameraOn} icon={cameraOn ? "videocam" : "videocam-off"} label="كاميرا" onPress={() => void setCamera()} />
      </View>

      {activePane === "chat" ? (
        <View style={styles.chatPane}>
          <View style={styles.chatHead}><Text style={styles.paneTitle}>الدردشة الحية</Text><Text style={styles.roomCode}>{code}</Text></View>
          <View style={styles.messages}>
            {chat.length === 0 ? <Text style={styles.emptyText}>قل مرحبًا للأعضاء. الرسائل تُرسل فورًا داخل هذه الغرفة.</Text> : chat.map((message) => (
              <View key={message.id} style={[styles.messageBubble, message.mine && styles.messageMine]}>
                <Text style={styles.messageSender}>{message.sender}</Text>
                <Text style={styles.messageText}>{message.text}</Text>
              </View>
            ))}
          </View>
          <View style={styles.composer}>
            <Pressable onPress={() => void sendChat()} style={styles.send}><MaterialIcons color="#FFFFFF" name="arrow-back" size={20} /></Pressable>
            <TextInput onChangeText={setDraft} placeholder="اكتب رسالة قصيرة…" placeholderTextColor="#7383AA" returnKeyType="send" style={styles.chatInput} textAlign="right" value={draft} onSubmitEditing={() => void sendChat()} />
          </View>
        </View>
      ) : null}

      {activePane === "camera" ? (
        <View style={styles.cameraPane}>
          <View style={styles.chatHead}><Text style={styles.paneTitle}>كاميرات الغرفة</Text><Text style={styles.roomCode}>{cameraOn ? "مشاركتك ظاهرة" : ""}</Text></View>
          <View style={styles.cameraGrid}>
            {cameraTracks.length === 0 ? <Text style={styles.emptyText}>شغّل الكاميرا لتظهر معاينتك، وستظهر كاميرات الأعضاء هنا.</Text> : cameraTracks.slice(0, 4).map((track, index) => isTrackReference(track) ? <VideoTrack key={track.publication.trackSid} style={styles.videoTrack} trackRef={track} /> : <View key={`placeholder-${index}`} style={styles.videoPlaceholder} />)}
          </View>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

function Tool({ active, icon, label, onPress }: { active: boolean; icon: React.ComponentProps<typeof MaterialIcons>["name"]; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.tool, active && styles.toolActive, pressed && styles.toolPressed]}>
      <MaterialIcons color={active ? "#FFFFFF" : "#BBC7E7"} name={icon} size={21} />
      <Text style={[styles.toolLabel, active && styles.toolLabelLive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cameraGrid: { flexDirection: "row-reverse", flexWrap: "wrap", gap: 8, minHeight: 135 },
  cameraPane: { backgroundColor: "#0B132A", borderColor: "#263A67", borderRadius: 18, borderWidth: 1, marginTop: 12, overflow: "hidden", padding: 12 },
  chatHead: { alignItems: "center", flexDirection: "row-reverse", justifyContent: "space-between", marginBottom: 10 },
  chatInput: { color: palette.text, flex: 1, fontSize: 14, height: 45, paddingHorizontal: 13 },
  chatPane: { backgroundColor: "#0B132A", borderColor: "#263A67", borderRadius: 18, borderWidth: 1, marginTop: 12, padding: 12 },
  composer: { alignItems: "center", backgroundColor: "#141F3D", borderColor: "#293B65", borderRadius: 15, borderWidth: 1, flexDirection: "row", gap: 8, padding: 4 },
  connectionDot: { backgroundColor: "#617096", borderRadius: 5, height: 8, width: 8 },
  connectionDotLive: { backgroundColor: palette.success },
  emptyText: { color: palette.muted, fontSize: 12, lineHeight: 19, paddingVertical: 15, textAlign: "center" },
  memberCount: { alignItems: "center", backgroundColor: "rgba(73,213,158,0.10)", borderRadius: 99, flexDirection: "row-reverse", gap: 4, paddingHorizontal: 8, paddingVertical: 5 },
  memberCountText: { color: palette.success, fontSize: 11, fontWeight: "900" },
  messageBubble: { alignSelf: "flex-end", backgroundColor: "#172342", borderRadius: 13, marginBottom: 7, maxWidth: "82%", paddingHorizontal: 10, paddingVertical: 8 },
  messageMine: { alignSelf: "flex-start", backgroundColor: "#483198" },
  messageSender: { color: palette.cyan, fontSize: 10, fontWeight: "900", textAlign: "right" },
  messageText: { color: palette.text, fontSize: 13, lineHeight: 19, marginTop: 2, textAlign: "right" },
  messages: { maxHeight: 165, minHeight: 64 },
  panel: { backgroundColor: palette.panel, borderColor: "#293B66", borderRadius: 22, borderWidth: 1, marginHorizontal: 18, marginTop: 13, padding: 13 },
  panelHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  panelTitle: { color: palette.text, fontSize: 14, fontWeight: "900" },
  panelTitleRow: { alignItems: "center", flexDirection: "row-reverse", gap: 7 },
  paneTitle: { color: palette.text, fontSize: 13, fontWeight: "900" },
  roomCode: { color: "#8493B8", fontSize: 10, fontWeight: "800" },
  send: { alignItems: "center", backgroundColor: palette.primary, borderRadius: 12, height: 37, justifyContent: "center", width: 37 },
  talkTool: { alignItems: "center", backgroundColor: "#252050", borderColor: "#51479A", borderRadius: 16, borderWidth: 1, flex: 1, gap: 4, minHeight: 65, justifyContent: "center" },
  talkToolLive: { backgroundColor: "#A64E73", borderColor: "#FF9BBA" },
  tool: { alignItems: "center", backgroundColor: "#172342", borderColor: "#2B3D67", borderRadius: 16, borderWidth: 1, flex: 1, gap: 4, minHeight: 65, justifyContent: "center" },
  toolActive: { backgroundColor: "#6241D9", borderColor: "#A98AFF" },
  toolLabel: { color: "#C2CBE8", fontSize: 10, fontWeight: "900" },
  toolLabelLive: { color: "#FFFFFF" },
  toolPressed: { opacity: 0.76, transform: [{ scale: 0.97 }] },
  toolsRow: { flexDirection: "row-reverse", gap: 8, marginTop: 12 },
  unavailable: { alignItems: "center", backgroundColor: "#101A34", borderColor: "#293B66", borderRadius: 18, borderWidth: 1, flexDirection: "row-reverse", gap: 8, marginHorizontal: 18, marginTop: 13, padding: 13 },
  unavailableText: { color: palette.muted, flex: 1, fontSize: 12, lineHeight: 18, textAlign: "right" },
  videoPlaceholder: { backgroundColor: "#101A34", borderRadius: 12, height: 110, width: "48%" },
  videoTrack: { backgroundColor: "#070B16", borderRadius: 12, height: 110, overflow: "hidden", width: "48%" },
});
