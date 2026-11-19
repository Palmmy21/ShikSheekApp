import { applyPurchase, PLAN_RANK, PRODUCTS, type PaidPlan, type ProductId } from '../../../domain/plans.ts';
import { bangkokToday } from '../../../domain/dates.ts';
import { toIso, type Sql } from '../sql.ts';

export interface Payment {
  id: string;
  userId: string;
  invoiceNo: string;
  product: ProductId;
  plan: PaidPlan;
  days: number;
  amountSatang: number;
  status: 'pending' | 'paid' | 'expired';
  paymentUrl: string | null;
  gatewayRef: string | null;
  createdAt: string;
  paidAt: string | null;
}

interface Row {
  id: string;
  user_id: string;
  invoice_no: string;
  product: ProductId;
  plan: PaidPlan;
  days: number;
  amount_satang: unknown;
  status: Payment['status'];
  payment_url: string | null;
  gateway_ref: string | null;
  created_at: unknown;
  paid_at: unknown;
}
const COLS = 'id, user_id, invoice_no, product, plan, days, amount_satang, status, payment_url, gateway_ref, created_at, paid_at';
const map = (r: Row): Payment => ({
  id: r.id,
  userId: r.user_id,
  invoiceNo: r.invoice_no,
  product: r.product,
  plan: r.plan,
  days: Number(r.days),
  amountSatang: Number(r.amount_satang),
  status: r.status,
  paymentUrl: r.payment_url,
  gatewayRef: r.gateway_ref,
  createdAt: toIso(r.created_at),
  paidAt: r.paid_at ? toIso(r.paid_at) : null,
});

/** converted = first paid membership ever ("became a ShikSheek member") */
export type PlanEvent = 'converted' | 'renewed' | 'upgraded' | 'downgraded';
export interface PaidResult {
  payment: Payment;
  plan: PaidPlan;
  end: string;
  event: PlanEvent;
  /** the fee recorded as an expense in the member's ledger */
  expenseTxnId: string | null;
}

