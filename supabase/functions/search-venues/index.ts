import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GOOGLE_MAPS_API_KEY = Deno.env.get('GOOGLE_MAPS_API_KEY')!;
const MAPBOX_TOKEN = Deno.env.get('MAPBOX_SECRET_TOKEN')!;

type Provider = 'google' | 'mapbox';

type VenueRow = {
  plan_id: string;
  place_id: string;
  provider: Provider;
  name: string;
  lat: number;
  lng: number;
  rating: number | null;
  user_rating_count: number | null;
  price_level: number | null;
  category: string | null;
  source: string;
  eta_seconds: number | null;
  photo_urls: string[] | null;
  address: string | null;
  website_url: string | null;
  maps_url: string | null;
  is_open: boolean | null;
};

// ── Google taxonomy ────────────────────────────────────────────────────────────
const GOOGLE_VIBE_TYPES: Record<string, string[]> = {
  Food: ['restaurant'],
  Drinks: ['bar'],
  Coffee: ['cafe'],
  Movie: ['movie_theater'],
  Gaming: ['amusement_center', 'bowling_alley'],
  Active: ['gym', 'sports_club'],
  Party: ['night_club', 'bar'],
};
const GOOGLE_FALLBACK_TYPES = ['restaurant', 'bar', 'cafe'];

const PRICE_LEVEL_MAP: Record<string, number | null> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
  PRICE_LEVEL_UNSPECIFIED: null,
};

