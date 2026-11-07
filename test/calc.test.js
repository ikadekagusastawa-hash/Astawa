import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, upcoming, topUp, seasonality } from '../public/calc.js';

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

test('top-up buys whole lots of safe stocks only', () => {
  const s = summarize([{ ticker: 'AAAA', lots: 1, avg: 800 }, { ticker: 'BBBB', lots: 100, avg: 500 }], stocks, settings, now);
  s.rows.find((r) => r.ticker === 'AAAA').level = 0;
  const { plan, left } = topUp(s, 250_000);
  assert.deepEqual(plan.map((p) => [p.ticker, p.lots]), [['AAAA', 2]]);
  assert.equal(left, 50_000);
});
