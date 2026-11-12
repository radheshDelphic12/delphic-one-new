-- Accounts > Premium (yes/no). Additive: one boolean column, every existing account starts as not premium.
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "is_premium" BOOLEAN NOT NULL DEFAULT false;
