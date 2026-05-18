-- Bridges two group chats anonymously: mirrored messages appear in each thread as-from guest user.
-- Sentinel user IDs (credentials invalid on purpose).

insert into public.users (id, role, name, email, password_hash, course)
values (
  '_userphone_guest',
  'student',
  'Anonymous',
  'userphone.guest.internal',
  '$2a$10$________________________________________________________________',
  ''
)
on conflict (id) do nothing;

alter table public.anon_userphone_sessions
  add column if not exists bridge_conversation_a text references public.conversations(id) on delete set null,
  add column if not exists bridge_conversation_b text references public.conversations(id) on delete set null;

create table if not exists public.anon_userphone_conv_waiting (
  conversation_id text primary key references public.conversations(id) on delete cascade,
  queued_by_user_id text not null references public.users(id) on delete cascade,
  joined_at timestamptz default now()
);

create index if not exists idx_up_conv_waiting_joined on public.anon_userphone_conv_waiting(joined_at);

alter table public.anon_userphone_conv_waiting enable row level security;

-- Prevents mirrored rows from re-triggering relay to the other conversation.
alter table public.messages add column if not exists bridge_mirror boolean not null default false;
