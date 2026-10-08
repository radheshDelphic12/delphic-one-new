-- Per-record finance locks: salary per employee, vendor billing per vendor, each expense record.
ALTER TYPE "CalculationKind" ADD VALUE IF NOT EXISTS 'salary_employee';
ALTER TYPE "CalculationKind" ADD VALUE IF NOT EXISTS 'vendor_bill';
ALTER TYPE "CalculationKind" ADD VALUE IF NOT EXISTS 'expense';
