import { summarize, seasonality, upcoming, topUp, pct, LOT } from './calc.js';

let db = { settings: { target: 20e6, tax: 0.1 }, holdings: [], announcements: [] };
const stocks = {}, errors = {}, aiText = {};
let topUpResult = null;

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
  await Promise.all(db.holdings.map((h) => fetchStock(h.ticker)));
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
    <p class="mute">Kode yang sudah ada akan digabung (harga rata-rata dihitung ulang).</p>
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
    <h2>Top-up dana <small>dibagi ke 3 saham "aman" dengan yield tertinggi, per lot · Anda eksekusi sendiri di sekuritas</small></h2>
    <form class="form" id="topup"><label>Dana (Rp)<input name="cash" type="number" min="0" step="any" required value="${t?.cash ?? ''}"></label><button>Susun</button></form>
    ${t ? `<div class="wrap"><table style="margin-top:10px">
      <tr><th>Saham</th><th>Beli lot</th><th>Harga</th><th>Biaya</th><th>Yield</th><th>Tambahan/bln bersih</th></tr>
      ${t.plan.map((p) => `<tr><td><b>${p.ticker}</b></td><td>${p.lots}</td><td>${p.price.toLocaleString('id-ID')}</td><td>${rp(p.cost)}</td><td class="acc">${pct(p.yield, 2)}</td><td class="up">+${rp(p.monthly)}</td></tr>`).join('') || '<tr><td colspan="6">Dana kurang untuk 1 lot, atau tidak ada saham berstatus aman.</td></tr>'}
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

const VIEWS = { ringkasan: ['Ringkasan', ringkasan], portofolio: ['Portofolio', portofolio], fund: ['Fund Manager', fund], kalender: ['Pengumuman BEI', kalender], pengaturan: ['Pengaturan', pengaturan] };

function render() {
  const key = VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : 'ringkasan';
  const [title, view] = VIEWS[key];
  $('#title').textContent = title;
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('on', a.hash === '#' + key));
  $('#view').innerHTML = view(summarize(db.holdings, stocks, db.settings));
}

// ---------- events ----------
const ticker = (v) => v.trim().toUpperCase().replace(/\.JK$/, '');

document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  if (e.target.id === 'add-h') {
    const t = ticker(f.ticker), lots = +f.lots, avg = +f.avg;
    const h = db.holdings.find((x) => x.ticker === t);
    if (h) { h.avg = (h.lots * h.avg + lots * avg) / (h.lots + lots); h.lots += lots; }
    else db.holdings.push({ ticker: t, lots, avg });
    await fetchStock(t);
    await save();
  } else if (e.target.id === 'add-a') {
    db.announcements.push({ ticker: ticker(f.ticker), amount: +f.amount, cum: f.cum, pay: f.pay });
    db.announcements.sort((a, b) => a.cum.localeCompare(b.cum));
    await save();
  } else if (e.target.id === 'settings') {
    db.settings = { target: +f.target, tax: +f.tax / 100 };
    await save();
  } else if (e.target.id === 'topup') {
    topUpResult = { cash: +f.cash, ...topUp(summarize(db.holdings, stocks, db.settings), +f.cash) };
    render();
  }
});

document.addEventListener('change', (e) => {
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
  if (b.dataset.ai) {
    const t = b.dataset.ai;
    const r = summarize(db.holdings, stocks, db.settings).rows.find((x) => x.ticker === t);
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
