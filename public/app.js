import { summarize, seasonality, upcoming, topUp, watchRows, performance, simulate, taxReport, zakat, pct, LOT } from './calc.js';

let db = { settings: { target: 20e6, tax: 0.1 }, holdings: [], announcements: [], watchlist: [], transactions: [] };
const stocks = {}, errors = {}, aiText = {};
let topUpResult = null, market = null, marketErr = '';
let sim = { topup: 5_000_000, y: null, g: 0.03, drip: true }; // y null = current portfolio yield
let taxYear = String(new Date().getFullYear()), goldPerGram = null;

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const rp = (n) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
const short = (n) => n >= 1e9 ? `Rp ${(n / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 })} M`
  : n >= 1e6 ? `Rp ${(n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt` : rp(n);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const day = (ms) => new Date(ms).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
const signed = (x) => x === null ? '–' : `<span class="${x >= 0 ? 'up' : 'down'}">${x >= 0 ? '+' : ''}${pct(x)}</span>`;
const daysTo = (ms) => Math.ceil((ms - Date.now()) / 864e5);

async function api(path, opt) {
  const r = await fetch(path, opt);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

async function fetchStock(t) {
  try { stocks[t] = await api('/api/stock/' + t); delete errors[t]; }
  catch (e) { errors[t] = e.message; }
}

async function refresh() {
  $('#refresh').disabled = true;
  const tickers = new Set([...db.holdings.map((h) => h.ticker), ...db.watchlist]);
  await Promise.all([
    ...[...tickers].map(fetchStock),
    api('/api/market').then((m) => { market = m; marketErr = ''; }, (e) => { marketErr = e.message; }),
  ]);
  $('#refresh').disabled = false;
  $('#live').textContent = 'Live · ' + new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  render();
}

async function save() {
  try {
    db = await api('/api/portfolio', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(db) });
  } catch (e) {
    alert('Gagal menyimpan: ' + e.message);
    db = await api('/api/portfolio'); // back to what is actually on disk
  }
  render();
}

