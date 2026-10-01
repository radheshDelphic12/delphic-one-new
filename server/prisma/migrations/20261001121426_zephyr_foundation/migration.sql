-- CreateTable
CREATE TABLE "zx_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "valuation_method" TEXT NOT NULL DEFAULT 'revenue_multiple',
    "valuation_multiple" DECIMAL(8,2) NOT NULL DEFAULT 3,
    "valuation_manual" DECIMAL(16,2),
    "project_prefix" TEXT NOT NULL DEFAULT 'ZX-P',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zx_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zx_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "zx_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zx_audit" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" UUID,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "actor_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zx_audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zx_people" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "user_id" UUID,
    "access_role" TEXT NOT NULL DEFAULT 'none',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "zx_people_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "zx_settings_org_id_key" ON "zx_settings"("org_id");

-- CreateIndex
CREATE INDEX "zx_categories_org_id_kind_idx" ON "zx_categories"("org_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "zx_categories_org_id_kind_name_key" ON "zx_categories"("org_id", "kind", "name");

-- CreateIndex
CREATE INDEX "zx_audit_org_id_entity_entity_id_idx" ON "zx_audit"("org_id", "entity", "entity_id");

-- CreateIndex
CREATE INDEX "zx_audit_org_id_created_at_idx" ON "zx_audit"("org_id", "created_at");

-- CreateIndex
CREATE INDEX "zx_people_org_id_idx" ON "zx_people"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "zx_people_org_id_user_id_key" ON "zx_people"("org_id", "user_id");

-- AddForeignKey
ALTER TABLE "zx_settings" ADD CONSTRAINT "zx_settings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_categories" ADD CONSTRAINT "zx_categories_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_audit" ADD CONSTRAINT "zx_audit_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_people" ADD CONSTRAINT "zx_people_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_people" ADD CONSTRAINT "zx_people_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
