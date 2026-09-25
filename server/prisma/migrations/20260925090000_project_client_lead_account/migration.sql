-- Project client link: a project (active client Account) now references its
-- client as a Lead Account instead of free text. Additive and nullable —
-- existing projects keep their client_name text until someone links a lead.

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN "client_account_id" UUID;

-- CreateIndex
CREATE INDEX "accounts_client_account_id_idx" ON "accounts"("client_account_id");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_client_account_id_fkey" FOREIGN KEY ("client_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
