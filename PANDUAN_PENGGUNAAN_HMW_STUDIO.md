# Panduan Lengkap Fungsi & Cara Penggunaan — HMW Studio

> **Developer:** Hermawan Wiryana &nbsp;|&nbsp; **Tanggal:** 21 November 2026

## Gambaran Umum & 6 Pilar Fitur Besar

**HMW Studio** adalah *All-in-One Enterprise IDE* Desktop Native Windows 64-bit (`HMW Studio.exe`) yang menyatukan seluruh kebutuhan pengembangan aplikasi web, administrasi database, pengelolaan server remote, pemantauan performa, hingga asisten AI dalam satu aplikasi ringan dan aman untuk lingkungan produksi:

1. **Database & SQL Enterprise** — *SQL Query Runner* dengan parameter otomatis (`{$id}`) & akses 1-klik Query Tersimpan, *Safe Transaction Workbench* (`Read-Only` & `Staging COMMIT/ROLLBACK`), *Visual EXPLAIN Tree*, *FK Jump-to-Row (`↗`)*, Export & Import Excel `.xlsx` (aman NIP 18-digit + *Dry-Run*), *Visual Query Builder 2D* gaya Navicat, *ER Diagram*, *Schema/Data Diff*, *Kamus Data SPBE*, *User & RBAC*, hingga *Audit Trail 1-Klik Undo SQL*.
2. **Editor Kode & IntelliSense Cerdas** — Editor Monaco polyglot untuk **PHP 8, Laravel/Blade, Framework Wisanggeni (74 Class/544 Method/251 Helper), JS/jQuery, CSS, & SQL multi-baris**, mode saran anti-mengganggu (`Santai`/`Manual`/`Aktif`), *Split Editor*, *Smart Rename*, *Pre-Save Guard*, *Local History 1-Klik Rollback*, & **Dynamic Island (`Ctrl+K`)**.
3. **Proyek, Server Remote SFTP/FTPS & Paket Tim** — Edit langsung file server SFTP OpenSSH 9+ (`< 50 ms` *persistent pool* + kompresi `zlib`) & FTPS TLS 1.3, *Drag & Drop Upload*, `CHMOD`, *Visual Synchronizer* dengan **Folder Diff & Hunk-Level Merge**, **Multi-Server Deploy**, Pembuat Paket Rilis `.ZIP`, & **Paket Onboarding Tim Terenkripsi `.hmwpack`**.
4. **Monitor Performa MySQL & Kesehatan OS (SSH)** — Dashboard performa *real-time* bergaya MySQL Workbench (*Sparkline* QPS, Traffic, InnoDB I/O, Buffer Pool Hit Ratio, Saran `my.cnf`, *Slow Digest*, *Lock Waits + Kill Blocker*, *Storage + OPTIMIZE*), *Processlist*, Kesehatan OS Linux (`CPU/RAM/Disk` + 1-Klik Reload Service), *Crontab*, & **SSH Multi-Server Snippets**.
5. **Visual PHP Debugger (Xdebug), Live Log & HTTP Tester** — Debugger PHP visual bawaan (Xdebug Port `9003`, Breakpoint, Step Over/Into, Call Stack, Locals & Eval), *Live Error Log Monitor* (lompat `file:baris`), **HTTP/AJAX Tester Pro** (*Environments*, *Paste cURL*, *Auto-Capture Token/PHPSESSID*, Impor OpenAPI/Postman & Generator Kode), & **PHP Tinker**.
6. **Google Gemini AI Studio, Security Scanner & Git** — Chat kontekstual AI, Generator 3-File CRUD Wisanggeni, Inline Refactor (`Ctrl+I`), Perbaiki Error `php -l`, **Offline SAST & PHP 8 Security Scanner** (0 kuota AI), **Git Source Control**, *Live Web Preview*, *Terminal ConPTY/SSH*, & *Rubles 2.0*.

---

## 1. Lokasi Aplikasi & Memulai Cepat

- **Jalankan Aplikasi Desktop**: `release/win-unpacked/HMW Studio.exe`
- **Distribusi Portable (ZIP)**: `release/HMW-Studio-win-x64.zip` (tinggal ekstrak & jalankan di Windows 10/11 x64 tanpa instalasi).
- **Tema Tampilan**: Pilih tema di pojok kanan atas toolbar: **`HMW Dark`**, **`Midnight Blue`**, atau **`Clean Light`**.

