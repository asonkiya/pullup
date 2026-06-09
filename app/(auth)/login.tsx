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
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { COLORS, SPACING, FONT_SIZE } from '@/constants';

export default function LoginScreen() {
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function sendOtp() {
    const normalized = phone.trim().replace(/\s/g, '');
    if (!normalized.startsWith('+')) {
      Alert.alert('Enter your phone number starting with country code, e.g. +1');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({ phone: normalized });
    setLoading(false);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    router.push({ pathname: '/(auth)/verify', params: { phone: normalized } });
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
        <View style={styles.form}>
          <Text style={styles.label}>Phone number</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="+1 555 000 0000"
            keyboardType="phone-pad"
            autoComplete="tel"
            autoFocus
          />
          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={sendOtp}
            disabled={loading}
          >
            <Text style={styles.buttonText}>
              {loading ? 'Sending...' : 'Continue'}
            </Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.legal}>
          By continuing, you agree to our Terms and Privacy Policy. Location is
          only shared when you explicitly choose, for a specific plan only.
        </Text>
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
  form: { gap: SPACING.sm, marginTop: SPACING.md },
  label: { fontSize: FONT_SIZE.sm, fontWeight: '600', color: COLORS.text },
  input: {
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: SPACING.md,
    paddingVertical: 14,
    fontSize: FONT_SIZE.lg,
    color: COLORS.text,
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
  legal: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 16,
  },
});
