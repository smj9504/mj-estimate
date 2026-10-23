/**
 * Cent rounding for document totals.
 *
 * A line's amount is quantity * rate rounded to cents, and subtotals add up
 * those rounded amounts. The backend rounds the same way
 * (backend/app/common/utils/money.py); if the two disagree, the edit page and
 * the PDF show different totals.
 */

/**
 * Round to cents, halves away from zero. Never returns -0.
 * toPrecision(12) drops binary noise first: 3.03 * 7.5 is 22.724999999999998
 * as a float and would otherwise round down to 22.72.
 */
export const roundCurrency = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  const cents = Math.round(Number((Math.abs(value) * 100).toPrecision(12)));
  return (Math.sign(value) * cents) / 100 || 0;
};

/** A line item's amount: quantity * rate, rounded to cents. */
export const lineAmount = (quantity: unknown, rate: unknown): number =>
  roundCurrency((parseFloat(String(quantity)) || 0) * (parseFloat(String(rate)) || 0));
