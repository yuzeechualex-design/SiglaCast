-- Server message attachments, edits, and emoji reactions
alter table public.server_messages
  add column if not exists attachment_url text,
  add column if not exists attachment_type text,
  add column if not exists edited_at timestamptz;

alter table public.server_messages alter column text drop not null;

create table if not exists public.server_message_reactions (
  message_id text not null references public.server_messages(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  emoji text not null,
  created_at timestamptz default now(),
  primary key (message_id, user_id)
);

create index if not exists idx_server_msg_reactions_msg on public.server_message_reactions(message_id);

alter table public.server_message_reactions enable row level security;
