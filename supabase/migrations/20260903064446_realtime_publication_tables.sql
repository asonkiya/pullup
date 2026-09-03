-- The supabase_realtime publication had no tables, so every postgres_changes
-- subscription in the app (chat, live member map, plans list, venue updates,
-- member joins) silently received nothing. Add every table the client
-- subscribes to. RLS still gates which rows each subscriber receives.
alter publication supabase_realtime add table
  public.plan_messages,
  public.plan_members,
  public.plans,
  public.venue_candidates,
  public.eta_snapshots,
  public.location_points;

-- These two are subscribed with event '*'; DELETE events only match the
-- client's plan_id filter when the old row is fully replicated.
alter table public.plan_members replica identity full;
alter table public.eta_snapshots replica identity full;
