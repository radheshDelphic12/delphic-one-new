-- AlterTable
ALTER TABLE "nx_invoices" ADD COLUMN     "credited_amount" DECIMAL(16,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "nx_people" ADD COLUMN     "outlet_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "nx_settings" ADD COLUMN     "default_gst_rate" DECIMAL(7,3) NOT NULL DEFAULT 12,
ADD COLUMN     "expiry_block_days" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "expiry_warning_days" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN     "invoice_prefix" TEXT NOT NULL DEFAULT 'INV',
ADD COLUMN     "invoice_timing" TEXT NOT NULL DEFAULT 'delivery',
ADD COLUMN     "require_transfer_approval" BOOLEAN NOT NULL DEFAULT false;

