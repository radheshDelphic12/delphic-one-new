-- CreateTable
CREATE TABLE "external_accesses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "scope" JSONB NOT NULL,
    "token_hash" TEXT NOT NULL,
    "granted_by" UUID NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "use_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_accesses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "external_accesses_token_hash_key" ON "external_accesses"("token_hash");

-- CreateIndex
CREATE INDEX "external_accesses_org_id_idx" ON "external_accesses"("org_id");

-- CreateIndex
CREATE INDEX "external_accesses_org_id_email_idx" ON "external_accesses"("org_id", "email");

-- AddForeignKey
ALTER TABLE "external_accesses" ADD CONSTRAINT "external_accesses_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_accesses" ADD CONSTRAINT "external_accesses_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
