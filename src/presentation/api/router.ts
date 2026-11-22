/**
 * JSON API for the LIFF web app. Runtime-agnostic: (Request) → Response.
 *
 * Auth: `Authorization: Bearer <LIFF ID token>`, verified with LINE on every request (cached until
 * expiry). The verified `sub` is the ONLY user id ever used — no id is read from the URL or body.
 * Money crosses the wire as integer satang plus a formatted string; inputs are baht strings parsed
 * exactly (no floats). All money maths stays in the domain/services.
 */
import { z } from 'zod';
import { validateDraft, ValidationError } from '../../application/services/transaction-service.ts';
import { PlanLimitError } from '../../application/services/entitlement-service.ts';
import { computeBudgetStatuses } from '../../domain/calculations/budget.ts';
import { dailyExpenseSeries, expenseByCategoryMap } from '../../domain/calculations/summary.ts';
import { bangkokToday, type LocalDate } from '../../domain/dates.ts';
import { CATEGORIES, getCategory } from '../../domain/entities/categories.ts';
import type { NotificationPrefs, Transaction } from '../../domain/entities/index.ts';
import { formatBaht, parseBahtToSatang, type Satang } from '../../domain/money.ts';
import { periodForDate, periodFromKey, previousPeriod } from '../../domain/period.ts';
import { describeRuleThai } from '../../domain/recurrence.ts';
import { PLAN_PITCH, PRICES, REFERRAL_ACTIVATION_ENTRIES, REFERRAL_REWARD_DAYS } from '../../domain/plans.ts';
import { inviteLink, shareText } from '../line/flex/engagement.ts';
import { STORY_CARD_KINDS, type StoryCardKind } from '../../domain/calculations/story.ts';
import type { IdTokenVerifier } from '../../infrastructure/line/id-token.ts';
import { redactUserId, type AppDeps } from '../line/context.ts';

export interface ApiOptions {
  verify: IdTokenVerifier;
  allowedOrigins: string[];
}

/** Whole months between two period keys (YYYY-MM); future → 0. */
function periodsBack(currentKey: string, key: string): number {
  const n = (k: string) => Number(k.slice(0, 4)) * 12 + Number(k.slice(5, 7));
  return Math.max(0, n(currentKey) - n(key));
}

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const money = (satang: Satang) => ({ satang, text: formatBaht(satang) });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const bahtText = z.string().max(20).transform((v, ctx) => {
  const s = parseBahtToSatang(v.replace(/,/g, '').trim());
  if (s === null || s <= 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'จำนวนเงินไม่ถูกต้อง' });
    return z.NEVER;
  }
  return s;
});

function txnJson(t: Transaction) {
  const c = getCategory(t.categoryId);
  return {
    id: t.id,
    type: t.type,
    amount: money(t.amountSatang),
    category: { id: c.id, label: c.labelTh, emoji: c.emoji },
    note: t.note,
    date: t.txnDate,
    source: t.source,
    isBillPayment: t.fixedCostOccurrenceId !== null,
  };
}

const TxnCreate = z.object({
  type: z.enum(['income', 'expense']),
  amount: bahtText,
  categoryId: z.string().max(40),
  note: z.string().max(200).nullable().optional(),
  date,
});
const TxnPatch = z.object({
  type: z.enum(['income', 'expense']).optional(),
  amount: bahtText.optional(),
  categoryId: z.string().max(40).optional(),
  note: z.string().max(200).nullable().optional(),
  date: date.optional(),
});
const FixedCostCreate = z.object({
  name: z.string().trim().min(1).max(60),
  amount: bahtText,
  categoryId: z.string().max(40).default('bills'),
  frequency: z.enum(['weekly', 'monthly', 'yearly', 'custom']),
  interval: z.number().int().min(1).max(366).default(1),
  firstDueDate: date,
  remindDaysBefore: z.number().int().min(0).max(14).default(1),
});
const BudgetPut = z.object({ limit: bahtText });
const GoalCreate = z.object({ name: z.string().trim().min(1).max(60), target: bahtText, monthlyReserve: z.string().max(20).optional() });
const AmountBody = z.object({ amount: bahtText.optional() });
const SettingsPatch = z.object({
  cycleStartDay: z.number().int().min(1).max(28).optional(),
  autoRecord: z.boolean().optional(),
  notifications: z
    .object({ dailySummary: z.boolean(), weeklySummary: z.boolean(), monthlySummary: z.boolean(), billReminders: z.boolean(), budgetAlerts: z.boolean(), streakReminders: z.boolean() })
    .partial()
    .optional(),
});

