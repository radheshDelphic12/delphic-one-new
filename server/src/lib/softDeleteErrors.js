// Why a record cannot be deleted / restored, as [http status, message]. Shared by every screen that deletes.
module.exports = {
  locked_attendance: [409, 'This employee has locked attendance months. Reopen them first, then delete.'],
  locked_payroll: [409, 'This employee is on a processed payroll. Reopen that payroll first, then delete.'],
  locked_invoice_paid: [409, 'A paid invoice cannot be deleted. Reopen it first.'],
  locked_claim_reimbursed: [409, 'A reimbursed expense claim cannot be deleted.'],
  not_a_project: [409, 'This record is not a project.'],
  invoice_number_taken: [409, 'Another invoice now uses this invoice number. Change that number first, then restore.'],
  duplicate_on_restore: [409, 'The same person applied again in the meantime. Delete that newer application first, then restore.'],
};
