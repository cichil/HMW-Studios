# HMW Studio 4.0 Enterprise

> **Developer:** Hermawan Wiryana &nbsp;|&nbsp; **Tanggal:** 21 November 2026  
> **Platform:** Native Windows 64-bit Desktop IDE (`.exe`) — Electron 45 • Node.js 24 • React 19 • TypeScript 5.8 • Vite 8 • Monaco Editor 0.57

**HMW Studio** adalah *All-in-One Enterprise IDE* desktop native Windows yang menyatukan seluruh kebutuhan kerja pengembang web modern — mulai dari pengeditan kode **PHP 8, Laravel/Blade, Framework Wisanggeni, JavaScript/TypeScript, & CSS**, administrasi **Database MySQL/MariaDB & PostgreSQL Enterprise**, pengeditan & sinkronisasi langsung **Server Remote SFTP/FTPS/SSH**, **pemantauan performa MySQL & OS Linux**, **debugging visual Xdebug**, **pengujian API/HTTP**, hingga **Google Gemini AI Studio** dalam satu aplikasi yang cepat, aman untuk server produksi, dan nyaman digunakan sehari-hari.

> 📖 **Panduan Lengkap Fungsi & Cara Penggunaan:** baca [PANDUAN_PENGGUNAAN_HMW_STUDIO.md](./PANDUAN_PENGGUNAAN_HMW_STUDIO.md) atau tekan **`F1`** di dalam aplikasi.

---

## 6 Pilar Fitur Besar

### 1. Database & SQL Enterprise *(DataGrip + TablePlus + Navicat + Workbench)*
- **Akses 1-Klik Query Tersimpan & Parameter Otomatis (`{$id}`, `{{id}}`, `:id`, `${id}`, `$id`)**: tab **`⭐ Query (N)`** di sidebar + strip chip 1-klik di SQL Runner Layar Lebar; ketik nilai parameter lalu tekan `Enter` tanpa merusak template query asli.
- **Safe Transaction Workbench**: tombol **`🔒 Read-Only`** otomatis terkunci pada koneksi **`🔴 PROD`**, serta mode **`Staging: ON`** (*Pending Changes*, *Preview SQL*, & atomik **`COMMIT` / `ROLLBACK`**).
- **Visual `EXPLAIN` Tree & Query Profiler**: pohon rencana eksekusi berwarna (*Full Scan* merah vs *Index* hijau), skor kesehatan `0–100`, & perbandingan *Baseline* sebelum vs sesudah pasang index.
- **Foreign-Key *Jump-to-Row* (`↗`) & *Master-Detail***: lompat langsung dari kolom FK ke baris induknya secara berantai (*multi-hop*).
- **HMW Database Architect (`5-in-1`)**: Visual ER Diagram 2D, Navicat-Style Drag-and-Drop Visual Query Builder (keluaran SQL / PHP `mysqli` / Wisanggeni / Laravel), Schema Diff (`ALTER TABLE`), Sync Isi Data (+ Masking kolom sensitif), Data Diff PK, & Ekspor **Kamus Data SPBE** (`.HTML` siap cetak A4 & `.XLSX` multi-sheet).
- **Export & Import Excel (`.xlsx` Asli)**: menjaga **NIP 18-digit** & kode `0`-depan tetap utuh sebagai teks, impor multi-sheet / *Paste* Excel dengan normalisasi tanggal & Rupiah Indonesia serta uji **`🧪 Dry-Run (Rollback)`**.
- **User & RBAC + Audit Keamanan**, **Global Value Hunter (`Cari Isi DB`)**, **Visual Table Designer**, **View/Proc/Trigger**, **Smart Data Seeder Indonesia**, **Penjadwal Otomatis**, **Grafik & Pivot**, **Saran `INDEX`**, & **Enterprise Audit Trail + 1-Klik Undo SQL**.

