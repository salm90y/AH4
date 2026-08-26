import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

export type RealtimeRoomCredentials = {
  code: string;
  serverUrl: string;
  token: string;
};

export function RoomRealtimePanel({ credentials }: { credentials: RealtimeRoomCredentials }) {
  const [activePane, setActivePane] = useState<"chat" | "camera" | null>("chat");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<string[]>([]);
  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setMessages((current) => [...current, text]);
    setDraft("");
  };

  return (
    <View style={styles.panel}>
      <View style={styles.toolsRow}>
        <View style={styles.membersTool}><MaterialIcons color="#CABEFF" name="group" size={25} /><View style={styles.membersBadge}><Text style={styles.membersBadgeText}>1</Text></View></View>
        <Tool icon="videocam-off" label="كاميرا" tone="camera" onPress={() => setActivePane("camera")} />
        <View style={styles.talkTool}><MaterialIcons color="#8EF7D9" name="keyboard-voice" size={23} /><Text style={styles.toolLabel}>تحدث</Text></View>
        <Tool icon="auto-awesome" label="مزامنة" tone="sync" onPress={() => undefined} />
        <Tool icon="phone-in-talk" label="اتصال" tone="call" onPress={() => undefined} />
        <Tool active={activePane === "chat"} icon="chat-bubble-outline" label="دردشة" tone="chat" onPress={() => setActivePane(activePane === "chat" ? null : "chat")} />
      </View>

      {activePane === "chat" ? <View style={styles.chatPane}>
        <View style={styles.chatHead}><Pressable onPress={() => setActivePane(null)} style={styles.closePane}><Text style={styles.closePaneText}>إغلاق</Text></Pressable><View style={styles.chatHeadInfo}><View style={styles.chatPresence}><Text style={styles.chatPresenceText}>1 متصل</Text></View><Text style={styles.title}>الدردشة الحية</Text><MaterialIcons color="#68A9FF" name="chat-bubble-outline" size={24} /></View></View>
        <View style={styles.messages}>{messages.length === 0 ? <View style={styles.emptyWrap}><MaterialIcons color="#33669E" name="chat-bubble-outline" size={48} /><Text style={styles.emptyTitle}>لا توجد رسائل بعد</Text><Text style={styles.body}>كن أول من يكتب في الدردشة المباشرة!</Text></View> : messages.map((message, index) => <View key={`${index}-${message}`} style={styles.message}><Text style={styles.messageText}>{message}</Text></View>)}</View>
        <View style={styles.composer}><Pressable onPress={send} style={styles.send}><MaterialIcons color="#A8C7FF" name="send" size={23} /></Pressable><TextInput onChangeText={setDraft} onSubmitEditing={send} placeholder="اكتب رسالة في الدردشة المباشرة…" placeholderTextColor="#7383AA" returnKeyType="send" style={styles.chatInput} textAlign="right" value={draft} /><MaterialIcons color="#9AA7C1" name="insert-photo" size={25} /><MaterialIcons color="#9AA7C1" name="sentiment-satisfied-alt" size={25} /></View>
      </View> : null}

      {activePane === "camera" ? <View style={styles.cameraPane}><View style={styles.chatHead}><Text style={styles.title}>كاميرات الغرفة</Text><Pressable onPress={() => setActivePane(null)} style={styles.closePane}><Text style={styles.closePaneText}>إغلاق</Text></Pressable></View><Text style={styles.body}>الكاميرا والصوت والهوكي توكي تعمل في APK Android الأصلي. هذه المعاينة تعرض التخطيط فقط.</Text></View> : null}
    </View>
  );
}

