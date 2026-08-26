import { Tabs } from "expo-router";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HapticTab } from "@/components/haptic-tab";
import { IconSymbol } from "@/components/ui/icon-symbol";

export default function TabLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle: {
          display: "none",
          height: Platform.OS === "web" ? 0 : insets.bottom,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "AH4 Watch Party",
          tabBarIcon: ({ color }) => <IconSymbol color={color} name="house.fill" size={24} />,
        }}
      />
    </Tabs>
  );
}
