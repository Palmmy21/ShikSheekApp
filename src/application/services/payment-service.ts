/**
 * Checkout and settlement for PromptPay via 2C2P.
 *
 * Nothing is granted from a client redirect or from the notification body alone: a payment is
 * settled only after the notification signature verifies AND paymentInquiry (server-to-server)
 * reports respCode 0000 with the exact amount in THB. Settlement is idempotent.
 */
import { EARLY_BIRD_LIMIT, PRODUCTS, type ProductId } from '../../domain/plans.ts';
import type { Repos } from '../../infrastructure/db/repositories/index.ts';
import type { Payment } from '../../infrastructure/db/repositories/payments.ts';
import type { PaymentGateway } from '../../infrastructure/payments/twoc2p.ts';

export interface PaymentUrls {
  /** where 2C2P sends the user afterwards (our "thank you" page) */
  returnUrl: string;
  /** our payment-webhook Edge Function */
  notifyUrl: string;
}

export type SettleResult =
  | { status: 'paid'; newlyPaid: boolean; payment: Payment; until: string | null }
  | { status: 'pending'; payment: Payment }
  | { status: 'not_found' };

const REUSE_MINUTES = 15;

/** 20 alphanumerics (2C2P limit for QR payments), unguessable. */
export function newInvoiceNo(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(17));
  return 'SS' + Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('') + 'P';
}

export function createPaymentService(repos: Repos, gateway: PaymentGateway, urls: PaymentUrls, clock: () => Date) {
  async function earlyBirdAvailable(userId: string): Promise<boolean> {
    const [total, mine] = await Promise.all([repos.payments.countPaid('plus_early'), repos.payments.countPaid('plus_early', userId)]);
    return total < EARLY_BIRD_LIMIT && mine === 0;
  }

  async function settle(payment: Payment): Promise<SettleResult> {
    if (payment.status === 'paid') return { status: 'paid', newlyPaid: false, payment, until: null };
    const r = await gateway.inquiry(payment.invoiceNo);
    const exact = r.respCode === '0000' && r.amountSatang === payment.amountSatang && (r.currencyCode === null || r.currencyCode === 'THB' || r.currencyCode === '764');
    if (!exact) return { status: 'pending', payment };
    const done = await repos.payments.markPaidAndGrant(payment.invoiceNo, { providerRef: r.referenceNo, channelCode: r.channelCode }, clock());
    if (!done) return { status: 'paid', newlyPaid: false, payment: { ...payment, status: 'paid' }, until: null };
    return { status: 'paid', newlyPaid: true, payment: done.payment, until: done.end };
  }

  return {
    earlyBirdAvailable,

    async checkout(userId: string, product: ProductId): Promise<{ payment: Payment; url: string }> {
      if (product === 'plus_early' && !(await earlyBirdAvailable(userId))) throw new Error('early bird unavailable');
      const reuse = await repos.payments.findRecentPending(userId, product, REUSE_MINUTES);
      if (reuse?.paymentUrl) return { payment: reuse, url: reuse.paymentUrl };
      const payment = await repos.payments.create(userId, newInvoiceNo(), product);
      const { webPaymentUrl } = await gateway.createPayment({
        invoiceNo: payment.invoiceNo,
        amountSatang: payment.amountSatang,
        description: `ShikSheek ${PRODUCTS[product].label}`,
        frontendReturnUrl: urls.returnUrl,
        backendReturnUrl: urls.notifyUrl,
      });
      await repos.payments.setUrl(payment.id, webPaymentUrl);
      return { payment: { ...payment, paymentUrl: webPaymentUrl }, url: webPaymentUrl };
    },

    /** User tapped "ตรวจสอบการชำระเงิน" (or LIFF polls). */
    async check(userId: string, paymentId: string): Promise<SettleResult> {
      const p = await repos.payments.get(userId, paymentId);
      return p ? settle(p) : { status: 'not_found' };
    },

    /** 2C2P backend notification. Unauthentic bodies are ignored. */
    async handleNotification(body: unknown): Promise<SettleResult> {
      const n = await gateway.parseNotification(body);
      if (!n) return { status: 'not_found' };
      const p = await repos.payments.getByInvoice(n.invoiceNo);
      return p ? settle(p) : { status: 'not_found' };
    },
  };
}
export type PaymentService = ReturnType<typeof createPaymentService>;
