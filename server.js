import http from 'node:http';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1'; // set HOST=0.0.0.0 to open it from your phone on the same Wi-Fi
const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUB = join(ROOT, 'public');
const DATA_DIR = join(ROOT, 'data');
const DATA = join(DATA_DIR, 'portfolio.json');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css' };
const EMPTY = { settings: { target: 20_000_000, tax: 0.1 }, holdings: [], announcements: [], watchlist: [], transactions: [] };

const fail = (status, message) => Object.assign(new Error(message), { status });
const TICKER = /^[A-Z0-9]{2,6}$/;

// ---- Yahoo Finance (price + 10y dividend history), cached 15 min per symbol ----
const cache = new Map();
async function yahoo(symbol, ticker = symbol) {
  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.at < 15 * 60_000) return hit.data;
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=10y&interval=1mo&events=div`);
  const j = await res.json().catch(() => null);
  const r = j?.chart?.result?.[0];
  if (!r) throw fail(res.status === 404 ? 404 : 502, j?.chart?.error?.description || `Yahoo HTTP ${res.status}`);
  const ts = r.timestamp || [];
  const closes = r.indicators?.quote?.[0]?.close || [];
  const i = ts.findLastIndex((t) => t <= r.meta.regularMarketTime - 365 * 86400);
  const data = {
    ticker,
    name: r.meta.longName || r.meta.shortName || ticker,
    price: r.meta.regularMarketPrice,
    time: r.meta.regularMarketTime * 1000,
    price1y: closes[i] ?? null,
    dividends: Object.values(r.events?.dividends || {})
      .map((d) => ({ date: d.date * 1000, amount: d.amount }))
      .sort((a, b) => a.date - b.date),
  };
  cache.set(symbol, { at: Date.now(), data });
  return data;
}

// IHSG for performance comparison; world gold price in Rp/gram for the zakat nisab.
async function market() {
  const [ihsg, gold, usd] = await Promise.all([yahoo('^JKSE', 'IHSG'), yahoo('GC=F'), yahoo('IDR=X')]);
  return { ihsg, goldPerGram: (gold.price * usd.price) / 31.1035 };
}

// ---- Portfolio file: validated, written atomically so a crash can't corrupt it ----
function clean(d) {
  const num = (v, max = 1e15) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > max) throw fail(400, `Angka tidak valid: ${v}`);
    return n;
  };
  const tick = (t) => { if (!TICKER.test(t)) throw fail(400, `Kode saham tidak valid: ${t}`); return t; };
  const date = (v, required) => {
    if (!v && !required) return '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v))) throw fail(400, `Tanggal tidak valid: ${v}`);
    return v;
  };
  const list = (v) => { if (v === undefined) return []; if (!Array.isArray(v)) throw fail(400, 'Format data salah'); return v; };
  const tx = (t) => {
    const base = { date: date(t.date, true), ticker: tick(t.ticker), type: t.type };
    if (t.type === 'beli') return { ...base, lots: num(t.lots), price: num(t.price) };
    if (t.type === 'jual') return { ...base, lots: num(t.lots), price: num(t.price), avg: num(t.avg) };
    if (t.type === 'dividen') return { ...base, amount: num(t.amount), tax: num(t.tax) };
    throw fail(400, `Jenis transaksi tidak valid: ${t.type}`);
  };
  if (!d || typeof d !== 'object') throw fail(400, 'Format data salah');
  return {
    settings: { target: num(d.settings?.target), tax: num(d.settings?.tax, 1) },
    holdings: list(d.holdings).map((h) => ({ ticker: tick(h.ticker), lots: num(h.lots), avg: num(h.avg) })),
    announcements: list(d.announcements).map((a) => ({
      ticker: tick(a.ticker), amount: num(a.amount), cum: date(a.cum, true), pay: date(a.pay),
    })),
    watchlist: [...new Set(list(d.watchlist).map(tick))],
    transactions: list(d.transactions).map(tx),
  };
}

async function load() {
  try { return { ...EMPTY, ...JSON.parse(await readFile(DATA, 'utf8')) }; }
  catch (e) { if (e.code === 'ENOENT') return EMPTY; throw e; }
}

async function save(d) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DATA + '.tmp', JSON.stringify(d, null, 2));
  await rename(DATA + '.tmp', DATA);
}

// ---- Optional AI analysis (needs `npm install` + ANTHROPIC_API_KEY) ----
const SYSTEM = `Kamu analis saham dividen Indonesia (BEI) yang kritis dan jujur.
Tugas: nilai apakah dividen saham ini masih aman, lalu beri satu keputusan: PERTAHANKAN, PANTAU, JUAL, atau ROTASI.
Gunakan web search untuk mencari laporan keuangan terbaru, pengumuman dividen di BEI/KSEI, dan berita emiten.
Fokus: laba, arus kas operasi, utang, payout ratio, dan kebijakan dividen.
Format: baris pertama "Keputusan: <X>", lalu 3-6 poin alasan singkat, lalu "Risiko utama:" satu kalimat.
Sebut sumber/tanggal data. Jika data tidak ditemukan, katakan, jangan mengarang. Ini bukan nasihat keuangan.`;

let anthropic;
async function analyzeAI(payload) {
  const sdk = await import('@anthropic-ai/sdk').catch(() => null);
  if (!sdk) throw fail(503, 'Jalankan "npm install" dulu untuk fitur AI.');
  anthropic ??= new sdk.default();
  const msg = await anthropic.beta.messages.toolRunner({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium' },
    max_iterations: 5,
    system: SYSTEM,
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }],
    messages: [{ role: 'user', content: `Data portofolio saya untuk ${payload.ticker}:\n${JSON.stringify(payload, null, 1)}` }],
  }).runUntilDone().catch((e) => {
    throw e.status ? e : fail(503, `AI belum siap (${e.message}). Set ANTHROPIC_API_KEY lalu jalankan ulang server.`);
  });
  if (msg.stop_reason === 'refusal') throw fail(502, 'AI menolak permintaan ini.');
  if (msg.stop_reason === 'pause_turn') throw fail(504, 'AI belum selesai mencari, coba lagi.');
  return msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
}

// ---- HTTP ----
async function body(req, limit) {
  let s = '';
  for await (const c of req) if ((s += c).length > limit) throw fail(413, 'Data terlalu besar');
  try { return JSON.parse(s); } catch { throw fail(400, 'JSON tidak valid'); }
}

const send = (res, status, data) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
};

http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  try {
    if (pathname === '/api/portfolio' && req.method === 'GET') return send(res, 200, await load());
    if (pathname === '/api/portfolio' && req.method === 'PUT') {
      const d = clean(await body(req, 1e6));
      await save(d);
      return send(res, 200, d);
    }
    let m = pathname.match(/^\/api\/stock\/([A-Z0-9]{2,6})$/);
    if (m && req.method === 'GET') return send(res, 200, await yahoo(`${m[1]}.JK`, m[1]));
    if (pathname === '/api/market' && req.method === 'GET') return send(res, 200, await market());
    m = pathname.match(/^\/api\/ai\/([A-Z0-9]{2,6})$/);
    if (m && req.method === 'POST') {
      const p = await body(req, 50_000);
      return send(res, 200, { text: await analyzeAI({ ...p, ticker: m[1] }) });
    }
    if (pathname.startsWith('/api/')) throw fail(404, 'Tidak ditemukan');

    const file = join(PUB, pathname === '/' ? 'index.html' : pathname);
    if (!file.startsWith(PUB + sep)) throw fail(403, 'Dilarang');
    const buf = await readFile(file).catch(() => { throw fail(404, 'Tidak ditemukan'); });
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(buf);
  } catch (e) {
    if (!e.status) console.error(e);
    send(res, e.status || 500, { error: e.message });
  }
}).listen(PORT, HOST, () => console.log(`Dividen Astawa: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`));