// ---------- views ----------
function ringkasan(s) {
  if (!s.rows.length) return `<div class="card">Belum ada saham. Tambahkan di <a href="#portofolio">Portofolio</a>.</div>`;
  const months = seasonality(s, stocks, db.announcements);
  const max = Math.max(...months.map((m) => m.amount), 1);
  const peak = months.reduce((a, b) => (b.amount > a.amount ? b : a));
  const next = upcoming(s, stocks, db.announcements);
  const movers = s.rows.filter((r) => r.divGrowth !== null).sort((a, b) => b.divGrowth - a.divGrowth);
  const chips = (list, cls) => list.map((r) => `<span class="chip ${cls}">${r.ticker} ${r.divGrowth >= 0 ? '+' : ''}${pct(r.divGrowth, 0)}</span>`).join('') || '–';
  return `
  <div class="card hero">
    <div>
      <div class="label">— PANEN DIVIDEN ANDA</div>
      <div class="big"><sup>Rp</sup> ${Math.round(s.monthly).toLocaleString('id-ID')} <small>/ bulan</small></div>
      <div class="mute">rata-rata 12 bulan terakhir, bersih pajak ${pct(db.settings.tax, 0)} · nilai pasar ${short(s.value)}</div>
    </div>
    <div>
      <div class="mute" style="text-align:right">Perkiraan 12 bulan ke depan (bulan ex-date tahun lalu) · puncak <b>${MONTHS[peak.m]}</b></div>
      <div class="bars">${months.map((m, i) => `<div title="${rp(m.amount)}"><i class="${i === 0 || m.official ? 'off' : ''}" style="height:${(m.amount / max) * 100}%"></i><span>${MONTHS[m.m]}</span></div>`).join('')}</div>
      <div class="mute"><span class="acc">■</span> bulan ini / ada pengumuman BEI &nbsp; ■ perkiraan</div>
    </div>
    <div class="progress">
      <div style="display:flex;justify-content:space-between"><span>Menuju target <b>${short(db.settings.target)}</b> / bulan</span><b class="acc">${pct(s.progress, 0)}</b></div>
      <div class="track"><i style="width:${Math.min(100, s.progress * 100)}%"></i></div>
      <div class="mute">${s.shortfall ? `Kurang <b>${short(s.shortfall)}/bln</b> · butuh tambahan modal ± <b>${s.needCapital ? short(s.needCapital) : '–'}</b> pada yield bersih ${pct(s.netYield, 2)}` : 'Target tercapai 🎉'}</div>
    </div>
  </div>
  <div class="card">
    <h2>Mesin dividen <small>seberapa kuat portofolio menghasilkan</small></h2>
    <div class="grid2">
      <div class="stat"><span class="mute">Dividend yield (TTM)</span><b class="acc">${pct(s.yield, 2)}</b><span class="mute">dari nilai pasar</span></div>
      <div class="stat"><span class="mute">Yield on cost (TTM)</span><b class="up">${pct(s.yoc, 2)}</b><span class="mute">dari modal ${short(s.cost)}</span></div>
      <div class="stat"><span class="mute">Pertumbuhan 1 tahun</span><b>${signed(s.growth1y)}</b><span class="mute">${short(s.prevIncome * s.keep)} → ${short(s.income * s.keep)} / thn</span></div>
      <div class="stat"><span class="mute">Pertumbuhan 5 tahun</span><b>${signed(s.cagr5y)}</b><span class="mute">rata-rata per tahun (CAGR)</span></div>
    </div>
    <p class="mute" style="margin:10px 0 0">Naik ${chips(movers.filter((r) => r.divGrowth > 0).slice(0, 3), 'up')}<br>Turun ${chips(movers.filter((r) => r.divGrowth < 0).reverse().slice(0, 3), 'down')}</p>
  </div>
  <div class="card">
    <h2>Panen berikutnya <small>${next.length ? short(next.reduce((a, b) => a + b.amount, 0)) + ' akan masuk (bersih)' : 'tidak ada dalam 4 bulan'}</small></h2>
    <div class="scroll">${next.map((n) => `
      <div class="harvest">
        <div style="display:flex;justify-content:space-between"><b>${day(n.date).replace(/ \d{4}$/, '')}</b><span class="mute">${daysTo(n.date)} hari lagi</span></div>
        <b>${n.ticker}</b> <span class="chip ${n.official ? 'resmi' : 'perkiraan'}">${n.official ? 'resmi' : 'perkiraan'}</span>
        <div class="amt">${rp(n.amount)}</div>
        <div class="mute">${n.official ? `Cum ${day(Date.parse(n.cum))}${n.pay ? ' · Bayar ' + day(Date.parse(n.pay)) : ''}` : 'Ex-date ± tahun lalu'}<br>Rp ${n.dps.toLocaleString('id-ID')}/lbr</div>
      </div>`).join('')}</div>
  </div>`;
}

function portofolio(s) {
  const rows = db.holdings.map((h, i) => {
    const r = s.rows.find((x) => x.ticker === h.ticker);
    const input = (k) => `<input type="number" min="0" step="any" data-h="${i}" data-k="${k}" value="${h[k]}">`;
    if (!r) return `<tr><td><b>${h.ticker}</b><div class="err">${esc(errors[h.ticker] || 'memuat…')}</div></td><td>${input('lots')}</td><td>${input('avg')}</td><td colspan="7"></td><td><button class="ghost" data-del-h="${i}">✕</button></td></tr>`;
    return `<tr>
      <td><b>${r.ticker}</b><div class="mute">${esc(r.name)}</div></td>
      <td>${input('lots')}</td><td>${input('avg')}</td>
      <td>${r.price.toLocaleString('id-ID')}</td><td>${short(r.value)}</td>
      <td>${signed(r.cost ? r.value / r.cost - 1 : null)}</td>
      <td>${r.ttm.toLocaleString('id-ID', { maximumFractionDigits: 2 })}</td>
      <td class="acc">${pct(r.yield, 2)}</td><td class="up">${pct(r.yoc, 2)}</td>
      <td>${rp(r.income * s.keep)}</td>
      <td><button class="ghost" data-del-h="${i}">✕</button></td></tr>`;
  }).join('');
  return `<div class="card">
    <h2>Portofolio <small>data harga & dividen: Yahoo Finance · 1 lot = ${LOT} lembar</small></h2>
    <div class="wrap"><table>
      <tr><th>Saham</th><th>Lot</th><th>Harga rata²</th><th>Harga</th><th>Nilai</th><th>Untung/rugi</th><th>Dividen/lbr TTM</th><th>Yield</th><th>YoC</th><th>Dividen/thn bersih</th><th></th></tr>
      ${rows}
      <tr><td><b>Total</b></td><td colspan="3"></td><td><b>${short(s.value)}</b></td><td>${signed(s.cost ? s.value / s.cost - 1 : null)}</td><td></td>
        <td class="acc">${pct(s.yield, 2)}</td><td class="up">${pct(s.yoc, 2)}</td><td><b>${rp(s.income * s.keep)}</b></td><td></td></tr>
    </table></div>
    <form class="form" id="add-h">
      <label>Kode saham<input name="ticker" placeholder="BBRI" required></label>
      <label>Jumlah lot<input name="lots" type="number" min="1" step="1" required></label>
      <label>Harga beli rata-rata<input name="avg" type="number" min="1" step="any" required></label>
      <button>Tambah</button>
    </form>
    <p class="mute">Untuk saldo awal. Kode yang sudah ada akan digabung (harga rata-rata dihitung ulang). Beli/jual baru sebaiknya lewat <a href="#transaksi">Transaksi</a> agar masuk ke kinerja.</p>
  </div>`;
}

