-- Engagement: streak reminders preference, referral codes, referrals and one-time rewards.
alter table users add column notify_streak boolean not null default true;
alter table users add column referral_code text unique check (referral_code ~ '^[A-Z0-9]{6}$');

-- One row per invited user (a user can be invited only once).
create table referrals (
  referee_id   text primary key references users(line_user_id) on delete cascade,
  referrer_id  text not null references users(line_user_id) on delete cascade,
  created_at   timestamptz not null default now(),
  rewarded_at  timestamptz,
  check (referee_id <> referrer_id)
);
create index referrals_referrer_idx on referrals (referrer_id);

-- Idempotency for rewards: each (user, key) can be granted once, e.g. 'streak30', 'referral:<referee>'.
create table user_rewards (
  user_id     text not null references users(line_user_id) on delete cascade,
  reward_key  text not null check (char_length(reward_key) between 1 and 80),
  days        integer not null check (days > 0),
  granted_at  timestamptz not null default now(),
  primary key (user_id, reward_key)
);

-- Activity lookups for streaks (distinct Bangkok days with a recorded entry).
create index transactions_user_created_idx on transactions (user_id, created_at desc);

alter table referrals enable row level security;
alter table user_rewards enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on referrals, user_rewards from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on referrals, user_rewards from authenticated'; end if;
end;
$$;
