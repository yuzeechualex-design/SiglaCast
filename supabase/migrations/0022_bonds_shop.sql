create table if not exists public.user_bonds (
  user_id text not null references public.users(id) on delete cascade,
  target_user_id text not null references public.users(id) on delete cascade,
  exp int not null default 0,
  pinned boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (user_id, target_user_id),
  check (user_id <> target_user_id)
);
create index if not exists idx_user_bonds_target on public.user_bonds(target_user_id);

create table if not exists public.user_wallets (
  user_id text primary key references public.users(id) on delete cascade,
  coins int not null default 0,
  updated_at timestamptz default now()
);

create table if not exists public.user_shop_purchases (
  user_id text not null references public.users(id) on delete cascade,
  item_id text not null,
  created_at timestamptz default now(),
  primary key (user_id, item_id)
);

alter table public.user_bonds enable row level security;
alter table public.user_wallets enable row level security;
alter table public.user_shop_purchases enable row level security;