// ── Mapbox taxonomy ─────────────────────────────────────────────────────────────
const MAPBOX_VIBE_CATEGORIES: Record<string, string[]> = {
  Food: ['restaurant'],
  Drinks: ['bar'],
  Coffee: ['cafe'],
  Movie: ['cinema'],
  Gaming: ['bowling_alley'],
  Active: ['gym'],
  Party: ['nightclub'],
};
const MAPBOX_FALLBACK_CATEGORIES = ['restaurant', 'bar', 'cafe'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' } });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response('Unauthorized', { status: 401 });

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return new Response('Unauthorized', { status: 401 });

  let plan_id: string;
  let provider: Provider = 'google';
  try {
    const body = await req.json();
    plan_id = body.plan_id;
    if (body.provider === 'mapbox' || body.provider === 'google') provider = body.provider;
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: plan, error: planError } = await adminClient
    .from('plans')
    .select('anchor_lat, anchor_lng, vibe, travel_mode_default')
    .eq('id', plan_id)
    .single();

  if (planError || !plan) return new Response('Plan not found', { status: 404 });

  const { anchor_lat, anchor_lng, vibe, travel_mode_default } = plan;
  if (anchor_lat == null || anchor_lng == null) {
    return new Response(JSON.stringify({ inserted: 0, reason: 'no anchor set' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let rows: VenueRow[];
  try {
    rows = provider === 'mapbox'
      ? await searchMapbox(plan_id, anchor_lat, anchor_lng, vibe, travel_mode_default)
      : await searchGoogle(plan_id, anchor_lat, anchor_lng, vibe, travel_mode_default);
  } catch (e) {
    return new Response(`${provider} search error: ${e instanceof Error ? e.message : 'unknown'}`, { status: 502 });
  }

  if (rows.length === 0) {
    return new Response(JSON.stringify({ inserted: 0 }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  rows.sort((a, b) => {
    if (a.eta_seconds == null && b.eta_seconds == null) return 0;
    if (a.eta_seconds == null) return 1;
    if (b.eta_seconds == null) return -1;
    return a.eta_seconds - b.eta_seconds;
  });

  const { data, error: upsertError } = await adminClient
    .from('venue_candidates')
    .upsert(rows, { onConflict: 'plan_id,place_id' })
    .select('id');

  if (upsertError) {
    return new Response(`DB error: ${upsertError.message}`, { status: 500 });
  }

  return new Response(JSON.stringify({ inserted: data?.length ?? 0, provider }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

// ── Google Places Nearby + Routes + photos ──────────────────────────────────────
async function searchGoogle(
  plan_id: string,
  anchor_lat: number,
  anchor_lng: number,
  vibe: string | null,
  travel_mode_default: string,
): Promise<VenueRow[]> {
  const includedTypes = (vibe && GOOGLE_VIBE_TYPES[vibe]) ?? GOOGLE_FALLBACK_TYPES;

  const placesRes = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.rating,places.userRatingCount,places.priceLevel,places.primaryTypeDisplayName,places.photos,places.shortFormattedAddress,places.websiteUri,places.googleMapsUri,places.currentOpeningHours',
    },
    body: JSON.stringify({
      includedTypes,
      maxResultCount: 20,
      locationRestriction: {
        circle: { center: { latitude: anchor_lat, longitude: anchor_lng }, radius: 2000.0 },
      },
    }),
  });

  if (!placesRes.ok) throw new Error(await placesRes.text());
  const placesData = await placesRes.json();
  const places: Array<Record<string, unknown>> = placesData.places ?? [];
  if (places.length === 0) return [];

  // Routes API — Compute Route Matrix anchor → each venue
  const travelMode = travel_mode_default === 'walk' ? 'WALK' : 'DRIVE';
  const routesRes = await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
      'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,status',
    },
    body: JSON.stringify({
      origins: [{ waypoint: { location: { latLng: { latitude: anchor_lat, longitude: anchor_lng } } } }],
      destinations: places.map((p) => ({
        waypoint: {
          location: {
            latLng: {
              latitude: (p.location as { latitude: number }).latitude,
              longitude: (p.location as { longitude: number }).longitude,
            },
          },
        },
      })),
      travelMode,
      routingPreference: travelMode === 'DRIVE' ? 'TRAFFIC_AWARE' : undefined,
    }),
  });

  const etaMap = new Map<number, number>();
  if (routesRes.ok) {
    const routesData: Array<{ destinationIndex: number; duration?: string; status?: { code: number } }> = await routesRes.json();
    for (const el of routesData) {
      if (el.duration && (!el.status || el.status.code === 0)) {
        etaMap.set(el.destinationIndex, parseInt(el.duration));
      }
    }
  }

  return places.map((place, i) => {
    const photos = place.photos as Array<{ name: string }> | undefined;
    const photoUrls = photos
      ?.slice(0, 5)
      .map((p) => `https://places.googleapis.com/v1/${p.name}/media?maxHeightPx=800&key=${GOOGLE_MAPS_API_KEY}`)
      ?? null;
    const openingHours = place.currentOpeningHours as { openNow?: boolean } | undefined;

    return {
      plan_id,
      place_id: place.id as string,
      provider: 'google',
      name: (place.displayName as { text: string })?.text ?? 'Unknown',
      lat: (place.location as { latitude: number })?.latitude,
      lng: (place.location as { longitude: number })?.longitude,
      rating: typeof place.rating === 'number' ? place.rating : null,
      user_rating_count: typeof place.userRatingCount === 'number' ? place.userRatingCount : null,
      price_level: PRICE_LEVEL_MAP[place.priceLevel as string] ?? null,
      category: (place.primaryTypeDisplayName as { text: string } | null)?.text ?? null,
      source: 'nearby_search',
      eta_seconds: etaMap.get(i) ?? null,
      photo_urls: photoUrls,
      address: (place.shortFormattedAddress as string) ?? null,
      website_url: (place.websiteUri as string) ?? null,
      maps_url: (place.googleMapsUri as string) ?? null,
      is_open: openingHours?.openNow ?? null,
    };
  });
}

// ── Mapbox Category Search + Directions ──────────────────────────────────────────
async function searchMapbox(
  plan_id: string,
  anchor_lat: number,
  anchor_lng: number,
  vibe: string | null,
  travel_mode_default: string,
): Promise<VenueRow[]> {
  const categories = (vibe && MAPBOX_VIBE_CATEGORIES[vibe]) ?? MAPBOX_FALLBACK_CATEGORIES;

  const seen = new Set<string>();
  const places: Array<{ place_id: string; name: string; lat: number; lng: number; category: string | null; address: string | null }> = [];

  for (const category of categories) {
    const params = new URLSearchParams({
      access_token: MAPBOX_TOKEN,
      proximity: `${anchor_lng},${anchor_lat}`,
      limit: '20',
      language: 'en',
    });
    const res = await fetch(`https://api.mapbox.com/search/searchbox/v1/category/${category}?${params}`);
    if (!res.ok) continue;
    const data = await res.json();
    for (const feature of data.features ?? []) {
      const id: string = feature.properties?.mapbox_id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      places.push({
        place_id: id,
        name: feature.properties?.name ?? 'Unknown',
        lat: feature.geometry?.coordinates?.[1] ?? 0,
        lng: feature.geometry?.coordinates?.[0] ?? 0,
        category: feature.properties?.poi_category?.[0] ?? category,
        address: feature.properties?.full_address ?? feature.properties?.address ?? null,
      });
    }
    if (places.length >= 20) break;
  }

  if (places.length === 0) return [];

  const profile = travel_mode_default === 'walk' ? 'walking' : 'driving-traffic';
  const etaMap = new Map<string, number>();
  await Promise.all(places.map(async (place) => {
    try {
      const coords = `${anchor_lng},${anchor_lat};${place.lng},${place.lat}`;
      const params = new URLSearchParams({ access_token: MAPBOX_TOKEN, overview: 'false', steps: 'false' });
      const res = await fetch(`https://api.mapbox.com/directions/v5/mapbox/${profile}/${coords}?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      const duration = data.routes?.[0]?.duration as number | undefined;
      if (duration != null) etaMap.set(place.place_id, Math.round(duration));
    } catch {
      // graceful degradation
    }
  }));

  return places.map((place) => ({
    plan_id,
    place_id: place.place_id,
    provider: 'mapbox',
    name: place.name,
    lat: place.lat,
    lng: place.lng,
    rating: null,
    user_rating_count: null,
    price_level: null,
    category: place.category,
    source: 'nearby_search',
    eta_seconds: etaMap.get(place.place_id) ?? null,
    photo_urls: null,
    address: place.address,
    website_url: null,
    maps_url: `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`,
    is_open: null,
  }));
}
