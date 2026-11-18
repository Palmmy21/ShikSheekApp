-- Plans: free / plus / pro. "Free" has no row. A 14-day Pro trial is derived from users.created_at
-- (no row needed). Paid or granted access lives in `subscriptions`.
create table subscriptions (
  user_id            text primary key references users(line_user_id) on delete cascade,
  plan               text not null check (plan in ('plus', 'pro')),
  source             text not null check (source in ('manual', 'promo', 'referral', 'payment')),
  current_period_end timestamptz not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Metered usage per period ('YYYY-MM' or 'YYYY-MM-DD') and feature; incremented atomically with a cap.
create table usage_counters (
  user_id  text not null references users(line_user_id) on delete cascade,
  period   text not null check (char_length(period) between 7 and 10),
  feature  text not null check (feature in ('docs', 'ai', 'ai_day')),
  used     integer not null default 0 check (used >= 0),
  primary key (user_id, period, feature)
);

-- "สนใจ Plus/Pro" taps before payments open: demand signal + who to notify at launch.
create table plan_interest (
  user_id    text not null references users(line_user_id) on delete cascade,
  plan       text not null check (plan in ('plus', 'pro')),
  created_at timestamptz not null default now(),
  primary key (user_id, plan)
);

alter table subscriptions enable row level security;
alter table usage_counters enable row level security;
alter table plan_interest enable row level security;

-- Admin helper (run from the SQL editor):  select grant_plan('<LINE user id>', 'plus', 30, 'promo');
-- Extends from the later of now / current end, so granting twice adds time.
create or replace function grant_plan(p_user text, p_plan text, p_days integer, p_source text default 'manual')
returns timestamptz language sql as $fn$
  insert into subscriptions (user_id, plan, source, current_period_end)
  values (p_user, p_plan, p_source, now() + make_interval(days => p_days))
  on conflict (user_id) do update set
    plan = excluded.plan,
    source = excluded.source,
    current_period_end = greatest(subscriptions.current_period_end, now()) + make_interval(days => p_days),
    updated_at = now()
  returning current_period_end;
$fn$;

revoke execute on function grant_plan(text, text, integer, text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on subscriptions, usage_counters, plan_interest from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on subscriptions, usage_counters, plan_interest from authenticated';
  end if;
end;
$$;