function fund(s) {
  const rows = s.rows.slice().sort((a, b) => b.level - a.level).map((r) => `
    <tr>
      <td><b>${r.ticker}</b> <span class="chip ${r.status}">${r.status}</span><div class="mute">${r.why.join(' · ') || 'Dividen stabil/naik'}</div>
        ${aiText[r.ticker] ? `<div class="ai">${esc(aiText[r.ticker])}</div>` : ''}</td>
      <td>${signed(r.divGrowth)}</td><td>${signed(r.priceChange)}</td><td class="acc">${pct(r.yield, 2)}</td>
      <td><button class="ghost" data-ai="${r.ticker}">Analisis AI</button></td>
    </tr>`).join('');
  const t = topUpResult;
  return `<div class="card">
    <h2>Pemeriksaan dividen <small>aturan otomatis; "Analisis AI" mencari laporan keuangan & berita terbaru</small></h2>
    <div class="wrap"><table>
      <tr><th>Saham & status</th><th>Dividen 1 thn</th><th>Harga 1 thn</th><th>Yield</th><th></th></tr>${rows}
    </table></div>
    <p class="mute">Aturan: <b class="down">bahaya</b> = tidak bagi dividen / dividen turun ≥50%. <b style="color:var(--yellow)">pantau</b> = dividen turun ≥20%, yield &gt;15%, harga turun &gt;30%, atau porsi &gt;25%.</p>
  </div>
  <div class="card">
    <h2>Top-up dana <small>dibagi ke 3 saham "aman" (portofolio + watchlist) dengan yield tertinggi, per lot · Anda eksekusi sendiri di sekuritas</small></h2>
    <form class="form" id="topup"><label>Dana (Rp)<input name="cash" type="number" min="0" step="any" required value="${t?.cash ?? ''}"></label><button>Susun</button></form>
    ${t ? `<div class="wrap"><table style="margin-top:10px">
      <tr><th>Saham</th><th>Beli lot</th><th>Harga</th><th>Biaya</th><th>Yield</th><th>Tambahan/bln bersih</th></tr>
      ${t.plan.map((p) => `<tr><td><b>${p.ticker}</b>${s.rows.some((r) => r.ticker === p.ticker) ? '' : ' <span class="chip perkiraan">watchlist</span>'}</td><td>${p.lots}</td><td>${p.price.toLocaleString('id-ID')}</td><td>${rp(p.cost)}</td><td class="acc">${pct(p.yield, 2)}</td><td class="up">+${rp(p.monthly)}</td></tr>`).join('') || '<tr><td colspan="6">Dana kurang untuk 1 lot, atau tidak ada saham berstatus aman.</td></tr>'}
    </table></div><p class="mute">Sisa kas ${rp(t.left)} · total tambahan ± ${rp(t.plan.reduce((a, p) => a + p.monthly, 0))}/bulan</p>` : ''}
  </div>`;
}

