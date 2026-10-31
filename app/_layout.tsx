import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  useFonts,
  Outfit_400Regular,
  Outfit_500Medium,
  Outfit_600SemiBold,
  Outfit_700Bold,
  Outfit_800ExtraBold,
} from '@expo-google-fonts/outfit';
import MapboxGL from '@rnmapbox/maps';
import { supabase } from '@/lib/supabase';
import { useLocationSharing } from '@/lib/locationSharing';
import { consumePendingRoute, setPendingRoute } from '@/lib/pendingRoute';
import { logEvent } from '@/lib/analytics';
import { syncPushToken } from '@/lib/push';
import type { Session } from '@supabase/supabase-js';

MapboxGL.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '');

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function useProtectedRoute(session: Session | null, ready: boolean) {
  const router = useRouter();
  const segments = useSegments();

  const replaying = useRef(false);

  useEffect(() => {
    if (!ready) return;
    const inAuthGroup = segments[0] === '(auth)';
    if (!session && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (session && inAuthGroup) {
      router.replace('/(tabs)');
    } else if (session && !replaying.current) {
      // Signed in and past the auth screens: replay wherever an invite link or
      // notification was trying to take the user before they had a session.
      replaying.current = true;
      consumePendingRoute()
        .then((route) => { if (route) router.push(route as never); })
        .finally(() => { replaying.current = false; });
    }
  }, [session, segments, ready]);
}

function routeForNotification(data: Record<string, unknown>): string | null {
  if (typeof data.route === 'string' && data.route.startsWith('/')) return data.route;
  if (typeof data.join_token === 'string') return `/join/${data.join_token}`;
  if (typeof data.plan_id === 'string') return `/plan/${data.plan_id}`;
  return null;
}

const APP_OPEN_MIN_GAP_MS = 30 * 60 * 1000;

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const router = useRouter();

  const [fontsLoaded] = useFonts({
    Outfit_400Regular,
    Outfit_500Medium,
    Outfit_600SemiBold,
    Outfit_700Bold,
    Outfit_800ExtraBold,
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setReady(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Keep the push token fresh. The permission prompt itself waits until the
  // user creates or joins a plan (lib/push.ts).
  useEffect(() => {
    if (!session) return;
    syncPushToken(session.user.id);
  }, [session?.user.id]);

  // Notification taps. useLastNotificationResponse also covers the tap that
  // cold-started the app, which a response listener registered after launch
  // misses. Signed-out taps are parked and replayed after login.
  const lastResponse = Notifications.useLastNotificationResponse();
  const handledResponse = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !lastResponse) return;
    const responseId = lastResponse.notification.request.identifier;
    if (handledResponse.current === responseId) return;
    handledResponse.current = responseId;
    const data = (lastResponse.notification.request.content.data ?? {}) as Record<string, unknown>;
    const route = routeForNotification(data);
    Notifications.clearLastNotificationResponse();
    if (!route) return;
    if (session) {
      logEvent('push_opened', {
        planId: typeof data.plan_id === 'string' ? data.plan_id : null,
        properties: { event: data.event ?? null },
      });
      router.push(route as never);
    } else {
      setPendingRoute(route);
    }
  }, [lastResponse, ready, session]);

  // app_open, throttled so foreground/background flicker doesn't count twice.
  const lastAppOpen = useRef(0);
  useEffect(() => {
    if (!session) return;
    function onActive() {
      const now = Date.now();
      if (now - lastAppOpen.current < APP_OPEN_MIN_GAP_MS) return;
      lastAppOpen.current = now;
      logEvent('app_open');
    }
    onActive();
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') onActive(); });
    return () => sub.remove();
  }, [session?.user.id]);

  // Handle deep links (pullup://join/:token)
  useEffect(() => {
    function handleUrl(url: string) {
      const parsed = Linking.parse(url);
      // parsed.path is "join/TOKEN" for pullup://join/TOKEN
      if (parsed.path?.startsWith('join/')) {
        const token = parsed.path.split('/')[1];
        if (!token) return;
        // Signed in: expo-router already routes pullup://join/<token> to the
        // join screen, so pushing here too would redeem it twice. Signed out:
        // park it; useProtectedRoute replays it after login.
        if (!session) setPendingRoute(`/join/${token}`);
      }
    }

    // Cold-start deep link
    Linking.getInitialURL().then((url) => {
      if (url) handleUrl(url);
    });

    // Foreground deep link
    const sub = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    return () => sub.remove();
  }, [session]);

  useProtectedRoute(session, ready);
  useLocationSharing(session?.user.id ?? null);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="plan/create" options={{ presentation: 'modal' }} />
        <Stack.Screen name="plan/[id]" />
        <Stack.Screen name="join/[token]" />
      </Stack>
    </GestureHandlerRootView>
  );
}
