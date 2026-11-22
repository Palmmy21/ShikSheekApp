-- Story cards shared to IG/FB/TikTok stories: one row per share/save, for measuring the viral loop.
create table story_shares (
  id          bigint generated always as identity primary key,
  user_id     text not null references users(line_user_id) on delete cascade,
  card        text not null check (card in ('recap', 'streak', 'goal')),
  method      text not null check (method in ('share', 'download')),
  created_at  timestamptz not null default now()
);
create index story_shares_user_idx on story_shares (user_id, created_at desc);
create index story_shares_created_idx on story_shares (created_at desc);

alter table story_shares enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on story_shares from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on story_shares from authenticated'; end if;
end;
$$;
