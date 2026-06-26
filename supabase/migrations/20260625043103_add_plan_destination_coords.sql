-- Store the locked destination's coordinates directly on the plan so the live
-- map / ETA screens don't depend on a fragile join into venue_candidates.
alter table public.plans
  add column selected_place_lat double precision,
  add column selected_place_lng double precision;

-- Backfill from the currently selected venue candidate where possible.
update public.plans p
set selected_place_lat = vc.lat,
    selected_place_lng = vc.lng
from public.venue_candidates vc
where vc.plan_id = p.id
  and vc.place_id = p.selected_place_id
  and p.selected_place_id is not null;
