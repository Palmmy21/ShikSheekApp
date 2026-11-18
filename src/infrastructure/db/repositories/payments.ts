import { applyPurchase, PRODUCTS, type PaidPlan, type ProductId } from '../../../domain/plans.ts';
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
  created_at: unknown;
  paid_at: unknown;
}
const COLS = 'id, user_id, invoice_no, product, plan, days, amount_satang, status, payment_url, created_at, paid_at';
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
  createdAt: toIso(r.created_at),
  paidAt: r.paid_at ? toIso(r.paid_at) : null,
});

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
    async setUrl(id: string, url: string): Promise<void> {
      await sql.query(`update payments set payment_url = $2 where id = $1`, [id, url]);
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
    async markPaidAndGrant(invoiceNo: string, ref: { providerRef: string | null; channelCode: string | null }, now: Date): Promise<{ payment: Payment; plan: PaidPlan; end: string } | null> {
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
        return { payment: { ...payment, status: 'paid' as const }, plan: next.plan, end };
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
