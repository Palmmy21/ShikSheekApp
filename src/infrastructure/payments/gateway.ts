/** Payment provider port. The app only needs: start a hosted checkout, confirm it, verify webhooks. */
export interface CreatePaymentInput {
  invoiceNo: string;
  amountSatang: number;
  description: string;
  returnUrl: string;
  cancelUrl: string;
}

export interface InquiryResult {
  paid: boolean;
  amountSatang: number | null;
  currency: string | null;
  /** provider payment reference (e.g. Stripe PaymentIntent id) */
  referenceNo: string | null;
  channelCode: string | null;
}

export interface PaymentGateway {
  /** returns the hosted payment page URL and the provider's checkout id */
  createPayment(input: CreatePaymentInput): Promise<{ url: string; gatewayRef: string }>;
  inquiry(gatewayRef: string): Promise<InquiryResult>;
  /** Verifies a webhook (raw body + headers). Returns which checkout it is about, or null to ignore. */
  parseNotification(rawBody: string, headers: Headers): Promise<{ invoiceNo: string; gatewayRef: string } | null>;
}

export class PaymentGatewayError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'PaymentGatewayError';
    this.code = code;
  }
}
