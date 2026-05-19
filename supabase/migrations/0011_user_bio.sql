-- Optional longer “about me” text shown on public profile cards.
alter table public.users add column if not exists bio text;
