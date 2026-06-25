-- Rename google_place_id → mapbox_id in venue_candidates
alter table public.venue_candidates
  rename column google_place_id to mapbox_id;

-- Rename the unique constraint for clarity
alter table public.venue_candidates
  rename constraint venue_candidates_plan_id_google_place_id_key
  to venue_candidates_plan_id_mapbox_id_key;
