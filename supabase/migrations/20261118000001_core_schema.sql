-- ShikSheek core schema
-- All money is BIGINT satang. All user-owned rows carry user_id (LINE user id) and are
-- deleted with the user (ON DELETE CASCADE) to support full data deletion.
--
-- Access model: the LINE webhook (Edge Function) connects with a privileged role and
-- scopes every query by user_id. Row Level Security is ENABLED with NO policies, so the
-- public anon/authenticated roles can read or write nothing even if the anon key leaks.

-- ───────────────────────── helpers ─────────────────────────
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ───────────────────────── users ─────────────────────────
create table users (
  line_user_id      text primary key check (line_user_id ~ '^U[0-9a-f]{32}$'),
  display_name      text check (char_length(display_name) <= 100),
  cycle_start_day   smallint not null default 1 check (cycle_start_day between 1 and 28),
  notify_daily_summary   boolean not null default true,
  notify_weekly_summary  boolean not null default false,
  notify_monthly_summary boolean not null default true,
  notify_bill_reminders  boolean not null default true,
  notify_budget_alerts   boolean not null default true,
  onboarding        text not null default 'new' check (onboarding in ('new', 'asked_income', 'asked_cycle', 'done')),
  is_following      boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger users_updated_at before update on users for each row execute function set_updated_at();

-- ───────────────────────── fixed costs ─────────────────────────
create table fixed_costs (
  id                 uuid primary key default gen_random_uuid(),
  user_id            text not null references users(line_user_id) on delete cascade,
  name               text not null check (char_length(name) between 1 and 60),
  amount_satang      bigint not null check (amount_satang > 0 and amount_satang <= 100000000000),
  category_id        text not null default 'bills' check (char_length(category_id) between 1 and 40),
  frequency          text not null check (frequency in ('weekly', 'monthly', 'yearly', 'custom')),
  interval_count     smallint not null default 1 check (interval_count between 1 and 366),
  anchor_date        date not null,
  end_date           date check (end_date is null or end_date >= anchor_date),
  remind_days_before smallint not null default 1 check (remind_days_before between 0 and 14),
  status             text not null default 'active' check (status in ('active', 'paused')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);
create index fixed_costs_user_idx on fixed_costs (user_id) where deleted_at is null;
create trigger fixed_costs_updated_at before update on fixed_costs for each row execute function set_updated_at();

create table fixed_cost_occurrences (
  id              uuid primary key default gen_random_uuid(),
  user_id         text not null references users(line_user_id) on delete cascade,
  fixed_cost_id   uuid not null references fixed_costs(id) on delete cascade,
  occurrence_key  text not null check (char_length(occurrence_key) between 1 and 20),
  due_date        date not null,
  amount_satang   bigint not null check (amount_satang > 0 and amount_satang <= 100000000000),
  status          text not null default 'pending' check (status in ('pending', 'paid', 'skipped')),
  resolved_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- one bill per fixed cost per period: makes generation idempotent
  constraint fixed_cost_occurrences_unique_key unique (fixed_cost_id, occurrence_key)
);
create index fixed_cost_occurrences_user_due_idx on fixed_cost_occurrences (user_id, due_date);
create index fixed_cost_occurrences_pending_idx on fixed_cost_occurrences (due_date) where status = 'pending';
create trigger fixed_cost_occurrences_updated_at before update on fixed_cost_occurrences for each row execute function set_updated_at();

-- ───────────────────────── savings goals ─────────────────────────
create table savings_goals (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 text not null references users(line_user_id) on delete cascade,
  name                    text not null check (char_length(name) between 1 and 60),
  target_satang           bigint not null check (target_satang > 0 and target_satang <= 100000000000),
  monthly_reserve_satang  bigint not null default 0 check (monthly_reserve_satang >= 0 and monthly_reserve_satang <= 100000000000),
  target_date             date,
  status                  text not null default 'active' check (status in ('active', 'completed', 'archived')),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index savings_goals_user_idx on savings_goals (user_id);
create trigger savings_goals_updated_at before update on savings_goals for each row execute function set_updated_at();

-- ───────────────────────── transactions ─────────────────────────
create table transactions (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   text not null references users(line_user_id) on delete cascade,
  type                      text not null check (type in ('income', 'expense', 'saving')),
  amount_satang             bigint not null check (amount_satang > 0 and amount_satang <= 100000000000),
  category_id               text not null check (char_length(category_id) between 1 and 40),
  note                      text check (char_length(note) <= 200),
  txn_date                  date not null,
  source                    text not null default 'chat' check (source in ('chat', 'rich_menu', 'fixed_cost', 'savings', 'import')),
  fixed_cost_occurrence_id  uuid references fixed_cost_occurrences(id) on delete set null,
  savings_goal_id           uuid references savings_goals(id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  deleted_at                timestamptz,
  constraint transactions_occurrence_is_expense check (fixed_cost_occurrence_id is null or type = 'expense'),
  constraint transactions_goal_is_saving check (savings_goal_id is null or type = 'saving')
);
-- an occurrence can be settled by at most one live transaction: prevents paying a bill twice
create unique index transactions_one_payment_per_occurrence
  on transactions (fixed_cost_occurrence_id)
  where fixed_cost_occurrence_id is not null and deleted_at is null;
create index transactions_user_date_idx on transactions (user_id, txn_date) where deleted_at is null;
create trigger transactions_updated_at before update on transactions for each row execute function set_updated_at();

-- ───────────────────────── budgets ─────────────────────────
create table budgets (
  id            uuid primary key default gen_random_uuid(),
  user_id       text not null references users(line_user_id) on delete cascade,
  category_id   text not null check (char_length(category_id) between 1 and 40), -- 'total' = overall cap
  limit_satang  bigint not null check (limit_satang > 0 and limit_satang <= 100000000000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint budgets_one_per_category unique (user_id, category_id)
);
create trigger budgets_updated_at before update on budgets for each row execute function set_updated_at();

-- each threshold alert fires once per budget per period
create table budget_alerts (
  budget_id     uuid not null references budgets(id) on delete cascade,
  user_id       text not null references users(line_user_id) on delete cascade,
  period_start  date not null,
  threshold     smallint not null check (threshold between 1 and 1000),
  sent_at       timestamptz not null default now(),
  primary key (budget_id, period_start, threshold)
);

-- ───────────────────────── conversation state ─────────────────────────
-- Drafts awaiting the user's confirm/cancel tap. Nothing financial is written until confirmed.
create table pending_actions (
  id           uuid primary key default gen_random_uuid(),
  user_id      text not null references users(line_user_id) on delete cascade,
  kind         text not null check (char_length(kind) between 1 and 40),
  payload      jsonb not null,
  status       text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled', 'expired')),
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);
create index pending_actions_user_idx on pending_actions (user_id, created_at desc) where status = 'pending';

-- Multi-step flows ("awaiting amount for category X").
create table conversation_states (
  user_id     text primary key references users(line_user_id) on delete cascade,
  state       text not null check (char_length(state) between 1 and 40),
  context     jsonb not null default '{}'::jsonb,
  expires_at  timestamptz not null,
  updated_at  timestamptz not null default now()
);

-- ───────────────────────── idempotency ─────────────────────────
-- LINE may redeliver webhooks; the event id is recorded before processing.
create table webhook_events (
  webhook_event_id  text primary key check (char_length(webhook_event_id) between 1 and 64),
  event_type        text not null,
  received_at       timestamptz not null default now()
);
create index webhook_events_received_idx on webhook_events (received_at);

-- Scheduled jobs record one row per (job, run key, user) so re-runs never double-send.
create table job_runs (
  job         text not null check (char_length(job) between 1 and 40),
  run_key     text not null check (char_length(run_key) between 1 and 60),
  user_id     text not null default '',
  created_at  timestamptz not null default now(),
  primary key (job, run_key, user_id)
);

-- ───────────────────────── row level security ─────────────────────────
alter table users                  enable row level security;
alter table fixed_costs            enable row level security;
alter table fixed_cost_occurrences enable row level security;
alter table savings_goals          enable row level security;
alter table transactions           enable row level security;
alter table budgets                enable row level security;
alter table budget_alerts          enable row level security;
alter table pending_actions        enable row level security;
alter table conversation_states    enable row level security;
alter table webhook_events         enable row level security;
alter table job_runs               enable row level security;

-- On Supabase, also strip default grants from the public API roles (no-op elsewhere).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon';
    execute 'revoke all on all functions in schema public from anon';
    execute 'alter default privileges in schema public revoke all on tables from anon';
    execute 'alter default privileges in schema public revoke all on functions from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on all tables in schema public from authenticated';
    execute 'revoke all on all functions in schema public from authenticated';
    execute 'alter default privileges in schema public revoke all on tables from authenticated';
    execute 'alter default privileges in schema public revoke all on functions from authenticated';
  end if;
end;
$$;
