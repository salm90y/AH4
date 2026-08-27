import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { RoomPermission, RoomRole } from "@/lib/room-api";

export type RealtimeRoomCredentials = { code: string; serverUrl: string; token: string };

type PreviewMessage = { id: string; authorName: string; text: string; mine: boolean };

export function RoomRealtimePanel({
  onSelfAccessChange: _onSelfAccessChange,
  participantId: _participantId,
  permissions: _permissions,
  role: _role,
}: {
  accessToken: string;
  credentials: RealtimeRoomCredentials;
  onSelfAccessChange: (access: { role: RoomRole; permissions: RoomPermission[] }) => void;
  participantId: string;
  permissions: RoomPermission[];
  role: RoomRole;
}) {
  const [activePane, setActivePane] = useState<"chat" | "camera" | "members" | null>("chat");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<PreviewMessage[]>([]);
  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setMessages((current) => [...current, { id: `${Date.now()}`, authorName: "المضيف", text, mine: true }]);
    setDraft("");
  };

  return <View style={styles.panel}>
    <View style={styles.toolsRow}>
      <Tool active={activePane === "members"} icon="group" label="إدارة الأعضاء" tone="members" onPress={() => setActivePane(activePane === "members" ? "chat" : "members")}><View style={styles.membersBadge}><Text style={styles.membersBadgeText}>1</Text></View></Tool>
      <Tool icon="videocam-off" label="الكاميرا" tone="camera" onPress={() => setActivePane("camera")} />
      <Tool icon="keyboard-voice" label="هوكي توكي" tone="talk" onPress={() => undefined} />
      <Tool icon="auto-awesome" label="مزامنة المشاهدة" tone="sync" onPress={() => undefined} />
      <Tool icon="phone-in-talk" label="اتصال صوتي" tone="call" onPress={() => undefined} />
      <Tool active={activePane === "chat"} icon="chat-bubble-outline" label="الدردشة" tone="chat" onPress={() => setActivePane(activePane === "chat" ? null : "chat")} />
    </View>

    {activePane === "chat" ? <View style={styles.chatPane}>
      <FlatList contentContainerStyle={styles.messagesContent} data={messages} keyExtractor={(message) => message.id} renderItem={({ item }) => <PreviewChatRow message={item} onDelete={() => setMessages((current) => current.filter((message) => message.id !== item.id))} />} style={styles.messages} />
      <View style={styles.composer}><Pressable accessibilityLabel="إرسال" onPress={send} style={styles.send}><MaterialIcons color="#C6DAFF" name="send" size={20} /></Pressable><TextInput maxLength={800} onChangeText={setDraft} onSubmitEditing={send} placeholder="اكتب رسالة…" placeholderTextColor="#7383AA" returnKeyType="send" style={styles.chatInput} textAlign="right" value={draft} /></View>
    </View> : null}
    {activePane === "camera" ? <View style={styles.cameraPane}><View style={styles.cameraPlaceholder}><MaterialIcons color="#637AA5" name="videocam" size={32} /></View></View> : null}
    {activePane === "members" ? <View style={styles.memberPane}><View style={styles.memberRow}><View style={styles.avatar}><Text style={styles.avatarText}>م</Text></View><View style={styles.memberInfo}><Text style={styles.memberName}>المضيف</Text><Text style={styles.memberRole}>صلاحيات كاملة</Text></View><MaterialIcons color="#B49DFF" name="admin-panel-settings" size={20} /></View></View> : null}
  </View>;
}

function Tool({ active = false, children, icon, label, tone, onPress }: { active?: boolean; children?: React.ReactNode; icon: React.ComponentProps<typeof MaterialIcons>["name"]; label: string; tone: "members" | "camera" | "talk" | "call" | "chat" | "sync"; onPress: () => void }) {
  const toneStyle = tone === "members" ? styles.toolMembers : tone === "camera" ? styles.toolCamera : tone === "talk" ? styles.toolTalk : tone === "call" ? styles.toolCall : tone === "sync" ? styles.toolSync : styles.toolChat;
  return <Pressable accessibilityLabel={label} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.tool, toneStyle, active && styles.toolActive, pressed && styles.pressed]}><MaterialIcons color="#D7DFF7" name={icon} size={20} />{children}</Pressable>;
}

function PreviewChatRow({ message, onDelete }: { message: PreviewMessage; onDelete: () => void }) {
  return <View style={[styles.messageRow, message.mine && styles.messageRowMine]}><View style={[styles.avatar, message.mine && styles.avatarMine]}><Text style={styles.avatarText}>{message.authorName.slice(0, 1)}</Text></View><View style={[styles.messageBody, message.mine && styles.messageBodyMine]}><View style={styles.messageMeta}><Text style={styles.messageSender}>{message.authorName}</Text><Pressable accessibilityLabel="حذف الرسالة" onPress={onDelete}><MaterialIcons color="#A7B6D9" name="delete-outline" size={15} /></Pressable></View><Text style={styles.messageText}>{message.text}</Text></View></View>;
}

