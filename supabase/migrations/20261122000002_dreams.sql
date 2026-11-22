-- Life plan ("อนาคตที่อยากมี"): a dream is a savings goal with a kind and a target date.
alter table savings_goals add column dream text check (dream in ('home', 'travel', 'retire', 'business', 'car', 'education', 'wedding', 'freedom', 'custom'));
create index savings_goals_dream_idx on savings_goals (user_id) where dream is not null;
