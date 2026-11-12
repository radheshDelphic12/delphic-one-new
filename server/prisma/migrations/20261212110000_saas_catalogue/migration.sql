-- SaaS launch, phase 1: module catalogue, dependencies, a first dated price book, platform settings and the platform-admin list.
-- Platform configuration only (edited by platform admins); no existing table is changed and no existing behaviour depends on it.
-- Prices: the pricing sheet (28 modules = Rs 215 per user per 30 days, Basic View Rs 50, admin Rs 500), before GST.

CREATE TABLE "platform_admins" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "added_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "platform_admins_user_id_key" ON "platform_admins"("user_id");
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "saas_modules" (
    "code" VARCHAR(8) NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_basic" BOOLEAN NOT NULL DEFAULT false,
    "coming_soon" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "saas_modules_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "saas_module_dependencies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "module_code" VARCHAR(8) NOT NULL,
    "needs_code" VARCHAR(8) NOT NULL,
    "requirement_group" INTEGER NOT NULL DEFAULT 1,
    "note" TEXT,
    CONSTRAINT "saas_module_dependencies_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "saas_module_dependencies_module_code_needs_code_key" ON "saas_module_dependencies"("module_code", "needs_code");
CREATE INDEX "saas_module_dependencies_needs_code_idx" ON "saas_module_dependencies"("needs_code");
ALTER TABLE "saas_module_dependencies" ADD CONSTRAINT "saas_module_dependencies_module_code_fkey" FOREIGN KEY ("module_code") REFERENCES "saas_modules"("code") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "saas_module_dependencies" ADD CONSTRAINT "saas_module_dependencies_needs_code_fkey" FOREIGN KEY ("needs_code") REFERENCES "saas_modules"("code") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "saas_price_books" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "admin_price" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "saas_price_books_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "saas_price_books_effective_from_idx" ON "saas_price_books"("effective_from");

CREATE TABLE "saas_module_prices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "price_book_id" UUID NOT NULL,
    "module_code" VARCHAR(8) NOT NULL,
    "price_30d" DECIMAL(12,2) NOT NULL,
    CONSTRAINT "saas_module_prices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "saas_module_prices_price_book_id_module_code_key" ON "saas_module_prices"("price_book_id", "module_code");
ALTER TABLE "saas_module_prices" ADD CONSTRAINT "saas_module_prices_price_book_id_fkey" FOREIGN KEY ("price_book_id") REFERENCES "saas_price_books"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "saas_module_prices" ADD CONSTRAINT "saas_module_prices_module_code_fkey" FOREIGN KEY ("module_code") REFERENCES "saas_modules"("code") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "saas_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "note" TEXT,
    "updated_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "saas_settings_pkey" PRIMARY KEY ("key")
);

INSERT INTO "saas_modules" ("code","name","is_basic","coming_soon","sort_order") VALUES
  ('BASC', 'Basic View', true, false, 10),
  ('CLVN', 'Clients & Vendors Management', false, false, 20),
  ('RQLD', 'Requirement & Leads Management', false, false, 30),
  ('CLHR', 'Client Hiring', false, false, 40),
  ('INHR', 'Internal Hiring', false, false, 50),
  ('INAS', 'Interviews Assessment', false, false, 60),
  ('EMPM', 'Employee Management', false, false, 70),
  ('RESM', 'Resource Management', false, false, 80),
  ('PRTS', 'Project Timesheet', false, false, 90),
  ('PRJM', 'Project Management', false, false, 100),
  ('BILL', 'Billing & Invoicing Management', false, false, 110),
  ('VNPY', 'Vendor Payments', false, false, 120),
  ('EXRB', 'Expense & Reimbursement Management', false, false, 130),
  ('ATLV', 'Attendance & Leave Management', false, false, 140),
  ('WPCI', 'Workplace Checkin Management', false, false, 150),
  ('PAYR', 'Payroll Management', false, false, 160),
  ('OFFC', 'Office Management', false, false, 170),
  ('RFBN', 'Referral & Bench Management', false, false, 180),
  ('SPKU', 'Speak Up - Confidential Reporting', false, false, 190),
  ('HOLC', 'Holiday Calendar Management', false, false, 200),
  ('OTRG', 'OT & Regularization', false, false, 210),
  ('JOBP', 'Job Portal', false, false, 220),
  ('VNDP', 'Vendor Portal', false, false, 230),
  ('LAFN', 'Live Analytics & Financials', false, false, 240),
  ('REPT', 'Various Reports', false, false, 250),
  ('PLCY', 'Policy Management', false, false, 260),
  ('ANNC', 'Announcements, birthdays and anniversaries', false, false, 270),
  ('GSTD', 'GST/TDS Taxation', false, true, 280),
  ('BANK', 'Banking Management', false, true, 290);

