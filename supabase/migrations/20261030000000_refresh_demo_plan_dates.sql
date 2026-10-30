-- The App Review demo account's plans are fixed rows. The home screen moves
-- plans whose time has passed into "Past", so keep the demo dates rolling:
-- Taco Tuesday is live now, Friday dinner and Sunday coffee are on the next
-- Friday / Sunday, and the ramen run was five days ago (Chapel Hill time, where
-- the demo venues are).
create or replace function public.refresh_demo_plan_dates()
returns void
language sql
security definer
set search_path = ''
as $$
  with today as (
    select date_trunc('day', now() at time zone 'America/New_York') as d,
           extract(isodow from now() at time zone 'America/New_York')::int as dow
  )
  update public.plans p
  set scheduled_for = case p.id
    when 'bbbbbbbb-0000-0000-0000-000000000002' then date_trunc('hour', now()) - interval '30 minutes'
    when 'aaaaaaaa-0000-0000-0000-000000000001' then (t.d + make_interval(days => (5 - t.dow + 6) % 7 + 1) + interval '19 hours 30 minutes') at time zone 'America/New_York'
    when 'cccccccc-0000-0000-0000-000000000003' then (t.d + make_interval(days => (7 - t.dow + 6) % 7 + 1) + interval '10 hours') at time zone 'America/New_York'
    when 'dddddddd-0000-0000-0000-000000000004' then (t.d - interval '5 days' + interval '19 hours') at time zone 'America/New_York'
  end
  from today t
  where p.id in (
    'aaaaaaaa-0000-0000-0000-000000000001',
    'bbbbbbbb-0000-0000-0000-000000000002',
    'cccccccc-0000-0000-0000-000000000003',
    'dddddddd-0000-0000-0000-000000000004'
  );
$$;

revoke execute on function public.refresh_demo_plan_dates() from public, anon, authenticated;

select cron.schedule('refresh-demo-plan-dates', '0 * * * *', $$select public.refresh_demo_plan_dates()$$);

select public.refresh_demo_plan_dates();
