-- SiglaCast initial schema (run on a fresh Supabase project to recreate it)

create table if not exists public.users (
  id text primary key,
  role text not null check (role in ('student','admin')),
  name text not null,
  email text not null unique,
  password_hash text not null,
  refresh_token_hash text,
  course text,
  avatar_url text,
  permissions jsonb default '[]'::jsonb,
  created_at timestamptz default now()
);

create table if not exists public.events (
  id text primary key,
  title text not null,
  description text default '',
  rules text default '',
  status text not null default 'open' check (status in ('open','closed')),
  strategy text not null default 'single' check (strategy in ('single','weighted')),
  max_votes_per_user int not null default 1,
  cover_image_url text,
  created_at timestamptz default now()
);

create table if not exists public.candidates (
  id text primary key,
  event_id text not null references public.events(id) on delete cascade,
  name text not null,
  image_url text,
  position int default 0
);
create index if not exists idx_candidates_event on public.candidates(event_id);

create table if not exists public.votes (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  event_id text not null references public.events(id) on delete cascade,
  candidate_id text not null references public.candidates(id) on delete cascade,
  weight numeric default 1,
  created_at timestamptz default now()
);
create index if not exists idx_votes_event on public.votes(event_id);
create index if not exists idx_votes_user_event on public.votes(user_id, event_id);

create table if not exists public.posts (
  id text primary key,
  author_id text not null references public.users(id) on delete cascade,
  content text default '',
  image_url text,
  created_at timestamptz default now()
);
create index if not exists idx_posts_created on public.posts(created_at desc);

create table if not exists public.post_reactions (
  post_id text not null references public.posts(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (post_id, user_id)
);

create table if not exists public.post_comments (
  id text primary key,
  post_id text not null references public.posts(id) on delete cascade,
  author_id text not null references public.users(id) on delete cascade,
  content text not null,
  created_at timestamptz default now()
);
create index if not exists idx_comments_post on public.post_comments(post_id, created_at);

create table if not exists public.announcements (
  id text primary key,
  title text not null,
  message text not null,
  created_at timestamptz default now()
);
create index if not exists idx_announcements_created on public.announcements(created_at desc);

create table if not exists public.notifications (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  text text not null,
  read boolean default false,
  created_at timestamptz default now()
);
create index if not exists idx_notifications_user on public.notifications(user_id, created_at desc);

create table if not exists public.friends (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  friend_id text not null references public.users(id) on delete cascade,
  created_at timestamptz default now(),
  unique(user_id, friend_id)
);
create index if not exists idx_friends_user on public.friends(user_id);

create table if not exists public.messages (
  id text primary key,
  from_user_id text not null references public.users(id) on delete cascade,
  to_user_id text not null references public.users(id) on delete cascade,
  text text not null,
  read boolean default false,
  created_at timestamptz default now()
);
create index if not exists idx_messages_pair on public.messages(from_user_id, to_user_id, created_at);
create index if not exists idx_messages_to_unread on public.messages(to_user_id) where read = false;

-- RLS: enabled with NO policies. Backend uses service_role key which bypasses RLS.
-- Anon / authenticated keys cannot read or write via the Data API. This is intentional.
alter table public.users enable row level security;
alter table public.events enable row level security;
alter table public.candidates enable row level security;
alter table public.votes enable row level security;
alter table public.posts enable row level security;
alter table public.post_reactions enable row level security;
alter table public.post_comments enable row level security;
alter table public.announcements enable row level security;
alter table public.notifications enable row level security;
alter table public.friends enable row level security;
alter table public.messages enable row level security;

-- Public storage buckets for avatars, posts, events
insert into storage.buckets (id, name, public) values
  ('avatars','avatars',true),
  ('posts','posts',true),
  ('events','events',true)
on conflict (id) do nothing;
