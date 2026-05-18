-- In-app navigation target when user taps a notification (React Router path + query/hash).
alter table public.notifications add column if not exists link_path text;
