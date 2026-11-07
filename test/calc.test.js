import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, upcoming, topUp, seasonality, watchRows, performance, simulate, taxReport, zakat } from '../public/calc.js';

const DAY = 864e5, YEAR = 365 * DAY;
const now = Date.UTC(2026, 10, 7);
const ago = (days) => now - days * DAY;

const stocks = {
  // annual payer, dividend 100 -> 120 (+20%), 5 years ago 60
  AAAA: { name: 'A', price: 1000, price1y: 1000, dividends: [
    { date: ago(5 * 365 + 100), amount: 60 }, { date: ago(465), amount: 100 }, { date: ago(100), amount: 120 }] },
  // stopped paying
  BBBB: { name: 'B', price: 500, price1y: 1000, dividends: [{ date: ago(400), amount: 50 }] },
};
const holdings = [{ ticker: 'AAAA', lots: 10, avg: 800 }, { ticker: 'BBBB', lots: 10, avg: 500 }];
const settings = { target: 1_000_000, tax: 0.1 };

test('summary math', () => {
  const s = summarize(holdings, stocks, settings, now);
  const a = s.rows.find((r) => r.ticker === 'AAAA');
  assert.equal(a.ttm, 120);
  assert.equal(a.income, 1000 * 120);
  assert.equal(a.yield, 0.12);
  assert.equal(a.yoc, 0.15);
  assert.ok(Math.abs(a.divGrowth - 0.2) < 1e-9);
  assert.equal(s.value, 1000 * 1000 + 1000 * 500);
  assert.equal(s.monthly, (120_000 * 0.9) / 12);
  assert.equal(s.growth1y, 120_000 / (100_000 + 50_000) - 1);
  assert.ok(Math.abs(s.cagr5y - ((120 / 60) ** 0.2 - 1)) < 1e-9);
  assert.equal(s.needCapital, ((1_000_000 - s.monthly) * 12) / s.netYield);
});

test('fund manager rules', () => {
  const s = summarize(holdings, stocks, settings, now);
  const b = s.rows.find((r) => r.ticker === 'BBBB');
  assert.equal(b.status, 'bahaya');
  assert.match(b.why.join(), /Tidak bagi dividen 12 bulan/);
  assert.match(b.why.join(), /Harga turun 50%/);
  const a = s.rows.find((r) => r.ticker === 'AAAA');
  assert.equal(a.status, 'pantau'); // 67% of portfolio
});

test('upcoming: official announcement replaces projection', () => {
  const s = summarize(holdings, stocks, settings, now);
  const proj = upcoming(s, stocks, [], now, 400 * DAY);
  assert.deepEqual(proj.map((x) => [x.ticker, x.official]), [['AAAA', false]]);
  const pay = new Date(ago(100) + YEAR + 10 * DAY).toISOString().slice(0, 10);
  const off = upcoming(s, stocks, [{ ticker: 'AAAA', amount: 130, cum: pay, pay }], now, 400 * DAY);
  assert.equal(off.length, 1);
  assert.equal(off[0].official, true);
  assert.equal(off[0].amount, 1000 * 130 * 0.9);
});

test('seasonality puts last year payout in its month', () => {
  const s = summarize(holdings, stocks, settings, now);
  const months = seasonality(s, stocks, [], now);
  assert.equal(months.length, 12);
  const m = new Date(ago(100)).getMonth();
  assert.equal(months.find((x) => x.m === m).amount, 1000 * 120 * 0.9);
  assert.equal(months.reduce((t, x) => t + x.amount, 0), 1000 * 120 * 0.9);
});

test('top-up buys whole lots of safe candidates only, incl. watchlist', () => {
  const s = summarize([{ ticker: 'BBBB', lots: 100, avg: 500 }], stocks, settings, now);
  const w = watchRows(['AAAA', 'BBBB', 'ZZZZ'], stocks, now); // ZZZZ has no data -> skipped
  assert.deepEqual(w.map((r) => [r.ticker, r.status]), [['AAAA', 'aman'], ['BBBB', 'bahaya']]);
  const { plan, left } = topUp([...s.rows, w[0]], 250_000, 0.9);
  assert.deepEqual(plan.map((p) => [p.ticker, p.lots]), [['AAAA', 2]]);
  assert.equal(left, 50_000);
  assert.equal(plan[0].monthly, (200_000 * 0.12 * 0.9) / 12);
});

test('performance: unrealized + realized + dividends', () => {
  const s = summarize(holdings, stocks, settings, now);
  const tx = [
    { type: 'jual', ticker: 'AAAA', lots: 5, price: 1200, avg: 800, date: '2026-01-01' },
    { type: 'dividen', ticker: 'AAAA', amount: 100_000, tax: 10_000, date: '2026-05-01' },
    { type: 'beli', ticker: 'AAAA', lots: 1, price: 900, date: '2026-02-01' },
  ];
  const p = performance(s, tx, { price: 110, price1y: 100 });
  assert.equal(p.realized, 400 * 500);
  assert.equal(p.dividends, 90_000);
  assert.equal(p.unrealized, s.value - s.cost);
  assert.equal(p.totalPct, p.total / (s.cost + 800 * 500));
  assert.ok(Math.abs(p.ihsg1y - 0.1) < 1e-9);
  assert.equal(p.price1y, s.value / (1000 * 1000 + 1000 * 1000) - 1); // BBBB was 1000
});

test('simulate: reaches target, more top-up is never slower', () => {
  const base = { income: 12_000_000, y: 0.1, g: 0.03, keep: 0.9, drip: true, target: 5_000_000 };
  const a = simulate({ ...base, topup: 1_000_000 });
  const b = simulate({ ...base, topup: 5_000_000 });
  assert.ok(a.hit > 0 && b.hit > 0 && b.hit <= a.hit);
  assert.equal(simulate({ ...base, topup: 0, target: 900_000 }).hit, 0); // already there
  assert.equal(simulate({ ...base, topup: 0, y: 0, g: 0, drip: false }).hit, null); // never
  assert.equal(a.years[0].invested, 12_000_000);
  // no top-up, no growth, no drip: income stays flat
  assert.equal(simulate({ ...base, topup: 0, g: 0, drip: false }).years[4].monthly, 900_000);
});

test('tax report and zakat', () => {
  const tx = [
    { type: 'dividen', ticker: 'AAAA', amount: 100, tax: 10, date: '2026-05-01' },
    { type: 'dividen', ticker: 'AAAA', amount: 50, tax: 5, date: '2026-11-01' },
    { type: 'dividen', ticker: 'BBBB', amount: 70, tax: 7, date: '2025-05-01' },
  ];
  const r = taxReport(tx, '2026');
  assert.deepEqual(r.rows, [{ ticker: 'AAAA', gross: 150, tax: 15 }]);
  assert.equal(r.gross, 150);
  assert.deepEqual(zakat(100, 0, 2), { nisab: 170, base: 100, wajib: false, amount: 0 });
  assert.equal(zakat(1000, 200, 2).amount, 30);
});
