-- Documents on a project vendor invoice (Project P&L) and on an employee
-- (People). project_vendor_invoice was accepted by the API but missing here.

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DocumentEntityType" ADD VALUE 'project_vendor_invoice';
ALTER TYPE "DocumentEntityType" ADD VALUE 'org_membership';

