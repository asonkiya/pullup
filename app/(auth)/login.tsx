import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { supabase } from '@/lib/supabase';
import { COLORS, SPACING, FONT_SIZE } from '@/constants';

export default function LoginScreen() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('dev@hangout.com');
  const [password, setPassword] = useState('password123');
  const [loading, setLoading] = useState(false);

  async function submit() {
    const e = email.trim().toLowerCase();
    if (!e || !password) {
      Alert.alert('Enter your email and password');
      return;
    }
    setLoading(true);
    if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email: e, password });
      if (error) Alert.alert('Sign in failed', error.message);
    } else {
      const { error } = await supabase.auth.signUp({ email: e, password });
      if (error) Alert.alert('Sign up failed', error.message);
      // _layout.tsx session listener handles redirect on success
    }
    setLoading(false);
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <Text style={styles.wordmark}>hangout</Text>
        <Text style={styles.tagline}>
          Pick a place. Share ETA for this plan only. See who's almost there.
        </Text>

        <View style={styles.tabs}>
          <TouchableOpacity
            style={[styles.tab, mode === 'signin' && styles.tabActive]}
            onPress={() => setMode('signin')}
          >
            <Text style={[styles.tabText, mode === 'signin' && styles.tabTextActive]}>Sign in</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, mode === 'signup' && styles.tabActive]}
            onPress={() => setMode('signup')}
          >
            <Text style={[styles.tabText, mode === 'signup' && styles.tabTextActive]}>Create account</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
          />
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            secureTextEntry
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          />
          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={submit}
            disabled={loading}
          >
            <Text style={styles.buttonText}>
              {loading ? '...' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
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
  wordmark: {
    fontSize: FONT_SIZE.display,
    fontWeight: '700',
    color: COLORS.primary,
    letterSpacing: -1,
  },
  tagline: { fontSize: FONT_SIZE.md, color: COLORS.textSecondary, lineHeight: 22 },
  tabs: { flexDirection: 'row', gap: SPACING.sm },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
  tabActive: { backgroundColor: COLORS.primaryLight },
  tabText: { fontSize: FONT_SIZE.sm, fontWeight: '600', color: COLORS.textSecondary },
  tabTextActive: { color: COLORS.primary },
  form: { gap: SPACING.sm },
  input: {
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: SPACING.md,
    paddingVertical: 14,
    fontSize: FONT_SIZE.md,
    color: COLORS.text,
    backgroundColor: COLORS.background,
  },
  button: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: SPACING.xs,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: FONT_SIZE.md, fontWeight: '600' },
});
