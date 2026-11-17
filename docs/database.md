# Database schema (Supabase Postgres)

Source of truth: `supabase/migrations/`. All money columns are `BIGINT` **satang**.

## Tables

| Table | Purpose | Key constraints |
|---|---|---|
| `users` | One row per LINE user (`line_user_id` = `U` + 32 hex). Settings + notification prefs. | `cycle_start_day` 1–28 |
| `transactions` | Income / expense / saving records. Soft delete via `deleted_at`. | `amount_satang > 0`; only `expense` may link `fixed_cost_occurrence_id`; only `saving` may link `savings_goal_id`; **one live payment per occurrence** (partial unique index) |
| `fixed_costs` | Recurring obligations: weekly / monthly / yearly / custom (every N days). | `end_date >= anchor_date`; status `active`/`paused` |
| `fixed_cost_occurrences` | One bill per period per fixed cost. | **`UNIQUE (fixed_cost_id, occurrence_key)`** → generation is idempotent |
| `savings_goals` | Target + monthly reservation. Saved amount is derived from transactions. | |
| `budgets` | Monthly limit per category (`total` = overall cap). | `UNIQUE (user_id, category_id)` |
| `budget_alerts` | Which threshold alert (50/80/100 %) was already sent for a period. | PK `(budget_id, period_start, threshold)` |
| `pending_actions` | Parsed drafts waiting for the user's confirm/cancel. Nothing financial is written before confirm. | |
| `conversation_states` | Multi-step chat flows (e.g. "waiting for amount"). | one per user |
| `webhook_events` | LINE `webhookEventId`s already processed. | PK → redeliveries are ignored |
| `job_runs` | Scheduler idempotency: one row per `(job, run_key, user)`. | PK |

## Ownership & isolation

- Every user-owned table has `user_id → users ON DELETE CASCADE`. Deleting a user removes all of their data (tested).
- Row Level Security is enabled on **all** tables with **no policies**; the `anon` and `authenticated` roles have their grants revoked. Only the server-side connection (Edge Functions via `SUPABASE_DB_URL`) can access data, and every repository query filters by `user_id`.

## Derived (not stored) values

- Occurrence display status: `upcoming` / `due` / `overdue` from `due_date` vs today (Asia/Bangkok).
- Savings goal saved amount: sum of live `saving` transactions for the goal.
- Period membership: transactions store `txn_date`; periods are computed from the user's `cycle_start_day`, so changing the cycle never requires rewriting rows.
