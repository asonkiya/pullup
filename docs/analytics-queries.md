# Analytics queries

The app now logs funnel + monetization events into `public.analytics_events`
(`lib/analytics.ts`). Run these in the Supabase SQL editor to track the metrics
that gate monetization (see `monetization.md`: no monetization until ≥30% W4
retention).

Events logged: `plan_created`, `plan_joined`, `venue_suggested`,
`venue_locked`, `eta_share_started`, `departure_leaving`, `departure_arrived`,
`affiliate_click`.

---

## Weekly retention (the gate)

Cohort users by the week they first did anything, then measure how many return
in later weeks. Target: **≥30% of the W0 cohort still active in W4**.

```sql
with first_seen as (
  select user_id, date_trunc('week', min(created_at)) as cohort_week
  from public.analytics_events
  group by user_id
),
activity as (
  select distinct ae.user_id, date_trunc('week', ae.created_at) as active_week
  from public.analytics_events ae
)
select
  fs.cohort_week,
  count(distinct fs.user_id) as cohort_size,
  floor(extract(epoch from (a.active_week - fs.cohort_week)) / 604800) as week_number,
  count(distinct a.user_id) as retained
from first_seen fs
join activity a on a.user_id = fs.user_id
group by fs.cohort_week, week_number
order by fs.cohort_week, week_number;
```

## Plan → arrival funnel

The core loop's conversion. A healthy product gets a large fraction of created
plans all the way to an arrival.

```sql
select
  count(*) filter (where event_name = 'plan_created')      as plans_created,
  count(*) filter (where event_name = 'venue_locked')      as venues_locked,
  count(*) filter (where event_name = 'eta_share_started') as eta_shares,
  count(*) filter (where event_name = 'departure_leaving') as departures,
  count(*) filter (where event_name = 'departure_arrived') as arrivals
from public.analytics_events
where created_at > now() - interval '30 days';
```

## Affiliate click-through (revenue signal)

Clicks on "Book a table" / "Get a ride", split by type. This is the numerator
for affiliate revenue once attribution codes are set in `lib/affiliate.ts`.

```sql
select
  properties_json->>'type' as cta,
  count(*) as clicks,
  count(distinct user_id) as unique_users
from public.analytics_events
where event_name = 'affiliate_click'
  and created_at > now() - interval '30 days'
group by 1
order by clicks desc;
```

## Affiliate conversion rate (per arriving plan)

How often an arrival is preceded by a commerce click — the high-intent moment
the monetization thesis is built on.

```sql
select
  count(*) filter (where event_name = 'departure_arrived') as arrivals,
  count(*) filter (where event_name = 'affiliate_click')   as commerce_clicks,
  round(
    100.0 * count(*) filter (where event_name = 'affiliate_click')
    / nullif(count(*) filter (where event_name = 'departure_arrived'), 0), 1
  ) as clicks_per_100_arrivals
from public.analytics_events
where created_at > now() - interval '30 days';
```
