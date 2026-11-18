-- Payments move to Stripe Checkout: keep the provider's checkout id (cs_…) to confirm server-side.
alter table payments add column gateway_ref text;
create unique index payments_gateway_ref_idx on payments (gateway_ref) where gateway_ref is not null;
