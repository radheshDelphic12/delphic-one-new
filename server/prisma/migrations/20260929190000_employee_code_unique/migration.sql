-- Employee codes are unique within a company; new employees get the next
-- E-number by default (lib/employeeCode.js). Existing codes are all null or
-- distinct, so this is safe to add.

-- CreateIndex
CREATE UNIQUE INDEX "org_memberships_org_id_employee_code_key" ON "org_memberships"("org_id", "employee_code");