function kalender(s) {
  return `<div class="card">
    <h2>Pengumuman dividen BEI <small>diinput manual dari keterbukaan informasi BEI / KSEI → label "resmi"</small></h2>
    <p class="mute">BEI tidak menyediakan API publik dan memblokir akses otomatis, jadi cek di
      <a href="https://www.idx.co.id/id/perusahaan-tercatat/keterbukaan-informasi/" target="_blank" rel="noopener">idx.co.id → Keterbukaan Informasi</a>
      lalu catat di sini.</p>
    <div class="wrap"><table>
      <tr><th>Saham</th><th>Dividen/lbr</th><th>Cum date</th><th>Tanggal bayar</th><th>Perkiraan masuk (bersih)</th><th></th></tr>
      ${db.announcements.map((a, i) => {
        const r = s.rows.find((x) => x.ticker === a.ticker);
        return `<tr><td><b>${a.ticker}</b></td><td>${a.amount.toLocaleString('id-ID')}</td><td>${a.cum}</td><td>${a.pay || '–'}</td>
          <td>${r ? rp(r.shares * a.amount * s.keep) : '–'}</td><td><button class="ghost" data-del-a="${i}">✕</button></td></tr>`;
      }).join('')}
    </table></div>
    <form class="form" id="add-a">
      <label>Kode<input name="ticker" required placeholder="JPFA"></label>
      <label>Dividen/lembar (Rp)<input name="amount" type="number" min="0" step="any" required></label>
      <label>Cum date<input name="cum" type="date" required></label>
      <label>Tanggal bayar<input name="pay" type="date"></label>
      <button>Tambah</button>
    </form>
  </div>`;
}

function pengaturan() {
  return `<div class="card"><h2>Pengaturan</h2>
    <form class="form" id="settings">
      <label>Target pendapatan pasif (Rp / bulan)<input name="target" type="number" min="0" step="any" value="${db.settings.target}"></label>
      <label>Pajak dividen (%)<input name="tax" type="number" min="0" max="100" step="any" value="${db.settings.tax * 100}"></label>
      <button>Simpan</button>
    </form>
    <p class="mute">Data tersimpan di <code>data/portfolio.json</code> di komputer yang menjalankan server.</p>
  </div>`;
}

const candidates = (s) => [...s.rows, ...watchRows(db.watchlist.filter((t) => !s.rows.some((r) => r.ticker === t)), stocks)];
const today = () => new Date().toISOString().slice(0, 10);

function watchlist(s) {
  const rows = db.watchlist.map((t, i) => {
    const r = watchRows([t], stocks)[0];
    const del = `<td><button class="ghost" data-ai="${t}" ${r ? '' : 'disabled'}>Analisis AI</button> <button class="ghost" data-del-w="${i}">✕</button></td>`;
    if (!r) return `<tr><td><b>${t}</b><div class="err">${esc(errors[t] || 'memuat…')}</div></td><td colspan="5"></td>${del}</tr>`;
    return `<tr>
      <td><b>${t}</b> <span class="chip ${r.status}">${r.status}</span>${s.rows.some((x) => x.ticker === t) ? ' <span class="chip perkiraan">dimiliki</span>' : ''}
        <div class="mute">${esc(r.name)}${r.why.length ? ' · ' + r.why.join(' · ') : ''}</div>
        ${aiText[t] ? `<div class="ai">${esc(aiText[t])}</div>` : ''}</td>
      <td>${r.price.toLocaleString('id-ID')}</td><td>${r.ttm.toLocaleString('id-ID', { maximumFractionDigits: 2 })}</td>
      <td class="acc">${pct(r.yield, 2)}</td><td>${signed(r.divGrowth)}</td><td>${signed(r.priceChange)}</td>${del}</tr>`;
  }).join('');
  return `<div class="card">
    <h2>Watchlist <small>kandidat berstatus "aman" ikut dipertimbangkan di Top-up dana (Fund Manager)</small></h2>
    <div class="wrap"><table>
      <tr><th>Saham & status</th><th>Harga</th><th>Dividen/lbr TTM</th><th>Yield</th><th>Dividen 1 thn</th><th>Harga 1 thn</th><th></th></tr>${rows}
    </table></div>
    <form class="form" id="add-w"><label>Kode saham (pisahkan dengan koma)<input name="tickers" placeholder="BBRI, TLKM, ADRO" required></label><button>Tambah</button></form>
  </div>`;
}

