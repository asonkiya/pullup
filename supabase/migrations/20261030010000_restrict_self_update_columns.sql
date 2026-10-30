-- The "update own row" policies only check user_id, so a member could rewrite
-- any column of their own row: make themselves host, or repoint plan_id at
-- another plan and read its chat and locations. Limit client updates to the
-- columns the app actually edits. Edge functions use the service role and are
-- unaffected.

revoke update on public.plan_members from anon, authenticated;
grant update (rsvp_status, departure_status) on public.plan_members to authenticated;

revoke update on public.location_share_sessions from anon, authenticated;
grant update (status, stopped_at, eta_only) on public.location_share_sessions to authenticated;

revoke update on public.eta_snapshots from anon, authenticated;
grant update (status, duration_seconds, distance_meters) on public.eta_snapshots to authenticated;

revoke update on public.users from anon, authenticated;
grant update (display_name, avatar_url, push_token) on public.users to authenticated;

-- Trigger function; nothing should call it directly.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
