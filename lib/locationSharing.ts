import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { supabase } from '@/lib/supabase';
import {
  LOCATION_UPDATE_INTERVAL_MS,
  LOCATION_DISTANCE_THRESHOLD_M,
  VENUE_PROVIDER,
} from '@/constants';

type ActiveSession = { id: string; plan_id: string; expires_at: string };

const LOCATION_TASK = 'pullup-location-sharing';

let requestSync: (() => void) | null = null;

/**
 * Nudge the root watcher to re-read active sessions right away.
 * Call after starting/stopping a share session — realtime doesn't
 * reliably fire for the user's own writes.
 */
export function refreshLocationSharing() {
  requestSync?.();
}

async function activeSessions(userId: string): Promise<ActiveSession[]> {
  const { data } = await supabase
    .from('location_share_sessions')
    .select('id, plan_id, expires_at')
    .eq('user_id', userId)
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString());
  return (data ?? []) as ActiveSession[];
}

async function uploadPoint(userId: string, sessions: ActiveSession[], loc: Location.LocationObject) {
  if (sessions.length === 0) return;
  const capturedAt = new Date(loc.timestamp).toISOString();
  const { error } = await supabase.from('location_points').insert(
    sessions.map((s) => ({
      session_id: s.id,
      user_id: userId,
      lat: loc.coords.latitude,
      lng: loc.coords.longitude,
      accuracy_m: loc.coords.accuracy,
      captured_at: capturedAt,
    }))
  );
  if (error) return;

  const { data: { session: auth } } = await supabase.auth.getSession();
  if (!auth) return;
  const planIds = [...new Set(sessions.map((s) => s.plan_id))];
  await Promise.all(
    planIds.map((planId) =>
      supabase.functions
        .invoke('compute-eta', {
          body: { plan_id: planId, provider: VENUE_PROVIDER },
          headers: { Authorization: `Bearer ${auth.access_token}` },
        })
        .catch(() => {})
    )
  );
}

async function stopUpdates() {
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => {});
  }
}

// Runs for every batch of fixes, including while the app is backgrounded (the
// user switched to Maps or locked the phone). Must be defined at module scope
// so it is registered before iOS delivers a fix to a relaunched JS context.
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  const { data: { session: auth } } = await supabase.auth.getSession();
  if (!auth) {
    await stopUpdates();
    return;
  }
  const sessions = await activeSessions(auth.user.id);
  if (sessions.length === 0) {
    // Every share ended or expired while we were in the background.
    await stopUpdates();
    return;
  }
  const latest = data.locations[data.locations.length - 1];
  await uploadPoint(auth.user.id, sessions, latest);
});

/**
 * App-wide location sharing. Mounted once in the root layout.
 *
 * While the user has ≥1 active, unexpired location_share_session, runs a
 * location task that keeps uploading after the app is backgrounded (iOS shows
 * the blue location pill). Sharing is always started by the user from the ETA
 * screen, so "While Using" permission is enough. Never prompts for
 * permission — screens do that; if permission is missing nothing starts.
 */
export function useLocationSharing(userId: string | null) {
  const expiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!userId) {
      stopUpdates();
      return;
    }
    const uid = userId;
    let alive = true;

    async function startUpdates() {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted' || !alive) return;
      if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)) return;
      await Location.startLocationUpdatesAsync(LOCATION_TASK, {
        accuracy: Location.Accuracy.Balanced,
        distanceInterval: LOCATION_DISTANCE_THRESHOLD_M,
        timeInterval: LOCATION_UPDATE_INTERVAL_MS,
        activityType: Location.ActivityType.OtherNavigation,
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: 'Sharing your ETA',
          notificationBody: 'Your crew can see how far away you are. Stop anytime in Pull Up.',
        },
      }).catch(() => {});
    }

    async function sync() {
      const sessions = await activeSessions(uid);
      if (!alive) return;
      // Re-sync the moment the soonest session expires, so updates stop on
      // time even if no realtime/app-state event arrives.
      if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
      expiryTimerRef.current = null;
      if (sessions.length > 0) {
        const soonest = Math.min(...sessions.map((x) => new Date(x.expires_at).getTime()));
        expiryTimerRef.current = setTimeout(sync, Math.max(soonest - Date.now(), 0) + 1000);
        startUpdates();
      } else {
        stopUpdates();
      }
    }

    sync();
    requestSync = sync;

    const channel = supabase
      .channel(`loc-sharing-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'location_share_sessions',
          filter: `user_id=eq.${userId}`,
        },
        () => sync()
      )
      .subscribe();

    const appSub = AppState.addEventListener('change', (next) => {
      if (next === 'active') sync();
    });

    return () => {
      alive = false;
      if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
      if (requestSync === sync) requestSync = null;
      supabase.removeChannel(channel);
      appSub.remove();
    };
  }, [userId]);
}