### Aturan Jendela Modal (Anti-Tertutup Tidak Sengaja)
Seluruh jendela modal di HMW Studio **tidak akan tertutup** jika Anda tidak sengaja mengklik area gelap di luar kotak. Untuk menutup jendela, klik tombol **`✕ Keluar`** di **pojok kanan atas**.

---

## 2. Daftar Pintasan Keyboard (*Shortcuts*) Utama

| Pintasan | Fungsi |
| :--- | :--- |
| **`Ctrl + S`** | Simpan file aktif (otomatis *backup* ke *Local History* + jalankan *Pre-Save Guard* untuk server remote) |
| **`Ctrl + Shift + S`** | Simpan semua tab file yang berubah |
| **`Ctrl + Alt + S`** | Simpan cepat sesi Proyek aktif (`.hmwproj`) |
| **`Ctrl + K`** | Buka **Pencarian Terpadu di Dynamic Island** (*Semua / File / Isi Kode / Simbol & DB*) |
| **`Ctrl + P`** | Buka cepat file Lokal & Server Remote SFTP (`50.000+` file) |
| **`Ctrl + Shift + P`** | Buka **Command Palette** & perintah otomatisasi **Rubles 2.0** |
| **`Ctrl + Shift + F`** | Cari & Ganti teks massal (*Search & Replace*) lintas file Lokal maupun Remote SFTP |
| **`Ctrl + \`** | Buka/tutup **Split Editor** (dua file berdampingan kiri-kanan) |
| **`Shift + Alt + F`** | Rapikan kode (*Code Formatter*) aman untuk campuran PHP + HTML + SQL multi-baris |
| **`Ctrl + Klik`** / **`F12`** | *Go to Definition / Include*: lompat ke file `include`/`require_once`, `view('...')`, `route('...')`, fungsi/class PHP & JS, atau class CSS |
| **`Shift + F12`** | Lacak seluruh pemakaian fungsi, class, atau tabel DB di seluruh proyek (berlencana `SELECT`/`UPDATE`/`JOIN`/`CALL`) |
| **`Ctrl + .`** | **Quick Fix**: perbaiki typo variabel PHP, typo nama tabel/kolom SQL, prefix lintas-DB, atau celah SQL Injection |
| **`Alt + O`** | **Module Companion Switcher**: lompat kilat antar `*_idx.php` ↔ `*_form.php` ↔ `*_save.php` ↔ `*_cetak.php` ↔ `*_excel.php` (atau *Controller ↔ Model ↔ Blade*) |
| **`Alt + R`** | **Smart Rename Symbol** lintas file (*word-boundary safe*) |
| **`Ctrl + Shift + R`** | **Extract Code**: pecah blok kode terpilih ke fungsi baru atau file `include` baru |
| **`Ctrl + Alt + D`** | **1-Klik Diff Lokal ↔ Server SFTP** untuk tab yang sedang dibuka |
| **`Ctrl + F2`** / **`F2`** | Pasang/hapus **Bookmark** baris & lompat ke Bookmark berikutnya |
| **`Ctrl + I`** | Buka **Inline Gemini AI Refactor** langsung di baris aktif |
| **`Ctrl + Shift + A`** | Buka panel **Google Gemini AI Studio** |
| **`Ctrl + Shift + Enter`** | Buka **PHP Scratchpad / Tinker Runner** (uji potongan kode PHP instan) |
| **`Ctrl + ` `** | Buka/tutup Panel Bawah (*Terminal, Transfer Log, Live Error Log, Xdebug PHP, Output*) |
| **`Ctrl + Enter`** *(di SQL Runner)* | Jalankan perintah SQL aktif |

---

## 3. Manajer Proyek, Koneksi Server & Paket Tim (`.hmwpack`)

### 3.1 Manajer Proyek (`Proyek` di Toolbar Atas)
- **Menyimpan Proyek**: Buka folder lokal dan/atau pilih server SFTP, lalu klik **`Proyek`** → masukkan nama proyek → **`Simpan Proyek`**. Seluruh folder lokal, koneksi remote, dan daftar tab yang sedang terbuka akan tersimpan.
- **Berpindah Proyek**: Klik **`Buka Proyek`** pada daftar untuk memulihkan sesi kerja lengkap dalam 1 klik.

