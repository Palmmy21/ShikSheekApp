-- One row per checkout attempt (2C2P PromptPay). Paid rows extend `subscriptions` in the same
-- transaction; the status transition pending → paid happens exactly once.
create table payments (
  id            uuid primary key default gen_random_uuid(),
  user_id       text not null references users(line_user_id) on delete cascade,
  invoice_no    text not null unique check (invoice_no ~ '^[A-Za-z0-9]{1,20}$'),
  product       text not null check (product in ('plus_monthly', 'plus_yearly', 'plus_early', 'pro_monthly', 'pro_yearly')),
  plan          text not null check (plan in ('plus', 'pro')),
  days          integer not null check (days > 0),
  amount_satang bigint not null check (amount_satang > 0),
  status        text not null default 'pending' check (status in ('pending', 'paid', 'expired')),
  payment_url   text,
  provider_ref  text,
  channel_code  text,
  created_at    timestamptz not null default now(),
  paid_at       timestamptz
);
create index payments_user_idx on payments (user_id, created_at desc);
create index payments_early_idx on payments (product) where status = 'paid';

alter table payments enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on payments from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on payments from authenticated'; end if;
end;
$$;
