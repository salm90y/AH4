import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { NativeMediaPlayer } from "@/components/native-media-player";
import { RoomRealtimePanel, type RealtimeRoomCredentials } from "@/components/room-realtime-panel";
import { ScreenContainer } from "@/components/screen-container";
import { File } from "expo-file-system/next";
import { useKeepAwake } from "expo-keep-awake";
import { LinearGradient } from "expo-linear-gradient";
import * as DocumentPicker from "expo-document-picker";
import * as WebBrowser from "expo-web-browser";
import { getGuestParticipantId } from "@/lib/guest-identity";
import { parseM3uPlaylist, type M3uEntry } from "@/lib/m3u";
import { createCloudRoom, joinCloudRoom } from "@/lib/room-api";
import { publishRoomSync, subscribeRoomSync } from "@/lib/room-sync";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

type Screen = "home" | "create" | "join" | "media" | "room";
type SourceType = "youtube" | "hls" | "m3u";

type RoomState = {
  code: string;
  name: string;
  host: boolean;
  passwordProtected: boolean;
  sourceLabel: string;
  sourceType: SourceType | null;
  sourceUrl: string | null;
  credentials: RealtimeRoomCredentials;
};

const colors = {
  background: "#070B16",
  surface: "#121B35",
  surfaceElevated: "#19264A",
  primary: "#8B5CF6",
  cyan: "#32D7E7",
  success: "#49D59E",
  text: "#F7F8FF",
  muted: "#A7B4D4",
  border: "#2A3A60",
  warning: "#FFB36B",
  coral: "#FF7B78",
};

function IconButton({
  icon,
  label,
  onPress,
  active = false,
}: {
  icon: React.ComponentProps<typeof MaterialIcons>["name"];
  label: string;
  onPress: () => void;
  active?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.iconControl, active && styles.iconControlActive, pressed && styles.pressed]}
    >
      <MaterialIcons color={active ? colors.background : colors.text} name={icon} size={24} />
      <Text style={[styles.iconControlLabel, active && styles.iconControlLabelActive]}>{label}</Text>
    </Pressable>
  );
}

function PrimaryButton({
  label,
  onPress,
  icon,
  secondary = false,
}: {
  label: string;
  onPress: () => void;
  icon?: React.ComponentProps<typeof MaterialIcons>["name"];
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.primaryButton, secondary && styles.secondaryButton, pressed && styles.pressed]}
    >
      {secondary ? (
        <>
          {icon ? <MaterialIcons color={colors.text} name={icon} size={20} /> : null}
          <Text style={[styles.primaryButtonText, styles.secondaryButtonText]}>{label}</Text>
        </>
      ) : (
        <LinearGradient colors={["#9D72FF", "#6E51DC", "#3D2A91"]} end={{ x: 1, y: 1 }} start={{ x: 0, y: 0 }} style={styles.primaryGradient}>
          {icon ? <MaterialIcons color="#FFFFFF" name={icon} size={20} /> : null}
          <Text style={styles.primaryButtonText}>{label}</Text>
        </LinearGradient>
      )}
    </Pressable>
  );
}

function Feature({ icon, label }: { icon: React.ComponentProps<typeof MaterialIcons>["name"]; label: string }) {
  return (
    <View style={styles.featureItem}>
      <View style={styles.featureIcon}>
        <MaterialIcons color={colors.cyan} name={icon} size={16} />
      </View>
      <Text style={styles.featureLabel}>{label}</Text>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry = false,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  secureTextEntry?: boolean;
  keyboardType?: "default" | "url";
}) {
  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={keyboardType}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        secureTextEntry={secureTextEntry}
        style={styles.fieldInput}
        textAlign="right"
        value={value}
      />
    </View>
  );
}

