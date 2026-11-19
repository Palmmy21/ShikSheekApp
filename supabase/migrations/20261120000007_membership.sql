-- Paid membership bookkeeping:
-- 1. the subscription fee is recorded in the member's own ledger (source 'payment', deduped by external_ref)
-- 2. users.member_since marks the first time someone became a paying ShikSheek member
-- 3. plan_events keeps the conversion history (converted / renewed / upgraded / downgraded)
alter table transactions drop constraint transactions_source_check;
alter table transactions add constraint transactions_source_check
  check (source in ('chat', 'rich_menu', 'fixed_cost', 'savings', 'import', 'slip', 'pdf', 'liff', 'payment'));

alter table users add column member_since timestamptz;

create table plan_events (
  id            uuid primary key default gen_random_uuid(),
  user_id       text not null references users(line_user_id) on delete cascade,
  event         text not null check (event in ('converted', 'renewed', 'upgraded', 'downgraded')),
  plan          text not null check (plan in ('plus', 'pro')),
  product       text not null,
  amount_satang bigint not null check (amount_satang >= 0),
  payment_id    uuid unique references payments(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index plan_events_user_idx on plan_events (user_id, created_at desc);
create index plan_events_event_idx on plan_events (event, created_at desc);

alter table plan_events enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on plan_events from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on plan_events from authenticated'; end if;
end;
$$;
