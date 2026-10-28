-- Fix RLS membership checks.
--
-- Many policies were written as
--   exists (select 1 from plan_members pm where pm.plan_id = plan_id and ...)
-- Inside the subquery the unqualified `plan_id` resolves to pm.plan_id, so the
-- check collapsed to "the caller is a member of ANY plan" and leaked chats,
-- ETAs (incl. origin coordinates), share sessions, venues and swipes across
-- plans. Rewrite every one against the security-definer helpers, which also
-- avoids per-row subqueries.
--
-- Also:
--   * drop the public token-lookup policy (it exposed every invite token) and
--     move joining into join_plan(token), a security-definer RPC;
--   * plan_members inserts are now limited to the plan creator adding
--     themselves; everyone else joins through join_plan();
--   * invite tokens get a server-generated default; links stay valid for every
--     recipient until they expire (no longer consumed on first use).

create or replace function public.my_hosted_plan_ids()
returns setof uuid
language sql
security definer
set search_path = ''
stable
as $$
  select plan_id from public.plan_members
  where user_id = (select auth.uid()) and role = 'host';
$$;

revoke execute on function public.my_hosted_plan_ids() from public, anon;
grant execute on function public.my_hosted_plan_ids() to authenticated;

-- eta_snapshots
drop policy "eta_select" on public.eta_snapshots;
create policy "eta_select" on public.eta_snapshots for select to authenticated
  using (eta_snapshots.plan_id in (select public.my_plan_ids()));

-- location_share_sessions
drop policy "lss_select" on public.location_share_sessions;
create policy "lss_select" on public.location_share_sessions for select to authenticated
  using (location_share_sessions.plan_id in (select public.my_plan_ids()));
drop policy "lss_insert_self" on public.location_share_sessions;
create policy "lss_insert_self" on public.location_share_sessions for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and location_share_sessions.plan_id in (select public.my_plan_ids())
  );

-- plan_messages
drop policy "msg_select" on public.plan_messages;
create policy "msg_select" on public.plan_messages for select to authenticated
  using (plan_messages.plan_id in (select public.my_plan_ids()));
drop policy "msg_insert" on public.plan_messages;
create policy "msg_insert" on public.plan_messages for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and plan_messages.plan_id in (select public.my_plan_ids())
  );

-- venue_candidates
drop policy "vc_select" on public.venue_candidates;
create policy "vc_select" on public.venue_candidates for select to authenticated
  using (venue_candidates.plan_id in (select public.my_plan_ids()));
drop policy "vc_insert" on public.venue_candidates;
create policy "vc_insert" on public.venue_candidates for insert to authenticated
  with check (venue_candidates.plan_id in (select public.my_plan_ids()));

-- venue_swipes
drop policy "vs_select" on public.venue_swipes;
create policy "vs_select" on public.venue_swipes for select to authenticated
  using (venue_swipes.plan_id in (select public.my_plan_ids()));
drop policy "vs_insert" on public.venue_swipes;
create policy "vs_insert" on public.venue_swipes for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and venue_swipes.plan_id in (select public.my_plan_ids())
  );

-- venue_selection_events
drop policy "vse_select" on public.venue_selection_events;
create policy "vse_select" on public.venue_selection_events for select to authenticated
  using (venue_selection_events.plan_id in (select public.my_plan_ids()));
drop policy "vse_insert" on public.venue_selection_events;
create policy "vse_insert" on public.venue_selection_events for insert to authenticated
  with check (
    (select auth.uid()) = selected_by_user_id
    and venue_selection_events.plan_id in (select public.my_plan_ids())
    and (
      selection_type = 'auto'
      or venue_selection_events.plan_id in (select public.my_hosted_plan_ids())
    )
  );

-- plan_invites
drop policy "invites_select_by_token" on public.plan_invites;
drop policy "invites_update_member" on public.plan_invites;
drop policy "invites_select_member" on public.plan_invites;
create policy "invites_select_member" on public.plan_invites for select to authenticated
  using (plan_invites.plan_id in (select public.my_plan_ids()));
drop policy "invites_insert_member" on public.plan_invites;
create policy "invites_insert_member" on public.plan_invites for insert to authenticated
  with check (
    (select auth.uid()) = inviter_user_id
    and plan_invites.plan_id in (select public.my_plan_ids())
  );

alter table public.plan_invites
  alter column token set default replace(gen_random_uuid()::text, '-', '');

-- plan_members: only the creator may add themselves directly (as host, at
-- create time). Everyone else goes through join_plan().
drop policy "pm_insert_self" on public.plan_members;
create policy "pm_insert_self" on public.plan_members for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.plans p
      where p.id = plan_members.plan_id
        and p.creator_user_id = (select auth.uid())
    )
  );

-- Redeem an invite token. Idempotent: re-opening a link you've already used
-- just returns the plan. `joined` is true only on the first join, so the
-- client sends the member_joined push once.
create or replace function public.join_plan(p_token text)
returns table (plan_id uuid, joined boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_plan uuid;
  v_rows int;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select i.plan_id into v_plan
  from public.plan_invites i
  where i.token = p_token
    and i.status <> 'expired'
    and i.expires_at > now();

  if v_plan is null then
    raise exception 'invalid_or_expired' using errcode = 'P0002';
  end if;

  insert into public.plan_members (plan_id, user_id, role, rsvp_status)
  values (v_plan, v_uid, 'member', 'going')
  on conflict on constraint plan_members_plan_id_user_id_key do nothing;
  get diagnostics v_rows = row_count;

  return query select v_plan, v_rows > 0;
end;
$$;

revoke execute on function public.join_plan(text) from public, anon;
grant execute on function public.join_plan(text) to authenticated;