export function WatchPartyApp() {
  const roomPreviewEnabled = Platform.OS === "web" && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("room-preview") === "1";
  const [screen, setScreen] = useState<Screen>(() => (roomPreviewEnabled ? "room" : "home"));
  const [createName, setCreateName] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [joinName, setJoinName] = useState("");
  const [joinPassword, setJoinPassword] = useState("");
  const [sourceType, setSourceType] = useState<SourceType>("hls");
  const [sourceUrl, setSourceUrl] = useState("");
  const [youtubeQuery, setYoutubeQuery] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [roomSearchInput, setRoomSearchInput] = useState("");
  const [searchHint, setSearchHint] = useState("");
  const [room, setRoom] = useState<RoomState | null>(() => roomPreviewEnabled ? {
    code: "AH4-RIOVJ8",
    name: "مراجعة التصميم",
    host: true,
    passwordProtected: true,
    sourceLabel: "لم يتم اختيار مصدر بعد",
    sourceType: null,
    sourceUrl: null,
    credentials: { code: "AH4-RIOVJ8", serverUrl: "", token: "" },
  } : null);
  const [channels, setChannels] = useState<M3uEntry[]>([]);
  const [channelQuery, setChannelQuery] = useState("");
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [joiningRoom, setJoiningRoom] = useState(false);

  useKeepAwake(screen === "room" ? "ah4-watch-party-room" : undefined);

  useEffect(() => {
    return subscribeRoomSync((event) => {
      if (event.type !== "source") return;
      setRoom((current) =>
        current
          ? {
              ...current,
              sourceLabel: event.sourceLabel,
              sourceType: event.sourceType,
              sourceUrl: event.sourceUrl,
            }
          : current,
      );
    });
  }, []);

  const roomCode = useMemo(() => room?.code ?? "", [room?.code]);

  const createRoom = async (name: string, password: string) => {
    const safeName = name.trim();
    if (!safeName) {
      Alert.alert("أدخل اسم الغرفة", "أدخل اسمًا قصيرًا لتسهيل مشاركته مع الأصدقاء.");
      return;
    }
    try {
      setCreatingRoom(true);
      const participantId = await getGuestParticipantId();
      const created = await createCloudRoom({
        name: safeName,
        password: password.trim(),
        participantId,
        displayName: "المضيف",
      });
      setRoom({
        code: created.code,
        name: created.name,
        host: created.host,
        passwordProtected: created.passwordProtected,
        sourceLabel: "لم يتم اختيار مصدر بعد",
        sourceType: null,
        sourceUrl: null,
        credentials: { code: created.code, serverUrl: created.serverUrl, token: created.token },
      });
      setScreen("room");
    } catch (error) {
      Alert.alert("تعذر إنشاء الغرفة", error instanceof Error ? error.message : "حاول مرة أخرى بعد التحقق من الاتصال.");
    } finally {
      setCreatingRoom(false);
    }
  };

  const joinRoom = async (code: string, password: string) => {
    const normalizedCode = code.trim().toUpperCase();
    if (!/^AH4-[A-F0-9]{8}$/.test(normalizedCode)) {
      Alert.alert("رمز غير صالح", "أدخل رمز الغرفة بالشكل AH4-1A2B3C4D.");
      return;
    }
    try {
      setJoiningRoom(true);
      const participantId = await getGuestParticipantId();
      const joined = await joinCloudRoom({
        code: normalizedCode,
        password: password.trim(),
        participantId,
        displayName: "ضيف",
      });
      setRoom({
        code: joined.code,
        name: joined.name,
        host: joined.host,
        passwordProtected: joined.passwordProtected,
        sourceLabel: "بانتظار المصدر من المضيف",
        sourceType: null,
        sourceUrl: null,
        credentials: { code: joined.code, serverUrl: joined.serverUrl, token: joined.token },
      });
      setScreen("room");
    } catch (error) {
      Alert.alert("تعذر الانضمام", error instanceof Error ? error.message : "تحقق من الرمز وكلمة المرور ثم أعد المحاولة.");
    } finally {
      setJoiningRoom(false);
    }
  };

  const applySource = () => {
    if (sourceType === "youtube") {
      if (/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(youtubeUrl.trim())) {
        void WebBrowser.openBrowserAsync(youtubeUrl.trim(), { toolbarColor: "#0B1020", controlsColor: "#7C5CFC" });
        setSearchHint("فُتح الرابط عبر YouTube الرسمي. لا يمكن مزامنة تحكم تطبيق YouTube الخارجي مع الغرفة.");
        return;
      }
      if (!youtubeQuery.trim()) {
        setSearchHint("ألصق رابط YouTube رسميًا أو اكتب عبارة بحث بعد تفعيل مفتاح Data API.");
        return;
      }
      setSearchHint("سيعرض البحث حتى 20 نتيجة عند تفعيل YouTube Data API في الخادم. لا نستخرج روابط الفيديو أو نعيد بثه.");
      return;
    }

    if (sourceType === "m3u") {
      void importM3u();
      return;
    }

    if (!/^https?:\/\//i.test(sourceUrl.trim())) {
      Alert.alert("رابط غير صالح", "أدخل رابط M3U8 يبدأ بـ http:// أو https://.");
      return;
    }

    const nextSource = { sourceLabel: sourceUrl.trim(), sourceType: "hls" as const, sourceUrl: sourceUrl.trim() };
    setRoom((current) => (current ? { ...current, ...nextSource } : current));
    void publishRoomSync({ type: "source", ...nextSource, sentAt: Date.now() });
    setScreen("room");
  };

  const importM3u = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["audio/x-mpegurl", "application/x-mpegURL", "text/plain", "*/*"],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;

      const asset = result.assets[0];
      if (!asset) return;
      if (!/\.m3u8?$/i.test(asset.name)) {
        Alert.alert("ملف غير متوافق", "اختر ملفًا بامتداد .m3u أو .m3u8.");
        return;
      }

      const parsed = parseM3uPlaylist(await new File(asset.uri).text());
      if (parsed.length === 0) {
        Alert.alert("لم نجد قنوات", "تأكد من أن الملف يتضمن أسطر #EXTINF وروابط HTTP أو HTTPS صالحة.");
        return;
      }

      setChannels(parsed);
      setChannelQuery("");
    } catch {
      Alert.alert("تعذر قراءة الملف", "حاول اختيار الملف مرة أخرى أو تأكد من صلاحية الوصول إليه.");
    }
  };

  const chooseChannel = (channel: M3uEntry) => {
    const nextSource = { sourceLabel: channel.name, sourceType: "m3u" as const, sourceUrl: channel.url };
    setRoom((current) => (current ? { ...current, ...nextSource } : current));
    void publishRoomSync({ type: "source", ...nextSource, sentAt: Date.now() });
    setScreen("room");
  };

  const returnHome = () => {
    setScreen("home");
    setRoom(null);
  };

  const openRoomSource = (nextType: SourceType) => {
    if (!room?.host) {
      Alert.alert("تحكم المضيف", "المضيف فقط يستطيع تغيير المصدر لضمان تزامن المشاهدة للجميع.");
      return;
    }
    setSourceType(nextType);
    setSearchHint("");
    setScreen("media");
  };

  const searchFromRoom = () => {
    const query = roomSearchInput.trim();
    if (!room?.host) {
      Alert.alert("تحكم المضيف", "المضيف فقط يستطيع تغيير المصدر أو البحث عن محتوى جديد.");
      return;
    }
    if (/^https?:\/\//i.test(query) && /\.m3u8?(?:$|[?#])/i.test(query)) {
      setSourceType("hls");
      setSourceUrl(query);
    } else if (/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(query)) {
      setSourceType("youtube");
      setYoutubeUrl(query);
    } else {
      setSourceType("youtube");
      setYoutubeQuery(query);
    }
    setSearchHint("");
    setScreen("media");
  };

  const filteredChannels = useMemo(() => {
    const query = channelQuery.trim().toLocaleLowerCase("ar");
    if (!query) return channels;
    return channels.filter((channel) => `${channel.name} ${channel.group}`.toLocaleLowerCase("ar").includes(query));
  }, [channelQuery, channels]);

  const header = (title: string, backTo: Screen) => (
    <View style={styles.screenHeader}>
      <Pressable accessibilityRole="button" onPress={() => setScreen(backTo)} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
        <MaterialIcons color={colors.text} name="arrow-forward" size={23} />
      </Pressable>
      <Text style={styles.screenTitle}>{title}</Text>
      <View style={styles.headerSpacer} />
    </View>
  );

  if (screen === "home") {
    return (
      <ScreenContainer className="" edges={["top", "left", "right", "bottom"]}>
        <View style={styles.homeShell}>
          <LinearGradient colors={["#181443", "#090F23", "#070B16"]} end={{ x: 0.25, y: 1 }} start={{ x: 0.82, y: 0 }} style={StyleSheet.absoluteFill} />
          <View style={styles.homeAuraOne} />
          <View style={styles.homeAuraTwo} />
          <ScrollView bounces={false} contentContainerStyle={styles.homeScroll} showsVerticalScrollIndicator={false}>
            <View style={styles.topBrandLine}>
              <View style={styles.brandRow}>
                <LinearGradient colors={["#B08BFF", "#6948D4"]} style={styles.brandMark}>
                  <MaterialIcons color="#FFFFFF" name="play-arrow" size={30} />
                </LinearGradient>
                <View>
                  <Text style={styles.brandName}>AH4</Text>
                  <Text style={styles.brandCaption}>WATCH TOGETHER</Text>
                </View>
              </View>
              <View style={styles.protectionMark}>
                <MaterialIcons color={colors.cyan} name="lock-outline" size={18} />
              </View>
            </View>

            <View style={styles.homeHeading}>
              <View style={styles.livePill}>
                <View style={styles.liveDot} />
                <Text style={styles.livePillText}>مساحة مشاهدة خاصة</Text>
              </View>
              <Text style={styles.heroTitle}>اجمع من تحب{`\n`}حول نفس اللحظة.</Text>
              <Text style={styles.heroBody}>غرفة خاصة، مزامنة دقيقة، وتواصل حي — في تجربة واحدة مصممة للهاتف.</Text>
            </View>

            <LinearGradient colors={["rgba(124,92,252,0.44)", "rgba(26,38,74,0.92)", "rgba(10,15,33,0.96)"]} end={{ x: 0.92, y: 1 }} start={{ x: 0.08, y: 0 }} style={styles.heroCard}>
              <View style={styles.heroGridLine} />
              <View style={styles.heroTopRow}>
                <View style={styles.heroPresence}>
                  <View style={styles.presenceAvatar}><Text style={styles.presenceAvatarText}>A</Text></View>
                  <View style={styles.presenceAvatarSecond}><Text style={styles.presenceAvatarText}>+3</Text></View>
                  <Text style={styles.heroPresenceText}>مكان للأصدقاء</Text>
                </View>
                <View style={styles.heroSyncChip}>
                  <MaterialIcons color={colors.cyan} name="sync" size={16} />
                  <Text style={styles.heroSyncText}>متزامن</Text>
                </View>
              </View>
              <View style={styles.heroPlayArea}>
                <LinearGradient colors={["#A477FF", "#6241D9"]} style={styles.heroPlay}>
                  <MaterialIcons color="#FFFFFF" name="play-arrow" size={42} />
                </LinearGradient>
                <Text style={styles.heroVisualText}>ابدأ جلستك التالية</Text>
                <Text style={styles.heroVisualSubtext}>M3U8 · M3U · روابط مشاركة</Text>
              </View>
            </LinearGradient>

            <View style={styles.featureRail}>
              <Feature icon="sync" label="مزامنة" />
              <Feature icon="lock-outline" label="خاصة" />
              <Feature icon="forum" label="تواصل" />
            </View>

            <View style={styles.actionStack}>
              <PrimaryButton icon="add-circle-outline" label="أنشئ غرفة جديدة" onPress={() => setScreen("create")} />
              <PrimaryButton icon="login" label="لدي رمز غرفة" onPress={() => setScreen("join")} secondary />
            </View>

            <View style={styles.infoRow}>
              <MaterialIcons color={colors.cyan} name="verified-user" size={18} />
              <Text style={styles.infoText}>كلمات مرور الغرف محمية ولا تظهر للأعضاء الآخرين.</Text>
            </View>
          </ScrollView>
        </View>
      </ScreenContainer>
    );
  }

  if (screen === "create") {
    return (
      <ScreenContainer className="" edges={["top", "left", "right", "bottom"]}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.formScreen}>
          {header("إنشاء غرفة", "home")}
          <View style={styles.formIntro}>
            <Text style={styles.formTitle}>ابدأ الجلسة</Text>
            <Text style={styles.formSubtitle}>أنت ستكون المضيف ويمكنك تغيير المصدر والتحكم بالتشغيل.</Text>
          </View>
          <Field label="اسم الغرفة" onChangeText={setCreateName} placeholder="مثال: سهرة الجمعة" value={createName} />
          <Field label="كلمة المرور (اختيارية)" onChangeText={setCreatePassword} placeholder="اجعل الغرفة خاصة" secureTextEntry value={createPassword} />
          <View style={styles.noteCard}>
            <MaterialIcons color={colors.warning} name="lock-outline" size={21} />
            <Text style={styles.noteText}>يمكنك إضافة مصدر المشاهدة الآن أو من داخل الغرفة لاحقًا.</Text>
          </View>
          <View style={styles.grow} />
          <PrimaryButton icon="arrow-back" label={creatingRoom ? "جارٍ إنشاء الغرفة…" : "إنشاء وفتح الغرفة"} onPress={() => void createRoom(createName, createPassword)} />
        </KeyboardAvoidingView>
      </ScreenContainer>
    );
  }

  if (screen === "join") {
    return (
      <ScreenContainer className="" edges={["top", "left", "right", "bottom"]}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.formScreen}>
          {header("الانضمام إلى غرفة", "home")}
          <View style={styles.formIntro}>
            <Text style={styles.formTitle}>ادخل إلى الجلسة</Text>
            <Text style={styles.formSubtitle}>اكتب رمز الغرفة الذي شاركه المضيف معك.</Text>
          </View>
          <Field label="رمز الغرفة" onChangeText={setJoinName} placeholder="AH4-1A2B3C4D" value={joinName} />
          <Field label="كلمة المرور" onChangeText={setJoinPassword} placeholder="إذا كانت الغرفة خاصة" secureTextEntry value={joinPassword} />
          <View style={styles.noteCard}>
            <MaterialIcons color={colors.cyan} name="sync" size={21} />
            <Text style={styles.noteText}>سيعيد التطبيق ضبط المشغل تلقائيًا عند دخول الغرفة لتقليل فرق الوقت.</Text>
          </View>
          <View style={styles.grow} />
          <PrimaryButton icon="group-add" label={joiningRoom ? "جارٍ الانضمام…" : "الانضمام الآن"} onPress={() => void joinRoom(joinName, joinPassword)} />
        </KeyboardAvoidingView>
      </ScreenContainer>
    );
  }

  if (screen === "media") {
    return (
      <ScreenContainer className="" edges={["top", "left", "right", "bottom"]}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.formScreen}>
          {header("مصدر المشاهدة", "room")}
          <Text style={styles.formTitle}>ماذا سنشاهد؟</Text>
          <Text style={styles.formSubtitle}>اختر مصدرًا مرخّصًا. يدعم المشغّل الأصلي روابط HLS وقوائم M3U.</Text>

          <View style={styles.sourceTabs}>
            {([
              ["hls", "رابط M3U8", "link"],
              ["m3u", "ملف M3U", "folder-open"],
              ["youtube", "YouTube", "youtube-searched-for"],
            ] as const).map(([type, label, icon]) => (
              <Pressable
                key={type}
                onPress={() => {
                  setSourceType(type);
                  setSearchHint("");
                }}
                style={({ pressed }) => [styles.sourceTab, sourceType === type && styles.sourceTabActive, pressed && styles.pressed]}
              >
                <MaterialIcons color={sourceType === type ? colors.background : colors.muted} name={icon} size={20} />
                <Text style={[styles.sourceTabText, sourceType === type && styles.sourceTabTextActive]}>{label}</Text>
              </Pressable>
            ))}
          </View>

          {sourceType === "hls" ? (
            <View style={styles.sourcePanel}>
              <Field label="رابط HLS / M3U8" keyboardType="url" onChangeText={setSourceUrl} placeholder="https://example.com/stream.m3u8" value={sourceUrl} />
              <Text style={styles.sourceHelp}>يُشغّل الرابط داخل مشغّل Android الأصلي، وتُنشر حالته فورًا لأعضاء الغرفة.</Text>
            </View>
          ) : null}

          {sourceType === "m3u" ? (
            <View style={styles.sourcePanel}>
              {channels.length === 0 ? (
                <View style={styles.fileDrop}>
                  <MaterialIcons color={colors.cyan} name="playlist-play" size={36} />
                  <Text style={styles.fileDropTitle}>استورد قائمة قنواتك</Text>
                  <Text style={styles.sourceHelp}>يفتح التطبيق منتقي ملفات Android، ثم يعرض القنوات والمجموعات للبحث والاختيار.</Text>
                </View>
              ) : (
                <>
                  <TextInput
                    onChangeText={setChannelQuery}
                    placeholder="ابحث في القنوات أو المجموعات"
                    placeholderTextColor={colors.muted}
                    style={styles.channelSearch}
                    textAlign="right"
                    value={channelQuery}
                  />
                  <FlatList
                    data={filteredChannels.slice(0, 20)}
                    keyExtractor={(item) => item.id}
                    ListEmptyComponent={<Text style={styles.noChannels}>لا توجد نتيجة مطابقة.</Text>}
                    renderItem={({ item }) => (
                      <Pressable onPress={() => chooseChannel(item)} style={({ pressed }) => [styles.channelRow, pressed && styles.pressed]}>
                        <View style={styles.channelIcon}>
                          <MaterialIcons color={colors.cyan} name="play-circle-outline" size={22} />
                        </View>
                        <View style={styles.channelCopy}>
                          <Text numberOfLines={1} style={styles.channelName}>{item.name}</Text>
                          <Text numberOfLines={1} style={styles.channelGroup}>{item.group}</Text>
                        </View>
                      </Pressable>
                    )}
                    style={styles.channelList}
                  />
                </>
              )}
            </View>
          ) : null}

          {sourceType === "youtube" ? (
            <View style={styles.sourcePanel}>
              <Field keyboardType="url" label="رابط فيديو YouTube المجاني" onChangeText={setYoutubeUrl} placeholder="https://youtu.be/..." value={youtubeUrl} />
              <Text style={styles.sourceHelp}>يفتح الرابط في واجهة YouTube الرسمية من دون مفتاح API. يُستخدم البحث الداخلي فقط عند توفير مفتاح YouTube Data API.</Text>
              <Field label="ابحث في YouTube" onChangeText={setYoutubeQuery} placeholder="اكتب عنوانًا أو اسم قناة" value={youtubeQuery} />
              <Text style={styles.sourceHelp}>ستظهر حتى 20 نتيجة مع زر «ابحث أكثر» عبر YouTube Data API الرسمي. التشغيل داخل الغرفة لا يستخرج روابط YouTube ولا يعيد بثها.</Text>
              {searchHint ? <Text style={styles.searchHint}>{searchHint}</Text> : null}
            </View>
          ) : null}

          <View style={styles.grow} />
          <PrimaryButton icon={sourceType === "youtube" ? "search" : "check-circle-outline"} label={sourceType === "youtube" ? "بحث" : sourceType === "m3u" ? "اختيار ملف" : "تأكيد المصدر"} onPress={applySource} />
        </KeyboardAvoidingView>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer className="" edges={["top", "left", "right", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.roomScreen}>
        <View style={styles.roomHeader}>
          <View style={styles.roomBrandMark}><Text style={styles.roomBrandText}>AH</Text></View>
          <View style={styles.roomUserChip}><Text numberOfLines={1} style={styles.roomUserText}>{room?.host ? "المضيف" : "ضيف"}</Text></View>
          <Pressable accessibilityLabel="عرض رمز واسم الغرفة" accessibilityRole="button" onPress={() => Alert.alert(room?.name ?? "الغرفة", room?.code ?? roomCode)} style={({ pressed }) => [styles.roomCodeChip, pressed && styles.pressed]}>
            <Text numberOfLines={1} style={styles.roomCodeText}>{(room?.code ?? roomCode).replace("AH4-", "#")}</Text>
          </Pressable>
          <View style={styles.roomHeaderIconGold}><MaterialIcons color="#FFD24A" name="workspace-premium" size={20} /></View>
          <View style={styles.roomHeaderIconShield}><MaterialIcons color="#9A8CFF" name="security" size={19} /></View>
          <View style={styles.roomMemberChip}><Text style={styles.roomMemberText}>1</Text><MaterialIcons color="#57E7B2" name="group" size={20} /></View>
          <Pressable accessibilityLabel="مغادرة الغرفة" accessibilityRole="button" onPress={returnHome} style={({ pressed }) => [styles.leaveButton, pressed && styles.pressed]}>
            <Text style={styles.leaveButtonText}>مغادرة</Text>
            <MaterialIcons color="#FFFFFF" name="logout" size={20} />
          </Pressable>
        </View>

        <View style={styles.roomSearchRow}>
          <Pressable accessibilityLabel="بحث عن مصدر" accessibilityRole="button" onPress={searchFromRoom} style={({ pressed }) => [styles.roomSearchButton, pressed && styles.pressed]}>
            <MaterialIcons color="#FFFFFF" name="search" size={27} />
          </Pressable>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setRoomSearchInput}
            onSubmitEditing={searchFromRoom}
            placeholder="ابحث في يوتيوب أو ضع رابط مباشر (TS)"
            placeholderTextColor="#9AA6C2"
            returnKeyType="search"
            style={styles.roomSearchInput}
            textAlign="right"
            value={roomSearchInput}
          />
          <Pressable accessibilityLabel="استيراد ملف M3U" accessibilityRole="button" onPress={() => openRoomSource("m3u")} style={({ pressed }) => [styles.roomSearchAction, styles.roomSearchUpload, pressed && styles.pressed]}>
            <MaterialIcons color="#FFFFFF" name="file-upload" size={25} />
          </Pressable>
          <Pressable accessibilityLabel="إضافة رابط M3U8" accessibilityRole="button" onPress={() => openRoomSource("hls")} style={({ pressed }) => [styles.roomSearchAction, styles.roomSearchLink, pressed && styles.pressed]}>
            <MaterialIcons color="#E9B3FF" name="language" size={25} />
          </Pressable>
          <Pressable accessibilityLabel="اختيار مصدر المشاهدة" accessibilityRole="button" onPress={() => openRoomSource("hls")} style={({ pressed }) => [styles.roomSearchAction, styles.roomSearchPlaylist, pressed && styles.pressed]}>
            <MaterialIcons color="#B6D7FF" name="playlist-play" size={26} />
          </Pressable>
        </View>

        <View style={styles.playerWrap}>
          <NativeMediaPlayer canControl={room?.host ?? false} sourceUrl={room?.sourceUrl ?? null} />
        </View>
        {room ? <RoomRealtimePanel credentials={room.credentials} /> : null}
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  actionStack: { gap: 11, marginTop: 24 },
  backButton: { alignItems: "center", backgroundColor: colors.surface, borderRadius: 14, height: 42, justifyContent: "center", width: 42 },
  brandCaption: { color: "#8795BD", fontSize: 9, fontWeight: "900", letterSpacing: 1.2, marginTop: 2, textAlign: "right" },
  brandMark: { alignItems: "center", borderRadius: 18, height: 52, justifyContent: "center", overflow: "hidden", width: 52 },
  brandName: { color: colors.text, fontSize: 22, fontWeight: "900", letterSpacing: 0.5, textAlign: "right" },
  brandRow: { alignItems: "center", flexDirection: "row-reverse", gap: 11 },
  chatArea: { flex: 1, minHeight: 170, paddingHorizontal: 18, paddingTop: 12 },
  channelCopy: { flex: 1 },
  channelGroup: { color: colors.muted, fontSize: 11, marginTop: 3, textAlign: "right" },
  channelIcon: { alignItems: "center", backgroundColor: "#172642", borderRadius: 12, height: 38, justifyContent: "center", width: 38 },
  channelList: { maxHeight: 245 },
  channelName: { color: colors.text, fontSize: 14, fontWeight: "800", textAlign: "right" },
  channelRow: { alignItems: "center", borderBottomColor: colors.border, borderBottomWidth: 1, flexDirection: "row-reverse", gap: 10, paddingVertical: 10 },
  channelSearch: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 13, borderWidth: 1, color: colors.text, fontSize: 14, height: 44, marginBottom: 10, paddingHorizontal: 12 },
  chatComposer: { alignItems: "center", flexDirection: "row", gap: 10, marginBottom: 6 },
  chatEmptyContent: { flexGrow: 1, justifyContent: "center" },
  chatEmptyText: { color: colors.muted, fontSize: 13, lineHeight: 19, paddingHorizontal: 12, textAlign: "center" },
  chatHeader: { alignItems: "center", flexDirection: "row-reverse", justifyContent: "space-between", marginBottom: 9 },
  chatInput: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 15, borderWidth: 1, color: colors.text, flex: 1, fontSize: 15, height: 46, paddingHorizontal: 14 },
  chatList: { flex: 1 },
  chatListContent: { gap: 8, paddingBottom: 8 },
  chatStatus: { color: colors.muted, fontSize: 12 },
  chatTitle: { color: colors.text, fontSize: 15, fontWeight: "800" },
  chatTitleRow: { alignItems: "center", flexDirection: "row-reverse", gap: 7 },
  controlRow: { flexDirection: "row-reverse", gap: 8, justifyContent: "space-between", paddingHorizontal: 18, paddingVertical: 14 },
  divider: { backgroundColor: colors.border, height: 24, width: 1 },
  fieldBlock: { marginBottom: 18 },
  fieldInput: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 16, borderWidth: 1, color: colors.text, fontSize: 16, height: 53, paddingHorizontal: 16 },
  fieldLabel: { color: colors.text, fontSize: 14, fontWeight: "700", marginBottom: 8, textAlign: "right" },
  featureIcon: { alignItems: "center", backgroundColor: "rgba(50,215,231,0.11)", borderRadius: 10, height: 28, justifyContent: "center", width: 28 },
  featureItem: { alignItems: "center", flexDirection: "row-reverse", gap: 7 },
  featureLabel: { color: "#B7C3E0", fontSize: 11, fontWeight: "800" },
  featureRail: { alignItems: "center", flexDirection: "row-reverse", justifyContent: "space-around", marginTop: 17, paddingHorizontal: 5 },
  fileDrop: { alignItems: "center", gap: 10, paddingVertical: 18 },
  fileDropTitle: { color: colors.text, fontSize: 16, fontWeight: "800" },
  formIntro: { marginBottom: 24, marginTop: 8 },
  formScreen: { flex: 1, paddingHorizontal: 22, paddingVertical: 14 },
  formSubtitle: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 7, textAlign: "right" },
  formTitle: { color: colors.text, fontSize: 26, fontWeight: "900", textAlign: "right" },
  grow: { flex: 1 },
  headerSpacer: { width: 42 },
  heroBody: { color: "#B7C4E4", fontSize: 15, lineHeight: 24, marginTop: 13, textAlign: "right" },
  heroCard: { borderColor: "rgba(171,150,255,0.38)", borderRadius: 30, borderWidth: 1, marginTop: 26, minHeight: 244, overflow: "hidden", padding: 18 },
  heroGridLine: { backgroundColor: "rgba(128,105,255,0.15)", borderRadius: 80, height: 200, position: "absolute", right: -56, top: -84, transform: [{ rotate: "-18deg" }], width: 220 },
  heroPlay: { alignItems: "center", borderRadius: 34, height: 68, justifyContent: "center", width: 68 },
  heroPlayArea: { alignItems: "center", flex: 1, justifyContent: "center", paddingTop: 15 },
  heroPresence: { alignItems: "center", flexDirection: "row-reverse", gap: 5 },
  heroPresenceText: { color: "#B4C2E3", fontSize: 11, fontWeight: "700", marginRight: 5 },
  heroSyncChip: { alignItems: "center", backgroundColor: "rgba(50,215,231,0.12)", borderColor: "rgba(50,215,231,0.26)", borderRadius: 99, borderWidth: 1, flexDirection: "row-reverse", gap: 5, paddingHorizontal: 9, paddingVertical: 6 },
  heroSyncText: { color: colors.cyan, fontSize: 11, fontWeight: "800" },
  heroTitle: { color: colors.text, fontSize: 33, fontWeight: "900", letterSpacing: -0.7, lineHeight: 42, marginTop: 13, textAlign: "right" },
  heroTopRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  heroVisualSubtext: { color: "#8392BA", fontSize: 11, fontWeight: "700", letterSpacing: 0.25, marginTop: 6 },
  heroVisualText: { color: colors.text, fontSize: 17, fontWeight: "900", marginTop: 13, textAlign: "center" },
  homeAuraOne: { backgroundColor: "rgba(133,93,255,0.20)", borderRadius: 999, height: 290, position: "absolute", right: -150, top: 22, width: 290 },
  homeAuraTwo: { backgroundColor: "rgba(50,215,231,0.10)", borderRadius: 999, bottom: 80, height: 230, left: -150, position: "absolute", width: 230 },
  homeHeading: { marginTop: 46 },
  homeScroll: { flexGrow: 1, paddingBottom: 34, paddingHorizontal: 22, paddingTop: 20 },
  homeShell: { flex: 1, overflow: "hidden" },
  iconControl: { alignItems: "center", flex: 1, gap: 5, minWidth: 48, paddingVertical: 7 },
  iconControlActive: { backgroundColor: colors.primary, borderRadius: 16 },
  iconControlLabel: { color: colors.muted, fontSize: 10, fontWeight: "700" },
  iconControlLabelActive: { color: colors.background },
  infoRow: { alignItems: "center", flexDirection: "row-reverse", gap: 8, justifyContent: "center", marginTop: 21, paddingHorizontal: 12 },
  infoText: { color: "#8F9DBC", flexShrink: 1, fontSize: 11, lineHeight: 17, textAlign: "right" },
  leaveButton: { alignItems: "center", backgroundColor: "#4A1024", borderColor: "#A82A50", borderRadius: 11, borderWidth: 1, flexDirection: "row-reverse", gap: 4, height: 39, justifyContent: "center", paddingHorizontal: 8 },
  leaveButtonText: { color: "#FFFFFF", fontSize: 11, fontWeight: "900" },
  liveDot: { backgroundColor: colors.success, borderRadius: 4, height: 8, width: 8 },
  livePill: { alignItems: "center", alignSelf: "flex-end", backgroundColor: "rgba(73,213,158,0.10)", borderColor: "rgba(73,213,158,0.22)", borderRadius: 999, borderWidth: 1, flexDirection: "row-reverse", gap: 7, paddingHorizontal: 11, paddingVertical: 7 },
  livePillText: { color: colors.success, fontSize: 11, fontWeight: "800" },
  messageAuthor: { color: colors.cyan, fontSize: 11, fontWeight: "800", textAlign: "right" },
  messageBody: { color: colors.text, fontSize: 14, lineHeight: 20, marginTop: 3, textAlign: "right" },
  messageBubble: { alignSelf: "flex-end", backgroundColor: colors.surface, borderRadius: 14, maxWidth: "82%", paddingHorizontal: 12, paddingVertical: 9 },
  noteCard: { alignItems: "flex-start", backgroundColor: "#1C2035", borderColor: "#38415F", borderRadius: 16, borderWidth: 1, flexDirection: "row-reverse", gap: 9, padding: 13 },
  noteText: { color: "#D7DDF4", flex: 1, fontSize: 13, lineHeight: 19, textAlign: "right" },
  noChannels: { color: colors.muted, fontSize: 13, paddingVertical: 18, textAlign: "center" },
  playOrb: { alignItems: "center", backgroundColor: colors.primary, borderRadius: 30, height: 60, justifyContent: "center", width: 60 },
  playerWrap: { marginTop: 4, paddingHorizontal: 10 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.97 }] },
  presenceAvatar: { alignItems: "center", backgroundColor: "#C3A8FF", borderColor: "#E6DEFF", borderRadius: 99, borderWidth: 1, height: 25, justifyContent: "center", width: 25 },
  presenceAvatarSecond: { alignItems: "center", backgroundColor: "#273555", borderColor: "#596E9D", borderRadius: 99, borderWidth: 1, height: 25, justifyContent: "center", marginRight: -8, width: 25 },
  presenceAvatarText: { color: "#FFFFFF", fontSize: 9, fontWeight: "900" },
  primaryButton: { alignItems: "center", borderRadius: 18, flexDirection: "row-reverse", height: 58, justifyContent: "center", overflow: "hidden", width: "100%" },
  primaryGradient: { alignItems: "center", flex: 1, flexDirection: "row-reverse", gap: 9, justifyContent: "center", width: "100%" },
  primaryButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  progressFill: { backgroundColor: colors.cyan, borderRadius: 4, height: 5 },
  progressLabels: { flexDirection: "row-reverse", justifyContent: "space-between", marginBottom: 7 },
  progressSection: { paddingHorizontal: 21, paddingTop: 13 },
  progressText: { color: colors.muted, fontSize: 11 },
  progressTrack: { backgroundColor: colors.border, borderRadius: 5, height: 5, justifyContent: "center", width: "100%" },
  roomAction: { alignItems: "center", flex: 1, flexDirection: "row-reverse", gap: 8, justifyContent: "center" },
  roomActionText: { color: colors.text, fontSize: 13, fontWeight: "700" },
  roomBrandMark: { alignItems: "center", borderColor: "#874AFF", borderRadius: 12, borderWidth: 2, height: 42, justifyContent: "center", shadowColor: "#7E3AF2", shadowOpacity: 0.45, shadowRadius: 10, width: 42 },
  roomBrandText: { color: "#AF9CFF", fontSize: 19, fontWeight: "900" },
  roomCodeChip: { backgroundColor: "#080E1B", borderColor: "#273249", borderRadius: 10, borderWidth: 1, maxWidth: 66, paddingHorizontal: 6, paddingVertical: 9 },
  roomCodeText: { color: "#F4F5FF", fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }), fontSize: 10, fontWeight: "800", textAlign: "center" },
  roomHeader: { alignItems: "center", backgroundColor: "#0A1121", borderBottomColor: "#26334B", borderBottomWidth: 1, flexDirection: "row-reverse", gap: 4, justifyContent: "space-between", minHeight: 68, paddingHorizontal: 9, paddingVertical: 10 },
  roomHeaderIconGold: { alignItems: "center", backgroundColor: "#291237", borderColor: "#7B2AB6", borderRadius: 10, borderWidth: 1, height: 38, justifyContent: "center", width: 35 },
  roomHeaderIconShield: { alignItems: "center", backgroundColor: "#18204E", borderColor: "#4653B2", borderRadius: 10, borderWidth: 1, height: 38, justifyContent: "center", width: 35 },
  roomMemberChip: { alignItems: "center", backgroundColor: "#0B101F", borderColor: "#26334B", borderRadius: 10, borderWidth: 1, flexDirection: "row-reverse", gap: 3, height: 38, justifyContent: "center", width: 38 },
  roomMemberText: { color: "#F0F3FF", fontSize: 14, fontWeight: "800" },
  roomScreen: { backgroundColor: "#0B1222", flex: 1 },
  roomSearchAction: { alignItems: "center", borderRadius: 16, height: 49, justifyContent: "center", width: 49 },
  roomSearchButton: { alignItems: "center", backgroundColor: "#E70821", borderRadius: 16, height: 49, justifyContent: "center", shadowColor: "#FF0033", shadowOpacity: 0.42, shadowRadius: 12, width: 49 },
  roomSearchInput: { backgroundColor: "#111827", borderColor: "#33425E", borderRadius: 18, borderWidth: 1, color: "#F5F7FF", flex: 1, fontSize: 13, height: 49, minWidth: 78, paddingHorizontal: 12 },
  roomSearchLink: { backgroundColor: "#311268", borderColor: "#7730B2", borderWidth: 1 },
  roomSearchPlaylist: { backgroundColor: "#112D66", borderColor: "#1F64C8", borderWidth: 1 },
  roomSearchRow: { alignItems: "center", flexDirection: "row", gap: 7, paddingHorizontal: 10, paddingVertical: 12 },
  roomSearchUpload: { backgroundColor: "#263044", borderColor: "#45536F", borderWidth: 1 },
  roomUserChip: { backgroundColor: "#242B3A", borderColor: "#44506A", borderRadius: 10, borderWidth: 1, maxWidth: 56, paddingHorizontal: 7, paddingVertical: 10 },
  roomUserText: { color: "#F5F7FF", fontSize: 11, fontWeight: "900", textAlign: "center" },
  screenHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 27 },
  screenTitle: { color: colors.text, fontSize: 17, fontWeight: "800" },
  searchHint: { color: colors.warning, fontSize: 13, lineHeight: 19, marginTop: 12, textAlign: "right" },
  protectionMark: { alignItems: "center", backgroundColor: "rgba(50,215,231,0.10)", borderColor: "rgba(50,215,231,0.20)", borderRadius: 14, borderWidth: 1, height: 42, justifyContent: "center", width: 42 },
  secondaryButton: { backgroundColor: "rgba(18,27,53,0.64)", borderColor: "#32456E", borderWidth: 1 },
  secondaryButtonText: { color: colors.text },
  sendButton: { alignItems: "center", backgroundColor: colors.primary, borderRadius: 15, height: 46, justifyContent: "center", width: 46 },
  sourceBadge: { alignItems: "center", backgroundColor: "#242E4D", borderRadius: 999, flexDirection: "row-reverse", gap: 5, paddingHorizontal: 8, paddingVertical: 5 },
  sourceBadgeText: { color: colors.text, fontSize: 10, fontWeight: "800" },
  sourceHelp: { color: colors.muted, fontSize: 13, lineHeight: 20, textAlign: "right" },
  sourcePanel: { backgroundColor: "#10192E", borderColor: colors.border, borderRadius: 18, borderWidth: 1, marginTop: 17, padding: 15 },
  sourceTab: { alignItems: "center", flex: 1, gap: 5, justifyContent: "center", minHeight: 65, paddingHorizontal: 5 },
  sourceTabActive: { backgroundColor: colors.cyan, borderRadius: 14 },
  sourceTabText: { color: colors.muted, fontSize: 10, fontWeight: "800", textAlign: "center" },
  sourceTabTextActive: { color: colors.background },
  sourceTabs: { backgroundColor: colors.surface, borderRadius: 17, flexDirection: "row-reverse", padding: 5 },
  syncDot: { backgroundColor: colors.success, borderRadius: 4, height: 7, width: 7 },
  syncRow: { alignItems: "center", flexDirection: "row-reverse", gap: 5, marginTop: 4 },
  syncText: { color: colors.success, fontSize: 11, fontWeight: "700" },
  topBrandLine: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  videoFrame: { aspectRatio: 16 / 9, backgroundColor: "#080D1A", borderColor: "#202D4B", borderRadius: 19, borderWidth: 1, marginHorizontal: 18, overflow: "hidden", padding: 12 },
  videoPlaceholder: { alignItems: "center", flex: 1, justifyContent: "center", paddingHorizontal: 24 },
  videoPlaceholderText: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 10, textAlign: "center" },
  videoTopRow: { alignItems: "center", flexDirection: "row-reverse", justifyContent: "space-between" },
});
