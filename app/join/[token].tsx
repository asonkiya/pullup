import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, SafeAreaView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { setPendingRoute } from '@/lib/pendingRoute';
import { supabase } from '@/lib/supabase';
import { logEvent } from '@/lib/analytics';
import { COLORS, FONTS, FONT_SIZE, SPACING, RADIUS, SHADOWS } from '@/constants';
import { HButton } from '@/components/ui';

export default function JoinScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();
  const [status, setStatus]   = useState<'loading' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => { redeemToken(token); }, [token]);

  async function redeemToken(tok: string | undefined) {
    if (!tok) { setErrorMsg('Invalid invite link.'); setStatus('error'); return; }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      await setPendingRoute(`/join/${tok}`);
      router.replace('/(auth)/login');
      return;
    }
    // join_plan validates the token server-side and is idempotent, so a link
    // works for everyone it's shared with until it expires.
    const { data, error } = await supabase.rpc('join_plan', { p_token: tok }).single();
    if (error || !data) {
      setErrorMsg(error?.message.includes('invalid_or_expired')
        ? 'This invite link is invalid or has expired. Ask the host to send a new one.'
        : 'Could not join the plan. Try again.');
      setStatus('error');
      return;
    }
    const { plan_id: planId, joined, invite_id, inviter_user_id } = data;
    if (joined) {
      logEvent('plan_joined', { planId, properties: { source: 'link', invite_id, inviter_user_id } });
      const { data: userRow } = await supabase.from('users').select('display_name').eq('id', user.id).single();
      const { data: planRow } = await supabase.from('plans').select('title').eq('id', planId).single();
      supabase.functions.invoke('notify', {
        body: { event: 'member_joined', plan_id: planId, actor_user_id: user.id, extra: { actor_name: userRow?.display_name ?? 'Someone', plan_title: planRow?.title ?? 'a plan' } },
      });
    }
    router.replace(`/plan/${planId}`);
  }

  if (status === 'loading') {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={COLORS.primary} size="large" />
        <Text style={styles.loadingText}>Joining plan…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.errorTitle}>Couldn't join</Text>
      <Text style={styles.errorMsg}>{errorMsg}</Text>
      <HButton label="Go home" variant="primary" size="md" onPress={() => router.replace('/(tabs)')} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SPACING.md, backgroundColor: COLORS.surface, padding: SPACING.xl },
  loadingText: { fontSize: FONT_SIZE.md, fontFamily: FONTS.regular, color: COLORS.textSecondary, marginTop: SPACING.sm, includeFontPadding: false },
  errorTitle: { fontSize: FONT_SIZE.xl, fontFamily: FONTS.bold, color: COLORS.text, includeFontPadding: false },
  errorMsg:   { fontSize: FONT_SIZE.md, fontFamily: FONTS.regular, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 22, includeFontPadding: false },
});
