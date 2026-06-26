import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GOOGLE_MAPS_API_KEY = Deno.env.get('GOOGLE_MAPS_API_KEY')!;
const MAPBOX_TOKEN = Deno.env.get('MAPBOX_SECRET_TOKEN')!;

type Provider = 'google' | 'mapbox';
type Origin = { user_id: string; lat: number; lng: number };
type EtaResult = { user_id: string; duration_seconds: number | null; distance_meters: number | null };

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
    .select('selected_place_id, selected_place_lat, selected_place_lng, travel_mode_default')
    .eq('id', plan_id)
    .single();

  if (planError || !plan) return new Response('Plan not found', { status: 404 });
  if (!plan.selected_place_id) {
    return new Response(JSON.stringify({ computed: 0, reason: 'no destination set' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Destination coordinates: prefer coords stored on the plan; fall back to the
  // venue candidate by place_id, then by the latest selection event (stable id).
  let venue: { lat: number; lng: number } | null =
    plan.selected_place_lat != null && plan.selected_place_lng != null
      ? { lat: plan.selected_place_lat, lng: plan.selected_place_lng }
      : null;

  if (!venue) {
    const { data: byPlace } = await adminClient
      .from('venue_candidates')
      .select('lat, lng')
      .eq('plan_id', plan_id)
      .eq('place_id', plan.selected_place_id)
      .maybeSingle();
    venue = byPlace ?? null;
  }

  if (!venue) {
    const { data: sel } = await adminClient
      .from('venue_selection_events')
      .select('venue_candidate_id')
      .eq('plan_id', plan_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (sel?.venue_candidate_id) {
      const { data: byId } = await adminClient
        .from('venue_candidates')
        .select('lat, lng')
        .eq('id', sel.venue_candidate_id)
        .maybeSingle();
      venue = byId ?? null;
    }
  }

  if (!venue) {
    return new Response(JSON.stringify({ computed: 0, reason: 'destination venue not found' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Active location share sessions
  const { data: sessions } = await adminClient
    .from('location_share_sessions')
    .select('id, user_id')
    .eq('plan_id', plan_id)
    .eq('status', 'active');

  if (!sessions || sessions.length === 0) {
    return new Response(JSON.stringify({ computed: 0 }), { headers: { 'Content-Type': 'application/json' } });
  }

  // Latest location point per session
  const origins: Origin[] = [];
  for (const session of sessions) {
    const { data: point } = await adminClient
      .from('location_points')
      .select('lat, lng, user_id')
      .eq('session_id', session.id)
      .order('captured_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (point) origins.push({ user_id: session.user_id, lat: point.lat, lng: point.lng });
  }

  if (origins.length === 0) {
    return new Response(JSON.stringify({ computed: 0 }), { headers: { 'Content-Type': 'application/json' } });
  }

  let results: EtaResult[];
  try {
    results = provider === 'mapbox'
      ? await routeMapbox(origins, venue.lat, venue.lng, plan.travel_mode_default)
      : await routeGoogle(origins, venue.lat, venue.lng, plan.travel_mode_default);
  } catch (e) {
    return new Response(`${provider} routing error: ${e instanceof Error ? e.message : 'unknown'}`, { status: 502 });
  }

  const now = new Date().toISOString();
  const snapshots = results.map((r) => ({
    plan_id,
    user_id: r.user_id,
    destination_place_id: plan.selected_place_id,
    duration_seconds: r.duration_seconds,
    distance_meters: r.distance_meters,
    status: 'ok',
    mode: plan.travel_mode_default,
    computed_at: now,
  }));

  if (snapshots.length > 0) {
    await adminClient.from('eta_snapshots').upsert(snapshots, { onConflict: 'plan_id,user_id' });
  }

  await adminClient.channel(`eta-${plan_id}`).send({
    type: 'broadcast',
    event: 'eta_updated',
    payload: { plan_id },
  });

  return new Response(JSON.stringify({ computed: snapshots.length, provider }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

// ── Google Routes — Compute Route Matrix (origins → destination) ─────────────────
async function routeGoogle(origins: Origin[], destLat: number, destLng: number, travel: string): Promise<EtaResult[]> {
  const travelMode = travel === 'walk' ? 'WALK' : 'DRIVE';
  const res = await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
      'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,status',
    },
    body: JSON.stringify({
      origins: origins.map((o) => ({ waypoint: { location: { latLng: { latitude: o.lat, longitude: o.lng } } } })),
      destinations: [{ waypoint: { location: { latLng: { latitude: destLat, longitude: destLng } } } }],
      travelMode,
      routingPreference: travelMode === 'DRIVE' ? 'TRAFFIC_AWARE' : 'ROUTING_PREFERENCE_UNSPECIFIED',
    }),
  });

  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  const elements: Array<Record<string, unknown>> = Array.isArray(data) ? data : [];

  const results: EtaResult[] = [];
  for (const el of elements) {
    const status = el.status as { code?: number } | null;
    if (status?.code != null && status.code !== 0) continue;
    const origin = origins[el.originIndex as number];
    if (!origin) continue;
    const durationSec = typeof el.duration === 'string' ? parseInt(el.duration as string) : null;
    results.push({
      user_id: origin.user_id,
      duration_seconds: durationSec != null && !isNaN(durationSec) ? durationSec : null,
      distance_meters: typeof el.distanceMeters === 'number' ? el.distanceMeters : null,
    });
  }
  return results;
}

// ── Mapbox Directions — one call per origin ──────────────────────────────────────
async function routeMapbox(origins: Origin[], destLat: number, destLng: number, travel: string): Promise<EtaResult[]> {
  const profile = travel === 'walk' ? 'walking' : 'driving-traffic';
  const results: EtaResult[] = [];

  await Promise.all(origins.map(async (origin) => {
    try {
      const coords = `${origin.lng},${origin.lat};${destLng},${destLat}`;
      const params = new URLSearchParams({ access_token: MAPBOX_TOKEN, overview: 'false', steps: 'false' });
      const res = await fetch(`https://api.mapbox.com/directions/v5/mapbox/${profile}/${coords}?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      const route = data.routes?.[0];
      if (!route) return;
      results.push({
        user_id: origin.user_id,
        duration_seconds: Math.round(route.duration as number),
        distance_meters: Math.round(route.distance as number),
      });
    } catch {
      // graceful degradation
    }
  }));

  return results;
}
