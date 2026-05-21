alter table public.user_stories
  add column if not exists visibility text not null default 'friends';
