-- Optional custom profile status shown next to display name (emoji + short note).
alter table public.users add column if not exists status_emoji text;
alter table public.users add column if not exists status_note text;