### 2. Editor Kode, IntelliSense Cerdas & Perbaikan Offline
- **Polyglot IntelliSense**: **PHP 8**, **Laravel 10/11/12 & Blade** (Facade, Route, View, Model, Config), **Framework Wisanggeni** (`74` Class / `544` Method / `251` Helper), **SQL lintas-database di dalam string PHP** (*Inline SQL CodeLens*), serta **JavaScript/jQuery/CSS** + *Color Picker*.
- **Mode Saran Anti-Mengganggu**: *default* **`💡 Saran: Santai (Tab)`** (`Enter` = baris baru, `Tab` = terima saran, tidak meledak di spasi/komentar/string) dengan sakelar 1-klik di *Status Bar* ke **`🔇 Manual (Ctrl+Space)`** atau **`⚡ Aktif`**.
- **⚡ Perbaiki Instan (Lokal — 100% Offline)**: perbaiki error sintaks PHP dalam hitungan milidetik tanpa Gemini AI & terverifikasi langsung oleh `php -l` (kutip SQL bersarang, kelebihan kutip multi-baris, lupa `;`/`,`/`.`, kurung hilang, array `=` → `=>`, hingga 3 error berantai).
- **Produktivitas & Pengaman**: *Split Editor (`Ctrl+\`)*, *Code Formatter (`Shift+Alt+F`)*, *Code Outline*, *Module Companion (`Alt+O`)*, *Inspector Alur File*, *Smart Rename (`Alt+R`)*, *Pre-Save Guard*, *Local History 1-Klik Rollback*, *Inline Git Blame*, *Panel Sidebar & Bawah Resizable*, serta **Dynamic Island & Desktop Floating Island (`Ctrl+K`)**.

### 3. Proyek, Server Remote SFTP/FTPS & Paket Tim
- **Manajer Proyek (`.hmwproj`)** & **Paket Onboarding Tim Terenkripsi (`.hmwpack` AES-256-GCM)** untuk berbagi seluruh profil SFTP, DB, Saved SQL, HTTP Collection, & SSH Snippets dalam 1 file aman.
- **Dual Explorer & Remote SFTP OpenSSH 9+ (`< 50 ms` *Persistent Pool* + kompresi `zlib`) / FTPS TLS 1.3**: edit langsung (`Ctrl+S`), *Drag & Drop Upload*, `CHMOD`, *Cut/Copy/Paste* 4 arah, & proteksi **`🔴 PRODUKSI`**.
- **Visual Synchronizer + Folder Diff & Hunk-Level Merge** (dorong/tarik per blok kode tanpa menimpa seluruh file), **Multi-Server Broadcast Deploy**, & **Pembuat Paket Rilis `.ZIP`**.

### 4. Monitor Performa MySQL & Server Linux (SSH)
- **MySQL Workbench Performance Dashboard**: grafik *Sparkline* real-time QPS, Traffic `KB/s`, InnoDB I/O, 4 *Health Gauge*, Saran `my.cnf`, Top 15 *Slow Digest SQL*, *InnoDB Lock Waits (+ 1-Klik Kill Blocker)*, & *Storage/Fragmentation (+ `OPTIMIZE TABLE`)*.
- **DB Processlist & Kill**, **Kesehatan OS Linux via SSH** (CPU, RAM, Disk + **1-Klik Reload Service**), **Jadwal Crontab**, & **SSH Command Snippets + Multi-Server Exec**.

### 5. Visual PHP Debugger (Xdebug), Live Log & HTTP Tester Pro
- **Built-in Visual PHP Debugger (Xdebug DBGp Port `9003`)**: *Breakpoint* titik merah di editor, *Path Mapping*, *Step Over/Into/Out*, *Call Stack*, *Locals*, *Superglobals*, & *Eval*.
- **Live Error Log Monitor**: pantau `error.log` / `laravel.log` real-time dengan tombol lompat `file:baris`.
- **HTTP / AJAX Tester Pro**: *Environments* (`Dev`/`Prod`), 1-klik **Ambil Field Tab PHP**, **Paste cURL**, **Auto-Capture Token & `PHPSESSID`**, Impor OpenAPI/Swagger/Postman JSON, & Generator Kode PHP cURL / Laravel / JS Fetch.
- **PHP Scratchpad / Tinker (`Ctrl+Shift+Enter`)**.

### 6. Google Gemini AI Studio, Offline SAST Security & Git
- **Google Gemini AI Studio (`Ctrl+Shift+A` / `Ctrl+I`)**: API Key terenkripsi Windows DPAPI, sensor kredensial otomatis, Chat kontekstual, Generator 3-File CRUD Wisanggeni, *Fast Surgical Error Patch*, Audit SQL, & Smart Git Commit / Ringkasan Pra-Deploy.
- **Offline SAST, PHP 8 Compatibility & Broken-Include Scanner** (`0` kuota AI), **Git Source Control**, **Live Web Preview**, **Multi-Tab Terminal ConPTY & Direct SSH**, serta **Rubles 2.0**.

---

## Perintah Pengembangan, Pengujian & Build `.exe`

```powershell
# Instalasi dependensi
npm.cmd install

# Jalankan mode pengembangan (Hot-Reload)
npm.cmd run dev

# Jalankan seluruh 61 uji otomatis (Vitest)
npm.cmd test

# Verifikasi TypeScript & build produksi
npm.cmd run build

# Paketkan aplikasi desktop Windows 64-bit (release\win-unpacked\HMW Studio.exe)
npx.cmd electron-builder --win --dir
```
