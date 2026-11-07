// Pure dividend math, shared by the browser (app.js) and the tests.
const DAY = 864e5;
const YEAR = 365 * DAY;
export const LOT = 100;

export const pct = (x, d = 1) => (x * 100).toFixed(d).replace('.', ',') + '%';

// Sum of dividend-per-share with ex-date in (from, to].
export const sumDps = (divs, from, to) =>
  divs.reduce((s, d) => (d.date > from && d.date <= to ? s + d.amount : s), 0);

// shortcut: a fixed 365-day window briefly double-counts (or misses) an annual payout whose
// ex-date drifts a few days year to year; switch to per-fiscal-year grouping if that matters.
export function analyze(h, s, now = Date.now()) {
  const shares = h.lots * LOT;
  const ttm = sumDps(s.dividends, now - YEAR, now);
  const prev = sumDps(s.dividends, now - 2 * YEAR, now - YEAR);
  const old5 = sumDps(s.dividends, now - 6 * YEAR, now - 5 * YEAR);
  return {
    ticker: h.ticker, name: s.name, lots: h.lots, shares, avg: h.avg, price: s.price, price1y: s.price1y,
    cost: shares * h.avg, value: shares * s.price,
    ttm, prev,
    yield: s.price ? ttm / s.price : 0,
    yoc: h.avg ? ttm / h.avg : 0,
    income: shares * ttm, prevIncome: shares * prev, oldIncome: shares * old5,
    divGrowth: prev ? ttm / prev - 1 : null,
    priceChange: s.price1y ? s.price / s.price1y - 1 : null,
  };
}

// Rule-based "fund manager": 0 aman, 1 pantau, 2 bahaya.
export function safety(a, weight) {
  let level = 0;
  const why = [];
  const flag = (l, msg) => { level = Math.max(level, l); why.push(msg); };
  if (!a.ttm && a.prev) flag(2, 'Tidak bagi dividen 12 bulan terakhir');
  else if (!a.ttm) flag(2, 'Tidak bagi dividen 2 tahun terakhir');
  else if (a.divGrowth !== null && a.divGrowth <= -0.5) flag(2, `Dividen turun ${pct(-a.divGrowth, 0)}`);
  else if (a.divGrowth !== null && a.divGrowth <= -0.2) flag(1, `Dividen turun ${pct(-a.divGrowth, 0)}`);
  if (a.yield > 0.15) flag(1, `Yield ${pct(a.yield)}: cek dividen spesial / yield trap`);
  if (a.priceChange !== null && a.priceChange < -0.3) flag(1, `Harga turun ${pct(-a.priceChange, 0)} setahun`);
  if (weight > 0.25) flag(1, `Porsi ${pct(weight, 0)} portofolio (>25%)`);
  return { level, status: ['aman', 'pantau', 'bahaya'][level], why };
}

export function summarize(holdings, stocks, settings, now = Date.now()) {
  const keep = 1 - settings.tax;
  const rows = holdings.filter((h) => stocks[h.ticker]).map((h) => analyze(h, stocks[h.ticker], now));
  const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
  const value = sum('value'), cost = sum('cost'), income = sum('income');
  const prevIncome = sum('prevIncome'), oldIncome = sum('oldIncome');
  for (const r of rows) Object.assign(r, safety(r, value ? r.value / value : 0));
  const monthly = (income * keep) / 12;
  const netYield = value ? (income * keep) / value : 0;
  const shortfall = Math.max(0, settings.target - monthly);
  return {
    rows, keep, value, cost, income, prevIncome, monthly, netYield, shortfall,
    yield: value ? income / value : 0,
    yoc: cost ? income / cost : 0,
    growth1y: prevIncome ? income / prevIncome - 1 : null,
    cagr5y: oldIncome && income ? (income / oldIncome) ** (1 / 5) - 1 : null,
    progress: settings.target ? monthly / settings.target : 0,
    needCapital: netYield ? (shortfall * 12) / netYield : null,
  };
}

// Next 12 months, projected from last year's ex-date months (net of tax).
export function seasonality(sum, stocks, announcements, now = Date.now()) {
  const start = new Date(now);
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    return { y: d.getFullYear(), m: d.getMonth(), amount: 0, official: false };
  });
  for (const r of sum.rows)
    for (const d of stocks[r.ticker].dividends)
      if (d.date > now - YEAR && d.date <= now)
        months.find((x) => x.m === new Date(d.date).getMonth()).amount += r.shares * d.amount * sum.keep;
  for (const a of announcements) {
    const d = new Date(a.cum);
    const hit = months.find((x) => x.y === d.getFullYear() && x.m === d.getMonth());
    if (hit && sum.rows.some((r) => r.ticker === a.ticker)) hit.official = true;
  }
  return months;
}