### 3.2 Paket Onboarding Tim Terenkripsi (`.hmwpack` • AES-256-GCM)
Berbagi seluruh konfigurasi tim (koneksi SFTP, Database, Saved SQL, Koleksi HTTP, & SSH Snippets) ke rekan kerja baru dalam 10 detik:
1. Klik **`Proyek`** di toolbar atas → gulir ke kartu **`🔐 Paket Onboarding Tim Terenkripsi (.hmwpack)`** → klik **`Ekspor / Impor .hmwpack`**.
2. Masukkan *passphrase* enkripsi (minimal 4 karakter).
3. *(Opsional)* Centang **`Sertakan Password`** jika ingin menyertakan kata sandi terenkripsi; biarkan tidak dicentang jika rekan tim akan mengisi password masing-masing.
4. Klik **`Ekspor Paket Tim (.hmwpack)`** untuk menyimpan file, atau **`Impor Paket Tim (.hmwpack)`** di komputer rekan tim (otomatis melewati profil yang sudah ada agar tidak menimpa data lokal).

### 3.3 Manajer Koneksi Server SFTP / FTPS / FTP
- Buka panel kiri **Explorer** → tab **Remote Server** → klik ikon tambah/kelola koneksi.
- Mendukung **SFTP OpenSSH 9+ (dengan kompresi `zlib@openssh.com` & koneksi persisten `< 50 ms`)**, **FTPS TLS 1.3**, **FTP**, dan **Folder Lokal**.
- **Label Produksi (`🔴 PRODUKSI`)**: Centang opsi **Server Produksi** untuk mengaktifkan banner peringatan merah di editor dan proteksi konfirmasi tambahan.
- **Drag & Drop Upload**: Tarik langsung file/folder dari Windows Explorer ke pohon file *Remote Browser*.
- **Ubah Permission (`CHMOD`)**: Klik kanan file/folder remote → ubah permission (`644` / `755`).

---

## 4. Editor Kode, IntelliSense & Refactoring

### 4.1 IntelliSense Cerdas Multi-Bahasa
- **PHP 8 + Laravel + Wisanggeni**: Saran otomatis fungsi PHP, `$variabel`, method `->`, kunci array `$row['...']`, Facade/Blade/Route/View Laravel, serta 74 Class + 544 Method + 251 Helper **Framework Wisanggeni**.
- **SQL di Dalam String PHP**: Saat mengetik `mysql("SELECT ... FROM db.tabel ...")` multi-baris, autocomplete otomatis membaca skema database aktif & lintas-database, lengkap dengan deteksi typo tabel/kolom dan tombol **`▶ Uji Query`**, **`⚡ Explain Index`**, **`📊 Struktur`** (*Inline SQL CodeLens*) langsung di atas baris SQL.
- **JS, jQuery & CSS di Dalam `.php` / `.blade.php`**: Mengenali `<script>`, `<style>`, `class="..."`, `$('#id')`, serta menampilkan *Visual Color Picker*.
- **Git Blame Inline**: Menampilkan info commit terakhir secara halus di ujung baris kursor aktif pada repositori Git.
- **Mode Saran Anti-Mengganggu (*Non-Intrusive Suggestions*)**: Secara *default* aktif pada mode **`💡 Saran: Santai (Tab)`** — menekan **`Enter`** selalu membuat baris baru (tidak pernah membajak ketikan), menekan **Spasi** atau mengetik di dalam string/komentar biasa tidak memunculkan popup, saran muncul tenang setelah jeda `320 ms` (minimal 2 huruf atau trigger semantik `->`, `::`, `.`, `$`), dan terima saran dengan **`Tab`** atau **Klik**. Klik indikator **`💡 Saran: ...`** di *Status Bar* kanan bawah (atau lewat `Ctrl+Shift+P`) untuk beralih cepat antara **`Santai (Tab)`**, **`Manual (Ctrl+Space)`** *(0% popup otomatis)*, dan **`Aktif (Enter/Tab)`**.

