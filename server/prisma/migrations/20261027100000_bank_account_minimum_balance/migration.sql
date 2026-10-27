-- Group bank accounts: an optional minimum balance. Additive and nullable; null = no alert level set (every existing account).
ALTER TABLE "bank_accounts" ADD COLUMN IF NOT EXISTS "minimum_balance" DECIMAL(16,2);