export function paymentRepo(sql: Sql) {
  return {
    async create(userId: string, invoiceNo: string, product: ProductId): Promise<Payment> {
      const p = PRODUCTS[product];
      const rows = await sql.query<Row>(
        `insert into payments (user_id, invoice_no, product, plan, days, amount_satang) values ($1, $2, $3, $4, $5, $6) returning ${COLS}`,
        [userId, invoiceNo, product, p.plan, p.days, p.baht * 100],
      );
      return map(rows[0]!);
    },
    async setCheckout(id: string, url: string, gatewayRef: string): Promise<void> {
      await sql.query(`update payments set payment_url = $2, gateway_ref = $3 where id = $1`, [id, url, gatewayRef]);
    },
    async get(userId: string, id: string): Promise<Payment | null> {
      const rows = await sql.query<Row>(`select ${COLS} from payments where id = $1 and user_id = $2`, [id, userId]);
      return rows[0] ? map(rows[0]) : null;
    },
    async getByInvoice(invoiceNo: string): Promise<Payment | null> {
      const rows = await sql.query<Row>(`select ${COLS} from payments where invoice_no = $1`, [invoiceNo]);
      return rows[0] ? map(rows[0]) : null;
    },
    /** A still-usable pending checkout for this product (so double taps reuse one QR). */
    async findRecentPending(userId: string, product: ProductId, sinceMinutes: number): Promise<Payment | null> {
      const rows = await sql.query<Row>(
        `select ${COLS} from payments where user_id = $1 and product = $2 and status = 'pending' and payment_url is not null
           and created_at > now() - make_interval(mins => $3) order by created_at desc limit 1`,
        [userId, product, sinceMinutes],
      );
      return rows[0] ? map(rows[0]) : null;
    },
    async countPaid(product: ProductId, userId?: string): Promise<number> {
      const rows = await sql.query<{ n: unknown }>(
        `select count(*) as n from payments where product = $1 and status = 'paid' and ($2::text is null or user_id = $2)`,
        [product, userId ?? null],
      );
      return Number(rows[0]?.n ?? 0);
    },

    /**
     * pending → paid exactly once, and extend the subscription in the same transaction.
     * Returns the new subscription end, or null if this payment was already settled.
     */
    async markPaidAndGrant(invoiceNo: string, ref: { providerRef: string | null; channelCode: string | null }, now: Date): Promise<PaidResult | null> {
      return sql.transaction(async (tx) => {
        const rows = await tx.query<Row>(
          `update payments set status = 'paid', paid_at = $2, provider_ref = $3, channel_code = $4
           where invoice_no = $1 and status in ('pending', 'expired') returning ${COLS}`,
          [invoiceNo, now.toISOString(), ref.providerRef, ref.channelCode],
        );
        if (!rows[0]) return null;
        const payment = map(rows[0]);
        const cur = await tx.query<{ plan: PaidPlan; current_period_end: unknown }>(
          `select plan, current_period_end from subscriptions where user_id = $1 for update`,
          [payment.userId],
        );
        const current = cur[0] ? { plan: cur[0].plan, end: Date.parse(toIso(cur[0].current_period_end)) } : null;
        const next = applyPurchase(current, payment.product, now.getTime());
        const end = new Date(next.end).toISOString();
        await tx.query(
          `insert into subscriptions (user_id, plan, source, current_period_end) values ($1, $2, 'payment', $3)
           on conflict (user_id) do update set plan = excluded.plan, source = 'payment',
             current_period_end = excluded.current_period_end, updated_at = now()`,
          [payment.userId, next.plan, end],
        );
        // ── membership bookkeeping (same transaction) ──
        const prior = await tx.query<{ n: unknown }>(`select count(*) as n from payments where user_id = $1 and status = 'paid' and id <> $2`, [payment.userId, payment.id]);
        const active = current && current.end > now.getTime() ? current.plan : null;
        const event: PlanEvent =
          Number(prior[0]?.n ?? 0) === 0 ? 'converted' : !active || active === payment.plan ? 'renewed' : PLAN_RANK[payment.plan] > PLAN_RANK[active] ? 'upgraded' : 'downgraded';
        await tx.query(
          `insert into plan_events (user_id, event, plan, product, amount_satang, payment_id) values ($1, $2, $3, $4, $5, $6) on conflict (payment_id) do nothing`,
          [payment.userId, event, payment.plan, payment.product, payment.amountSatang, payment.id],
        );
        await tx.query(`update users set member_since = coalesce(member_since, $2) where line_user_id = $1`, [payment.userId, now.toISOString()]);
        // the fee is real spending: record it in the member's own ledger (bills), once per invoice
        const expense = await tx.query<{ id: string }>(
          `insert into transactions (user_id, type, amount_satang, category_id, note, txn_date, source, external_ref)
           values ($1, 'expense', $2, 'bills', $3, $4, 'payment', $5)
           on conflict (user_id, external_ref) where external_ref is not null and deleted_at is null do nothing
           returning id`,
          [payment.userId, payment.amountSatang, `ค่าสมาชิก ชิกชิก ${PRODUCTS[payment.product].label}`, bangkokToday(now), `pay:${payment.invoiceNo}`],
        );
        return { payment: { ...payment, status: 'paid' as const }, plan: next.plan, end, event, expenseTxnId: expense[0]?.id ?? null };
      });
    },

    async expireOlderThan(hours: number): Promise<number> {
      const rows = await sql.query(`update payments set status = 'expired' where status = 'pending' and created_at < now() - make_interval(hours => $1) returning id`, [hours]);
      return rows.length;
    },

    /** Paid subscriptions ending within [from, to) — for renewal reminders. */
    async listEnding(from: Date, to: Date): Promise<Array<{ userId: string; plan: PaidPlan; end: string }>> {
      const rows = await sql.query<{ user_id: string; plan: PaidPlan; current_period_end: unknown }>(
        `select user_id, plan, current_period_end from subscriptions where source = 'payment' and current_period_end >= $1 and current_period_end < $2`,
        [from.toISOString(), to.toISOString()],
      );
      return rows.map((r) => ({ userId: r.user_id, plan: r.plan, end: toIso(r.current_period_end) }));
    },
  };
}
export type PaymentRepo = ReturnType<typeof paymentRepo>;
