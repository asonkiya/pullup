import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Image,
  Alert,
  Dimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { logEvent } from '@/lib/analytics';
import { COLORS, FONTS, FONT_SIZE, SPACING, RADIUS, SHADOWS, AUTO_SELECT_THRESHOLD, AUTO_SELECT_MIN_VOTES } from '@/constants';
import { NavHead, Skeleton } from '@/components/ui';
import type { VenueCandidateRow } from '@/types/database';

const { width: SCREEN_W } = Dimensions.get('window');
const CARD_W = (SCREEN_W - SPACING.lg * 2 - SPACING.md) / 2;
const CARD_H = 300;

export default function FaceoffScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [isHost, setIsHost] = useState(false);
  const [uid, setUid] = useState<string | null>(null);
  const [myName, setMyName] = useState('Someone');
  const [planTitle, setPlanTitle] = useState('');
  const [pair, setPair] = useState<[VenueCandidateRow, VenueCandidateRow] | null>(null);
  const [queue, setQueue] = useState<VenueCandidateRow[]>([]);
  const [round, setRound] = useState(1);

  useEffect(() => { load(); }, [id]);

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUid(user.id);

    const [{ data: me }, { data: mem }, { data: plan }] = await Promise.all([
      supabase.from('users').select('display_name').eq('id', user.id).single(),
      supabase.from('plan_members').select('role').eq('plan_id', id!).eq('user_id', user.id).single(),
      supabase.from('plans').select('title, state').eq('id', id!).single(),
    ]);
    if (me) setMyName(me.display_name);
    const host = mem?.role === 'host';
    setIsHost(host);
    if (plan) setPlanTitle(plan.title);

    // Recompute the tie from the DB so this screen works no matter how the
    // host arrived (venues screen, push tap, plan-detail banner).
    const [{ count: totalMembers }, { data: allRight }] = await Promise.all([
      supabase.from('plan_members').select('*', { count: 'exact', head: true }).eq('plan_id', id!),
      supabase.from('venue_swipes').select('venue_candidate_id').eq('plan_id', id!).eq('direction', 'right'),
    ]);
    const counts = new Map<string, number>();
    for (const s of allRight ?? []) {
      counts.set(s.venue_candidate_id, (counts.get(s.venue_candidate_id) ?? 0) + 1);
    }
    const over = [...counts.entries()].filter(
      ([, c]) => totalMembers && c >= AUTO_SELECT_MIN_VOTES && c / totalMembers >= AUTO_SELECT_THRESHOLD
    );
    const maxCount = over.length ? Math.max(...over.map(([, c]) => c)) : 0;
    const leaderIds = over.filter(([, c]) => c === maxCount).map(([vid]) => vid);

    if (leaderIds.length < 2 || plan?.state !== 'open') {
      setPair(null);
      setLoading(false);
      return;
    }

    const { data: venues } = await supabase
      .from('venue_candidates')
      .select('*')
      .in('id', leaderIds);
    const contenders = (venues ?? []) as VenueCandidateRow[];
    if (contenders.length < 2) {
      setPair(null);
      setLoading(false);
      return;
    }
    setQueue(contenders);
    setPair([contenders[0], contenders[1]]);
    setLoading(false);
  }

  function pick(winner: VenueCandidateRow) {
    if (!pair) return;
    const loserIds = new Set(pair.map((v) => v.id));
    loserIds.delete(winner.id);
    const rest = queue.filter((v) => !loserIds.has(v.id) && v.id !== winner.id);

    if (rest.length === 0) {
      confirmLock(winner);
      return;
    }
    setQueue([winner, ...rest]);
    setPair([winner, rest[0]]);
    setRound((r) => r + 1);
  }

  function confirmLock(winner: VenueCandidateRow) {
    Alert.alert('Lock the winner?', `"${winner.name}" becomes the spot.`, [
      { text: 'Keep picking', style: 'cancel' },
      { text: 'Lock it in', onPress: () => lockWinner(winner) },
    ]);
  }

  async function lockWinner(winner: VenueCandidateRow) {
    const { error } = await supabase.from('plans').update({
      selected_place_id: winner.place_id,
      selected_place_name: winner.name,
      selected_place_lat: winner.lat,
      selected_place_lng: winner.lng,
      state: 'venue_locked' as const,
    }).eq('id', id!);
    if (error) {
      Alert.alert('Could not lock venue', error.message);
      return;
    }
    await supabase.from('venue_selection_events').insert({
      plan_id: id!, venue_candidate_id: winner.id, selected_by_user_id: uid!, selection_type: 'host' as const,
    });
    supabase.functions.invoke('notify', {
      body: { event: 'venue_locked', plan_id: id, actor_user_id: uid, extra: { actor_name: myName, plan_title: planTitle, place_name: winner.name } },
    });
    logEvent('venue_locked', { planId: id!, properties: { source: 'faceoff' } });
    router.replace(`/plan/${id}`);
  }

  function contenderCard(venue: VenueCandidateRow) {
    const photo = (venue.photo_urls as string[] | null)?.[0];
    return (
      <TouchableOpacity
        key={venue.id}
        style={styles.card}
        activeOpacity={0.85}
        onPress={() => pick(venue)}
        disabled={!isHost}
      >
        {photo ? (
          <Image source={{ uri: photo }} style={styles.photo} />
        ) : (
          <View style={[styles.photo, styles.photoFallback]}>
            <Feather name="map-pin" size={28} color={COLORS.textFaint} />
          </View>
        )}
        <View style={styles.cardBody}>
          <Text style={styles.cardName} numberOfLines={2}>{venue.name}</Text>
          {venue.rating != null && (
            <Text style={styles.cardMeta}>★ {venue.rating}{venue.category ? ` · ${venue.category}` : ''}</Text>
          )}
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        <NavHead title="Break the tie" onBack={() => router.back()} />

        {loading ? (
          <View style={styles.pairRow}>
            <Skeleton width={CARD_W} height={CARD_H} radius={20} />
            <Skeleton width={CARD_W} height={CARD_H} radius={20} />
          </View>
        ) : !pair ? (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyTitle}>No tie to break</Text>
            <Text style={styles.emptySub}>Either a spot already won or voting is still open. Keep swiping!</Text>
          </View>
        ) : (
          <>
            <Text style={styles.sub}>
              {isHost
                ? 'The crew loves both. Tap the winner.'
                : 'Waiting on the host to pick the winner.'}
            </Text>
            {queue.length > 2 && <Text style={styles.roundText}>Round {round} · {queue.length} contenders left</Text>}

            <View style={styles.pairRow}>
              {contenderCard(pair[0])}
              {contenderCard(pair[1])}
              <View style={styles.vsCircle} pointerEvents="none">
                <Text style={styles.vsText}>VS</Text>
              </View>
            </View>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  inner: { flex: 1, padding: SPACING.lg, gap: SPACING.md },

  sub: {
    fontSize: FONT_SIZE.md,
    fontFamily: FONTS.regular,
    color: COLORS.textSecondary,
    includeFontPadding: false,
  },
  roundText: {
    fontSize: FONT_SIZE.sm,
    fontFamily: FONTS.semibold,
    color: COLORS.primary,
    includeFontPadding: false,
  },

  pairRow: {
    flexDirection: 'row',
    gap: SPACING.md,
    marginTop: SPACING.md,
    position: 'relative',
  },
  card: {
    width: CARD_W,
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    overflow: 'hidden',
    ...SHADOWS.card,
  },
  photo: { width: '100%', height: CARD_H - 84 },
  photoFallback: {
    backgroundColor: COLORS.primaryFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { padding: SPACING.md, gap: 4, minHeight: 84 },
  cardName: {
    fontSize: FONT_SIZE.md,
    fontFamily: FONTS.bold,
    color: COLORS.text,
    includeFontPadding: false,
  },
  cardMeta: {
    fontSize: FONT_SIZE.xs,
    fontFamily: FONTS.regular,
    color: COLORS.textSecondary,
    includeFontPadding: false,
  },

  vsCircle: {
    position: 'absolute',
    top: (CARD_H - 84) / 2 - 22,
    left: '50%',
    marginLeft: -22,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#fff',
    ...SHADOWS.floating,
  },
  vsText: {
    fontSize: FONT_SIZE.md,
    fontFamily: FONTS.extrabold,
    color: '#fff',
    includeFontPadding: false,
  },

  emptyWrap: { alignItems: 'center', paddingTop: 80, gap: SPACING.sm, paddingHorizontal: SPACING.lg },
  emptyTitle: { fontSize: FONT_SIZE.xl, fontFamily: FONTS.bold, color: COLORS.text, includeFontPadding: false },
  emptySub: { fontSize: FONT_SIZE.md, fontFamily: FONTS.regular, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 21, includeFontPadding: false },
});
