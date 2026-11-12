// Cash Position: the live total of the ticked bank accounts and wallets. Money is added as whole paise (integers) so
// nothing drifts, INR and USD are never added together, and a wallet whose bank account is also ticked counts once.

export const toPaise = (amount) => {
  const s = String(amount ?? '0').trim();
  const negative = s.startsWith('-');
  const [whole, frac = ''] = s.replace('-', '').split('.');
  const paise = Number(whole || 0) * 100 + Number((frac + '00').slice(0, 2));
  return negative ? -paise : paise;
};

export const fromPaise = (paise) => {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
};

export const accountKey = (id) => `a:${id}`;
export const walletKey = (id) => `w:${id}`;

/** `accounts` is the Bank view tree flattened to accounts (each with its wallets); `selected` a Set of account / wallet keys. */
export function selectionTotals(accounts, selected) {
  const totals = { INR: 0, USD: 0 };
  let accountsCount = 0;
  let walletsCount = 0;
  for (const account of accounts) {
    if (selected.has(accountKey(account.id))) {
      totals[account.currency] += toPaise(account.shown_balance ?? account.balance);
      accountsCount += 1;
      continue; // its wallets are already inside this total
    }
    for (const wallet of account.wallets) {
      if (!selected.has(walletKey(wallet.id))) continue;
      totals[account.currency] += toPaise(wallet.balance);
      walletsCount += 1;
    }
  }
  return { INR: fromPaise(totals.INR), USD: fromPaise(totals.USD), accounts: accountsCount, wallets: walletsCount };
}

export const SYMBOL = { INR: '₹', USD: '$' };
export const formatMoney = (amount, currency) => {
  const paise = toPaise(amount);
  const [whole, frac] = fromPaise(Math.abs(paise)).split('.');
  const grouped = currency === 'INR' ? Number(whole).toLocaleString('en-IN') : Number(whole).toLocaleString('en-US');
  return `${paise < 0 ? '-' : ''}${SYMBOL[currency] || ''}${grouped}.${frac}`;
};
