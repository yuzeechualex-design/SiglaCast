-- Comments on ephemeral stories (friends + author who can view the story).

create table if not exists public.story_comments (
  id text primary key,
  story_id text not null references public.user_stories(id) on delete cascade,
  author_id text not null references public.users(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_story_comments_story_created
  on public.story_comments (story_id, created_at asc);

alter table public.story_comments enable row level security;
