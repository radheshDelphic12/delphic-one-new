-- CreateTable
CREATE TABLE "zx_parties" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'client',
    "name" TEXT NOT NULL,
    "contact_name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "gstin" TEXT,
    "pan" TEXT,
    "address" TEXT,
    "city" TEXT,
    "payment_terms" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "zx_parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zx_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "owner_type" TEXT NOT NULL,
    "owner_id" UUID NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'other',
    "title" TEXT NOT NULL,
    "ref_no" TEXT,
    "issue_date" DATE,
    "expiry_date" DATE,
    "file_url" TEXT NOT NULL,
    "file_name" TEXT,
    "size_bytes" INTEGER,
    "uploaded_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "zx_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "zx_parties_org_id_kind_status_idx" ON "zx_parties"("org_id", "kind", "status");

-- CreateIndex
CREATE INDEX "zx_parties_org_id_name_idx" ON "zx_parties"("org_id", "name");

-- CreateIndex
CREATE INDEX "zx_documents_org_id_owner_type_owner_id_idx" ON "zx_documents"("org_id", "owner_type", "owner_id");

-- CreateIndex
CREATE INDEX "zx_documents_org_id_expiry_date_idx" ON "zx_documents"("org_id", "expiry_date");

-- AddForeignKey
ALTER TABLE "zx_parties" ADD CONSTRAINT "zx_parties_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_documents" ADD CONSTRAINT "zx_documents_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
