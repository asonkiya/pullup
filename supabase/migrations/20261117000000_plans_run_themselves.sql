-- Plans run themselves.
--
-- Until now a plan only moved when the host tapped something: nothing started
-- it, nothing ended it, and nobody was reminded. A pg_cron job now runs
-- run_plan_automation() every 5 minutes. It starts and ends plans around their
-- time and queues reminder pushes; the send-plan-pushes edge function delivers
-- the queue through Expo.
--
-- "Plan time" (T) is coalesce(arrival_time, scheduled_for). Plans without a
-- time are left alone. Push copy never states a clock time: the server doesn't
-- know anyone's timezone.
--
--   kind       who            when                              what
--   tomorrow   members        T-24h (plans made >30h ahead)     "Tomorrow at <place>"
--   vote       non-voters     max(T-24h, created+2h)            "<host> is waiting on your vote"
--   host_pick  host           max(T-3h, created+1h), still open "3 haven't voted. Tap to pick"
--   starting   members        T-1h: venue_locked -> active      "Starts in about an hour"
--   leave      not left yet   T-(travel time + 10 min)          "Time to head out"
--   ended      members        T+4h: -> completed                "How was it? Tap for the recap"

create extension if not exists pg_net with schema extensions;

-- 1. Opt-out switch. Off for the App Review demo plans (their dates roll
--    forward every hour, see refresh_demo_plan_dates) and for plans whose time
--    had already passed when this shipped, so turning the feature on doesn't
--    rewrite history or push about old plans.
alter table public.plans add column if not exists automation boolean not null default true;

update public.plans
set automation = false
where id in (
    'aaaaaaaa-0000-0000-0000-000000000001',
    'bbbbbbbb-0000-0000-0000-000000000002',
    'cccccccc-0000-0000-0000-000000000003',
    'dddddddd-0000-0000-0000-000000000004'
  )
  or coalesce(arrival_time, scheduled_for) < now();

