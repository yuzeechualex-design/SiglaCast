-- Discord-style availability: stored on users; heartbeats remain in user_presence.
alter table public.users add column if not exists availability text not null default 'online';
