/**
 * One money rule for every surface that reads a stored transaction row.
 *
 * `amount_minor` is signed from the CREDITOR's side: positive means the creditor is still owed that
 * much, negative means money came back (a repayment or a netting offset). The kind is only a label,
 * because the two write paths disagreed about it: the page posts a repayment positive while the CSV
 * import stores it negative. A consumer that trusts either the sign alone or the kind alone reads
 * half the rows backwards, which is how the settle plan came to report the opposite of the person
 * cards for the same ledger.
 *
 * So the rule is deliberately tolerant of both conventions, and it is the ONLY rule:
 *
 *   settlement        = entry_kind === 'payment' || amount_minor < 0
 *   creditor's change = settlement ? -|amount| : +|amount|
 *   debtor's change   = -(creditor's change)
 *
 * Ordering, offsets and the legacy negative repayment all fall out of it: an offset row is negative
 * on both sides, so it is a settlement and keeps its own sign; a repayment posted negative is a
 * settlement by both tests; a repayment posted positive is a settlement by its kind.
 */
export type MoneyRow = { entry_kind: string; amount_minor: number };

/** The rule as SQL, aliased so it can be dropped into a join: `${creditMinorSql('t')}`. */
export function creditMinorSql(alias = ''): string {
  const p = alias ? `${alias}.` : '';
  return `CASE WHEN ${p}amount_minor < 0 OR ${p}entry_kind = 'payment' THEN -ABS(${p}amount_minor) ELSE ABS(${p}amount_minor) END`;
}

/** True when the row is money coming back rather than a new debt. */
export function isSettlementRow(row: MoneyRow): boolean {
  return row.entry_kind === 'payment' || Number(row.amount_minor) < 0;
}

/** What the row does to the creditor's balance, in minor units. */
export function creditMinor(row: MoneyRow): number {
  const magnitude = Math.abs(Number(row.amount_minor) || 0);
  return isSettlementRow(row) ? -magnitude : magnitude;
}

/** What the row does to the debtor's balance, in minor units. */
export function debitMinor(row: MoneyRow): number {
  return -creditMinor(row);
}

/**
 * The canonical stored sign for a row about to be written: debts and splits positive, settlements
 * negative. Normalising here means a raw `SUM(amount_minor)` is also correct for every row written
 * from now on, so a future surface that forgets the rule still cannot flip a repayment's direction.
 */
export function storedMinor(entryKind: string, amountMinor: number): number {
  const magnitude = Math.abs(Number(amountMinor) || 0);
  return entryKind === 'debt' || entryKind === 'split' ? magnitude : -magnitude;
}
