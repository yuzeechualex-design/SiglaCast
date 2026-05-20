-- Ephemeral stories (24h) visible to friends + author; optional views for unread ring styling.

create table if not exists public.user_stories (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  body_text text not null default '',
  media_url text,
  created_at timestamptz not null default now(),
  constraint user_stories_has_content check (
    (length(trim(coalesce(body_text, ''))) > 0)
    or (media_url is not null and length(trim(media_url)) > 0)
  )
);

create index if not exists idx_user_stories_user_created
  on public.user_stories (user_id, created_at desc);

create table if not exists public.story_views (
  story_id text not null references public.user_stories(id) on delete cascade,
  viewer_id text not null references public.users(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (story_id, viewer_id)
);

create index if not exists idx_story_views_viewer on public.story_views (viewer_id);
