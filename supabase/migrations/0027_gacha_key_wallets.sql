create table if not exists public.user_gacha_key_wallets (
  user_id text primary key references public.users(id) on delete cascade,
  keys int not null default 0,
  updated_at timestamptz default now()
);

alter table public.user_gacha_key_wallets enable row level security;
