-- Deleting an account failed (delete-account returned 500) for anyone who had
-- locked a venue or created an invite link on a plan they don't own: these two
-- foreign keys to users had no ON DELETE action, so the user row couldn't go.
-- (Plans the user created are deleted first by delete-account, which hid this
-- for hosts.)

-- Keep the record of which venue was picked; forget who picked it.
alter table public.venue_selection_events
  alter column selected_by_user_id drop not null,
  drop constraint venue_selection_events_selected_by_user_id_fkey,
  add constraint venue_selection_events_selected_by_user_id_fkey
    foreign key (selected_by_user_id) references public.users(id) on delete set null;

-- A deleted user's invite links stop working.
alter table public.plan_invites
  drop constraint plan_invites_inviter_user_id_fkey,
  add constraint plan_invites_inviter_user_id_fkey
    foreign key (inviter_user_id) references public.users(id) on delete cascade;
