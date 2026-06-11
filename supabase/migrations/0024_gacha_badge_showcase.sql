alter table public.users
add column if not exists alien_stage_gacha_draws integer not null default 0;

alter table public.users
add column if not exists profile_badge_item_ids jsonb not null default '[]'::jsonb;