### 4.2 Sabuk Pengaman Simpan (*Pre-Save Guard*) & *Local History*
- **Pre-Save Guard**: Sebelum menyimpan ke server remote, HMW Studio otomatis memindai sisa debug baru (`var_dump`, `print_r`, `dd()`, `debugger;`), penanda konflik Git (`<<<<<<<`), atau kurung `<script>` tidak seimbang, dengan tombol 1-klik **`Hapus Jebakan Debug & Simpan`**.
- **Local History (Panel Kiri `History`)**: Setiap simpan/buka file Lokal & Remote otomatis dibuatkan *snapshot* terdeduplikasi; Anda dapat membandingkan *Diff* dan melakukan **1-Klik Rollback** kapan saja.
- **Multi-Deploy (`📡 Multi-Deploy`)**: Dari bilah aksi editor, unggah 1 file aktif secara serentak ke beberapa server target sekaligus.

### 4.3 Dynamic Island & Desktop Floating Island (`Ctrl + K`)
- **Pencarian 4 Mode**: Klik tombol cari di **Dynamic Island** tengah atas (atau tekan `Ctrl+K`):
  - **`⚡ Semua`**: Gabungan File + Simbol + Tabel DB + Saved SQL + Perintah.
  - **`📄 File`**: Cari kilat `50.000+` file Remote SFTP (`< 10 ms` dari *disk cache* + *delta sync*) & Lokal, filter ekstensi `.php`/`.js`/`.css`/`.sql`, serta lompat baris (`nama_file.php:120`).
  - **`🔎 Isi Kode`**: *Live Grep* paralel langsung di Server SFTP maupun Lokal.
  - **`🧩 Simbol & DB`**: Lompat langsung ke fungsi PHP/JS, `.class` CSS, atau buka *Table Designer* / *Visual JOIN* dari nama tabel.
- **Desktop Floating Island**: Aktifkan mode *Desktop Floating* di menu Dynamic Island agar pil notifikasi tetap mengambang rapi di atas browser saat Anda mengetes aplikasi web.

---

## 5. Visual Synchronizer, Folder Diff & Hunk Merge + Patch `.ZIP`

### 5.1 Sinkronisasi & *Hunk-Level* Merge (Lokal ↔ Server SFTP)
1. Buka **Visual Synchronizer** dari toolbar / menu koneksi.
2. Pilih mode arah (**Bidirectional**, **Push**, atau **Pull**) lalu klik **`Pindai Ulang`**.
3. Gunakan tab **`Daftar Sync`** untuk sinkronisasi massal (tersedia tombol **`✨ Ringkas Pra-Deploy AI`**), **ATAU** klik tab **`Folder Diff & Hunk Merge`** untuk:
   - Melihat pohon folder file yang berbeda di panel kiri.
   - Memilih file untuk memeriksa perbedaan per blok (*hunk*).
   - Menekan **`→ Push Blok ke Server`** atau **`← Pull Blok ke Lokal`** hanya pada blok kode tertentu, lalu klik **`Simpan Lokal`** / **`Simpan ke Server`**.

### 5.2 Pembuat Paket Rilis / Patch `.ZIP`
- Buka dari **Command Palette (`Ctrl+Shift+P`)** → **`Buat Paket Rilis / Patch (.ZIP)`**.
- Pilih sumber perubahan (**Berdasarkan Waktu Modifikasi** mis. 4/12/24 jam terakhir, atau **Perubahan Git**), lampirkan skrip migrasi `.sql` opsional, lalu klik **`Buat Paket Rilis (.ZIP)`** — otomatis mengemas file beserta struktur foldernya utuh + `CATATAN_RILIS.txt`.

---

## 6. Database & SQL Enterprise (DataGrip + TablePlus + Navicat + Workbench)

Buka ikon **Database (`DATABASE & SQL`)** di panel samping kiri.

