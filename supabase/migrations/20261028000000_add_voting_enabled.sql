-- Host mode: when false, only the host picks the venue (no crew swiping).
alter table public.plans add column if not exists voting_enabled boolean not null default true;