// Upcoming payouts: BEI announcements you entered ("resmi") + last year's pattern ("perkiraan").
export function upcoming(sum, stocks, announcements, now = Date.now(), horizon = 120 * DAY) {
  const shares = Object.fromEntries(sum.rows.map((r) => [r.ticker, r.shares]));
  const out = announcements
    .filter((a) => shares[a.ticker] && Date.parse(a.pay || a.cum) >= now - DAY)
    .map((a) => ({
      ticker: a.ticker, date: Date.parse(a.pay || a.cum), cum: a.cum, pay: a.pay, dps: a.amount,
      amount: shares[a.ticker] * a.amount * sum.keep, official: true,
    }));
  for (const r of sum.rows)
    for (const d of stocks[r.ticker].dividends) {
      const next = d.date + YEAR;
      if (next >= now && next <= now + horizon &&
          !out.some((o) => o.ticker === r.ticker && Math.abs(o.date - next) < 60 * DAY))
        out.push({ ticker: r.ticker, date: next, dps: d.amount, amount: r.shares * d.amount * sum.keep, official: false });
    }
  return out.sort((a, b) => a.date - b.date);
}

// Watchlist candidates, judged by the same rules (no position, so no concentration flag).
export const watchRows = (watchlist, stocks, now = Date.now()) =>
  watchlist.filter((t) => stocks[t]).map((t) => {
    const a = analyze({ ticker: t, lots: 0, avg: 0 }, stocks[t], now);
    return Object.assign(a, safety(a, 0));
  });

// Split new cash over the 3 highest-yield "aman" candidates, weighted by yield, in whole lots.
export function topUp(candidates, cash, keep) {
  const plan = candidates
    .filter((r) => r.level === 0 && r.yield > 0 && r.price > 0)
    .sort((a, b) => b.yield - a.yield)
    .slice(0, 3)
    .map((r) => ({ ticker: r.ticker, price: r.price, yield: r.yield, lots: 0 }));
  const lotCost = (p) => p.price * LOT;
  const w = plan.reduce((s, p) => s + p.yield, 0);
  for (const p of plan) p.lots = Math.floor((cash * p.yield) / w / lotCost(p));
  let left = cash - plan.reduce((s, p) => s + p.lots * lotCost(p), 0);
  for (const p of plan) while (left >= lotCost(p)) { p.lots++; left -= lotCost(p); }
  for (const p of plan) {
    p.cost = p.lots * lotCost(p);
    p.monthly = (p.cost * p.yield * keep) / 12;
  }
  return { plan: plan.filter((p) => p.lots), left };
}

// Total return = unrealized + realized (from sells) + net dividends received (from the log).
export function performance(sum, transactions, ihsg) {
  const sells = transactions.filter((t) => t.type === 'jual');
  const realized = sells.reduce((s, t) => s + (t.price - t.avg) * t.lots * LOT, 0);
  const soldCost = sells.reduce((s, t) => s + t.avg * t.lots * LOT, 0);
  const dividends = transactions.filter((t) => t.type === 'dividen').reduce((s, t) => s + t.amount - t.tax, 0);
  const unrealized = sum.value - sum.cost;
  const total = unrealized + realized + dividends;
  const base = sum.cost + soldCost;
  // "if you had held today's portfolio for the last 12 months"
  const value1y = sum.rows.reduce((s, r) => s + r.shares * (r.price1y || r.price), 0);
  return {
    realized, unrealized, dividends, total,
    totalPct: base ? total / base : null,
    price1y: value1y ? sum.value / value1y - 1 : null,
    withDiv1y: value1y ? (sum.value + sum.income * sum.keep) / value1y - 1 : null,
    ihsg1y: ihsg?.price1y ? ihsg.price / ihsg.price1y - 1 : null,
  };
}

// Monthly model: top-up (+ net dividends if reinvested) buys new income at yield y;
// existing dividends grow by g once a year. Prices are assumed flat.
export function simulate({ income, topup, y, g, keep, drip, target, maxYears = 40 }) {
  let I = income, invested = 0;
  let hit = (I * keep) / 12 >= target ? 0 : null;
  const years = [];
  for (let m = 1; m <= maxYears * 12; m++) {
    invested += topup;
    I += (topup + (drip ? (I * keep) / 12 : 0)) * y;
    if (m % 12 === 0) { I *= 1 + g; years.push({ year: m / 12, invested, monthly: (I * keep) / 12 }); }
    if (hit === null && (I * keep) / 12 >= target) hit = m;
  }
  return { hit, years };
}

// Dividends received in a year, per stock (for the SPT).
export function taxReport(transactions, year) {
  const by = {};
  for (const t of transactions)
    if (t.type === 'dividen' && t.date.startsWith(year)) {
      const r = (by[t.ticker] ??= { ticker: t.ticker, gross: 0, tax: 0 });
      r.gross += t.amount;
      r.tax += t.tax;
    }
  const rows = Object.values(by).sort((a, b) => b.gross - a.gross);
  return { rows, gross: rows.reduce((s, r) => s + r.gross, 0), tax: rows.reduce((s, r) => s + r.tax, 0) };
}

// Zakat saham: 2.5% of market value + cash dividends, once that reaches nisab (85 g gold).
export function zakat(value, dividends, goldPerGram) {
  const nisab = 85 * goldPerGram;
  const base = value + dividends;
  return { nisab, base, wajib: base >= nisab, amount: base >= nisab ? base * 0.025 : 0 };
}