### 6.1 Tata Letak Panel Ringkas
- **Baris 1**: Pilih profil koneksi DB (mendukung **MySQL/MariaDB**, **PostgreSQL**, dan **SSH Tunnel Otomatis**) + ikon edit/hapus.
- **Baris 2**: Pilih **Database Aktif** + tombol **`⚡ Skema`** (memuat skema super cepat `< 10 ms` dari *disk cache* lokal + pembaruan latar belakang).
- **Baris 3**: Alamat host + lencana **`🛡️ PROD`** (jika database ditandai Produksi).
- **Baris 4 (3 Tombol Utama)**:
  - **`Builder`**: Buka **Navicat-Style Visual Query Builder**.
  - **`Monitor`**: Buka **MySQL Workbench Performance Dashboard**.
  - **`Alat ▾`**: Menu dropdown 3 kategori rapi:
    - *Arsitektur & Skema*: `ER Diagram`, `Schema Diff`, `Tabel Baru`, `View / Proc`, `Ekspor Kamus Data (SPBE / HTML)`.
    - *Data & Migrasi*: `Data Sync`, `Import .XLSX`, `Backup .SQL`, `Cari Isi DB`, `Smart Data Seeder Indonesia`.
    - *Operasional & Keamanan*: `Processlist`, `Jadwal Auto`, `User & RBAC`, `Audit & Undo`.
- **Tab Utama `📋 Tabel (N)` | `⭐ Query (N)`** *(akses 1-klik Query Tersimpan)*:
  - Klik tab **`⭐ Query (N)`** (atau ikon bintang **`⭐`** di header panel) untuk langsung melihat seluruh daftar **Query Tersimpan**, filter folder, pencarian, dan **Riwayat Eksekusi** secara lega di panel samping; klik kartu query untuk memuat ke SQL Runner Layar Lebar atau klik **`▶ Jalankan`** langsung.
  - Pada tab **`📋 Tabel`**, tersedia kotak **`▾ SQL Query`** yang dapat dilipat (dilengkapi tombol **`💾 Simpan`**, Generator Laporan PHP, & Layar Lebar `⤢`) serta **Daftar Tabel & View** (klik **`DATA`** untuk 100 baris pertama, atau klik nama tabel untuk aksi detail).
- **Panel Samping & Panel Bawah Fleksibel (*Resizable*)**:
  - Seret batas kanan panel samping kiri (`240px–560px`) atau batas atas Panel Bawah Terminal/Xdebug (`150px–560px`) sesuai kenyamanan layar Anda; **klik 2×** garis pembatas untuk kembali ke ukuran standar.

### 6.2 SQL Query Runner, Akses Cepat Query Tersimpan, Parameter Otomatis & Safe Transaction Workbench
Klik tombol **Layar Lebar (`⤢`)** atau **`DATA`** pada tabel:
1. **Strip 1-Klik `⭐ Query Tersimpan` & Parameter Otomatis (`{$id}`, `{{id}}`, `:id`, `${id}`, `$id`)**:
   - Di bagian atas SQL Runner, seluruh query tersimpan (Favorit `★` paling depan) tampil langsung sebagai tombol **chip 1-klik** (`★ Cari rekom`, dll.). Klik 1× untuk memuat (atau klik 2× untuk langsung menjalankan); klik **`Kelola`** untuk simpan baru/edit/impor-ekspor.
   - Simpan query template dengan placeholder, misalnya:
     ```sql
     SELECT * FROM rekomendasi WHERE id_rekomendasi='{$id}';
     ```
   - Kotak biru **🎛️ Parameter Query Terdeteksi** otomatis muncul & langsung fokus di atas editor. Ketik nilai ID lalu tekan **`Enter`** — query berjalan dengan nilai tersebut sementara template `'{$id}'` di editor tetap utuh untuk dipakai ulang berkali-kali.
2. **Mode `🔒 Read-Only` & Safe Staging (`Staging: ON`)**:
   - Pada database **`🔴 PROD`**, tombol **`🔒 Read-Only`** aktif otomatis (seluruh edit/UPDATE/DELETE diblokir sampai Anda mengklik gembok untuk membukanya).
   - Saat **`Staging: ON`**, klik 2× sel untuk edit, tambah baris, atau hapus baris akan masuk antrean **Pending Changes** (sel disorot amber / baris dicoret merah) tanpa langsung mengubah data live. Klik **`👁 Preview SQL`** untuk meninjau, lalu klik **`✓ COMMIT Transaksi`** (atomik `BEGIN...COMMIT`) atau **`↩ ROLLBACK (Batal)`**.
