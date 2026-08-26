import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useCallback, useEffect, useState, type ComponentType } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

type WatchPartyScreen = ComponentType;

const palette = {
  background: "#090D1C",
  surface: "#121A32",
  surfaceSoft: "#182347",
  primary: "#7D5CFF",
  cyan: "#48D6FF",
  mint: "#39D99A",
  text: "#F7F8FF",
  muted: "#A6B0D0",
};

export function SafeLaunchScreen() {
  const [WatchParty, setWatchParty] = useState<WatchPartyScreen | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const roomPreviewEnabled = Platform.OS === "web" && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("room-preview") === "1";

  const openExperience = useCallback(() => {
    setLoading(true);
    setLoadError(false);

    requestAnimationFrame(() => {
      try {
        const loaded = require("./watch-party-app") as { WatchPartyApp: WatchPartyScreen };
        setWatchParty(() => loaded.WatchPartyApp);
      } catch (error) {
        console.error("Unable to load watch party experience", error);
        setLoadError(true);
        setLoading(false);
      }
    });
  }, []);

  useEffect(() => {
    if (roomPreviewEnabled) openExperience();
  }, [openExperience, roomPreviewEnabled]);

  if (WatchParty) return <WatchParty />;

  return (
    <View style={styles.page}>
      <View style={styles.glowOne} />
      <View style={styles.glowTwo} />
      <View style={styles.content}>
        <View style={styles.brandRow}>
          <View style={styles.brandMark}>
            <MaterialIcons color="#FFFFFF" name="play-arrow" size={25} />
          </View>
          <Text style={styles.brand}>AH4</Text>
        </View>

        <View style={styles.hero}>
          <View style={styles.status}>
            <View style={styles.statusDot} />
            <Text style={styles.statusText}>جاهز للمشاهدة الجماعية</Text>
          </View>
          <Text style={styles.title}>شاهدوا معًا،{`\n`}في اللحظة نفسها.</Text>
          <Text style={styles.subtitle}>غرف خاصة، مصادر HLS وM3U، ودردشة منظمة ضمن تجربة عربية واضحة.</Text>
        </View>

        <View style={styles.featureCard}>
          <Feature icon="lock-outline" text="غرف خاصة باسم وكلمة مرور" tint={palette.primary} />
          <Feature icon="sync" text="تزامن المشاهدة بين أعضاء الغرفة" tint={palette.cyan} />
          <Feature icon="chat-bubble-outline" text="دردشة حيّة وأدوات تواصل اختيارية" tint={palette.mint} />
        </View>

        {loadError ? (
          <View style={styles.errorCard}>
            <MaterialIcons color="#FF8E9A" name="error-outline" size={22} />
            <Text style={styles.errorText}>تعذر فتح ميزات الغرفة. يمكنك إعادة المحاولة الآن.</Text>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="دخول تطبيق غرف المشاهدة"
          disabled={loading}
          onPress={openExperience}
          style={({ pressed }) => [styles.startButton, (pressed || loading) && styles.startButtonPressed]}
        >
          <Text style={styles.startText}>{loading ? "يجري تجهيز التجربة…" : "ابدأ المشاهدة"}</Text>
          <MaterialIcons color="#FFFFFF" name="arrow-back" size={21} />
        </Pressable>

        <Text style={styles.footnote}>لن نطلب الكاميرا أو الميكروفون إلا عند اختيارك لميزة تحتاجهما.</Text>
      </View>
    </View>
  );
}

function Feature({ icon, text, tint }: { icon: React.ComponentProps<typeof MaterialIcons>["name"]; text: string; tint: string }) {
  return (
    <View style={styles.featureRow}>
      <View style={[styles.featureIcon, { backgroundColor: `${tint}22` }]}>
        <MaterialIcons color={tint} name={icon} size={21} />
      </View>
      <Text style={styles.featureText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  brand: { color: palette.text, fontSize: 21, fontWeight: "900", letterSpacing: 1.3 },
  brandMark: { alignItems: "center", backgroundColor: palette.primary, borderRadius: 15, height: 44, justifyContent: "center", width: 44 },
  brandRow: { alignItems: "center", flexDirection: "row-reverse", gap: 10 },
  content: { flex: 1, justifyContent: "space-between", paddingBottom: 34, paddingHorizontal: 24, paddingTop: 58 },
  errorCard: { alignItems: "center", backgroundColor: "#351F2B", borderColor: "#5D3442", borderRadius: 16, borderWidth: 1, flexDirection: "row-reverse", gap: 10, padding: 13 },
  errorText: { color: "#FFD4D9", flex: 1, fontSize: 13, lineHeight: 19, textAlign: "right" },
  featureCard: { backgroundColor: palette.surface, borderColor: "#293759", borderRadius: 24, borderWidth: 1, gap: 17, padding: 20 },
  featureIcon: { alignItems: "center", borderRadius: 12, height: 40, justifyContent: "center", width: 40 },
  featureRow: { alignItems: "center", flexDirection: "row-reverse", gap: 13 },
  featureText: { color: palette.text, flex: 1, fontSize: 14, fontWeight: "700", textAlign: "right" },
  footnote: { color: palette.muted, fontSize: 12, lineHeight: 18, textAlign: "center" },
  glowOne: { backgroundColor: "#372B8E", borderRadius: 220, height: 340, opacity: 0.22, position: "absolute", right: -125, top: -80, width: 340 },
  glowTwo: { backgroundColor: "#0A6077", borderRadius: 190, bottom: 130, height: 260, left: -145, opacity: 0.16, position: "absolute", width: 260 },
  hero: { gap: 15 },
  page: { backgroundColor: palette.background, flex: 1 },
  startButton: { alignItems: "center", backgroundColor: palette.primary, borderRadius: 18, flexDirection: "row-reverse", gap: 10, justifyContent: "center", minHeight: 60, paddingHorizontal: 20 },
  startButtonPressed: { opacity: 0.82, transform: [{ scale: 0.985 }] },
  startText: { color: "#FFFFFF", fontSize: 17, fontWeight: "900" },
  status: { alignItems: "center", alignSelf: "flex-end", backgroundColor: "#183D3C", borderRadius: 99, flexDirection: "row-reverse", gap: 7, paddingHorizontal: 12, paddingVertical: 8 },
  statusDot: { backgroundColor: palette.mint, borderRadius: 5, height: 8, width: 8 },
  statusText: { color: "#A8F6D6", fontSize: 12, fontWeight: "800" },
  subtitle: { color: palette.muted, fontSize: 16, lineHeight: 26, textAlign: "right" },
  title: { color: palette.text, fontSize: 39, fontWeight: "900", letterSpacing: -0.8, lineHeight: 49, textAlign: "right" },
});