function Tool({ active = false, icon, label, tone, onPress }: { active?: boolean; icon: React.ComponentProps<typeof MaterialIcons>["name"]; label: string; tone: "camera" | "call" | "chat" | "sync"; onPress: () => void }) {
  const toneStyle = tone === "camera" ? styles.toolCamera : tone === "call" ? styles.toolCall : tone === "sync" ? styles.toolSync : styles.toolChat;
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.tool, toneStyle, active && styles.toolActive, pressed && styles.pressed]}><MaterialIcons color="#E1E7FF" name={icon} size={22} /><Text style={styles.toolLabel}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  body: { color: "#9EADD0", fontSize: 12, lineHeight: 19, marginTop: 8, textAlign: "center" },
  cameraPane: { backgroundColor: "#151D2E", borderColor: "#365C95", borderRadius: 22, borderWidth: 1, marginTop: 13, padding: 13 },
  chatHead: { alignItems: "center", borderBottomColor: "#2B3850", borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", marginHorizontal: -13, marginTop: -3, paddingBottom: 13, paddingHorizontal: 13 },
  chatHeadInfo: { alignItems: "center", flexDirection: "row-reverse", gap: 9 },
  chatInput: { backgroundColor: "#151D2C", borderColor: "#35425A", borderRadius: 16, borderWidth: 1, color: "#F8F8FF", flex: 1, fontSize: 13, height: 45, paddingHorizontal: 13 },
  chatPane: { backgroundColor: "#151D2E", borderColor: "#365C95", borderRadius: 22, borderWidth: 1, flex: 1, minHeight: 350, overflow: "hidden", padding: 13 },
  chatPresence: { backgroundColor: "#10336A", borderRadius: 10, paddingHorizontal: 9, paddingVertical: 5 },
  chatPresenceText: { color: "#68A9FF", fontSize: 11, fontWeight: "900" },
  closePane: { backgroundColor: "#303A4B", borderColor: "#475469", borderRadius: 10, borderWidth: 1, paddingHorizontal: 11, paddingVertical: 7 },
  closePaneText: { color: "#E8EEFF", fontSize: 11, fontWeight: "800" },
  composer: { alignItems: "center", borderTopColor: "#26324A", borderTopWidth: 1, flexDirection: "row", gap: 8, marginHorizontal: -13, paddingHorizontal: 13, paddingTop: 13 },
  emptyTitle: { color: "#D8E0F5", fontSize: 15, fontWeight: "900", marginTop: 13, textAlign: "center" },
  emptyWrap: { alignItems: "center", flex: 1, justifyContent: "center", paddingHorizontal: 12 },
  membersBadge: { alignItems: "center", backgroundColor: "#00B77E", borderRadius: 17, height: 24, justifyContent: "center", position: "absolute", right: -8, top: -8, width: 24 },
  membersBadgeText: { color: "#FFFFFF", fontSize: 11, fontWeight: "900" },
  membersTool: { alignItems: "center", backgroundColor: "#272B40", borderColor: "#4B526D", borderRadius: 16, borderWidth: 1, height: 66, justifyContent: "center", width: 52 },
  message: { alignSelf: "flex-end", backgroundColor: "#22304E", borderRadius: 13, marginBottom: 7, maxWidth: "82%", paddingHorizontal: 10, paddingVertical: 8 },
  messageText: { color: "#F8F8FF", fontSize: 13, textAlign: "right" },
  messages: { flex: 1, minHeight: 210, paddingVertical: 12 },
  panel: { backgroundColor: "transparent", flex: 1, marginHorizontal: 10, paddingTop: 13 },
  pressed: { opacity: 0.76, transform: [{ scale: 0.97 }] },
  send: { alignItems: "center", backgroundColor: "#123A8A", borderRadius: 16, height: 45, justifyContent: "center", width: 45 },
  talkTool: { alignItems: "center", backgroundColor: "#073F3A", borderColor: "#167A70", borderRadius: 16, borderWidth: 1, flex: 1, gap: 4, minHeight: 66, justifyContent: "center" },
  title: { color: "#F8F8FF", fontSize: 16, fontWeight: "900", textAlign: "right" },
  tool: { alignItems: "center", borderRadius: 16, borderWidth: 1, flex: 1, gap: 4, minHeight: 66, justifyContent: "center" },
  toolActive: { backgroundColor: "#297BFF", borderColor: "#9AC4FF" },
  toolCall: { backgroundColor: "#8E216F", borderColor: "#E46BC5" },
  toolCamera: { backgroundColor: "#3A2C14", borderColor: "#9A6D22" },
  toolChat: { backgroundColor: "#0759D6", borderColor: "#4C9AFF" },
  toolLabel: { color: "#E1E7FF", fontSize: 10, fontWeight: "900" },
  toolSync: { backgroundColor: "#282052", borderColor: "#5A4BA5" },
  toolsRow: { backgroundColor: "#121A2A", borderColor: "#31415D", borderRadius: 22, borderWidth: 1, flexDirection: "row-reverse", gap: 7, padding: 6 },
});
