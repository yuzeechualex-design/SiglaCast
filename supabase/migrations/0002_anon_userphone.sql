-- Anonymous "Userphone" random pairing for Messages (backend uses service_role)

create table if not exists public.anon_userphone_waiting (
  user_id text primary key references public.users (id) on delete cascade,
  joined_at timestamptz default now()
);

create index if not exists idx_anon_up_waiting_joined on public.anon_userphone_waiting(joined_at);

create table if not exists public.anon_userphone_sessions (
  id text primary key,
  participant_a text not null references public.users (id) on delete cascade,
  participant_b text not null references public.users (id) on delete cascade,
  created_at timestamptz default now(),
  ended_at timestamptz null
);

create index if not exists idx_anon_up_sess_a on public.anon_userphone_sessions(participant_a);
create index if not exists idx_anon_up_sess_b on public.anon_userphone_sessions(participant_b);
create index if not exists idx_anon_up_sess_ended on public.anon_userphone_sessions(ended_at);

create table if not exists public.anon_userphone_messages (
  id text primary key,
  session_id text not null references public.anon_userphone_sessions (id) on delete cascade,
  from_user_id text not null references public.users (id) on delete cascade,
  text text not null default '',
  created_at timestamptz default now()
);

create index if not exists idx_anon_up_msg_session on public.anon_userphone_messages(session_id, created_at);

alter table public.anon_userphone_waiting enable row level security;
alter table public.anon_userphone_sessions enable row level security;
alter table public.anon_userphone_messages enable row level security;
