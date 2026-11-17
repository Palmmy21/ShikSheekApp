# Product & technical decisions

| # | Date | Decision | Why |
|---|------|----------|-----|
| 1 | 2026-11-18 | **Supabase** (Postgres + Edge Functions + pg_cron) instead of Firebase | Owner preference. Postgres gives real transactions, UNIQUE/CHECK constraints and SQL aggregates — a better fit for money. |
| 2 | 2026-11-18 | Money is integer **satang** (`BIGINT` in SQL, safe integers in TS) | No float rounding errors. |
| 3 | 2026-11-18 | Budget period = calendar month by default; user may set a cycle start day **1–28** | Supports payday cycles; 29–31 don't exist in every month. |
| 4 | 2026-11-18 | Available-to-spend = income − expenses − savings contributed − unpaid Fixed Costs (due ≤ period end, incl. overdue) − remaining savings reservation. **No carry-over** from previous periods. | Simple and explainable. See `src/domain/calculations/available.ts`. |
| 5 | 2026-11-18 | Marking a Fixed Cost occurrence **paid** creates one linked expense transaction (after a confirm tap). Reminders never create transactions. | Paid bills are counted exactly once, via their expense. DB enforces one live payment per occurrence. |
| 6 | 2026-11-18 | Occurrence display status (upcoming/due/overdue) is **derived** from dates; only pending/paid/skipped is stored. | No scheduled job needed to flip statuses; no drift. |
| 7 | 2026-11-18 | Saved amount of a goal is **derived** from `saving` transactions, never stored. | Single source of truth. |
| 8 | 2026-11-18 | Rule-based Thai parser first; optional Claude layer in Phase 8, which can only propose structured data that is re-validated. | Correctness doesn't depend on an AI provider. |
| 9 | 2026-11-18 | Tests run against **PGlite** (in-process Postgres) with the real migrations. | No Docker on the dev machine; still tests real SQL/constraints. |
| 10 | 2026-11-18 | Recurrence dates are computed from the **anchor**, not the previous occurrence; occurrence keys are calendar-based (`M2026-02`, `W2026-11-16`, `Y2026`, `D2026-11-21`). | No month-end drift; editing the due day doesn't create a second bill for the same month. |
