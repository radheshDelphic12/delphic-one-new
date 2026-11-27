-- Zephyr: the planned timeline for buying a property (token, agreement, payments, registration, possession ...), planned vs done dates.
CREATE TABLE "zx_property_purchase_steps" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "planned_date" DATE,
    "done_date" DATE,
    "amount" DECIMAL(16,2),
    "notes" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "zx_property_purchase_steps_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "zx_property_purchase_steps_org_id_property_id_idx" ON "zx_property_purchase_steps"("org_id", "property_id");
