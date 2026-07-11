import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import { supabase } from '@/lib/supabase';
import {
  LOCATION_UPDATE_INTERVAL_MS,
  LOCATION_DISTANCE_THRESHOLD_M,
  VENUE_PROVIDER,
} from '@/constants';

type ActiveSession = { id: string; plan_id: string };

let requestSync: (() => void) | null = null;

/**
 * Nudge the root watcher to re-read active sessions right away.
 * Call after starting/stopping a share session — realtime doesn't
 * reliably fire for the user's own writes.
 */
export function refreshLocationSharing() {
  requestSync?.();
}

/**
 * App-wide location sharing. Mounted once in the root layout so sharing
 * keeps working when the user navigates away from the ETA screen.
 *
 * Watches position while the user has ≥1 active, unexpired
 * location_share_session and uploads a point per session on each fix.
 * Never prompts for permission — screens do that; if permission is
 * missing the watch simply doesn't start.
 */
export function useLocationSharing(userId: string | null) {
  const watchRef = useRef<Location.LocationSubscription | null>(null);
  const sessionsRef = useRef<ActiveSession[]>([]);

  useEffect(() => {
    if (!userId) return;
    const uid = userId;
    let alive = true;

    function stopWatch() {
      watchRef.current?.remove();
      watchRef.current = null;
    }

    async function uploadPoint(loc: Location.LocationObject) {
      const sessions = sessionsRef.current;
      if (sessions.length === 0) return;
      const capturedAt = new Date(loc.timestamp).toISOString();
      const { error } = await supabase.from('location_points').insert(
        sessions.map((s) => ({
          session_id: s.id,
          user_id: uid,
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
      for (const planId of planIds) {
        supabase.functions
          .invoke('compute-eta', {
            body: { plan_id: planId, provider: VENUE_PROVIDER },
            headers: { Authorization: `Bearer ${auth.access_token}` },
          })
          .catch(() => {});
      }
    }

    async function startWatch() {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted' || watchRef.current || !alive) return;
      watchRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          distanceInterval: LOCATION_DISTANCE_THRESHOLD_M,
          timeInterval: LOCATION_UPDATE_INTERVAL_MS,
        },
        (loc) => uploadPoint(loc)
      );
      if (!alive) stopWatch();
    }

    async function sync() {
      const { data } = await supabase
        .from('location_share_sessions')
        .select('id, plan_id')
        .eq('user_id', uid)
        .eq('status', 'active')
        .gt('expires_at', new Date().toISOString());
      if (!alive) return;
      sessionsRef.current = (data ?? []) as ActiveSession[];
      if (sessionsRef.current.length > 0) {
        startWatch();
      } else {
        stopWatch();
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
      if (requestSync === sync) requestSync = null;
      stopWatch();
      supabase.removeChannel(channel);
      appSub.remove();
    };
  }, [userId]);
}
