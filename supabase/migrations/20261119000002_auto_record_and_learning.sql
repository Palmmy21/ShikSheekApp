-- Auto-record (save confident entries without a confirm tap; always with an undo button)
alter table users add column auto_record boolean not null default false;

-- Per-user category learning: when a user corrects a category, remember note → category.
create table user_category_rules (
  user_id      text not null references users(line_user_id) on delete cascade,
  keyword      text not null check (char_length(keyword) between 1 and 60),
  category_id  text not null check (char_length(category_id) between 1 and 40),
  hits         integer not null default 1,
  updated_at   timestamptz not null default now(),
  primary key (user_id, keyword)
);
alter table user_category_rules enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on user_category_rules from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on user_category_rules from authenticated';
  end if;
end;
$$;
