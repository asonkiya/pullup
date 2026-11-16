-- Guest web join (heypullup.com/join/<token>).
--
-- Guests without the app join from the browser with a Supabase anonymous
-- sign-in and just a name. They use the same join_plan() and RLS rules as app
-- users; this migration adds what the web page needs on top.

-- 1. Invite preview: what the invite page and its link preview (iMessage,
--    WhatsApp) show before anyone signs in. The token is the secret, same as
--    join_plan(), so anyone holding the link may see the plan's summary.
create or replace function public.invite_preview(p_token text)
returns table (
  plan_title     text,
  scheduled_for  timestamptz,
  arrival_time   timestamptz,
  state          public.plan_state,
  place_name     text,
  host_name      text,
  going_count    int,
  voting_enabled boolean
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    p.title,
    p.scheduled_for,
    p.arrival_time,
    p.state,
    p.selected_place_name,
    (select u.display_name
       from public.plan_members pm
       join public.users u on u.id = pm.user_id
      where pm.plan_id = p.id and pm.role = 'host'
      limit 1),
    (select count(*)::int
       from public.plan_members pm
      where pm.plan_id = p.id and pm.rsvp_status = 'going'),
    p.voting_enabled
  from public.plan_invites i
  join public.plans p on p.id = i.plan_id
  where i.token = p_token
    and i.status <> 'expired'
    and i.expires_at > now();
$$;

revoke execute on function public.invite_preview(text) from public;
grant execute on function public.invite_preview(text) to anon, authenticated;

-- 2. cast_vote: record a swipe and run the auto-select rule on the server.
--    The app does this client-side, but its plans update only succeeds for the
--    host (plans_update_creator), so a member's winning vote never locked the
--    plan. Doing it here works for every member and keeps web and app in step.
--    Rule (constants AUTO_SELECT_THRESHOLD / AUTO_SELECT_MIN_VOTES): a venue
--    locks when it has >= 2 right-swipes from >= 60% of members and no other
--    venue ties it; a tie is left for the host's face-off.
create or replace function public.cast_vote(
  p_candidate_id uuid,
  p_direction    public.swipe_direction
)
returns table (locked boolean, tie boolean, place_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_candidate public.venue_candidates%rowtype;
  v_plan      public.plans%rowtype;
  v_members   int;
  v_top       int;
  v_leaders   uuid[];
  v_winner    public.venue_candidates%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_candidate from public.venue_candidates c where c.id = p_candidate_id;
  if v_candidate.id is null then
    raise exception 'unknown_candidate' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.plan_members pm
    where pm.plan_id = v_candidate.plan_id and pm.user_id = v_uid
  ) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  -- Lock the plan row so two simultaneous winning votes can't both lock it.
  select * into v_plan from public.plans p where p.id = v_candidate.plan_id for update;
  if v_plan.state <> 'open' or not v_plan.voting_enabled then
    raise exception 'voting_closed' using errcode = 'P0001';
  end if;

  insert into public.venue_swipes (plan_id, user_id, venue_candidate_id, direction)
  values (v_candidate.plan_id, v_uid, v_candidate.id, p_direction)
  on conflict (plan_id, user_id, venue_candidate_id)
  do update set direction = excluded.direction;

  if p_direction <> 'right' then
    return query select false, false, null::text;
    return;
  end if;

  select count(*)::int into v_members
  from public.plan_members pm where pm.plan_id = v_plan.id;

  with counts as (
    select s.venue_candidate_id as id, count(*)::int as n
    from public.venue_swipes s
    where s.plan_id = v_plan.id and s.direction = 'right'
    group by s.venue_candidate_id
  ), qualifying as (
    select id, n from counts
    where n >= 2 and n::numeric / greatest(v_members, 1) >= 0.6
  )
  select max(n), array_agg(id) filter (where n = (select max(n) from qualifying))
    into v_top, v_leaders
  from qualifying;

  if v_top is null then
    return query select false, false, null::text;
    return;
  end if;

  if array_length(v_leaders, 1) > 1 then
    return query select false, true, null::text;
    return;
  end if;

  select * into v_winner from public.venue_candidates c where c.id = v_leaders[1];

  update public.plans set
    selected_place_id   = v_winner.place_id,
    selected_place_name = v_winner.name,
    selected_place_lat  = v_winner.lat,
    selected_place_lng  = v_winner.lng,
    state               = 'venue_locked'
  where id = v_plan.id;

  insert into public.venue_selection_events (plan_id, venue_candidate_id, selected_by_user_id, selection_type)
  values (v_plan.id, v_winner.id, v_uid, 'auto');

  return query select true, false, v_winner.name;
end;
$$;

revoke execute on function public.cast_vote(uuid, public.swipe_direction) from public, anon;
grant execute on function public.cast_vote(uuid, public.swipe_direction) to authenticated;

-- 3. Anonymous (web guest) accounts can join and vote but not create plans.
drop policy "plans_insert_creator" on public.plans;
create policy "plans_insert_creator" on public.plans for insert to authenticated
  with check (
    (select auth.uid()) = creator_user_id
    and not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false)
  );
