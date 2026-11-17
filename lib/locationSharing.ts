import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import { supabase } from '@/lib/supabase';
import {
  LOCATION_UPDATE_INTERVAL_MS,
  LOCATION_DISTANCE_THRESHOLD_M,
  LOCATION_NEAR_SPOT_M,
  LOCATION_NEAR_DISTANCE_THRESHOLD_M,
  LOCATION_NEAR_UPDATE_INTERVAL_MS,
  VENUE_PROVIDER,
} from '@/constants';

type ActiveSession = {
  id: string;
  plan_id: string;
  expires_at: string;
  plans: { selected_place_lat: number | null; selected_place_lng: number | null } | null;
};

// 'far' is cheap and coarse; 'near' is precise enough for the server to tell
// when you've arrived (it needs fixes good to 30 m; see auto_arrive.sql).
type WatchMode = 'far' | 'near';

function metersBetween(lat1: number, lng1: number, lat2: number, lng2: number) {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(a)));
}

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
  const modeRef = useRef<WatchMode>('far');
  const lastEtaAtRef = useRef(0);
  const sessionsRef = useRef<ActiveSession[]>([]);
  const expiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

      // Close to the spot, fixes come every few metres; the ETA barely moves.
      if (modeRef.current === 'near' && Date.now() - lastEtaAtRef.current < LOCATION_UPDATE_INTERVAL_MS) return;
      lastEtaAtRef.current = Date.now();

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

    // Tighten up within reach of any spot we're sharing towards, loosen
    // again when we leave.
    function wantedMode(loc: Location.LocationObject): WatchMode {
      const near = sessionsRef.current.some((s) => {
        const lat = s.plans?.selected_place_lat;
        const lng = s.plans?.selected_place_lng;
        return lat != null && lng != null
          && metersBetween(loc.coords.latitude, loc.coords.longitude, lat, lng) <= LOCATION_NEAR_SPOT_M;
      });
      return near ? 'near' : 'far';
    }

    async function startWatch() {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted' || watchRef.current || !alive) return;
      const near = modeRef.current === 'near';
      watchRef.current = await Location.watchPositionAsync(
        {
          accuracy: near ? Location.Accuracy.High : Location.Accuracy.Balanced,
          distanceInterval: near ? LOCATION_NEAR_DISTANCE_THRESHOLD_M : LOCATION_DISTANCE_THRESHOLD_M,
          timeInterval: near ? LOCATION_NEAR_UPDATE_INTERVAL_MS : LOCATION_UPDATE_INTERVAL_MS,
        },
        (loc) => {
          uploadPoint(loc);
          const mode = wantedMode(loc);
          if (mode !== modeRef.current) {
            modeRef.current = mode;
            stopWatch();
            startWatch();
          }
        }
      );
      if (!alive) stopWatch();
    }

    async function sync() {
      const { data } = await supabase
        .from('location_share_sessions')
        .select('id, plan_id, expires_at, plans(selected_place_lat, selected_place_lng)')
        .eq('user_id', uid)
        .eq('status', 'active')
        .gt('expires_at', new Date().toISOString());
      if (!alive) return;
      sessionsRef.current = (data ?? []) as unknown as ActiveSession[];
      // Re-sync the moment the soonest session expires, so the watch stops on
      // time even if no realtime/app-state event arrives.
      if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
      expiryTimerRef.current = null;
      if (sessionsRef.current.length > 0) {
        const soonest = Math.min(...sessionsRef.current.map((x) => new Date(x.expires_at).getTime()));
        expiryTimerRef.current = setTimeout(sync, Math.max(soonest - Date.now(), 0) + 1000);
      }
      if (sessionsRef.current.length > 0) {
        startWatch();
      } else {
        stopWatch();
        modeRef.current = 'far';
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
      stopWatch();
      supabase.removeChannel(channel);
      appSub.remove();
    };
  }, [userId]);
}