function transaksi(s) {
  const p = performance(s, db.transactions, market?.ihsg);
  const stat = (label, val, note) => `<div class="stat"><span class="mute">${label}</span><b>${val}</b><span class="mute">${note}</span></div>`;
  const money = (n) => `<span class="${n >= 0 ? 'up' : 'down'}">${n < 0 ? '-' : ''}${short(Math.abs(n))}</span>`;
  const tx = db.transactions.map((t, i) => [t, i]).sort((a, b) => b[0].date.localeCompare(a[0].date)).map(([t, i]) => `<tr>
    <td>${t.date}</td><td><b>${t.ticker}</b></td><td><span class="chip ${t.type === 'jual' ? 'down' : 'up'}">${t.type}</span></td>
    <td>${t.type === 'dividen' ? '' : t.lots}</td><td>${t.type === 'dividen' ? '' : t.price.toLocaleString('id-ID')}</td>
    <td>${t.type === 'dividen' ? rp(t.amount) : rp(t.lots * LOT * t.price)}</td>
    <td>${t.type === 'jual' ? money((t.price - t.avg) * t.lots * LOT) : t.type === 'dividen' ? 'pajak ' + rp(t.tax) : ''}</td>
    <td><button class="ghost" data-del-t="${i}">✕</button></td></tr>`).join('');
  return `<div class="card">
    <h2>Kinerja <small>harga dari Yahoo, realisasi & dividen dari catatan transaksi di bawah</small></h2>
    <div class="grid2">
      ${stat('Total return', `${money(p.total)} ${p.totalPct === null ? '' : `<small>(${signed(p.totalPct)})</small>`}`, 'belum direalisasi + sudah direalisasi + dividen bersih diterima')}
      ${stat('Belum direalisasi', money(p.unrealized), `nilai ${short(s.value)} vs modal ${short(s.cost)}`)}
      ${stat('Sudah direalisasi', money(p.realized), 'dari transaksi jual')}
      ${stat('Dividen diterima (bersih)', `<span class="up">${short(p.dividends)}</span>`, 'dari transaksi dividen')}
      ${stat('Portofolio saat ini, 1 tahun', `${signed(p.price1y)} <small class="mute">harga</small> · ${signed(p.withDiv1y)} <small class="mute">+dividen</small>`, 'jika komposisi hari ini dipegang 12 bulan')}
      ${stat('IHSG, 1 tahun', signed(p.ihsg1y), marketErr ? `<span class="err">${esc(marketErr)}</span>` : 'pembanding (tanpa dividen)')}
    </div>
  </div>
  <div class="card">
    <h2>Transaksi <small>beli/jual langsung mengubah lot & harga rata-rata di Portofolio</small></h2>
    <form class="form" id="add-t">
      <label>Tanggal<input name="date" type="date" required value="${today()}"></label>
      <label>Kode<input name="ticker" required placeholder="BBRI"></label>
      <label>Jenis<select name="type"><option>beli</option><option>jual</option><option>dividen</option></select></label>
      <label>Lot (beli/jual)<input name="lots" type="number" min="1" step="1"></label>
      <label>Harga/lbr (beli/jual)<input name="price" type="number" min="1" step="any"></label>
      <label>Dividen bruto Rp (dividen)<input name="amount" type="number" min="1" step="any"></label>
      <button>Catat</button>
    </form>
    <p class="mute">Pajak dividen dihitung ${pct(db.settings.tax, 0)} dari bruto (ubah di Pengaturan). Masukkan harga sudah termasuk fee broker. Menghapus catatan tidak mengubah Portofolio.</p>
    <div class="wrap"><table>
      <tr><th>Tanggal</th><th>Saham</th><th>Jenis</th><th>Lot</th><th>Harga</th><th>Nilai</th><th>Untung/rugi</th><th></th></tr>${tx}
    </table></div>
  </div>`;
}

