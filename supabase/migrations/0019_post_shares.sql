alter table public.posts
  add column if not exists shared_post_id text references public.posts(id) on delete set null;

create index if not exists idx_posts_shared_post_id
  on public.posts(shared_post_id);
