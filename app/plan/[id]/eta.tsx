import { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  SafeAreaView,
  Dimensions,
  Linking,
  Switch,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MapboxGL from '@rnmapbox/maps';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { supabase } from '@/lib/supabase';
import { logEvent } from '@/lib/analytics';
import { directionsUrl } from '@/lib/affiliate';
import { refreshLocationSharing } from '@/lib/locationSharing';
import {
  COLORS,
  SPACING,
  FONT_SIZE,
  DEFAULT_SHARE_SESSION_HOURS,
  VENUE_PROVIDER,
} from '@/constants';
import type { EtaSnapshotRow, UserRow } from '@/types/database';

const CONSENT_VERSION = '1.0';
// Remembered across plans: people who prefer ETA-only usually always do.
const ETA_ONLY_PREF_KEY = 'share_eta_only';
const MAP_HEIGHT = Dimensions.get('window').height * 0.38;

type EtaEntry = EtaSnapshotRow & { users: UserRow };
type MemberLocation = {
  user_id: string;
  display_name: string;
  lat: number;
  lng: number;
};

const MEMBER_COLORS = ['#5B4FE9', '#F59E0B', '#EF4444', '#10B981', '#EC4899', '#8B5CF6', '#06B6D4'];

export default function EtaDashboardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [isSharing, setIsSharing] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [etaOnly, setEtaOnly] = useState(false);
  const [entries, setEntries] = useState<EtaEntry[]>([]);
  const [planName, setPlanName] = useState('');
  const [uid, setUid] = useState<string | null>(null);
  const [venueLat, setVenueLat] = useState<number | null>(null);
  const [venueLng, setVenueLng] = useState<number | null>(null);
  const [venueName, setVenueName] = useState<string | null>(null);
  const [travelMode, setTravelMode] = useState<string | null>(null);
  const [memberLocations, setMemberLocations] = useState<MemberLocation[]>([]);
  const cameraRef = useRef<MapboxGL.Camera | null>(null);
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUid(user?.id ?? null);
      if (user) restoreMySession(user.id);
    });
    AsyncStorage.getItem(ETA_ONLY_PREF_KEY)
      .then((v) => { if (v === '1') setEtaOnly(true); })
      .catch(() => {});
    loadPlanData();
    fetchEta();
    fetchMemberLocations();

    const channel = supabase
      .channel(`eta-${id}`)
      .on('broadcast', { event: 'eta_updated' }, () => {
        fetchEta();
        fetchMemberLocations();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'location_points' }, () => {
        fetchMemberLocations();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id]);

  // Sharing persists app-wide (root layout hook), so returning to this
  // screen must reflect an already-running session.
  async function restoreMySession(userId: string) {
    const { data } = await supabase
      .from('location_share_sessions')
      .select('id, eta_only')
      .eq('plan_id', id!)
      .eq('user_id', userId)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (data) {
      setSessionId(data.id);
      setIsSharing(true);
      setEtaOnly(data.eta_only);
    }
  }

  // Applies immediately to a running share; otherwise used when sharing starts.
  async function changeEtaOnly(next: boolean) {
    setEtaOnly(next);
    AsyncStorage.setItem(ETA_ONLY_PREF_KEY, next ? '1' : '0').catch(() => {});
    if (sessionId) {
      const { error } = await supabase
        .from('location_share_sessions')
        .update({ eta_only: next })
        .eq('id', sessionId);
      if (error) {
        setEtaOnly(!next);
        Alert.alert('Could not update sharing', 'Try again.');
        return;
      }
      fetchMemberLocations();
    }
  }

  async function loadPlanData() {
    const { data: plan } = await supabase
      .from('plans')
      .select('title, selected_place_id, selected_place_name, selected_place_lat, selected_place_lng, travel_mode_default')
      .eq('id', id!)
      .single();
    if (!plan) return;
    setPlanName(plan.title);
    setVenueName(plan.selected_place_name);
    setTravelMode(plan.travel_mode_default);

    // Coords live on the plan. Fall back to the venue candidate for older plans:
    // first by place_id, then via the latest selection event (stable row id).
    if (plan.selected_place_lat != null && plan.selected_place_lng != null) {
      setVenueLat(plan.selected_place_lat);
      setVenueLng(plan.selected_place_lng);
      return;
    }
    if (!plan.selected_place_id) return;

    const { data: byPlace } = await supabase
      .from('venue_candidates')
      .select('lat, lng')
      .eq('plan_id', id!)
      .eq('place_id', plan.selected_place_id)
      .maybeSingle();
    if (byPlace) {
      setVenueLat(byPlace.lat);
      setVenueLng(byPlace.lng);
      return;
    }

    const { data: sel } = await supabase
      .from('venue_selection_events')
      .select('venue_candidate_id')
      .eq('plan_id', id!)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (sel?.venue_candidate_id) {
      const { data: byId } = await supabase
        .from('venue_candidates')
        .select('lat, lng')
        .eq('id', sel.venue_candidate_id)
        .maybeSingle();
      if (byId) {
        setVenueLat(byId.lat);
        setVenueLng(byId.lng);
      }
    }
  }

  async function fetchEta() {
    const { data } = await supabase
      .from('eta_snapshots')
      .select('*, users(id, display_name, avatar_url)')
      .eq('plan_id', id!)
      .order('duration_seconds', { ascending: true, nullsFirst: false });
    setEntries((data ?? []) as unknown as EtaEntry[]);
  }

  async function fetchMemberLocations() {
    const { data: sessions } = await supabase
      .from('location_share_sessions')
      .select('id, user_id, eta_only, users(display_name)')
      .eq('plan_id', id!)
      .eq('status', 'active');

    if (!sessions || sessions.length === 0) {
      setMemberLocations([]);
      return;
    }

    const locations: MemberLocation[] = [];
    for (const session of sessions) {
      // ETA-only sharers appear in the list below, not on the map. Your own
      // dot comes from MapboxGL.UserLocation.
      if (session.eta_only) continue;
      const { data: point } = await supabase
        .from('location_points')
        .select('lat, lng')
        .eq('session_id', session.id)
        .order('captured_at', { ascending: false })
        .limit(1)
        .single();
      if (point) {
        const user = session.users as unknown as { display_name: string } | null;
        locations.push({
          user_id: session.user_id,
          display_name: user?.display_name ?? 'Unknown',
          lat: point.lat,
          lng: point.lng,
        });
      }
    }
    setMemberLocations(locations);
  }

  function fitMapToMarkers() {
    const coords: [number, number][] = [];
    if (venueLat != null && venueLng != null) coords.push([venueLng, venueLat]);
    for (const m of memberLocations) coords.push([m.lng, m.lat]);
    if (coords.length === 0) return;
    if (coords.length === 1) {
      cameraRef.current?.flyTo(coords[0], 400);
      return;
    }
    const lngs = coords.map(c => c[0]);
    const lats = coords.map(c => c[1]);
    cameraRef.current?.fitBounds(
      [Math.max(...lngs), Math.max(...lats)],
      [Math.min(...lngs), Math.min(...lats)],
      [60, 60, 60, 60],
      400,
    );
  }

  useEffect(() => {
    fitMapToMarkers();
  }, [venueLat, venueLng, memberLocations]);

  const defaultCenter: [number, number] = [venueLng ?? -122.43, venueLat ?? 37.78];

  async function startSharing() {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Location is off',
        'Turn on location for Pull Up to share your ETA. It is only used for this plan, and sharing stops when you stop it or the plan ends.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ]
      );
      return;
    }
    const expiresAt = new Date(
      Date.now() + DEFAULT_SHARE_SESSION_HOURS * 60 * 60 * 1000
    ).toISOString();

    const { data: session, error } = await supabase
      .from('location_share_sessions')
      .insert({
        plan_id: id!,
        user_id: uid!,
        status: 'active',
        expires_at: expiresAt,
        consent_version: CONSENT_VERSION,
        share_mode: 'foreground',
        eta_only: etaOnly,
      })
      .select()
      .single();

    if (error || !session) {
      Alert.alert('Error', 'Could not start sharing. Try again.');
      return;
    }
    setSessionId(session.id);
    setIsSharing(true);
    // Root-layout watcher takes over from here; push one point right away
    // so friends see you before the first watch fix lands.
    uploadCurrentLocation(session.id);
    refreshLocationSharing();
    logEvent('eta_share_started', { planId: id!, properties: { eta_only: etaOnly } });
  }

  async function stopSharing() {
    if (sessionId) {
      await supabase
        .from('location_share_sessions')
        .update({ status: 'stopped' as const, stopped_at: new Date().toISOString() })
        .eq('id', sessionId);
    }
    // Flag our own ETA snapshot so it reads "not sharing" on everyone's
    // screen instead of freezing at the last value (a server cron does the
    // same as a backstop).
    if (uid) {
      await supabase
        .from('eta_snapshots')
        .update({ status: 'stopped', duration_seconds: null, distance_meters: null })
        .eq('plan_id', id!)
        .eq('user_id', uid);
    }
    setIsSharing(false);
    setSessionId(null);
    refreshLocationSharing();
    fetchEta();
  }

  async function uploadCurrentLocation(sid: string) {
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const { error } = await supabase.from('location_points').insert({
      session_id: sid,
      user_id: uid!,
      lat: loc.coords.latitude,
      lng: loc.coords.longitude,
      accuracy_m: loc.coords.accuracy,
      captured_at: new Date(loc.timestamp).toISOString(),
    });

    if (!error) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (!session) return;
        supabase.functions.invoke('compute-eta', {
          body: { plan_id: id!, provider: VENUE_PROVIDER },
          headers: { Authorization: `Bearer ${session.access_token}` },
        }).catch(() => {});
      });
    }
  }

  function fmtDuration(s: number | null) {
    if (s == null) return '--';
    const m = Math.round(s / 60);
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
  }
  function fmtDist(m: number | null) {
    if (m == null) return '';
    return m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`;
  }

  const hasMapContent = (venueLat != null && venueLng != null) || memberLocations.length > 0;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.back}>{'<-'}</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Who's close</Text>
          <Text style={styles.headerSub}>{planName}</Text>
        </View>
        {hasMapContent && (
          <TouchableOpacity onPress={fitMapToMarkers}>
            <Text style={styles.recenterText}>Re-center</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scrollContent}>
        {/* Map */}
        {hasMapContent && (
          <View style={styles.mapContainer}>
            <MapboxGL.MapView style={styles.map} logoEnabled={false} attributionEnabled={false}>
              <MapboxGL.Camera ref={cameraRef} centerCoordinate={defaultCenter} zoomLevel={13} />
              <MapboxGL.UserLocation visible={isSharing} />
              {venueLat != null && venueLng != null && (
                <MapboxGL.MarkerView coordinate={[venueLng, venueLat]} anchor={{ x: 0.5, y: 0.5 }} allowOverlap>
                  <View style={[styles.pin, styles.venuePin, { backgroundColor: COLORS.error }]} />
                </MapboxGL.MarkerView>
              )}
              {memberLocations.map((m, i) => (
                <MapboxGL.MarkerView key={m.user_id} coordinate={[m.lng, m.lat]} anchor={{ x: 0.5, y: 0.5 }} allowOverlap>
                  <View style={[styles.pin, { backgroundColor: MEMBER_COLORS[i % MEMBER_COLORS.length] }]} />
                </MapboxGL.MarkerView>
              ))}
            </MapboxGL.MapView>
            {memberLocations.length > 0 && (
              <View style={styles.legend}>
                {memberLocations.map((m, i) => (
                  <View key={m.user_id} style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: MEMBER_COLORS[i % MEMBER_COLORS.length] }]} />
                    <Text style={styles.legendText} numberOfLines={1}>{m.display_name}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Share / Stop banner */}
        {!isSharing ? (
          <View style={styles.consent}>
            <Text style={styles.consentTitle}>Share your ETA</Text>
            <Text style={styles.consentBody}>
              Only for this plan. Only while you choose. Automatically ends{' '}
              {DEFAULT_SHARE_SESSION_HOURS}h after you start.
            </Text>
            <TouchableOpacity style={styles.shareBtn} onPress={startSharing}>
              <Text style={styles.shareBtnText}>Share ETA for this plan</Text>
            </TouchableOpacity>
            <View style={styles.etaOnlyRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.etaOnlyLabel}>Show me on the map</Text>
                <Text style={styles.etaOnlySub}>
                  {etaOnly ? 'Crew sees only how far away you are.' : 'Crew sees your dot and your ETA.'}
                </Text>
              </View>
              <Switch
                value={!etaOnly}
                onValueChange={(v) => changeEtaOnly(!v)}
                trackColor={{ false: COLORS.border, true: COLORS.primary }}
              />
            </View>
          </View>
        ) : (
          <View style={styles.sharingBanner}>
            <View style={styles.dot} />
            <Text style={styles.sharingText}>
              {etaOnly ? 'Sharing your ETA only, for this plan' : 'Sharing your location for this plan only'}
            </Text>
            <TouchableOpacity onPress={stopSharing}>
              <Text style={styles.stopText}>Stop</Text>
            </TouchableOpacity>
          </View>
        )}
        {isSharing && (
          <View style={[styles.consent, { paddingVertical: SPACING.sm }]}>
            <View style={styles.etaOnlyRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.etaOnlyLabel}>Show me on the map</Text>
                <Text style={styles.etaOnlySub}>
                  {etaOnly ? 'Crew sees only how far away you are.' : 'Crew sees your dot and your ETA.'}
                </Text>
              </View>
              <Switch
                value={!etaOnly}
                onValueChange={(v) => changeEtaOnly(!v)}
                trackColor={{ false: COLORS.border, true: COLORS.primary }}
              />
            </View>
          </View>
        )}

        {/* Turn-by-turn handoff */}
        {venueLat != null && venueLng != null && (
          <TouchableOpacity
            style={styles.navigateBtn}
            onPress={() => {
              logEvent('navigate_click', { planId: id!, properties: { travel_mode: travelMode ?? 'drive' } });
              Linking.openURL(directionsUrl({ name: venueName ?? 'Destination', lat: venueLat, lng: venueLng }, travelMode));
            }}
          >
            <Text style={styles.navigateBtnText}>Navigate with Google Maps</Text>
          </TouchableOpacity>
        )}

        {/* ETA list */}
        {entries.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No ETAs yet</Text>
            <Text style={styles.emptySub}>
              Once members tap "Share ETA", you'll see who's on the way here.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {entries.map((item, index) => (
              <View key={item.id} style={styles.etaRow}>
                <Text style={styles.rank}>{index + 1}</Text>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{item.users?.display_name?.[0]?.toUpperCase() ?? '?'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.etaName}>{item.users?.display_name ?? 'Unknown'}</Text>
                  <Text style={styles.etaMode}>{item.mode} · {fmtDist(item.distance_meters)}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  {item.status === 'stopped' ? (
                    <Text style={styles.etaNotSharing}>Not sharing</Text>
                  ) : (
                    <>
                      <Text style={styles.etaDuration}>{fmtDuration(item.duration_seconds)}</Text>
                      <Text style={styles.etaTime}>
                        {new Date(item.computed_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                      </Text>
                    </>
                  )}
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  back: { fontSize: FONT_SIZE.xl, color: COLORS.primary },
  headerTitle: { fontSize: FONT_SIZE.lg, fontWeight: '700', color: COLORS.text },
  headerSub: { fontSize: FONT_SIZE.sm, color: COLORS.textSecondary },
  recenterText: { fontSize: FONT_SIZE.sm, fontWeight: '600', color: COLORS.primary },

  scrollContent: { paddingBottom: SPACING.xl },

  mapContainer: {
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  map: { width: '100%', height: MAP_HEIGHT },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: FONT_SIZE.xs, color: COLORS.textSecondary, maxWidth: 100 },

  consent: {
    margin: SPACING.lg,
    padding: SPACING.lg,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    gap: SPACING.sm,
    borderWidth: 1.5,
    borderColor: COLORS.primaryLight,
  },
  consentTitle: { fontSize: FONT_SIZE.lg, fontWeight: '700', color: COLORS.text },
  consentBody: { fontSize: FONT_SIZE.sm, color: COLORS.textSecondary, lineHeight: 20 },
  etaOnlyRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginTop: SPACING.xs },
  etaOnlyLabel: { fontSize: FONT_SIZE.sm, fontWeight: '600', color: COLORS.text },
  etaOnlySub: { fontSize: FONT_SIZE.xs, color: COLORS.textSecondary, marginTop: 2 },
  shareBtn: { backgroundColor: COLORS.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: SPACING.xs },
  shareBtnText: { color: '#fff', fontWeight: '700', fontSize: FONT_SIZE.md },
  sharingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.lg,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    backgroundColor: '#DCFCE7',
    borderRadius: 12,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.success },
  sharingText: { flex: 1, fontSize: FONT_SIZE.sm, color: COLORS.success, fontWeight: '500' },
  navigateBtn: {
    marginHorizontal: SPACING.md,
    marginTop: SPACING.xs,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  navigateBtnText: { fontSize: FONT_SIZE.sm, fontWeight: '700', color: COLORS.primary },
  stopText: { fontSize: FONT_SIZE.sm, fontWeight: '700', color: COLORS.error },

  list: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, gap: SPACING.sm },
  etaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: SPACING.md,
    gap: SPACING.sm,
  },
  rank: { width: 24, textAlign: 'center', fontSize: FONT_SIZE.sm, fontWeight: '700', color: COLORS.textSecondary },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: FONT_SIZE.md, fontWeight: '700', color: COLORS.primary },
  etaName: { fontSize: FONT_SIZE.md, fontWeight: '600', color: COLORS.text },
  etaMode: { fontSize: FONT_SIZE.xs, color: COLORS.textSecondary },
  etaDuration: { fontSize: FONT_SIZE.lg, fontWeight: '700', color: COLORS.primary },
  etaTime: { fontSize: FONT_SIZE.xs, color: COLORS.textSecondary },
  etaNotSharing: { fontSize: FONT_SIZE.sm, fontWeight: '600', color: COLORS.textSecondary },
  pin: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: '#fff' },
  venuePin: { width: 22, height: 22, borderRadius: 11, borderWidth: 3 },
  emptyState: { alignItems: 'center', paddingTop: 60, gap: SPACING.sm, paddingHorizontal: SPACING.xl },
  emptyTitle: { fontSize: FONT_SIZE.xl, fontWeight: '700', color: COLORS.text },
  emptySub: { fontSize: FONT_SIZE.md, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 22 },
});
