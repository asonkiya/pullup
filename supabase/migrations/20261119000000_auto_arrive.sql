-- Arriving ends the trip.
--
-- While someone shares their location for a plan, every fix they upload is
-- checked against the plan's spot. Once they have been within 30 m of it for
-- 2 minutes, the server marks them arrived, stops their sharing and tells the
-- crew. Nobody has to remember to tap "I've arrived" or "Stop".
--
-- A fix is a circle, not a point: the phone reports how far off it may be
-- (accuracy_m). With d = distance from the fix to the spot and a = accuracy:
--
--   at the spot   d - a <= 30 and a <= 30   could be inside, and precise enough to trust
--   away          d - a >  30               outside even at the edge of its error
--   unclear       anything else             a vague fix, typical indoors: changes nothing
--
-- The first "at the spot" fix starts a clock on the session (near_since); an
-- "away" fix clears it. Two minutes on the clock means arrived, so driving
-- past or sitting at a light outside doesn't count. A phone that has stopped
-- moving sends no more fixes, so a per-minute sweep finishes the job.
--
-- It runs in the database, on the location_points insert the app already
-- makes, so it also works in the background, where the app can't show
-- anything.
--
-- Tapping "I've arrived" by hand stops sharing the same way.

alter table public.location_share_sessions add column near_since timestamptz;

-- 1. Stop one person's sharing for one plan.
create or replace function public.end_share(p_plan_id uuid, p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.location_share_sessions
  set status = 'stopped', stopped_at = now()
  where plan_id = p_plan_id and user_id = p_user_id and status = 'active';

  -- Same as the app does on Stop: no frozen ETA left on the crew's screens.
  update public.eta_snapshots
  set status = 'stopped', duration_seconds = null, distance_meters = null
  where plan_id = p_plan_id and user_id = p_user_id and status = 'ok';
$$;

revoke execute on function public.end_share(uuid, uuid) from public, anon, authenticated;

-- 2. Mark someone arrived: status, pushes, sharing off.
create or replace function public.mark_arrived(p_plan_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan record;
  v_name text;
begin
  update public.plan_members
  set departure_status = 'arrived'
  where plan_id = p_plan_id and user_id = p_user_id and departure_status <> 'arrived';

  if found then
    select p.title, p.selected_place_name as place,
           coalesce(p.arrival_time, p.scheduled_for, p.created_at) as at
    into v_plan from public.plans p where p.id = p_plan_id;
    select u.display_name into v_name from public.users u where u.id = p_user_id;

    -- Tell the crew, and tell the person their sharing is off (they may have
    -- the app in the background). The kind carries who arrived, so two people
    -- arriving are two pushes.
    insert into public.plan_pushes (plan_id, user_id, kind, plan_time, title, body, route)
    select p_plan_id, pm.user_id, 'arrived:' || p_user_id, v_plan.at, v_plan.title,
           case when pm.user_id = p_user_id
             then 'You''re here. Location sharing is off.'
             else coalesce(v_name, 'Someone') || ' is here' || coalesce(' at ' || v_plan.place, '') || '.'
           end,
           '/plan/' || p_plan_id
    from public.plan_members pm
    where pm.plan_id = p_plan_id
      and (pm.user_id = p_user_id or pm.rsvp_status <> 'not_going')
    on conflict do nothing;

    -- Send now instead of waiting for the 5-minute tick.
    perform net.http_post(
      url := 'https://ciucouvnqetkjvniofba.supabase.co/functions/v1/send-plan-pushes',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb
    );
  end if;

  -- The members trigger below stops sharing when the status flips; this also
  -- covers someone already marked arrived who started sharing again.
  perform public.end_share(p_plan_id, p_user_id);
end;
$$;

revoke execute on function public.mark_arrived(uuid, uuid) from public, anon, authenticated;

-- 3. Each uploaded fix moves the session's clock.
create or replace function public.auto_arrive_on_point()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v       record;
  v_dist  double precision;
  v_acc   double precision := coalesce(new.accuracy_m, 0);
begin
  select p.id as plan_id, s.near_since,
         p.selected_place_lat as lat, p.selected_place_lng as lng
  into v
  from public.location_share_sessions s
  join public.plans p on p.id = s.plan_id
  where s.id = new.session_id
    and s.user_id = new.user_id
    and s.status = 'active'
    and p.state in ('venue_locked', 'active')
    and p.selected_place_lat is not null
    and p.selected_place_lng is not null
    -- Being near the spot long before the plan (it's next to work, say)
    -- isn't arriving.
    and (coalesce(p.arrival_time, p.scheduled_for) is null
         or now() >= coalesce(p.arrival_time, p.scheduled_for) - interval '3 hours');
  if not found then
    return new;
  end if;

  -- Haversine distance in metres.
  v_dist := 2 * 6371000 * asin(least(1, sqrt(
    power(sin(radians(v.lat - new.lat) / 2), 2)
    + cos(radians(new.lat)) * cos(radians(v.lat))
      * power(sin(radians(v.lng - new.lng) / 2), 2)
  )));

  if v_dist - v_acc > 30 then
    -- Away.
    if v.near_since is not null then
      update public.location_share_sessions set near_since = null where id = new.session_id;
    end if;
  elsif v_acc <= 30 then
    -- At the spot.
    if v.near_since is null then
      update public.location_share_sessions set near_since = now() where id = new.session_id;
    elsif v.near_since <= now() - interval '2 minutes' then
      perform public.mark_arrived(v.plan_id, new.user_id);
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.auto_arrive_on_point() from public, anon, authenticated;

create trigger location_points_auto_arrive
  after insert on public.location_points
  for each row execute function public.auto_arrive_on_point();

-- 4. Someone standing still sends no more fixes, so finish their clock here.
create or replace function public.arrive_due_sharers()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select s.plan_id, s.user_id
    from public.location_share_sessions s
    join public.plans p on p.id = s.plan_id
    where s.status = 'active'
      and s.expires_at > now()
      and s.near_since <= now() - interval '2 minutes'
      and p.state in ('venue_locked', 'active')
  loop
    perform public.mark_arrived(r.plan_id, r.user_id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke execute on function public.arrive_due_sharers() from public, anon, authenticated;

create index location_share_sessions_near_idx on public.location_share_sessions (near_since)
  where status = 'active' and near_since is not null;

select cron.schedule('arrive-due-sharers', '* * * * *', $$select public.arrive_due_sharers()$$);

-- 5. "I've arrived", tapped or automatic, stops sharing.
create or replace function public.stop_sharing_on_arrival()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.end_share(new.plan_id, new.user_id);
  return new;
end;
$$;

revoke execute on function public.stop_sharing_on_arrival() from public, anon, authenticated;

create trigger plan_members_stop_sharing_on_arrival
  after update of departure_status on public.plan_members
  for each row
  when (new.departure_status = 'arrived' and old.departure_status is distinct from new.departure_status)
  execute function public.stop_sharing_on_arrival();

-- 6. The app listens for changes to its own share sessions so it can stop the
--    GPS when the server ends one. The table was never in the publication, so
--    that listener heard nothing.
alter publication supabase_realtime add table public.location_share_sessions;
