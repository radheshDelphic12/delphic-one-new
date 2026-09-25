/*
  Warnings:

  - You are about to drop the column `lead_generated_date` on the `accounts` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "accounts_lead_generated_date_idx";

-- AlterTable
ALTER TABLE "accounts" DROP COLUMN "lead_generated_date";