3. **Visual `EXPLAIN` Tree & Query Profiler**:
   - Klik **`Visual EXPLAIN`** untuk melihat diagram pohon rencana eksekusi (`Full Table Scan` merah, `Filesort` kuning, `Index/Ref` hijau), skor kesehatan query `0–100`, serta tombol **`Simpan Baseline`** untuk mengukur penurunan *Cost* sebelum vs sesudah tambah index.
4. **Foreign-Key *Jump-to-Row* (`↗`) & *Master-Detail***:
   - Klik ikon panah **`↗`** di dalam sel kolom referensi (`id_perusahaan`, `kd_unitkerja`, dll.) untuk langsung membuka baris induknya di panel **Master-Detail** bagian bawah (mendukung lompatan berantai *multi-hop*).
5. **Grafik & Pivot, Saran Index, Multi-Query & Export Excel (`.xlsx`)**:
   - Klik **`Grafik & Pivot`** untuk mengubah hasil query menjadi grafik *Bar/Line/Pie* atau tabel *Pivot* + simpan `.PNG`.
   - Klik **`Saran INDEX`** untuk rekomendasi `CREATE INDEX` otomatis.
   - Jalankan beberapa `SELECT` dipisahkan `;` untuk membuka tab hasil `#1`, `#2`, dst.
   - Klik **`Export Excel (.xlsx)`** untuk menghasilkan file Excel OpenXML asli (aman menjaga **NIP 18 digit** & angka `0` di depan agar tidak berubah menjadi format ilmiah).

### 6.3 HMW Database Architect (`Builder` / `Alat ▾`)
Menyediakan 5 modul terpadu dalam 1 jendela:
1. **Visual ER Diagram**: Peta relasi tabel 2D interaktif (FK eksplisit + relasi implisit `id_*`/`kd_*`/`nip`), pilih banyak tabel lalu kirim langsung ke Query Builder.
2. **Visual Query Builder (Gaya Navicat)**: Tarik (*drag & drop*) tabel ke kanvas, centang kolom, tarik garis antar-field untuk membuat `JOIN`, atur `WHERE`/`GROUP BY`/`ORDER BY`, lalu salin langsung sebagai **SQL Murni**, **PHP mysqli**, **Wisanggeni (`$query->dosql`)**, atau **Laravel (`DB::table`)**.
3. **Schema Diff & `ALTER TABLE`**: Bandingkan struktur 2 database (mis. Lokal vs Produksi) dan hasilkan skrip migrasi `CREATE`/`ALTER TABLE` otomatis.
4. **Sync Isi Data (+ Masking)**: Transfer isi tabel antar-database (`UPSERT`/`INSERT IGNORE`/`TRUNCATE`) dengan penyamaran otomatis kolom sensitif (`password`, `nik`, `email`, `no_hp`).
5. **Data Diff (Baris PK)**: Bandingkan isi baris 2 tabel berdasarkan Primary Key untuk menghasilkan skrip `INSERT`/`UPDATE`/`DELETE` sinkronisasi presisi.
- Di bilah sub-toolbar atas tersedia tombol **`Kamus .HTML`** (siap cetak PDF A4 untuk dokumen **SPBE / BAST**) dan **`Kamus .XLSX`** (Excel multi-sheet).

### 6.4 Alat Database Enterprise Lainnya (di Menu `Alat ▾`)
- **User & RBAC (`User & RBAC`)**: Lihat daftar akun `mysql.user`/`pg_roles` + `SHOW GRANTS`, buat user baru cepat dengan preset (**Auditor Read-Only**, **Aplikasi Web CRUD**, **Developer**, **DBA**) + generator password acak, dan jalankan **Audit Keamanan** (mendeteksi `root@%`, password kosong, akun anonim, & hak `SUPER` wildcard).
- **Enterprise Excel Importer (`Import .XLSX`)**: Impor multi-sheet `.xlsx` atau *Copy-Paste* langsung dari Microsoft Excel, normalisasi tanggal Indonesia (`16 November 2026` → `2026-11-16`) & Rupiah (`Rp 8.500.000` → `8500000`), lengkap dengan **`🧪 Uji Dry-Run (Rollback)`** sebelum benar-benar menulis ke database.
- **Global Database Value Hunter (`Cari Isi DB`)**: Lacak keberadaan satu nilai (ID perusahaan, NIP, NIB, nomor surat) di ratusan tabel database sekaligus secara paralel.
- **Visual Table Designer (`Tabel Baru` / `Desain`)**: Buat/ubah struktur kolom, tipe data, PK, Auto Increment, Indeks, & FK secara visual.
- **View / Stored Procedure / Function / Trigger (`View / Proc`)**: Editor DDL lengkap dengan eksekutor `CALL`.
- **Smart Data Seeder Indonesia (`Smart Data Seeder Indonesia`)**: Isi ratusan baris data uji realistis (Nama Indonesia, NIP 18-digit, NIK, No. HP, Rupiah) yang otomatis mengikuti nilai induk Foreign Key.
- **Penjadwal Otomatis (`Jadwal Auto`)**: Jadwalkan backup `.SQL` atau ekspor `.XLSX` dari query tersimpan secara berkala di latar belakang.
- **Enterprise Audit Trail & 1-Click SQL Undo (`Audit & Undo` / ikon perisai hijau di toolbar atas)**: Setiap `UPDATE` sel, `DELETE` baris, impor data, & SFTP deploy tercatat otomatis lengkap dengan tombol **1-Klik Undo SQL** untuk memulihkan data lama.

