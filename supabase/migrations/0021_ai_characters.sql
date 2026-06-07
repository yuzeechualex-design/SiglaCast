-- AI characters are stored as owned, non-login user rows so existing posts,
-- comments, profile pages, avatars, and covers can reuse the current schema.

alter table public.users
  add column if not exists owner_user_id text references public.users(id) on delete cascade,
  add column if not exists is_ai_character boolean not null default false,
  add column if not exists ai_roles text,
  add column if not exists ai_personality text,
  add column if not exists ai_background text,
  add column if not exists ai_auto_post boolean not null default false,
  add column if not exists ai_auto_reply boolean not null default false;

do $$
declare
  constraint_name text;
begin
  select conname into constraint_name
  from pg_constraint
  where conrelid = 'public.users'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%role%student%admin%';

  if constraint_name is not null then
    execute format('alter table public.users drop constraint %I', constraint_name);
  end if;
end $$;

alter table public.users
  add constraint users_role_check
  check (role in ('student', 'admin', 'ai_character'));

create index if not exists idx_users_ai_owner
  on public.users(owner_user_id, created_at desc)
  where is_ai_character = true;
