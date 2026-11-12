-- SaaS launch, phase 4 foundations: orders, order lines, payment records and webhook events (with an idempotency key). No payment gateway keys anywhere:
-- the webhook is a stub that checks a shared-secret signature, and payments can also be recorded by hand (bank transfer).
-- New tables only; the GST rate is a platform setting, not a constant.
CREATE SEQUENCE "saas_order_no_seq" START 1;

CREATE TABLE "saas_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_no" TEXT NOT NULL DEFAULT ('SO-' || lpad(nextval('saas_order_no_seq')::text, 5, '0')),
    "customer_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "price_book_id" UUID,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "gst_rate" DECIMAL(5,2) NOT NULL,
    "gst_amount" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "dox_invoice_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMP(3),
    CONSTRAINT "saas_orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "saas_orders_status_check" CHECK ("status" IN ('pending', 'paid', 'cancelled'))
);
CREATE UNIQUE INDEX "saas_orders_order_no_key" ON "saas_orders"("order_no");
CREATE INDEX "saas_orders_customer_id_idx" ON "saas_orders"("customer_id");
ALTER TABLE "saas_orders" ADD CONSTRAINT "saas_orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "saas_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One line = credit days of one module on one slot (module_code 'ADMIN' = the admin slot fee, which adds no credit days).
CREATE TABLE "saas_order_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "slot_id" UUID NOT NULL,
    "module_code" VARCHAR(8) NOT NULL,
    "days" INTEGER NOT NULL,
    "unit_price_30d" DECIMAL(12,2) NOT NULL,
    "line_amount" DECIMAL(14,2) NOT NULL,
    "is_prerequisite" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "saas_order_lines_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "saas_order_lines_order_id_idx" ON "saas_order_lines"("order_id");
ALTER TABLE "saas_order_lines" ADD CONSTRAINT "saas_order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "saas_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "saas_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" TEXT NOT NULL,
    "provider_ref" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "saas_payments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "saas_payments_idempotency_key_key" ON "saas_payments"("idempotency_key");
CREATE INDEX "saas_payments_order_id_idx" ON "saas_payments"("order_id");
ALTER TABLE "saas_payments" ADD CONSTRAINT "saas_payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "saas_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every webhook call is recorded once: the unique (provider, event_id) is the idempotency key, so a repeated delivery changes nothing.
CREATE TABLE "saas_webhook_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "result" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "saas_webhook_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "saas_webhook_events_provider_event_id_key" ON "saas_webhook_events"("provider", "event_id");

INSERT INTO "saas_settings" ("key", "value", "note") VALUES
  ('gst_rate_pct', '18'::jsonb, 'GST rate on SaaS orders and invoices, in percent'),
  ('order_days_default', '30'::jsonb, 'Credit days a standard order buys per module');
