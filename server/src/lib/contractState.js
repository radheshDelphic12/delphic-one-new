// Project contract tracking, shared by Finance → Projects and Project P&L:
// a manual hold / completed wins; otherwise the agreement dates decide
// (not started → running → about to end within 30 days → completed).
const ABOUT_TO_END_DAYS = 30;

function todayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function contractState(account, today = todayUtc()) {
  if (account.contract_status) return { state: account.contract_status, days_left: null };
  const start = account.agreement_start_date;
  const end = account.agreement_end_date;
  if (end && end < today) return { state: 'completed', days_left: null };
  if (!start || start > today) return { state: 'not_started', days_left: null };
  const daysLeft = end ? Math.round((end - today) / 86400000) : null;
  if (daysLeft !== null && daysLeft <= ABOUT_TO_END_DAYS) return { state: 'about_to_end', days_left: daysLeft };
  return { state: 'running', days_left: daysLeft };
}

module.exports = { contractState, ABOUT_TO_END_DAYS };
