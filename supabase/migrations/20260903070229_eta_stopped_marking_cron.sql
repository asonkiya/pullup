-- Let a user mark their own snapshot as stopped when they end sharing.
create policy "update own eta snapshot" on public.eta_snapshots
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Movement-independent backstop: every minute, flag snapshots whose owner has
-- no active, unexpired share session. compute-eta does the same inline, but it
-- only runs when a sharer uploads a fix — stationary phones never trigger it.
-- Realtime (eta_snapshots is in the publication) pushes the UPDATE to clients.
create extension if not exists pg_cron;
select cron.schedule(
  'mark-stopped-etas',
  '* * * * *',
  $$
  update public.eta_snapshots e
  set status = 'stopped', duration_seconds = null, distance_meters = null
  where e.status = 'ok'
    and not exists (
      select 1 from public.location_share_sessions s
      where s.plan_id = e.plan_id
        and s.user_id = e.user_id
        and s.status = 'active'
        and s.expires_at > now()
    );
  $$
);
