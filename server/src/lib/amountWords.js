// An amount in words for the "Amount Chargeable (in words)" line of a tax invoice.
// INR uses the Indian system (thousand, lakh, crore) and paise; any other currency uses million / billion and cents.

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function below1000(n) {
  const parts = [];
  if (n >= 100) { parts.push(`${ONES[Math.floor(n / 100)]} Hundred`); n %= 100; }
  if (n >= 20) { parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : '')); } else if (n > 0) parts.push(ONES[n]);
  return parts.join(' ');
}

/** [divisor, name] from the largest unit down. */
const INDIAN = [[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand']];
const WESTERN = [[1000000000, 'Billion'], [1000000, 'Million'], [1000, 'Thousand']];

function wholeInWords(n, units) {
  if (n === 0) return 'Zero';
  const parts = [];
  let rest = n;
  for (const [size, name] of units) {
    if (rest >= size) {
      const q = Math.floor(rest / size);
      // the biggest Indian unit (crore) can itself be 100+; split it the same way
      parts.push(`${q >= 1000 ? wholeInWords(q, units) : below1000(q)} ${name}`);
      rest %= size;
    }
  }
  if (rest > 0) parts.push(below1000(rest));
  return parts.join(' ');
}

/** "INR One Lakh Seven Thousand Seven Hundred Thirty Nine Only", with "and Seventy Eight paise" when there are paise. */
function amountInWords(amount, currency = 'INR') {
  const fixed = Number(amount || 0).toFixed(2);
  const [whole, frac] = fixed.split('.');
  const minor = Number(frac);
  const inr = currency === 'INR';
  const words = wholeInWords(Number(whole), inr ? INDIAN : WESTERN);
  const subunit = inr ? 'paise' : 'cents';
  return `${currency} ${words}${minor ? ` and ${wholeInWords(minor, WESTERN)} ${subunit}` : ''} Only`;
}

module.exports = { amountInWords };