async function body<T extends z.ZodTypeAny>(req: Request, schema: T): Promise<z.output<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, 'invalid json');
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw new HttpError(422, r.error.issues.map((i) => i.message).join('; '));
  return r.data;
}

function corsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  const ok = origin && allowed.includes(origin);
  return {
    ...(ok ? { 'Access-Control-Allow-Origin': origin } : {}),
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Max-Age': '600',
  };
}

export async function handleApiRequest(req: Request, deps: AppDeps, opts: ApiOptions): Promise<Response> {
  const origin = req.headers.get('origin');
  const cors = corsHeaders(origin, opts.allowedOrigins);
  const json = (status: number, data: unknown) =>
    new Response(JSON.stringify(data), { status, headers: { ...cors, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (origin && !opts.allowedOrigins.includes(origin)) return json(403, { error: 'origin not allowed' });

  const url = new URL(req.url);
  const idx = url.pathname.indexOf('/api');
  const path = (idx >= 0 ? url.pathname.slice(idx + 4) : url.pathname).replace(/\/+$/, '') || '/';
  const seg = path.split('/').filter(Boolean);

  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const identity = token ? await opts.verify(token).catch(() => null) : null;
  if (!identity) return json(401, { error: 'unauthorized' });
  const userId = identity.userId;
  const today: LocalDate = bangkokToday(deps.clock());

  try {
    await deps.repos.users.ensure(userId, identity.name);
    const { txns, fixedCosts: fc, finance: fin } = deps;
    const m = req.method;
    const is = (method: string, ...parts: string[]) =>
      m === method && seg.length === parts.length && parts.every((p, i) => p === '*' || p === seg[i]);

    // ── profile & meta ──
    if (is('GET', 'me')) {
      const [u, s] = await Promise.all([deps.repos.users.get(userId), deps.plans.status(userId)]);
      return json(200, { displayName: u!.displayName, cycleStartDay: u!.cycleStartDay, notifications: u!.notifications, autoRecord: u!.autoRecord, today, plan: { id: s.plan, label: s.limits.label, source: s.source, daysLeft: s.daysLeft } });
    }
    if (is('GET', 'categories')) return json(200, CATEGORIES.map((c) => ({ id: c.id, kind: c.kind, label: c.labelTh, emoji: c.emoji })));

    // ── dashboard ──
    if (is('GET', 'dashboard')) {
      const v = await fin.dashboard(userId, today);
      const a = v.available;
      return json(200, {
        period: { key: v.period.key, start: v.period.start, end: v.period.end },
        available: money(a.availableSatang),
        dailyAllowance: money(a.dailyAllowanceSatang),
        daysRemaining: a.daysRemaining,
        isNegative: a.isNegative,
        hasIncome: a.hasIncome,
        income: money(a.incomeSatang),
        expense: money(a.expenseSatang),
        unpaidBills: money(a.unpaidFixedCostsSatang),
        unpaidBillCount: a.unpaidFixedCostCount,
        savings: money(a.savingContributedSatang + a.savingsReservedSatang),
        today: money(v.todayExpenseSatang),
        topCategories: v.totals.expenseByCategory.slice(0, 6).map((c) => ({ ...categoryRef(c.categoryId), amount: money(c.amountSatang) })),
        upcomingBills: v.upcomingBills.slice(0, 5).map((b) => ({ occurrenceId: b.id, name: v.fixedCostNames[b.fixedCostId] ?? 'บิล', dueDate: b.dueDate, status: b.displayStatus, amount: money(b.amountSatang) })),
        budgets: v.budgets.slice(0, 4).map(budgetJson),
      });
    }

    // ── transactions ──
    if (is('GET', 'transactions')) {
      const q = url.searchParams;
      const page = Math.max(0, Math.min(500, Number(q.get('page') ?? 0) || 0));
      const rows = await deps.repos.transactions.search(userId, {
        limit: 31,
        offset: page * 30,
        type: q.get('type') || null,
        categoryId: q.get('category') || null,
        from: q.get('from') && date.safeParse(q.get('from')).success ? q.get('from') : null,
        to: q.get('to') && date.safeParse(q.get('to')).success ? q.get('to') : null,
        q: q.get('q')?.slice(0, 50) || null,
      });
      return json(200, { items: rows.slice(0, 30).map(txnJson), hasMore: rows.length > 30, page });
    }
    if (is('POST', 'transactions')) {
      // The LIFF form is an explicit, structured entry: submitting it IS the confirmation.
      const b = await body(req, TxnCreate);
      const draft = { type: b.type, amountSatang: b.amount, categoryId: b.categoryId, categoryConfident: true, note: b.note?.trim() || null, txnDate: b.date, source: 'liff' as const };
      validateDraft(draft, today);
      const t = await deps.repos.transactions.insert({ userId, type: draft.type, amountSatang: draft.amountSatang, categoryId: draft.categoryId, note: draft.note, txnDate: draft.txnDate, source: 'liff' });
      return json(201, txnJson(t));
    }
    if (is('PATCH', 'transactions', '*')) {
      const b = await body(req, TxnPatch);
      const current = await deps.repos.transactions.get(userId, seg[1]!);
      if (!current || current.deletedAt) throw new HttpError(404, 'not found');
      if (current.type === 'saving') throw new HttpError(422, 'แก้รายการออมผ่านเมนูเป้าหมาย');
      if (current.fixedCostOccurrenceId && b.type && b.type !== current.type) throw new HttpError(422, 'รายการจ่ายบิลต้องเป็นรายจ่าย');
      const next = {
        type: (b.type ?? current.type) as 'income' | 'expense',
        amountSatang: b.amount ?? current.amountSatang,
        categoryId: b.categoryId ?? (b.type && b.type !== current.type ? (b.type === 'income' ? 'other_income' : 'other_expense') : current.categoryId),
        categoryConfident: true,
        note: b.note !== undefined ? b.note?.trim() || null : current.note,
        txnDate: b.date ?? current.txnDate,
        source: current.source,
      };
      validateDraft(next, today);
      const t = await deps.repos.transactions.update(userId, current.id, { type: next.type, amountSatang: next.amountSatang, categoryId: next.categoryId, note: next.note, txnDate: next.txnDate });
      // learn from category corrections made in the app as well
      if (b.categoryId && b.categoryId !== current.categoryId && next.note) await deps.repos.categoryRules.learn(userId, next.note, b.categoryId);
      return json(200, txnJson(t!));
    }
    if (is('DELETE', 'transactions', '*')) {
      const t = await txns.remove(userId, seg[1]!);
      if (!t) throw new HttpError(404, 'not found');
      return json(200, { deleted: t.id });
    }
    if (is('POST', 'transactions', '*', 'restore')) {
      const t = await txns.restore(userId, seg[1]!);
      if (!t) throw new HttpError(409, 'กู้คืนไม่ได้แล้ว');
      return json(200, txnJson(t));
    }

    // ── fixed costs ──
    if (is('GET', 'fixed-costs')) {
      const list = await fc.list(userId, today);
      return json(200, list.map(({ fixedCost: f, next, overdue }) => ({
        id: f.id,
        name: f.name,
        amount: money(f.amountSatang),
        category: categoryRef(f.categoryId),
        schedule: describeRuleThai({ frequency: f.frequency, interval: f.interval, anchorDate: f.anchorDate }),
        status: f.status,
        remindDaysBefore: f.remindDaysBefore,
        next: next ? { occurrenceId: next.id || null, dueDate: next.dueDate, status: next.displayStatus, amount: money(next.amountSatang) } : null,
        overdue: overdue.map((o) => ({ occurrenceId: o.id, dueDate: o.dueDate, amount: money(o.amountSatang) })),
      })));
    }
    if (is('POST', 'fixed-costs')) {
      const b = await body(req, FixedCostCreate);
      if (b.firstDueDate < today) throw new HttpError(422, 'วันครบกำหนดครั้งแรกต้องเป็นวันนี้หรืออนาคต');
      await deps.plans.assertCanAdd(userId, 'fixed_costs');
      const f = await fc.create(userId, { name: b.name, amountSatang: b.amount, categoryId: b.categoryId, rule: { frequency: b.frequency, interval: b.interval, anchorDate: b.firstDueDate }, remindDaysBefore: b.remindDaysBefore }, today);
      return json(201, { id: f.id });
    }
    if (is('POST', 'fixed-costs', '*', 'pause')) return ok(await fc.pause(userId, seg[1]!, today));
    if (is('POST', 'fixed-costs', '*', 'resume')) return ok(await fc.resume(userId, seg[1]!, today));
    if (is('DELETE', 'fixed-costs', '*')) return ok(await fc.remove(userId, seg[1]!, today));
    if (is('POST', 'occurrences', '*', 'pay')) {
      const b = await body(req, AmountBody);
      const r = await fc.pay(userId, seg[1]!, today, b.amount);
      if (r.status === 'not_found') throw new HttpError(404, 'not found');
      if (r.status === 'already_resolved') throw new HttpError(409, 'บิลงวดนี้บันทึกไปแล้ว');
      return json(200, txnJson(r.transaction));
    }
    if (is('POST', 'occurrences', '*', 'skip')) return ok((await fc.skip(userId, seg[1]!)) !== null);

    // ── budgets ──
    if (is('GET', 'budgets')) {
      const { period, statuses } = await fin.budgets(userId, today);
      return json(200, { period: { start: period.start, end: period.end }, items: statuses.map(budgetJson) });
    }
    if (is('PUT', 'budgets', '*')) {
      const b = await body(req, BudgetPut);
      await deps.plans.assertCanAdd(userId, 'category_budget', seg[1]!);
      const bud = await fin.setBudget(userId, seg[1]!, b.limit);
      return json(200, { id: bud.id });
    }
    if (is('DELETE', 'budgets', '*')) return ok(await fin.deleteBudget(userId, seg[1]!));

    // ── goals ──
    if (is('GET', 'goals')) {
      const goals = await fin.goals(userId);
      return json(200, goals.map((g) => ({
        id: g.goal.id,
        name: g.goal.name,
        target: money(g.goal.targetSatang),
        saved: money(g.savedSatang),
        monthlyReserve: money(g.goal.monthlyReserveSatang),
        progressPercent: Math.floor(g.progressBasisPoints / 100),
        isReached: g.isReached,
        periodsToGoal: g.periodsToGoal,
      })));
    }
    if (is('POST', 'goals')) {
      const b = await body(req, GoalCreate);
      const reserve = b.monthlyReserve ? parseBahtToSatang(b.monthlyReserve.replace(/,/g, '')) : 0;
      if (reserve === null) throw new HttpError(422, 'ยอดออมต่อเดือนไม่ถูกต้อง');
      await deps.plans.assertCanAdd(userId, 'goals');
      const g = await fin.createGoal(userId, { name: b.name, targetSatang: b.target, monthlyReserveSatang: reserve });
      return json(201, { id: g.id });
    }
    if (is('POST', 'goals', '*', 'contribute')) {
      const b = await body(req, AmountBody);
      if (!b.amount) throw new HttpError(422, 'ใส่จำนวนเงิน');
      const g = await deps.repos.goals.get(userId, seg[1]!);
      if (!g || g.status === 'archived') throw new HttpError(404, 'not found');
      const draft = { type: 'saving' as const, amountSatang: b.amount, categoryId: 'savings', categoryConfident: true, note: null, txnDate: today, source: 'liff' as const, savingsGoalId: g.id };
      validateDraft(draft, today);
      const t = await deps.repos.transactions.insert({ userId, ...draft });
      return json(201, txnJson(t));
    }
    if (is('POST', 'goals', '*', 'archive')) return ok(await fin.archiveGoal(userId, seg[1]!));

    // ── plan ──
    if (is('GET', 'plan')) {
      const [s, u] = await Promise.all([deps.plans.status(userId), deps.plans.usage(userId, today)]);
      const payable = !!deps.payments?.availableFor(userId);
      const earlyBird = payable ? await deps.payments!.earlyBirdAvailable(userId) : true;
      return json(200, { plan: s.plan, label: s.limits.label, source: s.source, until: s.until, daysLeft: s.daysLeft, limits: s.limits, usage: u, prices: PRICES, pitch: PLAN_PITCH, payable, earlyBird });
    }
    if (is('POST', 'plan', 'checkout')) {
      if (!deps.payments?.availableFor(userId)) throw new HttpError(503, 'ยังไม่เปิดรับชำระเงิน');
      const b = await body(req, z.object({ product: z.enum(['plus_monthly', 'plus_yearly', 'plus_early', 'pro_monthly', 'pro_yearly']) }));
      if (b.product === 'plus_early' && !(await deps.payments.earlyBirdAvailable(userId))) throw new HttpError(409, 'ราคาผู้ใช้กลุ่มแรกเต็มแล้ว');
      const { payment, url: payUrl } = await deps.payments.checkout(userId, b.product);
      return json(201, { paymentId: payment.id, url: payUrl, amount: money(payment.amountSatang) });
    }
    if (is('GET', 'plan', 'payments', '*')) {
      if (!deps.payments) throw new HttpError(503, 'ยังไม่เปิดรับชำระเงิน');
      const r = await deps.payments.check(userId, seg[2]!);
      if (r.status === 'not_found') throw new HttpError(404, 'not found');
      return json(200, { status: r.status });
    }
    // ── referral & streak ──
    if (is('GET', 'referral')) {
      const [info, s] = await Promise.all([deps.engagement.referralInfo(userId), deps.engagement.streak(userId)]);
      return json(200, { ...info, link: inviteLink(info.code), shareText: shareText(info.code), rewardDays: REFERRAL_REWARD_DAYS, activationEntries: REFERRAL_ACTIVATION_ENTRIES, streak: s.days });
    }
    if (is('POST', 'referral', 'claim')) {
      const b = await body(req, z.object({ code: z.string().max(12) }));
      const r = await deps.engagement.claim(userId, b.code);
      return json(r.status === 'ok' ? 200 : 409, r);
    }
    // ── story cards (share to IG/FB stories) ──
    if (is('GET', 'story')) return json(200, await deps.story.deck(userId, today));
    if (is('POST', 'story', 'shared')) {
      const b = await body(req, z.object({ card: z.enum(STORY_CARD_KINDS as [StoryCardKind, ...StoryCardKind[]]), method: z.enum(['share', 'download']) }));
      await deps.story.recordShare(userId, b.card, b.method);
      return json(200, { ok: true });
    }
    if (is('POST', 'plan', 'interest')) {
      const b = await body(req, z.object({ plan: z.enum(['plus', 'pro']) }));
      await deps.repos.plans.addInterest(userId, b.plan);
      return json(200, { ok: true });
    }

    // ── reports ──
    if (is('GET', 'reports', 'month')) {
      const user = (await deps.repos.users.get(userId))!;
      const key = url.searchParams.get('k');
      const current = periodForDate(today, user.cycleStartDay);
      const period = key && /^\d{4}-\d{2}$/.test(key) ? periodFromKey(key, user.cycleStartDay) : current;
      await deps.plans.assertHistory(userId, periodsBack(current.key, period.key));
      const s = await fin.monthSummary(userId, today, period.key);
      const txnsInPeriod = await deps.repos.transactions.listByRange(userId, period.start, period.end);
      const range = { start: period.start, end: period.end };
      return json(200, {
        period: { key: period.key, start: period.start, end: period.end, previousKey: previousPeriod(period).key },
        income: money(s.totals.incomeSatang),
        expense: money(s.totals.expenseSatang),
        saving: money(s.totals.savingSatang),
        net: money(s.totals.netSatang),
        expenseChange: s.expenseChangeSatang === null ? null : money(s.expenseChangeSatang),
        categories: s.totals.expenseByCategory.map((c) => ({ ...categoryRef(c.categoryId), amount: money(c.amountSatang), count: c.count })),
        daily: dailyExpenseSeries(txnsInPeriod, range).map((d) => ({ date: d.date, expense: money(d.expenseSatang) })),
        budgets: computeBudgetStatuses(await deps.repos.budgets.list(userId), expenseByCategoryMap(txnsInPeriod, range)).map(budgetJson),
      });
    }

    // ── settings ──
    if (is('PATCH', 'settings')) {
      const b = await body(req, SettingsPatch);
      if (b.cycleStartDay) await deps.repos.users.setCycleStartDay(userId, b.cycleStartDay);
      if (b.autoRecord !== undefined) await deps.repos.users.setAutoRecord(userId, b.autoRecord);
      for (const [k, v] of Object.entries(b.notifications ?? {})) {
        if (typeof v === 'boolean') await deps.repos.users.setNotification(userId, k as keyof NotificationPrefs, v);
      }
      const u = (await deps.repos.users.get(userId))!;
      return json(200, { cycleStartDay: u.cycleStartDay, notifications: u.notifications, autoRecord: u.autoRecord });
    }

    // ── notifications ──
    if (is('POST', 'notifications', 'test')) {
      try {
        await deps.line.push(userId, [{ type: 'text', text: '🔔 แจ้งเตือนทดสอบจากชิกชิก ถ้าเห็นข้อความนี้ แปลว่าสรุปรายวันและเตือนบิลจะส่งถึงคุณได้แน่นอน' }]);
        return json(200, { ok: true });
      } catch (err) {
        const status = (err as { status?: number }).status ?? 0;
        deps.log.error('test_push_failed', { user: redactUserId(userId), status });
        throw new HttpError(502, status === 429 ? 'โควตา push ของ LINE OA เดือนนี้หมดแล้ว' : 'LINE ไม่ยอมส่งแจ้งเตือนถึงบัญชีนี้ ลองเพิ่มเพื่อน OA ก่อน');
      }
    }

    return json(404, { error: 'not found' });
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.message });
    if (e instanceof ValidationError) return json(422, { error: e.message });
    if (e instanceof PlanLimitError) return json(402, { error: 'plan_limit', feature: e.feature, plan: e.plan, limit: e.limit });
    deps.log.error('api_failed', { path, user: redactUserId(userId), error: e instanceof Error ? e.message : String(e) });
    return json(500, { error: 'internal error' });
  }

  function ok(done: boolean) {
    return done ? json(200, { ok: true }) : json(404, { error: 'not found' });
  }
}

function categoryRef(id: string) {
  const c = getCategory(id);
  return { id: c.id, label: c.labelTh, emoji: c.emoji };
}

function budgetJson(s: import('../../domain/calculations/budget.ts').BudgetStatus) {
  return {
    id: s.budget.id,
    category: s.budget.categoryId === 'total' ? { id: 'total', label: 'งบรวมทั้งเดือน', emoji: '🧺' } : categoryRef(s.budget.categoryId),
    limit: money(s.budget.limitSatang),
    spent: money(s.spentSatang),
    remaining: money(s.remainingSatang),
    percent: Math.floor(s.usedBasisPoints / 100),
    level: s.level,
  };
}
