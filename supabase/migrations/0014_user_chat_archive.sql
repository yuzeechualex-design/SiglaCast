-- Per-user hide from main chat list (DM partner or group conversation).
create table if not exists public.user_chat_archive (
  user_id text not null references public.users(id) on delete cascade,
  dm_peer_id text references public.users(id) on delete cascade,
  conversation_id text references public.conversations(id) on delete cascade,
  archived_at timestamptz not null default now(),
  constraint user_chat_archive_one_target check (
    (dm_peer_id is not null and conversation_id is null)
    or (dm_peer_id is null and conversation_id is not null)
  )
);

create unique index if not exists uq_user_chat_archive_dm
  on public.user_chat_archive (user_id, dm_peer_id) where dm_peer_id is not null;

create unique index if not exists uq_user_chat_archive_group
  on public.user_chat_archive (user_id, conversation_id) where conversation_id is not null;

create index if not exists idx_user_chat_archive_user on public.user_chat_archive (user_id);
