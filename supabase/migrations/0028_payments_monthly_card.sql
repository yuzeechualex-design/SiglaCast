create table if not exists public.shop_payment_orders (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  sku text not null,
  kind text not null,
  amount_usd numeric(10, 2) not null,
  coins int not null default 0,
  status text not null default 'created',
  provider text not null default 'paypal',
  provider_order_id text unique,
  provider_capture_id text,
  created_at timestamptz not null default now(),
  captured_at timestamptz
);

create table if not exists public.user_monthly_cards (
  user_id text primary key references public.users(id) on delete cascade,
  active_until timestamptz not null,
  last_claim_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.shop_payment_orders enable row level security;
alter table public.user_monthly_cards enable row level security;

create index if not exists idx_shop_payment_orders_user on public.shop_payment_orders (user_id, created_at desc);
