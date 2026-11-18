/** Manual check: create a test PromptPay Checkout Session and read it back. node --env-file=.env.production scripts/try-stripe.ts */
import { createStripeGateway } from '../src/infrastructure/payments/stripe.ts';
import { newInvoiceNo } from '../src/application/services/payment-service.ts';

const key = process.env.STRIPE_SECRET_KEY;
if (!key?.startsWith('sk_test_')) throw new Error('Use a test key for this script');
const gw = createStripeGateway({ secretKey: key });
const invoiceNo = newInvoiceNo();
const { url, gatewayRef } = await gw.createPayment({ invoiceNo, amountSatang: 4900, description: 'ShikSheek Plus รายเดือน (test)', returnUrl: 'https://shiksheek.vercel.app/paid', cancelUrl: 'https://shiksheek.vercel.app/paid?cancelled=1' });
console.log('session', gatewayRef.slice(0, 14) + '…', '| url host', new URL(url).host);
console.log('inquiry', await gw.inquiry(gatewayRef));