INSERT INTO "saas_module_dependencies" ("module_code","needs_code","requirement_group") VALUES
  ('EMPM', 'BASC', 1),
  ('ATLV', 'EMPM', 1),
  ('OTRG', 'ATLV', 1),
  ('PAYR', 'EMPM', 1),
  ('PAYR', 'ATLV', 2),
  ('WPCI', 'EMPM', 1),
  ('RQLD', 'CLVN', 1),
  ('CLHR', 'RQLD', 1),
  ('INHR', 'EMPM', 1),
  ('INAS', 'CLHR', 1),
  ('INAS', 'INHR', 1),
  ('JOBP', 'CLHR', 1),
  ('JOBP', 'INHR', 1),
  ('RFBN', 'EMPM', 1),
  ('RESM', 'EMPM', 1),
  ('RESM', 'CLVN', 2),
  ('PRTS', 'EMPM', 1),
  ('PRTS', 'CLVN', 2),
  ('PRJM', 'CLVN', 1),
  ('BILL', 'CLVN', 1),
  ('VNPY', 'CLVN', 1),
  ('VNDP', 'CLVN', 1),
  ('EXRB', 'EMPM', 1),
  ('LAFN', 'BILL', 1),
  ('GSTD', 'BILL', 1),
  ('GSTD', 'VNPY', 2),
  ('SPKU', 'BASC', 1),
  ('HOLC', 'BASC', 1),
  ('PLCY', 'BASC', 1),
  ('ANNC', 'BASC', 1),
  ('OFFC', 'BASC', 1);

INSERT INTO "saas_price_books" ("id","name","effective_from","admin_price","notes") VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'Launch price book', DATE '2026-11-12', 500, 'First price list from the pricing sheet. Per user per 30 days, before GST. To be checked against the market before it is published (plan question 17).');

INSERT INTO "saas_module_prices" ("price_book_id","module_code","price_30d") VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'BASC', 50),
  ('00000000-0000-4000-8000-0000000000a1', 'CLVN', 8),
  ('00000000-0000-4000-8000-0000000000a1', 'RQLD', 12),
  ('00000000-0000-4000-8000-0000000000a1', 'CLHR', 15),
  ('00000000-0000-4000-8000-0000000000a1', 'INHR', 10),
  ('00000000-0000-4000-8000-0000000000a1', 'INAS', 5),
  ('00000000-0000-4000-8000-0000000000a1', 'EMPM', 10),
  ('00000000-0000-4000-8000-0000000000a1', 'RESM', 15),
  ('00000000-0000-4000-8000-0000000000a1', 'PRTS', 8),
  ('00000000-0000-4000-8000-0000000000a1', 'PRJM', 15),
  ('00000000-0000-4000-8000-0000000000a1', 'BILL', 10),
  ('00000000-0000-4000-8000-0000000000a1', 'VNPY', 5),
  ('00000000-0000-4000-8000-0000000000a1', 'EXRB', 8),
  ('00000000-0000-4000-8000-0000000000a1', 'ATLV', 10),
  ('00000000-0000-4000-8000-0000000000a1', 'WPCI', 5),
  ('00000000-0000-4000-8000-0000000000a1', 'PAYR', 15),
  ('00000000-0000-4000-8000-0000000000a1', 'OFFC', 5),
  ('00000000-0000-4000-8000-0000000000a1', 'RFBN', 8),
  ('00000000-0000-4000-8000-0000000000a1', 'SPKU', 3),
  ('00000000-0000-4000-8000-0000000000a1', 'HOLC', 2),
  ('00000000-0000-4000-8000-0000000000a1', 'OTRG', 4),
  ('00000000-0000-4000-8000-0000000000a1', 'JOBP', 5),
  ('00000000-0000-4000-8000-0000000000a1', 'VNDP', 5),
  ('00000000-0000-4000-8000-0000000000a1', 'LAFN', 12),
  ('00000000-0000-4000-8000-0000000000a1', 'REPT', 5),
  ('00000000-0000-4000-8000-0000000000a1', 'PLCY', 3),
  ('00000000-0000-4000-8000-0000000000a1', 'ANNC', 2),
  ('00000000-0000-4000-8000-0000000000a1', 'GSTD', 5),
  ('00000000-0000-4000-8000-0000000000a1', 'BANK', 5);

INSERT INTO "saas_settings" ("key","value","note") VALUES
  ('trial_days', '15'::jsonb, 'Free trial length in days'),
  ('trial_users', '2'::jsonb, 'Users in a trial (admin + 1)'),
  ('grace_days', '3'::jsonb, 'Read-only days after a module reaches 0 credit days'),
  ('slot_move_days', '7'::jsonb, 'Minimum days between two moves of the same slot'),
  ('low_credit_alert_days', '5'::jsonb, 'Alert the admin when a module has this many days left'),
  ('yearly_discount_pct', '10'::jsonb, 'Discount for yearly payment, in percent'),
  ('trial_read_only_days', '30'::jsonb, 'Days a trial customer''s data stays read-only after the trial ends');
