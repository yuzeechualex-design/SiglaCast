-- Incoming friend requests (recipient must accept)
create table if not exists public.friend_requests (
  id text primary key,
  from_user_id text not null references public.users (id) on delete cascade,
  to_user_id text not null references public.users (id) on delete cascade,
  created_at timestamptz default now(),
  check (from_user_id <> to_user_id),
  unique (from_user_id, to_user_id)
);

create index if not exists idx_friend_requests_to on public.friend_requests (to_user_id, created_at desc);
create index if not exists idx_friend_requests_from on public.friend_requests (from_user_id);

alter table public.friend_requests enable row level security;

-- Last heartbeat per user (used for online / offline in UI)
create table if not exists public.user_presence (
  user_id text primary key references public.users (id) on delete cascade,
  last_seen_at timestamptz default now()
);

create index if not exists idx_user_presence_seen on public.user_presence (last_seen_at desc);

alter table public.user_presence enable row level security;
