import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { creditMinor, creditMinorSql, debitMinor, isSettlementRow, storedMinor } from '../src/money';

/**
 * The money rule, pinned. Every surface (ledger row, outstanding tile, Balances cards, settle plan,
 * payment cap, person summary, /summary, auto-netting) has to agree with these four rows, because
 * they are the four shapes the ledger actually contains.
 */
const shapes = [
  // A debt as the page and the CSV both write it.
  { name: 'debt', row: { entry_kind: 'debt', amount_minor: 12_000 }, settlement: false, credit: 12_000 },
  // A repayment as the page posts it (positive, kind carries the meaning).
  { name: 'page repayment', row: { entry_kind: 'payment', amount_minor: 2_000 }, settlement: true, credit: -2_000 },
  // A repayment as the CSV import stores it (negative). This is the shape that broke the settle plan.
  { name: 'imported repayment', row: { entry_kind: 'payment', amount_minor: -2_000 }, settlement: true, credit: -2_000 },
  // A netting offset: negative on both sides and already carrying its own sign.
  { name: 'offset', row: { entry_kind: 'offset', amount_minor: -700 }, settlement: true, credit: -700 },
];

test('a repayment subtracts from what is owed however it was stored', () => {
  for (const shape of shapes) {
    assert.equal(isSettlementRow(shape.row), shape.settlement, `${shape.name}: settlement?`);
    assert.equal(creditMinor(shape.row), shape.credit, `${shape.name}: creditor's change`);
    assert.equal(debitMinor(shape.row), -shape.credit, `${shape.name}: debtor's change`);
  }
});

test('the two repayment conventions read identically', () => {
  const posted = creditMinor({ entry_kind: 'payment', amount_minor: 2_000 });
  const imported = creditMinor({ entry_kind: 'payment', amount_minor: -2_000 });
  assert.equal(posted, imported, 'the same 20.00 handed back must move the balance the same way');
  assert.equal(posted, -2_000);
});

test('one currency of rows always nets to zero, which a raw sum does not', () => {
  const rows = [
    { entry_kind: 'debt', amount_minor: 12_000 },
    { entry_kind: 'payment', amount_minor: 2_000 },
    { entry_kind: 'debt', amount_minor: 6_050 },
    { entry_kind: 'payment', amount_minor: -450 },
  ];
  const credit = rows.reduce((total, row) => total + creditMinor(row), 0);
  const debit = rows.reduce((total, row) => total + debitMinor(row), 0);
  const raw = rows.reduce((total, row) => total + row.amount_minor, 0);
  assert.equal(credit + debit, 0, 'every credit is somebody else\'s debit');
  assert.equal(credit, 15_600, '120.00 + 60.50 owed, less 25.00 and 4.50 handed back');
  assert.notEqual(raw, credit, 'the raw sum is the bug: it treats a repayment as a new debt');
});

test('new rows are stored signed from the creditor side', () => {
  assert.equal(storedMinor('debt', 2_000), 2_000);
  assert.equal(storedMinor('debt', -2_000), 2_000, 'a debt magnitude is positive');
  assert.equal(storedMinor('split', 5_000), 5_000);
  assert.equal(storedMinor('payment', 2_000), -2_000, 'a repayment is stored negative');
  assert.equal(storedMinor('payment', -2_000), -2_000);
  assert.equal(storedMinor('offset', 700), -700);
});

test('the SQL form of the rule matches the JavaScript form', () => {
  assert.equal(
    creditMinorSql('t'),
    "CASE WHEN t.amount_minor < 0 OR t.entry_kind = 'payment' THEN -ABS(t.amount_minor) ELSE ABS(t.amount_minor) END",
  );
  assert.equal(
    creditMinorSql(),
    "CASE WHEN amount_minor < 0 OR entry_kind = 'payment' THEN -ABS(amount_minor) ELSE ABS(amount_minor) END",
  );
});

/**
 * The shipped page carries its own copy of the rule (it is a template literal, not an import), so a
 * lift-and-run check keeps the two from drifting apart — the drift that caused this bug.
 */
function liftPageHelper(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} must exist in src/pages.ts`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`${name} is not closed`);
}

test('the shipped page helper agrees with the shared rule on every row shape', () => {
  const source = readFileSync('src/pages.ts', 'utf8');
  const signedMinor = new Function(`${liftPageHelper(source, 'signedMinor')};return signedMinor`)() as (row: {
    entry_kind: string;
    amount_minor: number;
  }) => number;
  for (const shape of shapes) {
    assert.equal(signedMinor(shape.row), creditMinor(shape.row), `${shape.name}: page helper vs the rule`);
  }
  assert.equal(signedMinor({ entry_kind: 'payment', amount_minor: -2_000 }), -2_000, 'an imported repayment is still a repayment');
});

test('the page keeps exactly one signature of the rule', () => {
  const source = readFileSync('src/pages.ts', 'utf8');
  assert.equal(source.match(/function signedMinor\(/g)?.length, 1, 'no second derivation of the rule');
  // A consumer that re-derives the sign inline is the bug: -amount_minor reads an imported
  // repayment as +amount. The only allowed occurrences are inside signedMinor itself.
  const reDerivations = source.match(/-t\.amount_minor|: *- *t\.amount_minor/g) ?? [];
  assert.equal(reDerivations.length, 0, 'money views must call signedMinor(), never re-derive it');
});

test('the server surfaces import the shared rule instead of restating it', () => {
  const sources = {
    worker: readFileSync('src/worker.ts', 'utf8'),
    telegram: readFileSync('src/telegram.ts', 'utf8'),
    workflows: readFileSync('src/workflows.ts', 'utf8'),
    netting: readFileSync('src/netting.ts', 'utf8'),
  };
  for (const [name, source] of Object.entries(sources)) {
    assert.ok(/from '\.\/money'/.test(source), `${name} must import the shared money rule from './money'`);
    assert.ok(
      !/THEN -amount_minor ELSE amount_minor/.test(source),
      `${name} must not restate the rule in SQL — use creditMinorSql()`,
    );
  }
});
