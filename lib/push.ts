import { Alert, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';

async function saveToken(userId: string) {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Pull Up',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    });
  }
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) return;
  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  await supabase.from('users').update({ push_token: token.data }).eq('id', userId);
}

/**
 * Refresh the stored push token if the user already allowed notifications.
 * Never prompts; the prompt waits until the user has a plan worth hearing
 * about (see askForPushAfter).
 */
export async function syncPushToken(userId: string) {
  const { status } = await Notifications.getPermissionsAsync();
  if (status === 'granted') await saveToken(userId).catch(() => {});
}

const PRIMER_KEY = 'push_primer_last_asked';
const PRIMER_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Explain, then ask for notifications, right after the user creates or joins a
 * plan. iOS only ever shows its own prompt once, so this explains first.
 */
export async function askForPushAfter(reason: 'created' | 'joined') {
  const { status, canAskAgain } = await Notifications.getPermissionsAsync();
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) return;
  if (status === 'granted') {
    await saveToken(user.id).catch(() => {});
    return;
  }
  if (!canAskAgain) return;
  // "Not now" is respected for a week rather than re-asking on every plan.
  const lastAsked = Number(await AsyncStorage.getItem(PRIMER_KEY).catch(() => null)) || 0;
  if (Date.now() - lastAsked < PRIMER_COOLDOWN_MS) return;
  await AsyncStorage.setItem(PRIMER_KEY, String(Date.now())).catch(() => {});

  const body =
    reason === 'created'
      ? "We'll let you know when your crew joins, votes and is on the way."
      : "We'll let you know when the spot is picked and when it's time to head out.";
  Alert.alert('Get plan updates?', body, [
    { text: 'Not now', style: 'cancel' },
    {
      text: 'Turn on',
      onPress: async () => {
        const res = await Notifications.requestPermissionsAsync();
        if (res.status === 'granted') await saveToken(user.id).catch(() => {});
      },
    },
  ]);
}
