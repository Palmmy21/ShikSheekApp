-- One-time, short-lived download tokens for "export my data".
-- Only the SHA-256 hash of the token is stored; the token itself lives only in the LINE message.
create table data_export_tokens (
  token_hash  text primary key check (char_length(token_hash) = 64),
  user_id     text not null references users(line_user_id) on delete cascade,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index data_export_tokens_user_idx on data_export_tokens (user_id);
alter table data_export_tokens enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on data_export_tokens from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on data_export_tokens from authenticated';
  end if;
end;
$$;
