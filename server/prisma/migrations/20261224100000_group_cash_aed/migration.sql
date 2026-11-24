-- Group Book Keeping: bank accounts and wallets can also be held in AED (export invoices billed in dirhams). Only the two CHECK
-- constraints change; the columns stay plain text.
ALTER TABLE "bank_accounts" DROP CONSTRAINT "bank_accounts_currency_check";
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_currency_check" CHECK ("currency" IN ('INR', 'USD', 'AED'));
ALTER TABLE "wallets" DROP CONSTRAINT "wallets_currency_check";
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_currency_check" CHECK ("currency" IN ('INR', 'USD', 'AED'));
