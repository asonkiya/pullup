import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { COLORS, SPACING, FONT_SIZE } from '@/constants';

const VIBES = ['Food', 'Drinks', 'Party', 'Movie', 'Coffee', 'Gaming', 'Active'];

export default function EditPlanScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [vibe, setVibe] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: plan } = await supabase
        .from('plans')
        .select('title, vibe, scheduled_for')
        .eq('id', id!)
        .single();
      if (plan) {
        setTitle(plan.title);
        setVibe(plan.vibe ?? '');
        if (plan.scheduled_for) {
          const d = new Date(plan.scheduled_for);
          setDate(d.toISOString().slice(0, 10));
          setTime(d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }));
        }
      }
      setLoading(false);
    })();
  }, [id]);

  async function save() {
    if (!title.trim()) {
      Alert.alert('Plan needs a name');
      return;
    }
    setSaving(true);

    let scheduledFor: string | null = null;
    if (date && time) {
      const parsed = new Date(`${date}T${time}`);
      if (isNaN(parsed.getTime())) {
        Alert.alert('Invalid date/time', 'Use YYYY-MM-DD and HH:MM formats.');
        setSaving(false);
        return;
      }
      scheduledFor = parsed.toISOString();
    }

    const { error } = await supabase
      .from('plans')
      .update({
        title: title.trim(),
        vibe: vibe || null,
        scheduled_for: scheduledFor,
      })
      .eq('id', id!);

    setSaving(false);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    router.back();
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator style={{ flex: 1 }} color={COLORS.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.cancel}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Edit plan</Text>
          <TouchableOpacity onPress={save} disabled={saving || !title.trim()}>
            <Text style={[styles.saveText, (!title.trim() || saving) && styles.saveDisabled]}>
              {saving ? 'Saving...' : 'Save'}
            </Text>
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          <Text style={styles.fieldLabel}>What are you doing?</Text>
          <TextInput
            style={styles.titleInput}
            value={title}
            onChangeText={setTitle}
            placeholder="Dinner, pre-game, coffee run..."
            placeholderTextColor={COLORS.textSecondary}
            maxLength={80}
            autoFocus
          />
          <Text style={styles.fieldLabel}>Vibe</Text>
          <View style={styles.vibes}>
            {VIBES.map((v) => (
              <TouchableOpacity
                key={v}
                style={[styles.chip, vibe === v && styles.chipSelected]}
                onPress={() => setVibe(vibe === v ? '' : v)}
              >
                <Text style={[styles.chipText, vibe === v && styles.chipTextSelected]}>{v}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.fieldLabel}>When? (optional)</Text>
          <View style={styles.row}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={date}
              onChangeText={setDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={COLORS.textSecondary}
              keyboardType="numbers-and-punctuation"
            />
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={time}
              onChangeText={setTime}
              placeholder="HH:MM"
              placeholderTextColor={COLORS.textSecondary}
              keyboardType="numbers-and-punctuation"
            />
          </View>
          {(date || time) && (
            <TouchableOpacity onPress={() => { setDate(''); setTime(''); }}>
              <Text style={styles.clearDate}>Clear date & time</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  cancel: { fontSize: FONT_SIZE.md, color: COLORS.textSecondary },
  headerTitle: { fontSize: FONT_SIZE.md, fontWeight: '600', color: COLORS.text },
  saveText: { fontSize: FONT_SIZE.md, fontWeight: '700', color: COLORS.primary },
  saveDisabled: { opacity: 0.4 },
  form: { padding: SPACING.lg, gap: SPACING.sm },
  fieldLabel: { fontSize: FONT_SIZE.sm, fontWeight: '600', color: COLORS.text, marginTop: SPACING.md },
  titleInput: {
    fontSize: FONT_SIZE.xl,
    fontWeight: '600',
    color: COLORS.text,
    borderBottomWidth: 1.5,
    borderBottomColor: COLORS.border,
    paddingVertical: SPACING.sm,
  },
  input: {
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: SPACING.md,
    paddingVertical: 12,
    fontSize: FONT_SIZE.md,
    color: COLORS.text,
  },
  row: { flexDirection: 'row', gap: SPACING.sm },
  vibes: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  chip: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  chipSelected: { backgroundColor: COLORS.primaryLight, borderColor: COLORS.primary },
  chipText: { fontSize: FONT_SIZE.sm, color: COLORS.textSecondary, fontWeight: '500' },
  chipTextSelected: { color: COLORS.primary, fontWeight: '600' },
  clearDate: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.error,
    fontWeight: '600',
    marginTop: SPACING.xs,
  },
});
