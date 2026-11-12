// The 20 starting categories of the Whistleblower module (number, name, examples, restricted). They are copied into a company the first
// time the module is opened and are admin-editable from then on (rename, reword, switch off, set the handlers, add more).
// "Restricted" categories are seen only by the handlers an admin names for them (and the group admin), not by every admin.
const DEFAULT_CATEGORIES = [
  [1, 'POSH / Sexual Harassment', 'Sexual harassment, inappropriate behaviour, unwanted advances', true],
  [2, 'Favouritism & Bias', 'Preferential treatment, biased decisions, unequal opportunities', false],
  [3, 'Workplace Politics & Groupism', 'Groupism, manipulation, internal politics, spreading rumours', false],
  [4, 'Bullying & Mental Harassment', 'Humiliation, intimidation, threats, unreasonable pressure', false],
  [5, 'Misuse of Authority', 'Abuse of position, coercion, threats, misuse of managerial powers', false],
  [6, 'Discrimination', 'Unfair treatment based on protected characteristics', false],
  [7, 'Recruitment & Hiring Manipulation', 'Biased hiring, interview manipulation, unfair candidate selection', false],
  [8, 'Performance Appraisal & Promotion Bias', 'Manipulated reviews, unfair promotions, biased ratings', false],
  [9, 'Salary & Incentive Issues', 'Unfair deductions, incentive manipulation, salary-related irregularities', false],
  [10, 'Financial Fraud & Misconduct', 'Fraud, false bills, expense manipulation, financial irregularities', false],
  [11, 'Bribery & Corruption', 'Kickbacks, commissions, personal benefits, bribery', false],
  [12, 'Conflict of Interest', 'Personal interests influencing company decisions', false],
  [13, 'Vendor & Procurement Misconduct', 'Biased vendor selection, procurement manipulation, commissions', false],
  [14, 'Data & Information Misuse', 'Data leakage, unauthorized access, sharing confidential information', false],
  [15, 'Attendance & Work Record Manipulation', 'Fake attendance, manipulated timesheets, false work records', false],
  [16, 'Policy Violations', 'Violation of company policies, bypassing established procedures', false],
  [17, 'Retaliation Against Employees', 'Threats or unfair treatment for reporting concerns', true],
  [18, 'Workplace Safety & Security', 'Unsafe conditions, physical threats, security concerns', false],
  [19, 'Professional Misconduct', 'Dishonesty, unethical behaviour, deliberate negligence', false],
  [20, 'Other Confidential Concerns', 'Any serious issue not covered above', false],
];

const STATUSES = ['new', 'in_review', 'investigating', 'action_taken', 'closed'];
const STATUS_LABEL = { new: 'New', in_review: 'In review', investigating: 'Investigating', action_taken: 'Action taken', closed: 'Closed' };

module.exports = { DEFAULT_CATEGORIES, STATUSES, STATUS_LABEL };