---

## 7. MySQL Workbench Health Monitor & Server Ops (SSH)

Buka lewat tombol **`Monitor`** di panel Database (atau tombol **`Processlist`**).
1. **MySQL Performance Dashboard** *(ultra-ringan `< 50 ms`)*:
   - 3 Grafik *Sparkline* real-time: **QPS (`SELECT/s` vs `Write/s`)**, **Network Traffic (`KB/s`)**, dan **InnoDB Disk I/O**.
   - 4 *Health Gauge*: **InnoDB Buffer Pool Hit Ratio `%`**, **Koneksi Klien vs `max_connections`**, **Full Join tanpa Index & Slow Queries**, dan **Tmp Disk Ratio `%`**.
   - 4 Sub-Tab (dimuat *on-demand* agar tidak membebani produksi): **Tuning Advisor `my.cnf` & Variabel**, **Top 15 Slow Digest SQL**, **InnoDB Lock Waits + 1-Klik Kill Blocker**, dan **Storage/Fragmentasi + `⚡ OPTIMIZE TABLE`**.
2. **DB Processlist & Kill**: Pantau kueri aktif (`SHOW FULL PROCESSLIST` / `pg_stat_activity`) dan hentikan kueri macet dalam 1 klik.
3. **Kesehatan OS (SSH)**: Pantau CPU/Load, RAM, partisi Disk (`df -h` + peringatan merah jika `≥ 90%`), dan status layanan (`nginx`, `apache2`, `php-fpm`, `mysql`, `redis`) lengkap dengan tombol **1-Klik Reload Service**.
4. **Jadwal Crontab**: Inspeksi seluruh jadwal cron aktif pada server Linux.
5. **SSH Snippets & Multi-Exec**: Centang 1 atau beberapa server SSH sekaligus, pilih preset siap klik (*Top Disk `du -sh`*, *Clear Cache Laravel*, *Uji & Reload Nginx*, *Reload PHP-FPM*, *Cek SSL Expiry*, *Tail Error Log*) atau buat snippet kustom Anda sendiri, lalu jalankan serentak dengan output per server dan konfirmasi pengaman `PROD`.

---

## 8. Visual PHP Debugger (Xdebug), Live Error Log & Scratchpad

