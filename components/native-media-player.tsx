import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { publishRoomSync, subscribeRoomSync } from "@/lib/room-sync";
import { useEvent } from "expo";
import { VideoSource, VideoView, useVideoPlayer } from "expo-video";
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

const colors = {
  background: "#0B1020",
  border: "#263455",
  cyan: "#40C9FF",
  muted: "#99A5C7",
  primary: "#7C5CFC",
  surface: "#141C33",
  text: "#F5F7FF",
};

function formatTime(value: number) {
  if (!Number.isFinite(value)) return "0:00";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function NativeMediaPlayer({ sourceUrl, canControl }: { sourceUrl: string | null; canControl: boolean }) {
  const viewRef = useRef<VideoView>(null);
  const [volume, setVolume] = useState(0.8);
  const [readySource, setReadySource] = useState<VideoSource | null>(null);
  const player = useVideoPlayer(null, (instance) => {
    instance.timeUpdateEventInterval = 1;
    instance.volume = volume;
  });
  const { isPlaying } = useEvent(player, "playingChange", { isPlaying: player.playing });
  const { status, error } = useEvent(player, "statusChange", { status: player.status, error: undefined });
  const timeUpdate = useEvent(player, "timeUpdate", {
    currentTime: 0,
    bufferedPosition: 0,
    currentLiveTimestamp: null,
    currentOffsetFromLive: null,
  });

  useEffect(() => {
    const configureSource = async () => {
      if (!sourceUrl) {
        player.pause();
        setReadySource(null);
        return;
      }

      const normalized: VideoSource = {
        uri: sourceUrl,
        contentType: sourceUrl.toLowerCase().includes(".m3u8") ? "hls" : "auto",
      };
      setReadySource(normalized);
      await player.replaceAsync(normalized);
      player.currentTime = 0;
    };

    configureSource().catch(() => {
      Alert.alert("تعذر تحميل المصدر", "تحقق من أن الرابط متاح ويدعم التشغيل على جهاز Android.");
    });
  }, [player, sourceUrl]);

  useEffect(() => {
    player.volume = volume;
  }, [player, volume]);

  useEffect(() => {
    return subscribeRoomSync((event) => {
      if (event.type !== "playback" || !readySource) return;
      const drift = Math.abs(player.currentTime - event.position);
      if (drift > 1.5) player.currentTime = event.position;
      if (event.playing && !player.playing) player.play();
      if (!event.playing && player.playing) player.pause();
    });
  }, [player, readySource]);

  useEffect(() => {
    if (!readySource || !isPlaying) return;
    const interval = setInterval(() => {
      void publishRoomSync({ type: "playback", playing: true, position: player.currentTime, sentAt: Date.now() });
    }, 5000);
    return () => clearInterval(interval);
  }, [isPlaying, player, readySource]);

  const syncPlayback = (playing: boolean, nextPosition = player.currentTime) => {
    void publishRoomSync({ type: "playback", playing, position: nextPosition, sentAt: Date.now() });
  };

  const seekBy = (seconds: number) => {
    const nextPosition = Math.max(0, Math.min(duration || Number.MAX_SAFE_INTEGER, player.currentTime + seconds));
    player.seekBy(seconds);
    syncPlayback(player.playing, nextPosition);
  };

  const togglePlayback = () => {
    if (isPlaying) {
      player.pause();
      syncPlayback(false);
    } else {
      player.play();
      syncPlayback(true);
    }
  };

  const duration = player.duration > 0 ? player.duration : 0;
  const position = timeUpdate?.currentTime ?? 0;
  const progress = duration > 0 ? Math.max(0, Math.min(1, position / duration)) : 0;

  if (!readySource) {
    return (
      <View style={styles.emptyFrame}>
        <View style={styles.emptyOrb}>
          <MaterialIcons color="#FFFFFF" name="play-arrow" size={38} />
        </View>
        <Text style={styles.emptyTitle}>اختر مصدر المشاهدة</Text>
        <Text style={styles.emptyText}>ألصق رابط M3U8 أو استورد ملف M3U لعرض القنوات داخل المشغّل الأصلي.</Text>
      </View>
    );
  }

  return (
    <View>
      <View style={styles.videoFrame}>
        <VideoView
          allowsFullscreen
          contentFit="contain"
          nativeControls={false}
          player={player}
          ref={viewRef}
          style={styles.video}
        />
        {status === "loading" ? (
          <View style={styles.loadingOverlay}>
            <Text style={styles.loadingText}>جارٍ تحميل المصدر…</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.progressLabels}>
        <Text style={styles.progressText}>{formatTime(position)}</Text>
        <Text style={styles.progressText}>{duration > 0 ? formatTime(duration) : "بث مباشر أو مدة غير معروفة"}</Text>
      </View>
      <Pressable
        accessibilityRole="adjustable"
        onPress={() => {
          if (duration > 0) {
            const nextPosition = Math.min(duration, position + 15);
            player.currentTime = nextPosition;
            syncPlayback(player.playing, nextPosition);
          }
        }}
        style={styles.progressTrack}
      >
        <View style={[styles.progressFill, { width: `${Math.max(3, progress * 100)}%` }]} />
      </Pressable>

      <View style={styles.controls}>
        <Control disabled={!canControl} icon="replay-10" label="-10" onPress={() => seekBy(-10)} />
        <Control disabled={!canControl} icon={isPlaying ? "pause" : "play-arrow"} label={isPlaying ? "إيقاف" : "تشغيل"} onPress={togglePlayback} primary />
        <Control disabled={!canControl} icon="forward-10" label="+10" onPress={() => seekBy(10)} />
        <Control icon={volume === 0 ? "volume-off" : "volume-up"} label={`${Math.round(volume * 100)}%`} onPress={() => setVolume((value) => (value === 0 ? 0.8 : 0))} />
        <Control icon="fullscreen" label="تكبير" onPress={() => viewRef.current?.enterFullscreen().catch(() => undefined)} />
      </View>

      {error ? <Text style={styles.errorText}>تعذر تشغيل المصدر. قد يكون الرابط محميًا أو غير مدعوم.</Text> : null}
    </View>
  );
}

function Control({
  icon,
  label,
  onPress,
  primary = false,
  disabled = false,
}: {
  icon: React.ComponentProps<typeof MaterialIcons>["name"];
  label: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.control, primary && styles.primaryControl, disabled && styles.controlDisabled, pressed && styles.pressed]}>
      <MaterialIcons color={primary ? "#FFFFFF" : colors.text} name={icon} size={24} />
      <Text style={[styles.controlLabel, primary && styles.primaryControlLabel]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  control: { alignItems: "center", flex: 1, gap: 4, justifyContent: "center", minHeight: 52 },
  controlDisabled: { opacity: 0.45 },
  controlLabel: { color: colors.muted, fontSize: 10, fontWeight: "800" },
  controls: { flexDirection: "row-reverse", gap: 7, justifyContent: "space-between", paddingHorizontal: 3, paddingTop: 10 },
  emptyFrame: { alignItems: "center", aspectRatio: 16 / 9, backgroundColor: "#080D1A", borderColor: "#202D4B", borderRadius: 19, borderWidth: 1, justifyContent: "center", paddingHorizontal: 30 },
  emptyOrb: { alignItems: "center", backgroundColor: colors.primary, borderRadius: 30, height: 60, justifyContent: "center", width: 60 },
  emptyText: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 8, textAlign: "center" },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: "900", marginTop: 10 },
  errorText: { color: "#FFB86B", fontSize: 12, lineHeight: 18, marginTop: 6, textAlign: "right" },
  loadingOverlay: { alignItems: "center", backgroundColor: "rgba(11,16,32,0.72)", bottom: 0, justifyContent: "center", left: 0, position: "absolute", right: 0, top: 0 },
  loadingText: { color: colors.text, fontSize: 13, fontWeight: "700" },
  pressed: { opacity: 0.8, transform: [{ scale: 0.97 }] },
  primaryControl: { backgroundColor: colors.primary, borderRadius: 16 },
  primaryControlLabel: { color: "#FFFFFF" },
  progressFill: { backgroundColor: colors.cyan, borderRadius: 4, height: 5 },
  progressLabels: { flexDirection: "row-reverse", justifyContent: "space-between", marginBottom: 7, marginTop: 12 },
  progressText: { color: colors.muted, fontSize: 11 },
  progressTrack: { backgroundColor: colors.border, borderRadius: 5, height: 5, justifyContent: "center" },
  video: { height: "100%", width: "100%" },
  videoFrame: { aspectRatio: 16 / 9, backgroundColor: "#080D1A", borderColor: "#202D4B", borderRadius: 19, borderWidth: 1, overflow: "hidden" },
});
