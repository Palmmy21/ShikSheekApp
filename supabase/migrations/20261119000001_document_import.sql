-- Slip / PDF import support.
-- external_ref = bank transfer reference (slips) or a content fingerprint (PDF statement rows).
-- A live transaction can carry a given external_ref only once per user → re-sending the same
-- slip or re-importing the same statement never double-counts.

alter table transactions add column external_ref text check (char_length(external_ref) between 1 and 120);

create unique index transactions_one_per_external_ref
  on transactions (user_id, external_ref)
  where external_ref is not null and deleted_at is null;

alter table transactions drop constraint transactions_source_check;
alter table transactions add constraint transactions_source_check
  check (source in ('chat', 'rich_menu', 'fixed_cost', 'savings', 'import', 'slip', 'pdf', 'liff'));