Buka panel bawah dengan **`Ctrl + ` `**.
- **Tab `🪲 Xdebug PHP` (DBGp Port `9003`)**:
  1. Klik pinggir kiri nomor baris file `.php` di editor untuk memasang **titik merah Breakpoint**.
  2. Buka tab **`Xdebug PHP`** → atur *Path Mapping* (`Remote root ↔ Local root` jika server di Linux/Docker) → klik **`Listen Port 9003`**.
  3. Akses halaman PHP dari browser. Eksekusi otomatis berhenti di baris Breakpoint (disorot kuning amber), menampilkan **Call Stack**, **Locals**, **Superglobals (`$_POST`, `$_GET`, `$_SESSION`)**, serta konsol **Eval / Watch**.
  4. Gunakan tombol **`Continue`**, **`Step Over`**, **`Step Into`**, **`Step Out`**, dan **`Stop`**. Di sub-tab **`Panduan php.ini & SSH Tunnel`** tersedia konfigurasi `php.ini` Xdebug 3 dan perintah `ssh -R 9003` siap salin.
- **Tab `Live Error Log`**: Pantau `error.log` Apache/Nginx/PHP-FPM & `laravel.log` secara *real-time* (lokal maupun server remote SFTP). Setiap error fatal langsung memicu notifikasi di **Dynamic Island** dengan tombol lompat tepat ke `file:baris`.
- **Tab `Terminal`**: Multi-tab terminal lokal (PowerShell/CMD) & sesi **Direct SSH** ke server remote, lengkap dengan tombol analisis error terminal via Gemini AI.
- **PHP Scratchpad (`Ctrl + Shift + Enter`)**: Uji potongan fungsi PHP, regex, array, atau format tanggal tanpa perlu membuka browser.

---

## 9. HTTP / AJAX Tester Enterprise (Mini Postman)

Buka ikon **Globe (`HTTP / AJAX TESTER`)** di panel samping kiri:
- **Environments (`Dev` / `Prod`)**: Pilih lingkungan aktif di dropdown **`Env:`** lalu gunakan variabel `{{base_url}}`, `{{token}}`, atau `{{api_key}}` pada URL, Header, maupun Body.
- **1-Klik dari Kode PHP / Chrome**:
  - Klik **`Ambil Field Tab PHP`** untuk mengekstrak seluruh `$_POST`, `$_GET`, & `$request->input()` dari file PHP yang sedang dibuka.
  - Klik **`Paste cURL`** untuk menempel hasil *Copy as cURL* dari Chrome DevTools Network (otomatis mengisi URL, Header, Cookie `PHPSESSID`, & Body).
- **Auto-Capture Token & Cookie (Tab `Env/Impor`)**: Aktifkan tangkap otomatis `Set-Cookie` (`PHPSESSID`) dan/atau isi *JSON Path* (mis. `data.access_token` → `token`) agar setelah mengetes endpoint Login, token langsung terisi otomatis untuk request berikutnya.
- **Impor OpenAPI / Swagger / Postman**: Tempel isi `openapi.json`, `swagger.json`, atau *Postman Collection v2.1* di tab **`Env/Impor`** untuk mengimpor seluruh endpoint ke folder koleksi.
- **Generate Kode (`Kode`)**: Klik tombol **`Kode`** di baris Env untuk menyalin request aktif dalam bentuk **PHP cURL**, **Laravel HTTP/Guzzle**, atau **JavaScript Fetch**.

---

## 10. Keamanan Kode (Offline SAST) & Google Gemini AI Studio

### 10.1 Enterprise Security, PHP 8 & *Broken-Include* Scanner (Ikon Perisai Merah di Toolbar Atas)
- Bekerja **100% offline (0 kuota AI)** pada proyek Lokal maupun Server Remote SFTP.
- Memindai otomatis: celah **SQL Injection** mentah (`$_GET`/`$_POST`), **Reflected XSS**, **Hardcoded API Key/Password**, fungsi yang dihapus di **PHP 8** (`mysql_*`, `ereg`, `create_function`, `get_magic_quotes_gpc`), dan pernyataan `include`/`require` yang file tujuannya hilang.
- Klik temuan mana saja untuk langsung melompat ke file & baris yang bermasalah.

### 10.2 Google Gemini AI Studio (`Ctrl + Shift + A` atau tombol `Gemini AI`)
- Simpan `GEMINI_API_KEY` Anda dengan aman di brankas terenkripsi **Windows DPAPI** (otomatis menyensor isi `connect_db.php` / password sebelum dikirim ke AI).
- Fitur utama: **Chat Kontekstual**, **Generator 3-File CRUD Wisanggeni (`_idx`, `_form`, `_save`)**, **Inline Refactor (`Ctrl+I`)**, **Perbaiki Error `php -l`**, **Audit Keamanan & Optimasi SQL**, **Generator PHPDoc**, serta **Ringkasan Commit Git & Pra-Deploy Synchronizer**.

---

*Dokumentasi ini dibuat otomatis sesuai versi terbaru **HMW Studio 4.0 Enterprise** (`58/58` pengujian otomatis terverifikasi).*
