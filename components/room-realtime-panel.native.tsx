import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

export type RealtimeRoomCredentials = {
  code: string;
  serverUrl: string;
  token: string;
};

type NativePanel = (props: { credentials: RealtimeRoomCredentials }) => React.JSX.Element;

export function RoomRealtimePanel({ credentials }: { credentials: RealtimeRoomCredentials }) {
  const [Panel, setPanel] = useState<NativePanel | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    try {
      const { initializeLiveKit } = require("@/lib/livekit-setup");
      initializeLiveKit();
      const implementation = require("./room-realtime-panel.native-impl") as { RoomRealtimePanel: NativePanel };
      setPanel(() => implementation.RoomRealtimePanel);
    } catch (caught) {
      console.error("LiveKit initialization failed", caught);
      setError(true);
    }
  }, []);

  if (Panel) return <Panel credentials={credentials} />;

  return (
    <View style={styles.panel}>
      <MaterialIcons color={error ? "#FF7484" : "#40C9FF"} name={error ? "error-outline" : "sync"} size={22} />
      <View style={styles.copy}>
        <Text style={styles.title}>{error ? "تعذر تحميل الاتصال الفوري" : "يجري تجهيز اتصال الغرفة"}</Text>
        <Text style={styles.body}>{error ? "المشاهدة تظل متاحة. أعد فتح الغرفة لتجربة الصوت والكاميرا لاحقًا." : "تستمر واجهة الغرفة بالعمل أثناء تجهيز الدردشة والصوت."}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { color: "#99A5C7", fontSize: 12, lineHeight: 18, textAlign: "right" },
  copy: { flex: 1 },
  panel: { alignItems: "flex-start", backgroundColor: "#0F172B", borderColor: "#263455", borderRadius: 20, borderWidth: 1, flexDirection: "row-reverse", gap: 11, marginHorizontal: 18, padding: 14 },
  title: { color: "#F5F7FF", fontSize: 15, fontWeight: "900", marginBottom: 3, textAlign: "right" },
});
