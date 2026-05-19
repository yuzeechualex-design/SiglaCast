-- Profile banner / cover image URL (shown behind avatar on profile cards).
alter table public.users add column if not exists cover_url text;
