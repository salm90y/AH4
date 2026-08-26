import AsyncStorage from "@react-native-async-storage/async-storage";

const GUEST_ID_KEY = "ah4.guest-participant-id";

export async function getGuestParticipantId() {
  const existing = await AsyncStorage.getItem(GUEST_ID_KEY);
  if (existing) return existing;

  const value = `guest_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
  await AsyncStorage.setItem(GUEST_ID_KEY, value);
  return value;
}
