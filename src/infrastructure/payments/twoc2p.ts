/**
 * 2C2P Payment Gateway (PGW v4.5) client — hosted payment page with PromptPay QR.
 *
 * Flow: paymentToken (server) → user opens webPaymentUrl (2C2P shows the QR) → 2C2P POSTs a signed
 * notification to backendReturnUrl → we confirm with paymentInquiry before granting anything.
 * Every body is {"payload": "<HS256 JWT signed with the merchant secret>"}.
 */
import { signJwt, verifyJwt } from './jwt.ts';

export interface CreatePaymentInput {
  invoiceNo: string;
  amountSatang: number;
  description: string;
  frontendReturnUrl: string;
  backendReturnUrl: string;
}

export interface InquiryResult {
  /** '0000' = paid */
  respCode: string;
  respDesc: string;
  invoiceNo: string | null;
  amountSatang: number | null;
  currencyCode: string | null;
  referenceNo: string | null;
  channelCode: string | null;
}

export interface PaymentGateway {
  createPayment(input: CreatePaymentInput): Promise<{ webPaymentUrl: string; paymentToken: string }>;
  inquiry(invoiceNo: string): Promise<InquiryResult>;
  /** Verifies a backend notification body; returns its invoice number, or null if not authentic. */
  parseNotification(body: unknown): Promise<{ invoiceNo: string } | null>;
}

export class PaymentGatewayError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'PaymentGatewayError';
    this.code = code;
  }
}

/** "49", "49.00", "49.00000" → 4900. Anything else (incl. sub-satang digits) → null. Never floats. */
export function decimalToSatang(v: unknown): number | null {
  const s = typeof v === 'number' ? v.toFixed(5) : typeof v === 'string' ? v.trim() : '';
  const m = /^(\d{1,12})(?:\.(\d{1,5}))?$/.exec(s);
  if (!m) return null;
  const frac = (m[2] ?? '').padEnd(5, '0');
  if (frac.slice(2) !== '000') return null;
  return Number(m[1]) * 100 + Number(frac.slice(0, 2));
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : typeof v === 'number' ? String(v) : null);

export interface TwoC2POptions {
  merchantId: string;
  secretKey: string;
  env: 'sandbox' | 'production';
  /** paymentChannel list sent to 2C2P, e.g. ['QR'] (Thai QR / PromptPay, per your merchant setup). */
  channels: string[];
  fetch?: typeof fetch;
}

export function createTwoC2PGateway(o: TwoC2POptions): PaymentGateway {
  const base = o.env === 'production' ? 'https://pgw.2c2p.com/payment/4.5' : 'https://sandbox-pgw.2c2p.com/payment/4.5';
  const doFetch = o.fetch ?? fetch;

  async function call(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await doFetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: await signJwt(body, o.secretKey) }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => null)) as { payload?: unknown; respCode?: unknown; respDesc?: unknown } | null;
    if (!json) throw new PaymentGatewayError('http', `2C2P ${path} HTTP ${res.status}`);
    // Errors may come back unsigned: {"respCode": "...", "respDesc": "..."}
    if (typeof json.payload !== 'string') throw new PaymentGatewayError(str(json.respCode) ?? 'unknown', str(json.respDesc) ?? '2C2P error');
    const payload = await verifyJwt(json.payload, o.secretKey);
    if (!payload) throw new PaymentGatewayError('signature', '2C2P response signature invalid');
    return payload;
  }

  return {
    async createPayment(input) {
      const r = await call('/paymentToken', {
        merchantID: o.merchantId,
        invoiceNo: input.invoiceNo,
        description: input.description,
        amount: Number((input.amountSatang / 100).toFixed(2)),
        currencyCode: 'THB',
        paymentChannel: o.channels,
        locale: 'th',
        frontendReturnUrl: input.frontendReturnUrl,
        backendReturnUrl: input.backendReturnUrl,
        nonceStr: crypto.randomUUID().replace(/-/g, ''),
      });
      const url = str(r.webPaymentUrl);
      const token = str(r.paymentToken);
      if (r.respCode !== '0000' || !url || !token) throw new PaymentGatewayError(str(r.respCode) ?? 'unknown', str(r.respDesc) ?? 'paymentToken failed');
      return { webPaymentUrl: url, paymentToken: token };
    },

    async inquiry(invoiceNo) {
      const r = await call('/paymentInquiry', { merchantID: o.merchantId, invoiceNo, locale: 'en' });
      return {
        respCode: str(r.respCode) ?? 'unknown',
        respDesc: str(r.respDesc) ?? '',
        invoiceNo: str(r.invoiceNo),
        amountSatang: decimalToSatang(r.amount),
        currencyCode: str(r.currencyCode),
        referenceNo: str(r.referenceNo) ?? str(r.tranRef),
        channelCode: str(r.channelCode),
      };
    },

    async parseNotification(body) {
      const token = (body as { payload?: unknown } | null)?.payload;
      if (typeof token !== 'string') return null;
      const p = await verifyJwt(token, o.secretKey);
      if (!p || str(p.merchantID) !== o.merchantId) return null;
      const invoiceNo = str(p.invoiceNo);
      return invoiceNo ? { invoiceNo } : null;
    },
  };
}
