-- Time & Attendance: a standard holiday calendar can be tied to a department.
-- Additive only.

-- AlterTable
ALTER TABLE "calendars" ADD COLUMN     "department_id" UUID;

-- CreateIndex
CREATE INDEX "calendars_department_id_idx" ON "calendars"("department_id");

-- AddForeignKey
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
