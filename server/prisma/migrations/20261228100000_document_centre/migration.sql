-- Document Centre: what each client / vendor / employee should have on file, signatures and signing requests.
-- A document can be tagged with the kind of document it is (the name of a requirement, e.g. "Agreement").
ALTER TABLE "documents" ADD COLUMN "doc_type" TEXT;

CREATE TABLE "document_requirements" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "document_requirements_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "document_requirements_org_id_kind_name_key" ON "document_requirements"("org_id", "kind", "name");

CREATE TABLE "user_signatures" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "image_path" TEXT NOT NULL,
  "image_type" TEXT NOT NULL DEFAULT 'png',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_signatures_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "user_signatures_org_id_user_id_key" ON "user_signatures"("org_id", "user_id");

CREATE TABLE "signature_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "tag_kind" TEXT NOT NULL DEFAULT 'other',
  "entity_type" TEXT,
  "entity_id" UUID,
  "entity_name" TEXT,
  "doc_type" TEXT,
  "note" TEXT,
  "original_path" TEXT NOT NULL,
  "original_name" TEXT NOT NULL,
  "original_size" INTEGER,
  "original_deleted_at" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'pending',
  "signer_user_id" UUID NOT NULL,
  "requested_by" UUID NOT NULL,
  "placements" JSONB,
  "signed_path" TEXT,
  "signed_size" INTEGER,
  "signed_at" TIMESTAMP(3),
  "decline_reason" TEXT,
  "attached_document_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "signature_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "signature_requests_org_id_status_idx" ON "signature_requests"("org_id", "status");
CREATE INDEX "signature_requests_signer_user_id_status_idx" ON "signature_requests"("signer_user_id", "status");