const styles = StyleSheet.create({
  avatar: { alignItems: "center", backgroundColor: "#28517E", borderRadius: 18, height: 36, justifyContent: "center", marginTop: 2, width: 36 },
  avatarMine: { backgroundColor: "#6846D6" },
  avatarText: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  cameraPane: { backgroundColor: "#101A2D", borderColor: "#284876", borderRadius: 18, borderWidth: 1, flex: 1, marginTop: 8, minHeight: 158, padding: 8 },
  cameraPlaceholder: { alignItems: "center", backgroundColor: "#09101E", borderRadius: 12, flex: 1, justifyContent: "center" },
  chatInput: { backgroundColor: "#131D30", borderColor: "#31415D", borderRadius: 15, borderWidth: 1, color: "#F8F8FF", flex: 1, fontSize: 14, height: 42, paddingHorizontal: 13 },
  chatPane: { backgroundColor: "#111A2D", borderColor: "#314B76", borderRadius: 18, borderWidth: 1, flex: 1, marginTop: 8, minHeight: 300, overflow: "hidden", paddingHorizontal: 9, paddingTop: 5 },
  composer: { alignItems: "center", borderTopColor: "#26364F", borderTopWidth: 1, flexDirection: "row", gap: 8, marginHorizontal: -9, paddingHorizontal: 9, paddingVertical: 8 },
  memberInfo: { flex: 1, marginRight: 8 },
  memberName: { color: "#F8F8FF", fontSize: 13, fontWeight: "800", textAlign: "right" },
  memberPane: { backgroundColor: "#111A2D", borderColor: "#314B76", borderRadius: 18, borderWidth: 1, flex: 1, marginTop: 8, minHeight: 158, padding: 9 },
  memberRole: { color: "#93A2C4", fontSize: 10, marginTop: 2, textAlign: "right" },
  memberRow: { alignItems: "center", flexDirection: "row-reverse", minHeight: 52 },
  membersBadge: { alignItems: "center", backgroundColor: "#00B77E", borderRadius: 10, height: 18, justifyContent: "center", position: "absolute", right: -4, top: -4, width: 18 },
  membersBadgeText: { color: "#FFFFFF", fontSize: 9, fontWeight: "900" },
  messageBody: { backgroundColor: "#182747", borderRadius: 13, flexShrink: 1, maxWidth: "82%", paddingHorizontal: 10, paddingVertical: 7 },
  messageBodyMine: { backgroundColor: "#49319B" },
  messageMeta: { alignItems: "center", flexDirection: "row-reverse", justifyContent: "space-between" },
  messageRow: { alignItems: "flex-start", flexDirection: "row-reverse", gap: 7, marginBottom: 9, paddingHorizontal: 1 },
  messageRowMine: { flexDirection: "row" },
  messageSender: { color: "#86BFFF", fontSize: 11, fontWeight: "900" },
  messageText: { color: "#F8F8FF", fontSize: 13, lineHeight: 19, marginTop: 2, textAlign: "right" },
  messages: { flex: 1 },
  messagesContent: { flexGrow: 1, paddingTop: 8 },
  panel: { backgroundColor: "transparent", flex: 1, marginHorizontal: 10, paddingTop: 8 },
  pressed: { opacity: 0.76, transform: [{ scale: 0.94 }] },
  send: { alignItems: "center", backgroundColor: "#173F91", borderRadius: 14, height: 42, justifyContent: "center", width: 42 },
  tool: { alignItems: "center", borderRadius: 13, borderWidth: 1, flex: 1, height: 42, justifyContent: "center" },
  toolActive: { backgroundColor: "#6241D9", borderColor: "#AB8DFF" },
  toolCall: { backgroundColor: "#282052", borderColor: "#51479A" },
  toolCamera: { backgroundColor: "#372B15", borderColor: "#8B6B2E" },
  toolChat: { backgroundColor: "#0759D6", borderColor: "#4C9AFF" },
  toolMembers: { backgroundColor: "#202A41", borderColor: "#45536E" },
  toolSync: { backgroundColor: "#282052", borderColor: "#5A4BA5" },
  toolTalk: { backgroundColor: "#073F3A", borderColor: "#167A70" },
  toolsRow: { alignItems: "center", backgroundColor: "#0E1728", borderColor: "#2D405F", borderRadius: 18, borderWidth: 1, flexDirection: "row-reverse", gap: 5, padding: 5 },
});
