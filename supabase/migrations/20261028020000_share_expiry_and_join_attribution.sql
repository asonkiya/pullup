-- 1. Share sessions past expires_at stayed status='active' forever: stale pins
--    showed on the plan screen and the partial unique index on
--    (plan_id, user_id) where status='active' blocked starting a new share.
select cron.schedule(
  'expire-share-sessions',
  '* * * * *',
  $$
  update public.location_share_sessions
  set status = 'expired', stopped_at = coalesce(stopped_at, expires_at)
  where status = 'active' and expires_at <= now();
  $$
);

-- 2. Ending or cancelling a plan stops everyone's sharing for it.
create or replace function public.stop_sharing_on_plan_end()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.location_share_sessions
  set status = 'stopped', stopped_at = now()
  where plan_id = new.id and status = 'active';
  return new;
end;
$$;

revoke execute on function public.stop_sharing_on_plan_end() from public, anon, authenticated;

create trigger plans_stop_sharing_on_end
  after update of state on public.plans
  for each row
  when (new.state in ('completed', 'cancelled') and old.state is distinct from new.state)
  execute function public.stop_sharing_on_plan_end();

-- 3. join_plan also returns the invite and inviter so the client can log
--    attributed joins (invite → join conversion). Return type changes, so
--    drop and recreate.
drop function public.join_plan(text);

create function public.join_plan(p_token text)
returns table (plan_id uuid, joined boolean, invite_id uuid, inviter_user_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_invite public.plan_invites%rowtype;
  v_rows   int;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_invite
  from public.plan_invites i
  where i.token = p_token
    and i.status <> 'expired'
    and i.expires_at > now();

  if v_invite.id is null then
    raise exception 'invalid_or_expired' using errcode = 'P0002';
  end if;

  insert into public.plan_members (plan_id, user_id, role, rsvp_status)
  values (v_invite.plan_id, v_uid, 'member', 'going')
  on conflict on constraint plan_members_plan_id_user_id_key do nothing;
  get diagnostics v_rows = row_count;

  return query select v_invite.plan_id, v_rows > 0, v_invite.id, v_invite.inviter_user_id;
end;
$$;

revoke execute on function public.join_plan(text) from public, anon;
grant execute on function public.join_plan(text) to authenticated;
