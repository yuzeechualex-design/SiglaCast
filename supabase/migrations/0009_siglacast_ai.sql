-- Per-user persisted chat turns for SiglaCast AI (OpenAI-backed on the backend).

create table if not exists public.siglacast_ai_messages (
  id text primary key,
  user_id text not null references public.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_siglacast_ai_messages_user_created
  on public.siglacast_ai_messages (user_id, created_at);

alter table public.siglacast_ai_messages enable row level security;
