# Dividen Astawa

Dashboard pendapatan pasif dari dividen saham BEI: berapa dividen per bulan, progres ke target,
yield, yield on cost, pertumbuhan dividen, jadwal panen berikutnya, pemeriksaan "fund manager",
dan penyusun top-up per lot.

## Jalankan

Butuh [Node.js](https://nodejs.org) 18 atau lebih baru.

```bash
npm install      # hanya untuk fitur Analisis AI; dashboard jalan tanpa ini
npm start        # buka http://127.0.0.1:3000
```

Buka dari HP di Wi-Fi yang sama: jalankan dengan `HOST=0.0.0.0 npm start`
(Windows PowerShell: `$env:HOST="0.0.0.0"; npm start`), lalu buka `http://<IP-PC>:3000`.
Siapa pun di jaringan itu bisa melihat & mengubah data, jadi jangan lakukan ini di Wi-Fi publik.

Data tersimpan di `data/portfolio.json` di PC Anda.

## Sumber data

| Data | Sumber | Catatan |
|---|---|---|
| Harga, nama emiten, riwayat dividen 10 tahun | Yahoo Finance (otomatis, cache 15 menit) | Gratis, tanpa API key. Tanggal dividen = ex-date. Tidak membedakan dividen reguler vs spesial. |
| Jadwal dividen resmi (cum/bayar) | BEI / KSEI, diinput manual di menu **Pengumuman BEI** | BEI tidak punya API publik dan memblokir akses otomatis (Cloudflare). |
| Analisis AI | Claude + web search | Opsional, berbayar per pemakaian (lihat bawah). |

## Analisis AI (opsional)

Tombol **Analisis AI** di menu Fund Manager mengirim data saham itu ke Claude (`claude-opus-5-5`),
yang mencari laporan keuangan, pengumuman BEI/KSEI, dan berita terbaru lewat web search, lalu
memberi keputusan PERTAHANKAN / PANTAU / JUAL / ROTASI beserta alasannya.

1. Buat API key di <https://console.anthropic.com>, lalu aktifkan web search di pengaturan organisasi Console.
2. `npm install`, lalu jalankan server dengan key tersebut:
   `ANTHROPIC_API_KEY=sk-ant-... npm start` (PowerShell: `$env:ANTHROPIC_API_KEY="sk-ant-..."; npm start`).

Fallback server-side (`fallbacks: "default"`) aktif: jika model menolak permintaan, API otomatis mencoba model lain.

## Aturan fund manager

- **bahaya**: tidak bagi dividen 12 bulan terakhir, atau dividen turun ≥50%.
- **pantau**: dividen turun ≥20%, yield >15% (kemungkinan yield trap), harga turun >30% setahun, atau porsi >25% portofolio.
- **aman**: selain itu. Top-up hanya dibagi ke 3 saham "aman" dengan yield tertinggi.

Ini alat bantu hitung, bukan nasihat investasi.

## Tes

```bash
npm test
```
