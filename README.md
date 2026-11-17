# ShikSheek 🐔 — ให้เรื่องเงินเป็นเรื่องชิกชิก!

LINE-first personal finance assistant with a chicken mascot. Record income and expenses in natural Thai
("กินข้าว 65"), track Fixed Costs, budgets and savings goals, and get daily/monthly summaries in LINE.

> **Status:** Phase 1–2 of 10 complete (foundation, database schema, financial engine).
> The LINE bot is **not** usable yet. See [Roadmap](#roadmap).

## Stack

| Layer | Tech |
|---|---|
| Language | TypeScript (runs on Node for tests/scripts, Deno for Supabase Edge Functions) |
| Database | Supabase Postgres (`supabase/migrations`) |
| Webhook & jobs | Supabase Edge Functions + pg_cron (Phase 3+) |
| Messaging | LINE Messaging API (Flex Messages, Rich Menu) |
| Validation | Zod |
| Tests | Vitest + PGlite (real Postgres in-process, no Docker needed) |

## Project layout

```
src/
  domain/            pure business logic — no I/O, integer satang only
    money.ts         parse/format baht ↔ satang
    dates.ts         calendar dates, Asia/Bangkok "today", Thai formatting
    period.ts        budget periods (calendar month or payday cycle 1–28)
    recurrence.ts    Fixed Cost recurrence (weekly/monthly/yearly/custom) + occurrence keys
    entities/        entity types, built-in categories (+ Thai keywords)
    calculations/    summary, available-to-spend, budgets, savings, bills
  application/       use cases + validators            (Phase 4+)
  infrastructure/    db (SQL port), line, ai, scheduler (Phase 3+)
  presentation/line/ handlers, flex templates, rich menu (Phase 3+)
supabase/migrations/ SQL schema
tests/unit           domain tests
tests/integration    schema/repository tests on PGlite
assets/branding      logo + mascot sticker sheet
docs/                decisions, database, (setup guides later)
```

## Getting started

```bash
npm install
npm test          # unit + integration tests (PGlite boots automatically)
npm run typecheck
```

## How money is calculated

```
available = income − expenses − savings contributed − unpaid Fixed Costs − remaining savings reservation
```

- Paid Fixed Costs are expense transactions linked to their occurrence → counted **once**.
- Unpaid = pending occurrences due on/before the period end (including overdue).
- No carry-over between periods. Negative results are allowed and shown.

Details and rationale: [`docs/decisions.md`](docs/decisions.md), schema: [`docs/database.md`](docs/database.md).

## Roadmap

- [x] Phase 1 — Project foundation & database schema
- [x] Phase 2 — Financial engine
- [ ] Phase 3 — LINE webhook & message routing
- [ ] Phase 4 — Onboarding & transaction management
- [ ] Phase 5 — Fixed Costs & available balance
- [ ] Phase 6 — Budgets & savings goals
- [ ] Phase 7 — Flex Messages & Rich Menu
- [ ] Phase 8 — AI personality
- [ ] Phase 9 — Scheduled automation
- [ ] Phase 10 — Testing, security, deployment & docs
- [ ] Landing page (product website)