function simulasi(s) {
  const y = sim.y ?? Math.round(s.yield * 1000) / 1000;
  const run = (g) => simulate({ income: s.income, topup: sim.topup, y, g, keep: s.keep, drip: sim.drip, target: db.settings.target });
  const when = (hit) => {
    if (hit === null) return 'tidak tercapai dalam 40 tahun';
    if (hit === 0) return 'sudah tercapai';
    const d = new Date(); d.setMonth(d.getMonth() + hit);
    return `${MONTHS[d.getMonth()]} ${d.getFullYear()} <small class="mute">(${Math.floor(hit / 12)} thn ${hit % 12} bln)</small>`;
  };
  const scen = [['Pesimis', sim.g - 0.03], ['Dasar', sim.g], ['Optimis', sim.g + 0.03]].map(([n, g]) => [n, g, run(g)]);
  const base = scen[1][2];
  const shown = base.years.slice(0, Math.min(40, Math.max(5, base.hit === null ? 40 : Math.ceil(base.hit / 12) + 1)));
  const max = Math.max(...shown.map((r) => r.monthly), db.settings.target);
  const year0 = new Date().getFullYear();
  return `<div class="card">
    <h2>Simulasi target <small>kapan ${short(db.settings.target)}/bulan tercapai</small></h2>
    <form class="form" id="sim">
      <label>Top-up per bulan (Rp)<input name="topup" type="number" min="0" step="any" value="${sim.topup}"></label>
      <label>Yield saham yang dibeli (%)<input name="y" type="number" min="0" step="any" value="${+(y * 100).toFixed(2)}"></label>
      <label>Pertumbuhan dividen/thn (%)<input name="g" type="number" step="any" value="${+(sim.g * 100).toFixed(2)}"></label>
      <label><input name="drip" type="checkbox" ${sim.drip ? 'checked' : ''} style="width:auto"> Dividen diputar ulang</label>
      <button>Hitung</button>
    </form>
    <p class="mute">Mulai dari dividen bruto 12 bln terakhir ${short(s.income)}/thn · yield portofolio ${pct(s.yield, 2)} · pertumbuhan 5 thn portofolio ${s.cagr5y === null ? '–' : pct(s.cagr5y)}/thn</p>
    <div class="grid3">
      ${scen.map(([n, g, r]) => `<div class="stat"><span class="mute">${n} · dividen ${g >= 0 ? '+' : ''}${pct(g, 0)}/thn</span><b class="${n === 'Dasar' ? 'acc' : ''}" style="font-size:18px">${when(r.hit)}</b></div>`).join('')}
    </div>
  </div>
  <div class="card">
    <h2>Proyeksi skenario dasar <small>asumsi: harga & yield beli tetap, tanpa fee, pajak ${pct(db.settings.tax, 0)}</small></h2>
    <div class="wrap"><table>
      <tr><th>Tahun</th><th>Total top-up</th><th>Dividen bersih/bln</th><th>% target</th><th style="width:35%"></th></tr>
      ${shown.map((r) => `<tr><td>${year0 + r.year}</td><td>${short(r.invested)}</td><td>${rp(r.monthly)}</td><td>${pct(r.monthly / db.settings.target, 0)}</td>
        <td><div class="track" style="margin:0"><i style="width:${(r.monthly / max) * 100}%"></i></div></td></tr>`).join('')}
    </table></div>
  </div>`;
}

