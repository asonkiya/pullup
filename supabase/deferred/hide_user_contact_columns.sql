-- Co-members can read each other's public.users rows, which also carry email,
-- phone and push token. Only expose what the app shows about other people.
-- The app reads its own email and phone from the auth user (profile.tsx), and
-- edge functions use the service role, so neither is affected.
--
-- DEFERRED: build 7's embedded bundle runs `users.select('*')` on the profile
-- screen, which this breaks. Move this file into supabase/migrations/ (with a
-- timestamp) once build 8 is live and build 7 has picked up the OTA.

revoke select on public.users from anon, authenticated;
grant select (id, display_name, avatar_url, created_at) on public.users to authenticated;

-- Stop copying contact details into the shared table; auth.users has them.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.users (id, display_name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'display_name',
      new.raw_user_meta_data->>'full_name',
      nullif(split_part(coalesce(new.email, new.phone), '@', 1), ''),
      'User'
    )
  ) on conflict (id) do nothing;
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

update public.users set email = null, phone_e164 = null;
