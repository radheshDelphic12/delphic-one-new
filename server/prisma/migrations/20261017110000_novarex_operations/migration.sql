-- AlterTable
ALTER TABLE "nx_entries" ADD COLUMN     "non_cash" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "source_id" UUID,
ADD COLUMN     "source_type" TEXT;

-- CreateTable
CREATE TABLE "nx_products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "generic_name" TEXT,
    "category_id" UUID,
    "manufacturer" TEXT,
    "strength" TEXT,
    "dosage_form" TEXT,
    "pack_size" TEXT,
    "uom" TEXT NOT NULL DEFAULT 'unit',
    "hsn" TEXT,
    "gst_rate" DECIMAL(7,3) NOT NULL DEFAULT 12,
    "mrp" DECIMAL(16,2),
    "purchase_price" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "selling_price" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "barcode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "regulatory_class" TEXT,
    "requires_prescription" BOOLEAN NOT NULL DEFAULT false,
    "cold_chain" BOOLEAN NOT NULL DEFAULT false,
    "reorder_level" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "shelf_life_days" INTEGER,
    "notes" TEXT,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "nx_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nx_warehouses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'warehouse',
    "city" TEXT,
    "state" TEXT,
    "address" TEXT,
    "manager_name" TEXT,
    "outlet_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "nx_warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nx_suppliers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact_name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "gstin" TEXT,
    "licence_no" TEXT,
    "licence_expiry" DATE,
    "state" TEXT,
    "address" TEXT,
    "credit_days" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "nx_suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nx_customers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "outlet_id" UUID,
    "kind" TEXT NOT NULL DEFAULT 'external',
    "contact_name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "gstin" TEXT,
    "state" TEXT,
    "address" TEXT,
    "credit_days" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "nx_customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nx_logistics_partners" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact_name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "gstin" TEXT,
    "regions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pricing_model" TEXT NOT NULL DEFAULT 'fixed',
    "payment_terms" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "nx_logistics_partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nx_rate_cards" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "partner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT 'fixed',
    "base_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "rate" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "handling_charge" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "cold_chain_charge" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "zone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "nx_rate_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nx_vehicles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "reg_no" TEXT NOT NULL,
    "vehicle_type" TEXT,
    "capacity" TEXT,
    "driver_name" TEXT,
    "driver_person_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'available',
    "insurance_expiry" DATE,
    "permit_expiry" DATE,
    "notes" TEXT,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "nx_vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nx_batches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "batch_no" TEXT NOT NULL,
    "mfg_date" DATE,
    "expiry_date" DATE,
    "supplier_id" UUID,
    "unit_cost" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "quality_status" TEXT NOT NULL DEFAULT 'released',
    "received_qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "receipt_id" UUID,
    "notes" TEXT,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "nx_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nx_stock_ledger" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "bucket" TEXT NOT NULL DEFAULT 'available',
    "qty" DECIMAL(14,3) NOT NULL,
    "movement" TEXT NOT NULL,
    "ref_type" TEXT,
    "ref_id" UUID,
    "posting_key" TEXT,
    "note" TEXT,
    "actor_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nx_stock_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nx_stock_adjustments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "bucket" TEXT NOT NULL DEFAULT 'available',
    "qty" DECIMAL(14,3) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'posted',
    "actor_id" UUID,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nx_stock_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nx_purchase_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "po_no" TEXT NOT NULL,
    "supplier_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "order_date" DATE NOT NULL,
    "expected_date" DATE,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "subtotal" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "tax_total" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "lines" JSONB NOT NULL,
    "notes" TEXT,
    "approved_by" UUID,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "nx_purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nx_goods_receipts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "grn_no" TEXT NOT NULL,
    "po_id" UUID,
    "supplier_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "receipt_date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "lines" JSONB NOT NULL,
    "invoice_id" UUID,
    "notes" TEXT,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "nx_goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nx_transfers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "transfer_no" TEXT NOT NULL,
    "from_warehouse_id" UUID NOT NULL,
    "to_warehouse_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "request_date" DATE NOT NULL,
    "lines" JSONB NOT NULL,
    "notes" TEXT,
    "approved_by" UUID,
    "dispatched_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "nx_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nx_sales_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "so_no" TEXT NOT NULL,
    "customer_id" UUID NOT NULL,
    "outlet_id" UUID,
    "warehouse_id" UUID NOT NULL,
    "order_date" DATE NOT NULL,
    "expected_date" DATE,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "fulfilment" TEXT NOT NULL DEFAULT 'none',
    "invoice_status" TEXT NOT NULL DEFAULT 'none',
    "payment_status" TEXT NOT NULL DEFAULT 'unpaid',
    "subtotal" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "tax_total" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "payment_terms" TEXT,
    "delivery_address" TEXT,
    "logistics_method" TEXT,
    "lines" JSONB NOT NULL,
    "notes" TEXT,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "nx_sales_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nx_invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "invoice_no" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "source_type" TEXT,
    "source_id" UUID,
    "customer_id" UUID,
    "supplier_id" UUID,
    "outlet_id" UUID,
    "party_name" TEXT,
    "issue_date" DATE NOT NULL,
    "due_date" DATE,
    "subtotal" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "tax_total" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "paid_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'issued',
    "lines" JSONB NOT NULL,
    "tax_split" JSONB,
    "einvoice_status" TEXT NOT NULL DEFAULT 'not_filed',
    "eway_status" TEXT NOT NULL DEFAULT 'not_required',
    "entry_id" UUID,
    "cogs_entry_id" UUID,
    "ref_invoice_id" UUID,
    "notes" TEXT,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "nx_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nx_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "direction" TEXT NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "pay_date" DATE NOT NULL,
    "method" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "actor_id" UUID,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nx_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nx_goods_returns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "return_no" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "invoice_id" UUID,
    "shipment_id" UUID,
    "supplier_id" UUID,
    "warehouse_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "disposition" TEXT,
    "return_date" DATE NOT NULL,
    "credit_invoice_id" UUID,
    "actor_id" UUID,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "nx_goods_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nx_shipments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "shipment_no" TEXT NOT NULL,
    "sales_order_id" UUID,
    "transfer_id" UUID,
    "from_warehouse_id" UUID NOT NULL,
    "to_warehouse_id" UUID,
    "customer_id" UUID,
    "outlet_id" UUID,
    "method" TEXT NOT NULL DEFAULT 'own_vehicle',
    "vehicle_id" UUID,
    "partner_id" UUID,
    "rate_card_id" UUID,
    "driver_name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending_dispatch',
    "dispatch_at" TIMESTAMP(3),
    "expected_at" DATE,
    "delivered_at" TIMESTAMP(3),
    "tracking_ref" TEXT,
    "estimated_freight" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "actual_freight" DECIMAL(16,2),
    "freight_status" TEXT NOT NULL DEFAULT 'unpaid',
    "freight_entry_id" UUID,
    "weight_kg" DECIMAL(14,3),
    "distance_km" DECIMAL(14,3),
    "lines" JSONB NOT NULL,
    "pod_note" TEXT,
    "damaged_qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "missing_qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "nx_shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nx_trips" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "shipment_id" UUID,
    "trip_date" DATE NOT NULL,
    "distance_km" DECIMAL(14,3),
    "fuel_cost" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "toll_cost" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "maintenance_cost" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "other_cost" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "entry_id" UUID,
    "notes" TEXT,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "nx_trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nx_recalls" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "recall_no" TEXT NOT NULL,
    "product_id" UUID NOT NULL,
    "batch_id" UUID,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "recall_date" DATE NOT NULL,
    "notes" TEXT,
    "actor_id" UUID,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "nx_recalls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nx_franchise_agreements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "outlet_id" UUID NOT NULL,
    "partner_name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "initial_fee" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "royalty_pct" DECIMAL(7,3) NOT NULL DEFAULT 0,
    "revenue_share_pct" DECIMAL(7,3) NOT NULL DEFAULT 0,
    "purchase_discount_pct" DECIMAL(7,3) NOT NULL DEFAULT 0,
    "security_deposit" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "payment_terms" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "renewal_date" DATE,
    "terms" TEXT,
    "notes" TEXT,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "nx_franchise_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nx_franchise_settlements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "agreement_id" UUID NOT NULL,
    "outlet_id" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'royalty',
    "reported_sales" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "basis_visible" BOOLEAN NOT NULL DEFAULT true,
    "royalty_due" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "share_due" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "fee_due" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "total_due" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "invoice_id" UUID,
    "notes" TEXT,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "nx_franchise_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nx_counters" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nx_counters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "nx_products_org_id_status_idx" ON "nx_products"("org_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "nx_products_org_id_sku_key" ON "nx_products"("org_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "nx_warehouses_org_id_code_key" ON "nx_warehouses"("org_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "nx_suppliers_org_id_code_key" ON "nx_suppliers"("org_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "nx_customers_org_id_code_key" ON "nx_customers"("org_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "nx_logistics_partners_org_id_code_key" ON "nx_logistics_partners"("org_id", "code");

-- CreateIndex
CREATE INDEX "nx_rate_cards_org_id_partner_id_idx" ON "nx_rate_cards"("org_id", "partner_id");

-- CreateIndex
CREATE UNIQUE INDEX "nx_vehicles_org_id_reg_no_key" ON "nx_vehicles"("org_id", "reg_no");

-- CreateIndex
CREATE INDEX "nx_batches_org_id_expiry_date_idx" ON "nx_batches"("org_id", "expiry_date");

-- CreateIndex
CREATE UNIQUE INDEX "nx_batches_org_id_product_id_batch_no_key" ON "nx_batches"("org_id", "product_id", "batch_no");

-- CreateIndex
CREATE INDEX "nx_stock_ledger_org_id_product_id_warehouse_id_idx" ON "nx_stock_ledger"("org_id", "product_id", "warehouse_id");

-- CreateIndex
CREATE INDEX "nx_stock_ledger_org_id_batch_id_idx" ON "nx_stock_ledger"("org_id", "batch_id");

-- CreateIndex
CREATE INDEX "nx_stock_ledger_org_id_ref_type_ref_id_idx" ON "nx_stock_ledger"("org_id", "ref_type", "ref_id");

-- CreateIndex
CREATE UNIQUE INDEX "nx_stock_ledger_org_id_posting_key_key" ON "nx_stock_ledger"("org_id", "posting_key");

-- CreateIndex
CREATE INDEX "nx_stock_adjustments_org_id_warehouse_id_idx" ON "nx_stock_adjustments"("org_id", "warehouse_id");

-- CreateIndex
CREATE INDEX "nx_purchase_orders_org_id_status_idx" ON "nx_purchase_orders"("org_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "nx_purchase_orders_org_id_po_no_key" ON "nx_purchase_orders"("org_id", "po_no");

-- CreateIndex
CREATE UNIQUE INDEX "nx_goods_receipts_org_id_grn_no_key" ON "nx_goods_receipts"("org_id", "grn_no");

-- CreateIndex
CREATE UNIQUE INDEX "nx_transfers_org_id_transfer_no_key" ON "nx_transfers"("org_id", "transfer_no");

-- CreateIndex
CREATE INDEX "nx_sales_orders_org_id_status_idx" ON "nx_sales_orders"("org_id", "status");

-- CreateIndex
CREATE INDEX "nx_sales_orders_org_id_outlet_id_idx" ON "nx_sales_orders"("org_id", "outlet_id");

-- CreateIndex
CREATE UNIQUE INDEX "nx_sales_orders_org_id_so_no_key" ON "nx_sales_orders"("org_id", "so_no");

-- CreateIndex
CREATE INDEX "nx_invoices_org_id_status_idx" ON "nx_invoices"("org_id", "status");

-- CreateIndex
CREATE INDEX "nx_invoices_org_id_outlet_id_idx" ON "nx_invoices"("org_id", "outlet_id");

-- CreateIndex
CREATE UNIQUE INDEX "nx_invoices_org_id_invoice_no_key" ON "nx_invoices"("org_id", "invoice_no");

-- CreateIndex
CREATE UNIQUE INDEX "nx_invoices_org_id_type_source_type_source_id_key" ON "nx_invoices"("org_id", "type", "source_type", "source_id");

-- CreateIndex
CREATE INDEX "nx_payments_org_id_invoice_id_idx" ON "nx_payments"("org_id", "invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "nx_goods_returns_org_id_return_no_key" ON "nx_goods_returns"("org_id", "return_no");

-- CreateIndex
CREATE INDEX "nx_shipments_org_id_status_idx" ON "nx_shipments"("org_id", "status");

-- CreateIndex
CREATE INDEX "nx_shipments_org_id_sales_order_id_idx" ON "nx_shipments"("org_id", "sales_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "nx_shipments_org_id_shipment_no_key" ON "nx_shipments"("org_id", "shipment_no");

-- CreateIndex
CREATE INDEX "nx_trips_org_id_vehicle_id_idx" ON "nx_trips"("org_id", "vehicle_id");

-- CreateIndex
CREATE UNIQUE INDEX "nx_recalls_org_id_recall_no_key" ON "nx_recalls"("org_id", "recall_no");

-- CreateIndex
CREATE INDEX "nx_franchise_agreements_org_id_outlet_id_idx" ON "nx_franchise_agreements"("org_id", "outlet_id");

-- CreateIndex
CREATE INDEX "nx_franchise_agreements_org_id_status_idx" ON "nx_franchise_agreements"("org_id", "status");

-- CreateIndex
CREATE INDEX "nx_franchise_settlements_org_id_agreement_id_month_idx" ON "nx_franchise_settlements"("org_id", "agreement_id", "month");

-- CreateIndex
CREATE UNIQUE INDEX "nx_counters_org_id_key_key" ON "nx_counters"("org_id", "key");

-- CreateIndex
CREATE INDEX "nx_entries_org_id_source_type_source_id_idx" ON "nx_entries"("org_id", "source_type", "source_id");

-- AddForeignKey
ALTER TABLE "nx_products" ADD CONSTRAINT "nx_products_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nx_warehouses" ADD CONSTRAINT "nx_warehouses_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nx_suppliers" ADD CONSTRAINT "nx_suppliers_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nx_customers" ADD CONSTRAINT "nx_customers_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nx_logistics_partners" ADD CONSTRAINT "nx_logistics_partners_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nx_rate_cards" ADD CONSTRAINT "nx_rate_cards_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nx_vehicles" ADD CONSTRAINT "nx_vehicles_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nx_batches" ADD CONSTRAINT "nx_batches_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nx_stock_ledger" ADD CONSTRAINT "nx_stock_ledger_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nx_stock_adjustments" ADD CONSTRAINT "nx_stock_adjustments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nx_purchase_orders" ADD CONSTRAINT "nx_purchase_orders_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nx_goods_receipts" ADD CONSTRAINT "nx_goods_receipts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nx_transfers" ADD CONSTRAINT "nx_transfers_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nx_sales_orders" ADD CONSTRAINT "nx_sales_orders_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nx_invoices" ADD CONSTRAINT "nx_invoices_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nx_payments" ADD CONSTRAINT "nx_payments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nx_goods_returns" ADD CONSTRAINT "nx_goods_returns_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nx_shipments" ADD CONSTRAINT "nx_shipments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nx_trips" ADD CONSTRAINT "nx_trips_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nx_recalls" ADD CONSTRAINT "nx_recalls_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nx_franchise_agreements" ADD CONSTRAINT "nx_franchise_agreements_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nx_franchise_settlements" ADD CONSTRAINT "nx_franchise_settlements_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nx_counters" ADD CONSTRAINT "nx_counters_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

