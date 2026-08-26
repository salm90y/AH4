import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Pressable, StyleSheet, Text, View } from "react-native";

export type RealtimeRoomCredentials = {
  code: string;
  serverUrl: string;
  token: string;
};

export function RoomRealtimePanel({ credentials }: { credentials: RealtimeRoomCredentials }) {
  return (
    <View style={styles.panel}>
      <View style={styles.iconWrap}>
        <MaterialIcons color="#40C9FF" name="phonelink" size={22} />
      </View>
      <View style={styles.copy}>
        <Text style={styles.title}>تواصل الغرفة</Text>
        <Text style={styles.body}>الصوت والهوكي توكي والكاميرا تعمل في نسخة Android الأصلية. افتح التطبيق على جهاز Android لاستخدامها.</Text>
      </View>
      <Pressable onPress={() => undefined} style={styles.badge}>
        <Text style={styles.badgeText}>غرفة {credentials.code}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { backgroundColor: "#1B2746", borderRadius: 10, marginTop: 10, paddingHorizontal: 10, paddingVertical: 6 },
  badgeText: { color: "#99A5C7", fontSize: 11, fontWeight: "700" },
  body: { color: "#99A5C7", fontSize: 13, lineHeight: 19, textAlign: "right" },
  copy: { flex: 1 },
  iconWrap: { alignItems: "center", backgroundColor: "#14213B", borderRadius: 14, height: 46, justifyContent: "center", width: 46 },
  panel: { alignItems: "flex-start", backgroundColor: "#0F172B", borderColor: "#263455", borderRadius: 20, borderWidth: 1, flexDirection: "row-reverse", gap: 11, marginHorizontal: 18, padding: 14 },
  title: { color: "#F5F7FF", fontSize: 16, fontWeight: "900", marginBottom: 4, textAlign: "right" },
});
