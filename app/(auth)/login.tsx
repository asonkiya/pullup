import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  Linking,
} from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { supabase } from '@/lib/supabase';
import { hasPendingRoute } from '@/lib/pendingRoute';
import { COLORS, FONTS, FONT_SIZE, SPACING, RADIUS, SHADOWS } from '@/constants';

export default function LoginScreen() {
  const [mode, setMode]       = useState<'signin' | 'signup'>('signin');
  const [email, setEmail]     = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);

  // Arriving from an invite link almost always means a new user.
  useEffect(() => {
    hasPendingRoute().then((pending) => { if (pending) setMode('signup'); });
    AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => {});
  }, []);

  async function signInWithApple() {
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) throw new Error('No identity token from Apple');
      setLoading(true);
      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: credential.identityToken,
      });
      if (error) throw error;
      // Apple only shares the name on the very first sign-in, so save it now
      // instead of falling back to an email-prefix display name.
      const name = [credential.fullName?.givenName, credential.fullName?.familyName].filter(Boolean).join(' ');
      if (name && data.user) {
        await supabase.from('users').update({ display_name: name }).eq('id', data.user.id);
      }
    } catch (e: unknown) {
      if ((e as { code?: string }).code !== 'ERR_REQUEST_CANCELED') {
        Alert.alert('Sign in with Apple failed', e instanceof Error ? e.message : 'Try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  async function submit() {
    const e = email.trim().toLowerCase();
    if (!e || !password) { Alert.alert('Enter your email and password'); return; }
    setLoading(true);
    if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email: e, password });
      if (error) Alert.alert('Sign in failed', error.message);
    } else {
      const { data, error } = await supabase.auth.signUp({ email: e, password });
      if (error) {
        Alert.alert('Sign up failed', error.message);
      } else if (!data.session) {
        // Email confirmation is enabled — no session yet. Tell the user instead
        // of leaving them stuck on this screen.
        Alert.alert(
          'Confirm your email',
          'We sent a confirmation link to ' + e + '. Tap it, then come back and sign in.'
        );
        setMode('signin');
      }
    }
    setLoading(false);
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={styles.inner} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.top}>
          <Text style={styles.wordmark}>pull up</Text>
          <Text style={styles.tagline}>Pick a place. Share your ETA. See who's almost there.</Text>
        </View>

        {appleAvailable && (
          <View style={styles.form}>
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={mode === 'signup'
                ? AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP
                : AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
              cornerRadius={RADIUS.button}
              style={styles.appleBtn}
              onPress={signInWithApple}
            />
            <Text style={styles.divider}>or use email</Text>
          </View>
        )}

        {/* Mode tabs */}
        <View style={styles.tabs}>
          {(['signin', 'signup'] as const).map((m) => (
            <TouchableOpacity
              key={m}
              style={[styles.tab, mode === m && styles.tabActive]}
              onPress={() => setMode(m)}
            >
              <Text style={[styles.tabText, mode === m && styles.tabTextActive]}>
                {m === 'signin' ? 'Sign in' : 'Create account'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Form */}
        <View style={styles.form}>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            placeholderTextColor={COLORS.textFaint}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
          />
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor={COLORS.textFaint}
            secureTextEntry
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          />
          <TouchableOpacity
            style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
            onPress={submit}
            disabled={loading}
            activeOpacity={0.85}
          >
            <Text style={styles.submitBtnText}>
              {loading ? '…' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </Text>
          </TouchableOpacity>
          {mode === 'signup' && (
            <Text style={styles.consent}>
              By creating an account you agree to our{' '}
              <Text style={styles.consentLink} onPress={() => Linking.openURL('https://asonkiya.github.io/pullup/privacy-policy')}>
                privacy policy
              </Text>.
            </Text>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.surface },
  inner: {
    flex: 1,
    paddingHorizontal: SPACING.xl,
    justifyContent: 'center',
    gap: SPACING.lg,
  },
  top: { gap: SPACING.sm },
  wordmark: {
    fontSize: 26,
    fontFamily: FONTS.extrabold,
    color: COLORS.primary,
    letterSpacing: -0.5,
    includeFontPadding: false,
  },
  tagline: {
    fontSize: FONT_SIZE.md,
    fontFamily: FONTS.regular,
    color: COLORS.textSecondary,
    lineHeight: 22,
    includeFontPadding: false,
  },
  tabs: { flexDirection: 'row', gap: SPACING.sm },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: RADIUS.input,
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
  tabActive: { backgroundColor: COLORS.primaryLight },
  tabText: { fontSize: FONT_SIZE.sm, fontFamily: FONTS.semibold, color: COLORS.textSecondary, includeFontPadding: false },
  tabTextActive: { color: COLORS.primary },
  form: { gap: SPACING.sm },
  input: {
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: RADIUS.input,
    paddingHorizontal: SPACING.md,
    paddingVertical: 14,
    fontSize: FONT_SIZE.md,
    fontFamily: FONTS.regular,
    color: COLORS.text,
    backgroundColor: COLORS.background,
    includeFontPadding: false,
  },
  submitBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.button,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: SPACING.xs,
    ...SHADOWS.button,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: '#fff', fontSize: FONT_SIZE.md, fontFamily: FONTS.semibold, includeFontPadding: false },
  appleBtn: { height: 52, width: '100%' },
  divider: { fontSize: FONT_SIZE.xs, fontFamily: FONTS.medium, color: COLORS.textFaint, textAlign: 'center', marginTop: SPACING.xs, includeFontPadding: false },
  consent: { fontSize: FONT_SIZE.xs, fontFamily: FONTS.regular, color: COLORS.textSecondary, textAlign: 'center', marginTop: SPACING.sm, includeFontPadding: false, lineHeight: 16 },
  consentLink: { color: COLORS.primary, fontFamily: FONTS.semibold },
});
