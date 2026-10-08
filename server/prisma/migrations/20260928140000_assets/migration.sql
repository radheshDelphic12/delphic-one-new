-- People → Assets: the hardware register (who holds each device, who owns it,
-- supplying vendor, client it's used for). Additive only.

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('issued', 'returned');

-- CreateEnum
CREATE TYPE "AssetOwner" AS ENUM ('delphic', 'client');

-- CreateTable
CREATE TABLE "assets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "serial_number" TEXT,
    "asset_type" TEXT NOT NULL,
    "status" "AssetStatus" NOT NULL DEFAULT 'issued',
    "belongs_to" "AssetOwner" NOT NULL DEFAULT 'delphic',
    "org_membership_id" UUID,
    "vendor_account_id" UUID,
    "client_account_id" UUID,
    "issue_date" DATE,
    "return_date" DATE,
    "device_details" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assets_org_id_status_idx" ON "assets"("org_id", "status");

-- CreateIndex
CREATE INDEX "assets_org_membership_id_idx" ON "assets"("org_membership_id");

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_org_membership_id_fkey" FOREIGN KEY ("org_membership_id") REFERENCES "org_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_vendor_account_id_fkey" FOREIGN KEY ("vendor_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_client_account_id_fkey" FOREIGN KEY ("client_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

