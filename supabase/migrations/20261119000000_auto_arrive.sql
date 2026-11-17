-- Arriving ends the trip.
--
-- While someone shares their location for a plan, every fix they upload is
-- checked against the plan's spot. Within 100 m, the server marks them
-- arrived, stops their sharing and tells the crew. Nobody has to remember to
-- tap "I've arrived" or "Stop".
--
-- It runs in the database, on the location_points insert the app already
-- makes, so it works for every build (including in the background, where the
-- app can't show anything) without an app update.
--
-- Tapping "I've arrived" by hand stops sharing the same way.

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

-- 2. Each uploaded fix: close enough to the spot means arrived.
create or replace function public.auto_arrive_on_point()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan   record;
  v_dist   double precision;
  v_name   text;
begin
  -- A fix this vague could be a block away.
  if new.accuracy_m is not null and new.accuracy_m > 100 then
    return new;
  end if;

  select p.id, p.title, p.selected_place_name as place,
         p.selected_place_lat as lat, p.selected_place_lng as lng,
         coalesce(p.arrival_time, p.scheduled_for) as at, p.created_at
  into v_plan
  from public.location_share_sessions s
  join public.plans p on p.id = s.plan_id
  where s.id = new.session_id
    and s.user_id = new.user_id
    and s.status = 'active'
    and p.state in ('venue_locked', 'active')
    and p.selected_place_lat is not null
    and p.selected_place_lng is not null;
  if not found then
    return new;
  end if;

  -- Being near the spot long before the plan (it's next to work, say) isn't
  -- arriving.
  if v_plan.at is not null and now() < v_plan.at - interval '3 hours' then
    return new;
  end if;

  -- Haversine distance in metres.
  v_dist := 2 * 6371000 * asin(least(1, sqrt(
    power(sin(radians(v_plan.lat - new.lat) / 2), 2)
    + cos(radians(new.lat)) * cos(radians(v_plan.lat))
      * power(sin(radians(v_plan.lng - new.lng) / 2), 2)
  )));
  if v_dist > 100 then
    return new;
  end if;

  update public.plan_members
  set departure_status = 'arrived'
  where plan_id = v_plan.id and user_id = new.user_id and departure_status <> 'arrived';

  if found then
    select u.display_name into v_name from public.users u where u.id = new.user_id;

    -- Tell the crew, and tell the person their sharing is off (they may have
    -- the app in the background). The kind carries who arrived, so two people
    -- arriving are two pushes.
    insert into public.plan_pushes (plan_id, user_id, kind, plan_time, title, body, route)
    select v_plan.id, pm.user_id, 'arrived:' || new.user_id, coalesce(v_plan.at, v_plan.created_at), v_plan.title,
           case when pm.user_id = new.user_id
             then 'You''re here. Location sharing is off.'
             else coalesce(v_name, 'Someone') || ' is here' || coalesce(' at ' || v_plan.place, '') || '.'
           end,
           '/plan/' || v_plan.id
    from public.plan_members pm
    where pm.plan_id = v_plan.id
      and (pm.user_id = new.user_id or pm.rsvp_status <> 'not_going')
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
  perform public.end_share(v_plan.id, new.user_id);
  return new;
end;
$$;

revoke execute on function public.auto_arrive_on_point() from public, anon, authenticated;

create trigger location_points_auto_arrive
  after insert on public.location_points
  for each row execute function public.auto_arrive_on_point();

-- 3. "I've arrived", tapped or automatic, stops sharing.
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

-- 4. The app listens for changes to its own share sessions so it can stop the
--    GPS when the server ends one. The table was never in the publication, so
--    that listener heard nothing.
alter publication supabase_realtime add table public.location_share_sessions;