function pajak(s) {
  const years = [...new Set([String(new Date().getFullYear()), ...db.transactions.filter((t) => t.type === 'dividen').map((t) => t.date.slice(0, 4))])].sort().reverse();
  const r = taxReport(db.transactions, taxYear);
  const thisYear = taxReport(db.transactions, String(new Date().getFullYear()));
  const gold = goldPerGram ?? market?.goldPerGram ?? 0;
  const z = zakat(s.value, thisYear.gross - thisYear.tax, gold);
  return `<div class="card">
    <h2>Laporan dividen untuk SPT <small>dari transaksi jenis "dividen"</small></h2>
    <label class="mute">Tahun <select id="tax-year">${years.map((y) => `<option ${y === taxYear ? 'selected' : ''}>${y}</option>`).join('')}</select></label>
    <div class="wrap"><table style="margin-top:8px">
      <tr><th>Saham</th><th>Dividen bruto</th><th>Pajak dipotong</th><th>Diterima bersih</th></tr>
      ${r.rows.map((x) => `<tr><td><b>${x.ticker}</b></td><td>${rp(x.gross)}</td><td>${rp(x.tax)}</td><td>${rp(x.gross - x.tax)}</td></tr>`).join('') || '<tr><td colspan="4" class="mute">Belum ada dividen tercatat di tahun ini. Catat di menu Transaksi.</td></tr>'}
      <tr><td><b>Total</b></td><td><b>${rp(r.gross)}</b></td><td><b>${rp(r.tax)}</b></td><td><b>${rp(r.gross - r.tax)}</b></td></tr>
    </table></div>
    <h2 style="margin-top:18px">Daftar harta saham <small>per hari ini</small></h2>
    <div class="wrap"><table>
      <tr><th>Saham</th><th>Lembar</th><th>Harga perolehan</th><th>Nilai pasar</th></tr>
      ${s.rows.map((x) => `<tr><td><b>${x.ticker}</b> <span class="mute">${esc(x.name)}</span></td><td>${x.shares.toLocaleString('id-ID')}</td><td>${rp(x.cost)}</td><td>${rp(x.value)}</td></tr>`).join('')}
      <tr><td><b>Total</b></td><td></td><td><b>${rp(s.cost)}</b></td><td><b>${rp(s.value)}</b></td></tr>
    </table></div>
    <p class="mute">Perlakuan pajak dividen (PPh final 10% atau dikecualikan bila diinvestasikan kembali di Indonesia) dan cara mengisi SPT bisa berubah. Cek ketentuan terbaru DJP atau konsultan pajak.</p>
  </div>
  <div class="card">
    <h2>Zakat saham <small>2,5% × (nilai pasar + dividen tunai tahun ini), bila mencapai nisab 85 gram emas</small></h2>
    <form class="form" id="gold"><label>Harga emas per gram (Rp)<input name="gold" type="number" min="0" step="any" value="${Math.round(gold)}"></label><button>Hitung</button></form>
    <p class="mute">${goldPerGram === null ? (market ? 'Otomatis dari harga emas dunia (Yahoo: GC=F × USD/IDR). Harga emas Antam biasanya lebih tinggi; ganti bila perlu.' : esc(marketErr || 'memuat harga emas…')) : 'Harga emas diisi manual.'}</p>
    <div class="grid2">
      <div class="stat"><span class="mute">Nisab (85 gram)</span><b>${short(z.nisab)}</b></div>
      <div class="stat"><span class="mute">Harta kena zakat</span><b>${short(z.base)}</b><span class="mute">nilai pasar ${short(s.value)} + dividen bersih ${short(thisYear.gross - thisYear.tax)}</span></div>
      <div class="stat"><span class="mute">Status</span><b class="${z.wajib ? 'acc' : ''}">${z.wajib ? 'Wajib zakat' : 'Belum mencapai nisab'}</b></div>
      <div class="stat"><span class="mute">Zakat (2,5%)</span><b class="up">${rp(z.amount)}</b></div>
    </div>
    <p class="mute">Dengan syarat haul (dimiliki 1 tahun). Ada pendapat ulama lain, misalnya zakat hanya atas dividen. Konsultasikan dengan BAZNAS/LAZ.</p>
  </div>`;
}

const VIEWS = {
  ringkasan: ['Ringkasan', ringkasan], portofolio: ['Portofolio', portofolio], watchlist: ['Watchlist', watchlist],
  fund: ['Fund Manager', fund], transaksi: ['Transaksi & Kinerja', transaksi], simulasi: ['Simulasi', simulasi],
  pajak: ['Pajak & Zakat', pajak], kalender: ['Pengumuman BEI', kalender], pengaturan: ['Pengaturan', pengaturan],
};

function render() {
  const key = VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : 'ringkasan';
  const [title, view] = VIEWS[key];
  $('#title').textContent = title;
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('on', a.hash === '#' + key));
  $('#view').innerHTML = view(summarize(db.holdings, stocks, db.settings));
}

// ---------- events ----------
const ticker = (v) => v.trim().toUpperCase().replace(/\.JK$/, '');
function buy(t, lots, price) {
  const h = db.holdings.find((x) => x.ticker === t);
  if (h) { h.avg = (h.lots * h.avg + lots * price) / (h.lots + lots); h.lots += lots; }
  else db.holdings.push({ ticker: t, lots, avg: price });
}

