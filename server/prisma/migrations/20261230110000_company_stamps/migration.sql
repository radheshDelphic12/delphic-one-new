-- Document Centre: the company's stamp (seal), placed on a document while signing it. One per company.
CREATE TABLE "company_stamps" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "image_path" TEXT NOT NULL,
    "image_type" TEXT NOT NULL DEFAULT 'png',
    "uploaded_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "company_stamps_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "company_stamps_org_id_key" ON "company_stamps"("org_id");
