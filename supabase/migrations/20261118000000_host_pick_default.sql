-- A plan decides itself, even when most of the crew does nothing.
--
-- Before: a spot locked only when 60% of everyone who had joined liked it, so
-- every guest who joined and never voted raised the bar, and a quiet crew never
-- got a spot. Now (docs/guest-effort-review.md, items 3 and 4):
--
--   * The host's pick is the default. The first spot the host likes becomes
--     plans.host_pick_candidate_id; guests see it as "X, unless the crew wants
--     something else".
--   * Likes are measured against the people who voted, not everyone who joined.
--     A spot locks early once at least half the crew (not counting "can't make
--     it") has voted and one spot has 2+ likes from 60% of those voters.
--   * At the decide time, whatever leads wins: most likes, ties to the host's
--     pick. With no votes at all the host's pick wins. Only a plan with no likes
--     and no pick is left for the host nudge.
--
-- Decide time: 3 hours before the plan, or an hour after it was made if that's
-- later, but no later than 30 minutes before (15 minutes after creation for a
-- plan made at the last minute).

alter table public.plans
  add column if not exists host_pick_candidate_id uuid
    references public.venue_candidates(id) on delete set null;

create or replace function public.plan_decide_at(p_plan_time timestamptz, p_created_at timestamptz)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select least(
    greatest(p_plan_time - interval '3 hours', p_created_at + interval '1 hour'),
    greatest(p_plan_time - interval '30 minutes', p_created_at + interval '15 minutes')
  );
$$;

-- Where the vote stands. Members who said they can't make it don't count, as
-- voters or toward the crew size. Internal: clients use vote_status().
create or replace function public.plan_vote_standing(p_plan_id uuid)
returns table (members int, voters int, leaders uuid[], quorum boolean)
language sql
security definer
set search_path = ''
stable
as $$
  with crew as (
    select pm.user_id from public.plan_members pm
    where pm.plan_id = p_plan_id and pm.rsvp_status <> 'not_going'
  ), swipes as (
    select s.user_id, s.venue_candidate_id, s.direction
    from public.venue_swipes s
    join crew c on c.user_id = s.user_id
    where s.plan_id = p_plan_id
  ), totals as (
    select (select count(*)::int from crew) as members,
           (select count(distinct user_id)::int from swipes) as voters
  ), likes as (
    select venue_candidate_id as id, count(*)::int as n
    from swipes where direction = 'right'
    group by venue_candidate_id
  ), qualifying as (
    -- AUTO_SELECT_MIN_VOTES = 2, AUTO_SELECT_THRESHOLD = 0.6 in constants/index.ts
    select l.id, l.n from likes l, totals t
    where l.n >= 2 and l.n >= 0.6 * t.voters
  )
  select t.members, t.voters,
         coalesce((select array_agg(q.id) from qualifying q
                   where q.n = (select max(n) from qualifying)), '{}'::uuid[]),
         t.voters * 2 >= t.members
  from totals t;
$$;

revoke execute on function public.plan_vote_standing(uuid) from public, anon, authenticated;

-- Lock a plan on a candidate. Internal.
create or replace function public.lock_plan_venue(p_plan_id uuid, p_candidate_id uuid, p_user_id uuid, p_source text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_winner public.venue_candidates%rowtype;
begin
  select * into v_winner from public.venue_candidates c
  where c.id = p_candidate_id and c.plan_id = p_plan_id;
  if v_winner.id is null then return null; end if;

  update public.plans set
    selected_place_id   = v_winner.place_id,
    selected_place_name = v_winner.name,
    selected_place_lat  = v_winner.lat,
    selected_place_lng  = v_winner.lng,
    state               = 'venue_locked'
  where id = p_plan_id;

  insert into public.venue_selection_events (plan_id, venue_candidate_id, selected_by_user_id, selection_type)
  values (p_plan_id, v_winner.id, p_user_id, 'auto');

  -- Votes from the app and web log their own venue_locked event.
  if p_user_id is null then
    insert into public.analytics_events (plan_id, event_name, properties_json)
    values (p_plan_id, 'venue_locked', jsonb_build_object('source', p_source));
  end if;

  return v_winner.name;
end;
$$;

revoke execute on function public.lock_plan_venue(uuid, uuid, uuid, text) from public, anon, authenticated;

-- cast_vote: same signature and return shape as before, new rule.
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
  v_role      public.member_role;
  v_standing  record;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_candidate from public.venue_candidates c where c.id = p_candidate_id;
  if v_candidate.id is null then
    raise exception 'unknown_candidate' using errcode = 'P0002';
  end if;

  select pm.role into v_role from public.plan_members pm
  where pm.plan_id = v_candidate.plan_id and pm.user_id = v_uid;
  if v_role is null then
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

  -- The first spot the host likes is the plan's default.
  if v_role = 'host' and p_direction = 'right' and v_plan.host_pick_candidate_id is null then
    update public.plans set host_pick_candidate_id = v_candidate.id where id = v_plan.id;
  end if;

  select * into v_standing from public.plan_vote_standing(v_plan.id);

  if not v_standing.quorum or coalesce(array_length(v_standing.leaders, 1), 0) = 0 then
    return query select false, false, null::text;
  elsif array_length(v_standing.leaders, 1) > 1 then
    return query select false, true, null::text;
  else
    return query select true, false,
      public.lock_plan_venue(v_plan.id, v_standing.leaders[1], v_uid, 'auto');
  end if;
end;
$$;

revoke execute on function public.cast_vote(uuid, public.swipe_direction) from public, anon;
grant execute on function public.cast_vote(uuid, public.swipe_direction) to authenticated;

-- What the app and the web page show about an open vote.
create or replace function public.vote_status(p_plan_id uuid)
returns table (
  members                int,
  voters                 int,
  tie                    boolean,
  leader_ids             uuid[],
  host_pick_candidate_id uuid,
  decide_at              timestamptz
)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if not exists (
    select 1 from public.plan_members pm
    where pm.plan_id = p_plan_id and pm.user_id = (select auth.uid())
  ) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  return query
  select s.members, s.voters,
         s.quorum and coalesce(array_length(s.leaders, 1), 0) > 1,
         s.leaders,
         p.host_pick_candidate_id,
         case when p.automation and p.voting_enabled and coalesce(p.arrival_time, p.scheduled_for) is not null
              then public.plan_decide_at(coalesce(p.arrival_time, p.scheduled_for), p.created_at) end
  from public.plans p
  cross join lateral public.plan_vote_standing(p.id) s
  where p.id = p_plan_id;
end;
$$;

revoke execute on function public.vote_status(uuid) from public, anon;
grant execute on function public.vote_status(uuid) to authenticated;

-- The decide-time sweep. Runs just before run_plan_automation(), so a plan it
-- locks no longer gets the "nobody has picked a spot" host nudge.
create or replace function public.decide_due_plans()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan   record;
  v_winner uuid;
  v_name   text;
  v_count  int := 0;
begin
  for v_plan in
    select p.id, p.title, p.host_pick_candidate_id, coalesce(p.arrival_time, p.scheduled_for) as at
    from public.plans p
    where p.automation
      and p.state = 'open' and p.voting_enabled
      and coalesce(p.arrival_time, p.scheduled_for) is not null
      and now() >= public.plan_decide_at(coalesce(p.arrival_time, p.scheduled_for), p.created_at)
      and now() <  coalesce(p.arrival_time, p.scheduled_for) + interval '4 hours'
      -- Once a plan has been locked by anyone, a host who re-opens voting is
      -- in charge of it; don't lock it again under them five minutes later.
      and not exists (select 1 from public.venue_selection_events e where e.plan_id = p.id)
    for update of p skip locked
  loop
    -- Most likes wins; ties go to the host's pick, then the better rated and
    -- the closer. A spot nobody liked can only win as the host's pick.
    select c.id into v_winner
    from public.venue_candidates c
    left join lateral (
      select count(*)::int as n
      from public.venue_swipes s
      join public.plan_members pm on pm.plan_id = s.plan_id and pm.user_id = s.user_id
        and pm.rsvp_status <> 'not_going'
      where s.venue_candidate_id = c.id and s.direction = 'right'
    ) l on true
    where c.plan_id = v_plan.id
      and (l.n > 0 or c.id = v_plan.host_pick_candidate_id)
    order by l.n desc,
             (c.id = v_plan.host_pick_candidate_id) desc nulls last,
             c.rating desc nulls last,
             c.eta_seconds asc nulls last,
             c.created_at
    limit 1;

    continue when v_winner is null;

    v_name := public.lock_plan_venue(v_plan.id, v_winner, null, 'deadline');

    insert into public.plan_pushes (plan_id, user_id, kind, plan_time, title, body, route)
    select v_plan.id, pm.user_id, 'locked', v_plan.at, v_plan.title,
           'It''s settled: ' || v_name || '.', '/plan/' || v_plan.id
    from public.plan_members pm
    join public.users u on u.id = pm.user_id and u.push_token is not null
    where pm.plan_id = v_plan.id and pm.rsvp_status <> 'not_going'
    on conflict do nothing;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.decide_due_plans() from public, anon, authenticated;

-- Same job name: replaces the schedule set in 20261117000000.
select cron.schedule(
  'plan-automation',
  '*/5 * * * *',
  $$
  select public.decide_due_plans();
  select public.run_plan_automation();
  select net.http_post(
    url := 'https://ciucouvnqetkjvniofba.supabase.co/functions/v1/send-plan-pushes',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  )
  where exists (select 1 from public.plan_pushes where sent_at is null);
  $$
);

-- The invite card and link preview show the host's pick. Return type changes,
-- so drop and recreate.
drop function public.invite_preview(text);

create function public.invite_preview(p_token text)
returns table (
  plan_title     text,
  scheduled_for  timestamptz,
  arrival_time   timestamptz,
  state          public.plan_state,
  place_name     text,
  host_name      text,
  going_count    int,
  voting_enabled boolean,
  pick_name      text
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
    p.voting_enabled,
    (select c.name from public.venue_candidates c
      where c.id = p.host_pick_candidate_id and c.plan_id = p.id)
  from public.plan_invites i
  join public.plans p on p.id = i.plan_id
  where i.token = p_token
    and i.status <> 'expired'
    and i.expires_at > now();
$$;

revoke execute on function public.invite_preview(text) from public;
grant execute on function public.invite_preview(text) to anon, authenticated;
