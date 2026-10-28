import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Share,
  Alert,
  SafeAreaView,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { COLORS, FONTS, FONT_SIZE, SPACING, RADIUS } from '@/constants';
import { NavHead, HButton, Avatar, AvatarRow, VibeChip } from '@/components/ui';
import type { PlanRow } from '@/types/database';

type CrewSuggestion = { user_id: string; display_name: string };

export default function InviteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router  = useRouter();
  const [plan, setPlan]     = useState<PlanRow | null>(null);
  const [members, setMembers] = useState<string[]>([]);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [uid, setUid] = useState<string | null>(null);
  const [myName, setMyName] = useState('Someone');
  const [crew, setCrew] = useState<CrewSuggestion[]>([]);
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());

  const inviteLink = inviteToken ? `pullup://join/${inviteToken}` : null;

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) setUid(user.id);

      const { data: p } = await supabase.from('plans').select('*').eq('id', id!).single();
      if (p) setPlan(p);

      const { data: m } = await supabase
        .from('plan_members')
        .select('user_id, users(display_name)')
        .eq('plan_id', id!);
      const currentMembers = (m ?? []) as unknown as Array<{ user_id: string; users: { display_name: string } | null }>;
      setMembers(currentMembers.map((r) => r.users?.display_name ?? '?'));
      if (user) {
        const me = currentMembers.find((r) => r.user_id === user.id);
        if (me?.users?.display_name) setMyName(me.users.display_name);
        loadRecentCrew(user.id, new Set(currentMembers.map((r) => r.user_id)));
      }
    })();
  }, [id]);

  // People from your past plans who aren't in this one yet.
  async function loadRecentCrew(userId: string, exclude: Set<string>) {
    const { data: myPlans } = await supabase
      .from('plan_members')
      .select('plan_id')
      .eq('user_id', userId);
    const planIds = (myPlans ?? []).map((r) => r.plan_id).filter((p) => p !== id);
    if (planIds.length === 0) return;

    const { data: co } = await supabase
      .from('plan_members')
      .select('user_id, joined_at, users(display_name)')
      .in('plan_id', planIds)
      .neq('user_id', userId)
      .order('joined_at', { ascending: false })
      .limit(50);

    const seen = new Set<string>();
    const suggestions: CrewSuggestion[] = [];
    for (const row of (co ?? []) as unknown as Array<{ user_id: string; users: { display_name: string } | null }>) {
      if (exclude.has(row.user_id) || seen.has(row.user_id)) continue;
      seen.add(row.user_id);
      suggestions.push({ user_id: row.user_id, display_name: row.users?.display_name ?? '?' });
      if (suggestions.length >= 8) break;
    }
    setCrew(suggestions);
  }

  async function getOrCreateInviteToken(): Promise<string> {
    if (inviteToken) return inviteToken;
    if (!uid || !plan) return '';
    const token = Math.random().toString(36).slice(2, 10);
    const { data: invite } = await supabase
      .from('plan_invites')
      .insert({
        plan_id: id!,
        token,
        inviter_user_id: uid,
        status: 'pending',
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .select()
      .single();
    const finalToken = invite?.token ?? token;
    setInviteToken(finalToken);
    return finalToken;
  }

  async function copyLink() {
    const token = await getOrCreateInviteToken();
    await Clipboard.setStringAsync(`pullup://join/${token}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function shareLink() {
    const token = await getOrCreateInviteToken();
    Share.share({ message: `Pull up with us: ${plan?.title ?? ''}\npullup://join/${token}` });
  }

  // Pushes a join link to someone from a past plan. They join themselves —
  // nobody gets silently added to a plan they didn't agree to.
  async function inviteCrewMember(person: CrewSuggestion) {
    if (!uid || !plan || invitedIds.has(person.user_id)) return;
    const token = await getOrCreateInviteToken();
    if (!token) return;
    setInvitedIds((prev) => new Set(prev).add(person.user_id));
    supabase.functions.invoke('notify', {
      body: {
        event: 'crew_invited',
        plan_id: id,
        actor_user_id: uid,
        recipient_user_ids: [person.user_id],
        extra: { actor_name: myName, plan_title: plan.title, join_token: token },
      },
    }).catch(() => {});
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.inner} showsVerticalScrollIndicator={false}>

        <NavHead
          title={plan?.title ?? ''}
          onBack={() => router.back()}
          right={plan?.vibe ? <VibeChip vibe={plan.vibe} selected small /> : undefined}
        />

        <Text style={styles.sub}>Anyone with the link can join & vote on venues.</Text>

        {/* Link card */}
        <View style={styles.linkCard}>
          <Text style={styles.linkText} numberOfLines={1}>
            {inviteLink ?? `pullup.app/j/…`}
          </Text>
          <TouchableOpacity onPress={copyLink} activeOpacity={0.7}>
            <Text style={styles.copyBtn}>{copied ? 'Copied!' : 'Copy'}</Text>
          </TouchableOpacity>
        </View>

        <HButton
          label="Share link"
          variant="primary"
          size="md"
          onPress={shareLink}
          fullWidth
        />

        {/* Recent crew */}
        {crew.length > 0 && (
          <>
            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or add from recent plans</Text>
              <View style={styles.dividerLine} />
            </View>

            <View style={styles.crewGrid}>
              {crew.map((person, i) => {
                const invited = invitedIds.has(person.user_id);
                return (
                  <TouchableOpacity
                    key={person.user_id}
                    style={[styles.crewTile, invited && styles.crewTileInvited]}
                    onPress={() => inviteCrewMember(person)}
                    activeOpacity={0.7}
                    disabled={invited}
                  >
                    <Avatar name={person.display_name} index={i} size={40} />
                    <Text style={styles.crewName} numberOfLines={1}>{person.display_name}</Text>
                    <Text style={[styles.crewAction, invited && styles.crewActionInvited]}>
                      {invited ? 'Invited ✓' : '+ Invite'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}

        {/* Going so far footer */}
        <View style={styles.goingRow}>
          <Text style={styles.goingLabel}>Going so far</Text>
          <AvatarRow names={members} size={28} extraText={members.length === 1 ? 'just you (for now)' : undefined} />
        </View>

        <HButton
          label="Done — go to plan"
          variant="ghost"
          size="md"
          onPress={() => router.replace(`/plan/${id}`)}
          fullWidth
        />

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.surface },
  inner: { padding: SPACING.lg, gap: SPACING.lg, paddingBottom: SPACING.xxl },

  sub: {
    fontSize: FONT_SIZE.sm,
    fontFamily: FONTS.regular,
    color: COLORS.textSecondary,
    includeFontPadding: false,
  },

  linkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    backgroundColor: COLORS.primaryFaint,
    borderWidth: 1.5,
    borderColor: '#C9C2F6',
    borderStyle: 'dashed',
    borderRadius: RADIUS.card,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  linkText: {
    flex: 1,
    fontFamily: 'monospace',
    fontSize: FONT_SIZE.sm,
    color: COLORS.primary,
    includeFontPadding: false,
  },
  copyBtn: {
    fontSize: FONT_SIZE.sm,
    fontFamily: FONTS.bold,
    color: COLORS.primary,
    includeFontPadding: false,
  },

  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginVertical: SPACING.xs,
  },
  dividerLine: { flex: 1, height: 1.5, backgroundColor: COLORS.border },
  dividerText: {
    fontSize: FONT_SIZE.sm,
    fontFamily: FONTS.semibold,
    color: COLORS.textSecondary,
    includeFontPadding: false,
  },

  crewGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  crewTile: {
    width: '30.5%',
    alignItems: 'center',
    gap: 6,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.background,
    borderRadius: RADIUS.card,
    borderWidth: 1.5,
    borderColor: COLORS.border,
  },
  crewTileInvited: {
    borderColor: COLORS.successDeep,
    backgroundColor: COLORS.successTint,
  },
  crewName: {
    fontSize: FONT_SIZE.sm,
    fontFamily: FONTS.semibold,
    color: COLORS.text,
    maxWidth: '90%',
    includeFontPadding: false,
  },
  crewAction: {
    fontSize: FONT_SIZE.xs,
    fontFamily: FONTS.bold,
    color: COLORS.primary,
    includeFontPadding: false,
  },
  crewActionInvited: {
    color: COLORS.successDeep,
  },

  goingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  goingLabel: {
    fontSize: 12,
    fontFamily: FONTS.bold,
    color: COLORS.textFaint,
    textTransform: 'uppercase',
    letterSpacing: 1.1,
    includeFontPadding: false,
  },
});
