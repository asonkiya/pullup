-- "ETA only" sharing: the crew sees how far away you are, not where you are.

alter table public.location_share_sessions
  add column eta_only boolean not null default false;

-- Co-members see your raw points only when you share your location. Your own
-- points stay visible to you either way.
drop policy "lp_select_co_member" on public.location_points;
create policy "lp_select_co_member" on public.location_points for select to authenticated
  using (
    location_points.user_id = (select auth.uid())
    or exists (
      select 1 from public.location_share_sessions s
      where s.id = location_points.session_id
        and s.status = 'active'
        and not s.eta_only
        and s.plan_id in (select public.my_plan_ids())
    )
  );

-- eta_snapshots is readable by (and realtime-broadcast to) the whole crew, so
-- it can't carry coordinates. compute-eta only needs the routing origin to
-- decide whether a cached ETA is stale; keep it in a server-only table.
create table public.eta_origins (
  plan_id    uuid not null references public.plans(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  lat        double precision not null,
  lng        double precision not null,
  updated_at timestamptz not null default now(),
  primary key (plan_id, user_id)
);
create index on public.eta_origins (user_id);
-- RLS on with no policies: only the service role (edge functions) can touch it.
alter table public.eta_origins enable row level security;

insert into public.eta_origins (plan_id, user_id, lat, lng, updated_at)
select plan_id, user_id, origin_lat, origin_lng, computed_at
from public.eta_snapshots
where origin_lat is not null and origin_lng is not null;

alter table public.eta_snapshots drop column origin_lat, drop column origin_lng;
