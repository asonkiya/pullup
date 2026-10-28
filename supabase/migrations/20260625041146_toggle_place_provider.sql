-- Make venue_candidates provider-agnostic so we can toggle between Google and Mapbox.

-- Rename mapbox_id -> place_id (opaque per-provider place identifier)
alter table public.venue_candidates
  rename column mapbox_id to place_id;

alter table public.venue_candidates
  rename constraint venue_candidates_plan_id_mapbox_id_key
  to venue_candidates_plan_id_place_id_key;

-- Track which provider produced each candidate
alter table public.venue_candidates
  add column provider text not null default 'google';
