-- Let a user remove their own ETA snapshot when they stop sharing, so their
-- last ETA doesn't stay frozen on other members' screens.
create policy "delete own eta snapshot" on public.eta_snapshots
  for delete to authenticated
  using ((select auth.uid()) = user_id);
