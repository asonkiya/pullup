-- ETA caching: remember the origin each snapshot was computed from so
-- compute-eta can skip routing calls when the sharer hasn't moved.
alter table public.eta_snapshots
  add column if not exists origin_lat double precision,
  add column if not exists origin_lng double precision;

-- Area cache for venue searches: identical searches (same ~1km cell, vibe,
-- travel mode, provider) within the TTL reuse stored results instead of
-- calling the Places API again. Written and read only by edge functions via
-- the service role.
create table if not exists public.venue_search_cache (
  cache_key text primary key,
  provider text not null,
  results jsonb not null,
  created_at timestamptz not null default now()
);

-- Service-role only: RLS on with no policies denies anon/authenticated.
alter table public.venue_search_cache enable row level security;