document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  if (e.target.id === 'add-h') {
    const t = ticker(f.ticker);
    buy(t, +f.lots, +f.avg);
    await fetchStock(t);
    await save();
  } else if (e.target.id === 'add-w') {
    const add = f.tickers.split(/[\s,]+/).filter(Boolean).map(ticker).filter((t) => !db.watchlist.includes(t));
    db.watchlist.push(...add);
    await Promise.all(add.map(fetchStock));
    await save();
  } else if (e.target.id === 'add-t') {
    const t = ticker(f.ticker), lots = +f.lots, price = +f.price, amount = +f.amount;
    const h = db.holdings.find((x) => x.ticker === t);
    if (f.type === 'dividen') {
      if (!(amount > 0)) return alert('Isi jumlah dividen bruto.');
      db.transactions.push({ date: f.date, ticker: t, type: 'dividen', amount, tax: amount * db.settings.tax });
    } else {
      if (!(lots > 0 && price > 0)) return alert('Isi lot dan harga.');
      if (f.type === 'jual') {
        if (!h || h.lots < lots) return alert(`Lot ${t} tidak cukup (punya ${h ? h.lots : 0}).`);
        db.transactions.push({ date: f.date, ticker: t, type: 'jual', lots, price, avg: h.avg });
        h.lots -= lots;
        if (!h.lots) db.holdings.splice(db.holdings.indexOf(h), 1);
      } else {
        db.transactions.push({ date: f.date, ticker: t, type: 'beli', lots, price });
        buy(t, lots, price);
        await fetchStock(t);
      }
    }
    await save();
  } else if (e.target.id === 'sim') {
    sim = { topup: +f.topup, y: +f.y / 100, g: +f.g / 100, drip: !!f.drip };
    render();
  } else if (e.target.id === 'gold') {
    goldPerGram = +f.gold;
    render();
  } else if (e.target.id === 'add-a') {
    db.announcements.push({ ticker: ticker(f.ticker), amount: +f.amount, cum: f.cum, pay: f.pay });
    db.announcements.sort((a, b) => a.cum.localeCompare(b.cum));
    await save();
  } else if (e.target.id === 'settings') {
    db.settings = { target: +f.target, tax: +f.tax / 100 };
    await save();
  } else if (e.target.id === 'topup') {
    const s = summarize(db.holdings, stocks, db.settings);
    topUpResult = { cash: +f.cash, ...topUp(candidates(s), +f.cash, s.keep) };
    render();
  }
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'tax-year') { taxYear = e.target.value; return render(); }
  const { h, k } = e.target.dataset;
  if (h === undefined) return;
  db.holdings[h][k] = +e.target.value;
  save();
});

document.addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.delH) { db.holdings.splice(+b.dataset.delH, 1); save(); }
  if (b.dataset.delA) { db.announcements.splice(+b.dataset.delA, 1); save(); }
  if (b.dataset.delW) { db.watchlist.splice(+b.dataset.delW, 1); save(); }
  if (b.dataset.delT && confirm('Hapus catatan ini? Lot di Portofolio tidak ikut berubah.')) { db.transactions.splice(+b.dataset.delT, 1); save(); }
  if (b.dataset.ai) {
    const t = b.dataset.ai;
    const r = candidates(summarize(db.holdings, stocks, db.settings)).find((x) => x.ticker === t);
    const perYear = {};
    for (const d of stocks[t].dividends) { const y = new Date(d.date).getFullYear(); perYear[y] = (perYear[y] || 0) + d.amount; }
    b.disabled = true; b.textContent = 'Menganalisis… (±1 menit)';
    try {
      const { text } = await api('/api/ai/' + t, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          nama: r.name, lot: r.lots, hargaRataRata: r.avg, hargaSekarang: r.price,
          dividenPerLembarTTM: r.ttm, dividenPerLembarTahunSebelumnya: r.prev, dividenPerTahunKalender: perYear,
          yield: pct(r.yield, 2), yieldOnCost: pct(r.yoc, 2), perubahanHarga1Thn: r.priceChange === null ? null : pct(r.priceChange),
          statusAturan: r.status, alasanAturan: r.why,
          pengumumanBEI: db.announcements.filter((a) => a.ticker === t),
        }),
      });
      aiText[t] = text;
    } catch (err) { aiText[t] = 'Gagal: ' + err.message; }
    render();
  }
});

addEventListener('hashchange', render);
$('#refresh').onclick = refresh;
db = await api('/api/portfolio');
render();
refresh();
