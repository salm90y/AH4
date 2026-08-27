const { withMainApplication } = require("@expo/config-plugins");

/** Ensures LiveKit's Android audio/WebRTC runtime is initialized before React Native loads. */
module.exports = function withLiveKitAndroidSetup(config) {
  return withMainApplication(config, (nextConfig) => {
    if (nextConfig.modResults.language !== "kt") return nextConfig;
    let source = nextConfig.modResults.contents;
    if (!source.includes("import com.livekit.reactnative.LiveKitReactNative")) {
      source = source.replace(
        "import android.content.res.Configuration\n",
        "import android.content.res.Configuration\n\nimport com.livekit.reactnative.LiveKitReactNative\nimport com.livekit.reactnative.audio.AudioType\n",
      );
    }
    if (!source.includes("LiveKitReactNative.setup(this")) {
      source = source.replace(
        "  override fun onCreate() {\n    super.onCreate()",
        "  override fun onCreate() {\n    LiveKitReactNative.setup(this, AudioType.CommunicationAudioType())\n    super.onCreate()",
      );
    }
    nextConfig.modResults.contents = source;
    return nextConfig;
  });
};
