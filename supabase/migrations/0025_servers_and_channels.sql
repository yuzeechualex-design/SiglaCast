-- Create servers table with a jsonb structure column for sections and channels
create table if not exists public.servers (
  id text primary key,
  name text not null,
  icon_url text,
  structure jsonb default '[]'::jsonb,
  owner_id text not null references public.users(id) on delete cascade,
  created_at timestamptz default now()
);

-- Create server members table
create table if not exists public.server_members (
  server_id text not null references public.servers(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz default now(),
  primary key (server_id, user_id)
);

-- Create indexes
create index if not exists idx_server_members_user on public.server_members(user_id);

-- Create server messages table
create table if not exists public.server_messages (
  id text primary key,
  server_id text not null references public.servers(id) on delete cascade,
  channel_id text not null,
  text text not null,
  author_id text not null references public.users(id) on delete cascade,
  created_at timestamptz default now()
);

-- Create indexes
create index if not exists idx_server_messages_channel on public.server_messages(channel_id, created_at desc);

-- Enable Row Level Security (RLS)
alter table public.servers enable row level security;
alter table public.server_members enable row level security;
alter table public.server_messages enable row level security;
