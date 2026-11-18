/**
 * Checkout and settlement for PromptPay via Stripe Checkout.
 *
 * Nothing is granted from a client redirect or from the webhook body alone: a payment is settled
 * only after the provider confirms it server-side (Stripe: session payment_status=paid) with the
 * exact amount in THB. Settlement is idempotent.
 */
import { EARLY_BIRD_LIMIT, PRODUCTS, type ProductId } from '../../domain/plans.ts';
import type { Repos } from '../../infrastructure/db/repositories/index.ts';
import type { Payment } from '../../infrastructure/db/repositories/payments.ts';
import type { PaymentGateway } from '../../infrastructure/payments/gateway.ts';

export interface PaymentUrls {
  /** where the provider sends the user after paying (our "thank you" page) */
  returnUrl: string;
  /** where the provider sends the user if they back out */
  cancelUrl: string;
}

export interface PaymentAccess {
  /** null = everyone may buy (live keys); otherwise only these LINE user ids (test keys) */
  allowedUsers: ReadonlySet<string> | null;
}

export type SettleResult =
  | { status: 'paid'; newlyPaid: boolean; payment: Payment; until: string | null }
  | { status: 'pending'; payment: Payment }
  | { status: 'not_found' };

const REUSE_MINUTES = 15;

/** 20 alphanumerics, unguessable (also used as the provider idempotency key). */
export function newInvoiceNo(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(17));
  return 'SS' + Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('') + 'P';
}

export function createPaymentService(repos: Repos, gateway: PaymentGateway, urls: PaymentUrls, clock: () => Date, access: PaymentAccess = { allowedUsers: null }) {
  async function earlyBirdAvailable(userId: string): Promise<boolean> {
    const [total, mine] = await Promise.all([repos.payments.countPaid('plus_early'), repos.payments.countPaid('plus_early', userId)]);
    return total < EARLY_BIRD_LIMIT && mine === 0;
  }

  async function settle(payment: Payment): Promise<SettleResult> {
    if (payment.status === 'paid') return { status: 'paid', newlyPaid: false, payment, until: null };
    if (!payment.gatewayRef) return { status: 'pending', payment };
    const r = await gateway.inquiry(payment.gatewayRef);
    const exact = r.paid && r.amountSatang === payment.amountSatang && r.currency?.toLowerCase() === 'thb';
    if (!exact) return { status: 'pending', payment };
    const done = await repos.payments.markPaidAndGrant(payment.invoiceNo, { providerRef: r.referenceNo, channelCode: r.channelCode }, clock());
    if (!done) return { status: 'paid', newlyPaid: false, payment: { ...payment, status: 'paid' }, until: null };
    return { status: 'paid', newlyPaid: true, payment: done.payment, until: done.end };
  }

  return {
    earlyBirdAvailable,

    /** Whether this user may see buy buttons (test keys: allow-listed testers only). */
    availableFor(userId: string): boolean {
      return access.allowedUsers === null || access.allowedUsers.has(userId);
    },

    async checkout(userId: string, product: ProductId): Promise<{ payment: Payment; url: string }> {
      if (access.allowedUsers !== null && !access.allowedUsers.has(userId)) throw new Error('checkout not available for this user');
      if (product === 'plus_early' && !(await earlyBirdAvailable(userId))) throw new Error('early bird unavailable');
      const reuse = await repos.payments.findRecentPending(userId, product, REUSE_MINUTES);
      if (reuse?.paymentUrl) return { payment: reuse, url: reuse.paymentUrl };
      const payment = await repos.payments.create(userId, newInvoiceNo(), product);
      const { url, gatewayRef } = await gateway.createPayment({
        invoiceNo: payment.invoiceNo,
        amountSatang: payment.amountSatang,
        description: `ShikSheek ${PRODUCTS[product].label}`,
        returnUrl: urls.returnUrl,
        cancelUrl: urls.cancelUrl,
      });
      await repos.payments.setCheckout(payment.id, url, gatewayRef);
      return { payment: { ...payment, paymentUrl: url, gatewayRef }, url };
    },

    /** User tapped "ตรวจสอบการชำระเงิน" (or LIFF polls). */
    async check(userId: string, paymentId: string): Promise<SettleResult> {
      const p = await repos.payments.get(userId, paymentId);
      return p ? settle(p) : { status: 'not_found' };
    },

    /** Provider webhook. Unauthentic or irrelevant events are ignored. */
    async handleNotification(rawBody: string, headers: Headers): Promise<SettleResult> {
      const n = await gateway.parseNotification(rawBody, headers);
      if (!n) return { status: 'not_found' };
      const p = await repos.payments.getByInvoice(n.invoiceNo);
      if (!p || (p.gatewayRef && p.gatewayRef !== n.gatewayRef)) return { status: 'not_found' };
      return settle(p.gatewayRef ? p : { ...p, gatewayRef: n.gatewayRef });
    },
  };
}
export type PaymentService = ReturnType<typeof createPaymentService>;
