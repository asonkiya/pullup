import { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { COLORS, FONTS, FONT_SIZE, SPACING, RADIUS, VENUE_PROVIDER } from '@/constants';
import type { VenueProvider } from '@/types/database';

const GOOGLE_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';
const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '';
const MAPBOX_SEARCH_URL = 'https://api.mapbox.com/search/searchbox/v1';

export type PickedPlace = {
  place_id: string;
  provider: VenueProvider;
  name: string;
  lat: number;
  lng: number;
  address: string | null;
  maps_url: string | null;
};

type Suggestion = {
  id: string;
  text: string;
  secondary: string | null;
};

type Props = {
  placeholder?: string;
  bias?: { lat: number; lng: number } | null;
  value?: PickedPlace | null;
  onChange: (place: PickedPlace | null) => void;
};

export function PlacePicker({ placeholder = 'Search for a place…', bias, value, onChange }: Props) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionRef = useRef<string>(genId());

  useEffect(() => {
    if (value) return;
    if (!query.trim() || query.trim().length < 2) { setSuggestions([]); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSuggest(query), 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, value]);

  async function runSuggest(input: string) {
    setLoading(true);
    setError(null);
    try {
      const list = VENUE_PROVIDER === 'mapbox'
        ? await suggestMapbox(input)
        : await suggestGoogle(input);
      setSuggestions(list);
    } catch {
      setError('Could not search. Check your connection.');
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }

  // ── Google Places Autocomplete ──────────────────────────────────────────────
  async function suggestGoogle(input: string): Promise<Suggestion[]> {
    const body: Record<string, unknown> = { input, sessionToken: sessionRef.current };
    if (bias) {
      body.locationBias = { circle: { center: { latitude: bias.lat, longitude: bias.lng }, radius: 50000 } };
    }
    const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GOOGLE_API_KEY },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data.suggestions ?? [])
      .map((s: any) => s.placePrediction)
      .filter(Boolean)
      .map((p: any) => ({
        id: p.placeId,
        text: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
        secondary: p.structuredFormat?.secondaryText?.text ?? null,
      }));
  }

  // ── Mapbox Search Box suggest ───────────────────────────────────────────────
  async function suggestMapbox(input: string): Promise<Suggestion[]> {
    const params = new URLSearchParams({
      q: input,
      access_token: MAPBOX_TOKEN,
      session_token: sessionRef.current,
      limit: '5',
      language: 'en',
    });
    if (bias) params.set('proximity', `${bias.lng},${bias.lat}`);
    const res = await fetch(`${MAPBOX_SEARCH_URL}/suggest?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data.suggestions ?? []).map((s: any) => ({
      id: s.mapbox_id,
      text: s.name ?? s.place_formatted ?? '',
      secondary: s.place_formatted ?? null,
    }));
  }

  async function selectSuggestion(s: Suggestion) {
    setLoading(true);
    setError(null);
    try {
      const picked = VENUE_PROVIDER === 'mapbox'
        ? await retrieveMapbox(s)
        : await retrieveGoogle(s);
      setQuery('');
      setSuggestions([]);
      sessionRef.current = genId();
      onChange(picked);
    } catch {
      setError('Could not load place details.');
    } finally {
      setLoading(false);
    }
  }

  async function retrieveGoogle(s: Suggestion): Promise<PickedPlace> {
    const res = await fetch(
      `https://places.googleapis.com/v1/places/${s.id}?sessionToken=${sessionRef.current}`,
      {
        headers: {
          'X-Goog-Api-Key': GOOGLE_API_KEY,
          'X-Goog-FieldMask': 'id,displayName,location,shortFormattedAddress,googleMapsUri',
        },
      },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    return {
      place_id: d.id,
      provider: 'google',
      name: d.displayName?.text ?? s.text,
      lat: d.location?.latitude ?? 0,
      lng: d.location?.longitude ?? 0,
      address: d.shortFormattedAddress ?? s.secondary,
      maps_url: d.googleMapsUri ?? null,
    };
  }

  async function retrieveMapbox(s: Suggestion): Promise<PickedPlace> {
    const params = new URLSearchParams({
      access_token: MAPBOX_TOKEN,
      session_token: sessionRef.current,
    });
    const res = await fetch(`${MAPBOX_SEARCH_URL}/retrieve/${encodeURIComponent(s.id)}?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const feature = data.features?.[0];
    if (!feature) throw new Error('No feature returned');
    const { coordinates, name, full_address } = feature.properties;
    const lat: number = coordinates?.latitude ?? 0;
    const lng: number = coordinates?.longitude ?? 0;
    return {
      place_id: s.id,
      provider: 'mapbox',
      name: name ?? s.text,
      lat,
      lng,
      address: full_address ?? s.secondary,
      maps_url: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
    };
  }

  function clear() {
    setQuery('');
    setSuggestions([]);
    onChange(null);
  }

  if (value) {
    return (
      <View style={styles.selected}>
        <Feather name="map-pin" size={16} color={COLORS.primary} />
        <View style={{ flex: 1 }}>
          <Text style={styles.selectedName} numberOfLines={1}>{value.name}</Text>
          {value.address && <Text style={styles.selectedAddr} numberOfLines={1}>{value.address}</Text>}
        </View>
        <TouchableOpacity onPress={clear} hitSlop={10}>
          <Feather name="x" size={18} color={COLORS.textSecondary} />
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.inputRow}>
        <Feather name="search" size={16} color={COLORS.textSecondary} />
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder={placeholder}
          placeholderTextColor={COLORS.textFaint}
          autoCorrect={false}
          autoCapitalize="words"
        />
        {loading && <ActivityIndicator size="small" color={COLORS.primary} />}
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      {suggestions.length > 0 && (
        <View style={styles.predList}>
          {suggestions.map((s) => (
            <TouchableOpacity key={s.id} style={styles.predRow} onPress={() => selectSuggestion(s)} activeOpacity={0.7}>
              <Feather name="map-pin" size={14} color={COLORS.textFaint} />
              <View style={{ flex: 1 }}>
                <Text style={styles.predMain} numberOfLines={1}>{s.text}</Text>
                {s.secondary && <Text style={styles.predSub} numberOfLines={1}>{s.secondary}</Text>}
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

function genId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const styles = StyleSheet.create({
  wrap: { gap: SPACING.xs },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.background,
    borderRadius: RADIUS.button,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1.5,
    borderColor: COLORS.border,
  },
  input: {
    flex: 1,
    fontSize: FONT_SIZE.md,
    fontFamily: FONTS.regular,
    color: COLORS.text,
    includeFontPadding: false,
    padding: 0,
  },
  error: { fontSize: FONT_SIZE.sm, fontFamily: FONTS.regular, color: COLORS.error, includeFontPadding: false },
  predList: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.button,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  predRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  predMain: { fontSize: FONT_SIZE.md, fontFamily: FONTS.semibold, color: COLORS.text, includeFontPadding: false },
  predSub:  { fontSize: FONT_SIZE.sm, fontFamily: FONTS.regular,  color: COLORS.textSecondary, includeFontPadding: false },
  selected: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.primaryLight,
    borderRadius: RADIUS.button,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  selectedName: { fontSize: FONT_SIZE.md, fontFamily: FONTS.bold, color: COLORS.text, includeFontPadding: false },
  selectedAddr: { fontSize: FONT_SIZE.sm, fontFamily: FONTS.regular, color: COLORS.textSecondary, includeFontPadding: false },
});