-- 2. Push queue. The unique key is also the dedupe: one push per person, per
--    kind, per plan time (so moving the plan re-arms its reminders).
create table public.plan_pushes (
  id         bigint generated always as identity primary key,
  plan_id    uuid not null references public.plans(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  kind       text not null,
  plan_time  timestamptz not null,
  title      text not null,
  body       text not null,
  route      text,
  created_at timestamptz not null default now(),
  sent_at    timestamptz,
  unique (plan_id, user_id, kind, plan_time)
);
create index plan_pushes_unsent_idx on public.plan_pushes (id) where sent_at is null;
create index plan_pushes_user_id_idx on public.plan_pushes (user_id);

-- Server-only: RLS on with no policies.
alter table public.plan_pushes enable row level security;
revoke all on public.plan_pushes from anon, authenticated;

-- 3. The automation tick.
create or replace function public.run_plan_automation()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_queued int := 0;
  v_rows   int;
begin
  -- tomorrow: a day ahead, for plans made far enough in advance that
  -- "tomorrow" is news.
  insert into public.plan_pushes (plan_id, user_id, kind, plan_time, title, body, route)
  select p.id, pm.user_id, 'tomorrow', t.at, p.title,
         'Tomorrow' || coalesce(' at ' || p.selected_place_name, '') || '. '
           || case when p.state = 'open' and p.voting_enabled
                   then 'Vote on the spot if you haven''t yet.'
                   else 'See you there.' end,
         '/plan/' || p.id
  from public.plans p
  cross join lateral (select coalesce(p.arrival_time, p.scheduled_for) as at) t
  join public.plan_members pm on pm.plan_id = p.id and pm.rsvp_status <> 'not_going'
  join public.users u on u.id = pm.user_id and u.push_token is not null
  where p.automation
    and p.state in ('open', 'venue_locked')
    and now() >= t.at - interval '24 hours'
    and now() <  t.at - interval '20 hours'
    and p.created_at < t.at - interval '30 hours'
  on conflict do nothing;
  get diagnostics v_rows = row_count; v_queued := v_queued + v_rows;

  -- vote: members who haven't swiped anything. Skipped for anyone who just got
  -- the "tomorrow" reminder, which already asks for the vote.
  insert into public.plan_pushes (plan_id, user_id, kind, plan_time, title, body, route)
  select p.id, pm.user_id, 'vote', t.at, p.title,
         coalesce(h.display_name, 'Your host') || ' is waiting on your vote. Swipe to pick the spot.',
         '/plan/' || p.id || '/venues'
  from public.plans p
  cross join lateral (select coalesce(p.arrival_time, p.scheduled_for) as at) t
  cross join lateral (select greatest(t.at - interval '24 hours', p.created_at + interval '2 hours') as at) s
  join public.plan_members pm on pm.plan_id = p.id and pm.role <> 'host' and pm.rsvp_status <> 'not_going'
  join public.users u on u.id = pm.user_id and u.push_token is not null
  left join public.users h on h.id = p.creator_user_id
  where p.automation
    and p.state = 'open' and p.voting_enabled
    and now() >= s.at
    and now() <  least(s.at + interval '2 hours', t.at - interval '1 hour')
    and pm.joined_at < now() - interval '30 minutes'
    and exists (select 1 from public.venue_candidates c where c.plan_id = p.id)
    and not exists (select 1 from public.venue_swipes sw where sw.plan_id = p.id and sw.user_id = pm.user_id)
    and not exists (
      select 1 from public.plan_pushes x
      where x.plan_id = p.id and x.user_id = pm.user_id and x.kind = 'tomorrow' and x.plan_time = t.at)
  on conflict do nothing;
  get diagnostics v_rows = row_count; v_queued := v_queued + v_rows;

  -- host_pick: the plan is close and still has no spot. Tell the host who's
  -- holding it up and send them to the deck, where they can just pick.
  insert into public.plan_pushes (plan_id, user_id, kind, plan_time, title, body, route)
  select p.id, p.creator_user_id, 'host_pick', t.at, p.title,
         case
           when not p.voting_enabled or n.candidates = 0 then 'No spot picked yet. Tap to choose one.'
           when n.waiting > 0 then n.waiting || case when n.waiting = 1 then ' person hasn''t' else ' people haven''t' end
                                   || ' voted yet. Tap to pick the spot yourself.'
           else 'Everyone''s voted but there''s no winner. Tap to pick the spot.'
         end,
         '/plan/' || p.id || '/venues'
  from public.plans p
  cross join lateral (select coalesce(p.arrival_time, p.scheduled_for) as at) t
  cross join lateral (select greatest(t.at - interval '3 hours', p.created_at + interval '1 hour') as at) s
  cross join lateral (
    select
      (select count(*) from public.venue_candidates c where c.plan_id = p.id) as candidates,
      (select count(*) from public.plan_members pm
        where pm.plan_id = p.id and pm.role <> 'host' and pm.rsvp_status <> 'not_going'
          and not exists (select 1 from public.venue_swipes sw
                          where sw.plan_id = p.id and sw.user_id = pm.user_id)) as waiting
  ) n
  join public.users u on u.id = p.creator_user_id and u.push_token is not null
  where p.automation
    and p.state = 'open'
    and now() >= s.at
    and now() <  least(s.at + interval '1 hour', t.at)
  on conflict do nothing;
  get diagnostics v_rows = row_count; v_queued := v_queued + v_rows;

  -- ended: four hours after the plan time it's over. Runs before "starting" so
  -- a plan can't be started and ended in the same tick.
  with ended as (
    update public.plans p
    set state = 'completed'
    where p.automation
      and p.state in ('venue_locked', 'active')
      and now() >= coalesce(p.arrival_time, p.scheduled_for) + interval '4 hours'
    returning p.id, p.title, coalesce(p.arrival_time, p.scheduled_for) as at
  ), logged as (
    insert into public.analytics_events (plan_id, event_name, properties_json)
    select e.id, 'plan_state_changed', jsonb_build_object('to', 'completed', 'source', 'auto')
    from ended e
  )
  insert into public.plan_pushes (plan_id, user_id, kind, plan_time, title, body, route)
  select e.id, pm.user_id, 'ended', e.at, e.title, 'How was it? Tap for the recap.', '/plan/' || e.id
  from ended e
  join public.plan_members pm on pm.plan_id = e.id and pm.rsvp_status <> 'not_going'
  join public.users u on u.id = pm.user_id and u.push_token is not null
  where now() < e.at + interval '5 hours'
  on conflict do nothing;
  get diagnostics v_rows = row_count; v_queued := v_queued + v_rows;

  -- starting: an hour out, a plan with a spot goes live, which is what gives
  -- everyone the "I'm leaving" button. The host can still start it earlier.
  with started as (
    update public.plans p
    set state = 'active'
    where p.automation
      and p.state = 'venue_locked'
      and now() >= coalesce(p.arrival_time, p.scheduled_for) - interval '1 hour'
      and now() <  coalesce(p.arrival_time, p.scheduled_for) + interval '4 hours'
    returning p.id, p.title, p.selected_place_name, coalesce(p.arrival_time, p.scheduled_for) as at
  ), logged as (
    insert into public.analytics_events (plan_id, event_name, properties_json)
    select s.id, 'plan_state_changed', jsonb_build_object('from', 'venue_locked', 'to', 'active', 'source', 'auto')
    from started s
  )
  insert into public.plan_pushes (plan_id, user_id, kind, plan_time, title, body, route)
  select s.id, pm.user_id, 'starting', s.at, s.title,
         case
           when m.mins >= 45 then 'Starts in about an hour'
           when m.mins >= 10 then 'Starts in about ' || (round(m.mins / 5.0) * 5)::int || ' minutes'
           else 'Happening now'
         end
           || coalesce(' at ' || s.selected_place_name, '')
           || '. Tap "I''m leaving" when you head out.',
         '/plan/' || s.id
  from started s
  cross join lateral (select extract(epoch from s.at - now()) / 60 as mins) m
  join public.plan_members pm on pm.plan_id = s.id and pm.rsvp_status <> 'not_going'
  join public.users u on u.id = pm.user_id and u.push_token is not null
  where now() < s.at + interval '15 minutes'
  on conflict do nothing;
  get diagnostics v_rows = row_count; v_queued := v_queued + v_rows;

  -- leave: for people who haven't left. Lead time is the venue's travel time
  -- from the plan's search area plus 10 minutes (15 to 50 minutes); it's a
  -- crew-wide estimate, since we only know someone's real ETA once they share.
  insert into public.plan_pushes (plan_id, user_id, kind, plan_time, title, body, route)
  select p.id, pm.user_id, 'leave', t.at, p.title,
         'Time to head out' || coalesce(' to ' || p.selected_place_name, '')
           || '. Tap "I''m leaving" so the crew sees your ETA.',
         '/plan/' || p.id
  from public.plans p
  cross join lateral (select coalesce(p.arrival_time, p.scheduled_for) as at) t
  cross join lateral (
    select make_interval(secs => least(greatest(coalesce((
      select c.eta_seconds from public.venue_candidates c
      where c.plan_id = p.id and c.place_id = p.selected_place_id limit 1), 0) + 600, 900), 3000)) as lead
  ) l
  join public.plan_members pm on pm.plan_id = p.id
    and pm.rsvp_status <> 'not_going' and pm.departure_status = 'not_left'
  join public.users u on u.id = pm.user_id and u.push_token is not null
  where p.automation
    and p.state = 'active'
    and now() >= t.at - l.lead
    and now() <  least(t.at - l.lead + interval '10 minutes', t.at)
    -- Not right after "starting" (a plan made minutes before its time).
    and not exists (
      select 1 from public.plan_pushes x
      where x.plan_id = p.id and x.user_id = pm.user_id and x.kind = 'starting'
        and x.created_at > now() - interval '20 minutes')
  on conflict do nothing;
  get diagnostics v_rows = row_count; v_queued := v_queued + v_rows;

  return v_queued;
end;
$$;

revoke execute on function public.run_plan_automation() from public, anon, authenticated;

-- 4. Hand the queue to the sender. Marks rows sent as it returns them, so two
--    overlapping sends can't deliver the same push. Anything that sat unsent
--    for 30 minutes is stale ("time to head out") and is never delivered.
create or replace function public.claim_plan_pushes()
returns table (id bigint, plan_id uuid, kind text, title text, body text, route text, push_token text)
language sql
security definer
set search_path = ''
as $$
  with claimed as (
    update public.plan_pushes pp
    set sent_at = now()
    where pp.id in (
      select q.id from public.plan_pushes q
      where q.sent_at is null and q.created_at > now() - interval '30 minutes'
      order by q.id
      limit 500
      for update skip locked
    )
    returning pp.id, pp.plan_id, pp.user_id, pp.kind, pp.title, pp.body, pp.route
  )
  select c.id, c.plan_id, c.kind, c.title, c.body, c.route, u.push_token
  from claimed c
  join public.users u on u.id = c.user_id
  where u.push_token is not null;
$$;

revoke execute on function public.claim_plan_pushes() from public, anon, authenticated;
grant execute on function public.claim_plan_pushes() to service_role;

-- 5. Every 5 minutes: run the tick, then poke the sender if anything is queued.
select cron.schedule(
  'plan-automation',
  '*/5 * * * *',
  $$
  select public.run_plan_automation();
  select net.http_post(
    url := 'https://ciucouvnqetkjvniofba.supabase.co/functions/v1/send-plan-pushes',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  )
  where exists (select 1 from public.plan_pushes where sent_at is null);
  $$
);

-- Keep the queue small.
select cron.schedule(
  'prune-plan-pushes',
  '23 4 * * *',
  $$delete from public.plan_pushes where created_at < now() - interval '30 days'$$
);

-- 6. Hosts can delete their own plans. There was no delete policy, so a client
--    delete returned 204 and removed nothing.
create policy "plans_delete_creator" on public.plans for delete to authenticated
  using ((select auth.uid()) = creator_user_id);
