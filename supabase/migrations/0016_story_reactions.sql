-- One reaction per viewer per story (same reaction types as posts / chat).

create table if not exists public.story_reactions (
  story_id text not null references public.user_stories(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  reaction text not null default 'like',
  created_at timestamptz not null default now(),
  primary key (story_id, user_id)
);

create index if not exists idx_story_reactions_story on public.story_reactions (story_id);

alter table public.story_reactions enable row level security;
