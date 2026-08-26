import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

export type RealtimeRoomCredentials = {
  code: string;
  serverUrl: string;
  token: string;
};

export function RoomRealtimePanel({ credentials }: { credentials: RealtimeRoomCredentials }) {
  return (
    <View style={styles.panel}>
      <View style={styles.head}>
        <View style={styles.liveDot} />
        <Text style={styles.title}>أدوات الغرفة</Text>
      </View>
      <Text style={styles.body}>المشاهدة والدردشة النصية متاحتان في هذه النسخة الخفيفة. يُفعّل الاتصال والهوكي توكي والكاميرا في حزمة التواصل المتقدمة بعد التحقق من الاستقرار.</Text>
      <View style={styles.actions}>
        <Tool icon="chat-bubble-outline" label="الدردشة" onPress={() => Alert.alert("دردشة الغرفة", "ستظهر رسائل الغرفة هنا في التحديث التالي من النسخة الخفيفة.")} />
        <Tool icon="mic-none" label="هوكي توكي" onPress={() => Alert.alert("هوكي توكي", "تم تعليق الصوت المباشر مؤقتًا لتقديم نسخة مستقرة وخفيفة.")} />
        <Tool icon="videocam" label="كاميرا" onPress={() => Alert.alert("كاميرا الغرفة", "تم تعليق مشاركة الكاميرا مؤقتًا لتقديم نسخة مستقرة وخفيفة.")} />
      </View>
      <Text style={styles.code}>رمز الغرفة: {credentials.code}</Text>
    </View>
  );
}

function Tool({ icon, label, onPress }: { icon: React.ComponentProps<typeof MaterialIcons>["name"]; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.tool, pressed && styles.toolPressed]}>
      <MaterialIcons color="#B9C4EB" name={icon} size={20} />
      <Text style={styles.toolLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row-reverse", gap: 9, marginTop: 14 },
  body: { color: "#99A5C7", fontSize: 12, lineHeight: 19, textAlign: "right" },
  code: { color: "#6D7AA5", fontSize: 11, marginTop: 13, textAlign: "right" },
  head: { alignItems: "center", flexDirection: "row-reverse", gap: 8 },
  liveDot: { backgroundColor: "#35D39E", borderRadius: 5, height: 8, width: 8 },
  panel: { backgroundColor: "#0F172B", borderColor: "#263455", borderRadius: 20, borderWidth: 1, marginHorizontal: 18, padding: 15 },
  title: { color: "#F5F7FF", fontSize: 15, fontWeight: "900", textAlign: "right" },
  tool: { alignItems: "center", backgroundColor: "#182343", borderColor: "#2A3962", borderRadius: 14, borderWidth: 1, flex: 1, gap: 5, paddingVertical: 10 },
  toolLabel: { color: "#DCE3FF", fontSize: 11, fontWeight: "800" },
  toolPressed: { opacity: 0.72 },
});
