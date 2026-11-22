import React, { useMemo, useState } from 'react';
import {
  Activity,
  ArrowRight,
  BookOpen,
  Bug,
  Calendar,
  Code2,
  Database,
  FolderKanban,
  Keyboard,
  RefreshCw,
  Search,
  Sparkles,
  User,
  X
} from 'lucide-react';
import { useIdeStore } from '../store/useIdeStore';
import { HmwLogo } from './HmwLogo';

const APP_DEVELOPER_NAME = 'Hermawan Wiryana';
const APP_DOC_DATE = '21 November 2026';

interface MajorPillarItem {
  targetCategory: Exclude<DocCategoryId, 'all' | 'shortcuts'>;
  title: string;
  accent: string;
  icon: React.ReactNode;
  desc: string;
}

const MAJOR_PILLARS: MajorPillarItem[] = [
  {
    targetCategory: 'database',
    title: 'Database & SQL Enterprise',
    accent: '#fbbf24',
    icon: <Database size={16} />,
    desc: 'SQL Runner parameter otomatis ({$id}), akses 1-klik Query Tersimpan, Safe Transaction (Read-Only & Staging COMMIT/ROLLBACK), Visual EXPLAIN, FK Jump-to-Row, Export/Import Excel .xlsx, Visual Query Builder 2D, ER Diagram, Schema/Data Diff, Kamus Data SPBE, User & RBAC, hingga 1-Klik Undo SQL.'
  },
  {
    targetCategory: 'editor',
    title: 'Editor Kode & IntelliSense Cerdas',
    accent: '#38bdf8',
    icon: <Code2 size={16} />,
    desc: 'Editor Monaco untuk PHP 8, Laravel/Blade, Framework Wisanggeni, JS/jQuery, CSS, & SQL multi-baris, mode saran anti-mengganggu (Santai/Manual), Split Editor, Smart Rename, Pre-Save Guard, Local History 1-Klik Rollback, & Dynamic Island Omnibox (Ctrl+K).'
  },
  {
    targetCategory: 'projects',
    title: 'Proyek, Server SFTP/FTPS & Paket Tim',
    accent: '#34d399',
    icon: <FolderKanban size={16} />,
    desc: 'Edit langsung file server SFTP OpenSSH 9+ (< 50 ms persistent pool + kompresi zlib) & FTPS TLS 1.3, Drag & Drop Upload, CHMOD, Visual Synchronizer + Folder Diff & Hunk-Level Merge, Multi-Deploy, Paket Rilis .ZIP, & Paket Tim Terenkripsi .hmwpack.'
  },
  {
    targetCategory: 'monitor',
    title: 'Monitor Performa MySQL & Server SSH',
    accent: '#60a5fa',
    icon: <Activity size={16} />,
    desc: 'Dashboard performa live (Sparkline QPS, Traffic, InnoDB I/O, Buffer Pool Hit Ratio, Saran my.cnf, Slow Digest, Lock Waits + Kill Blocker, Storage/OPTIMIZE), Processlist, Kesehatan OS Linux + 1-Klik Reload Service, Crontab, & SSH Multi-Snippets.'
  },
  {
    targetCategory: 'debug',
    title: 'Visual PHP Debugger, Live Log & HTTP Tester',
    accent: '#fb923c',
    icon: <Bug size={16} />,
    desc: 'Debugger PHP visual Xdebug (Port 9003, Breakpoint, Step Over/Into, Call Stack, Locals & Eval), Live Error Log Monitor (lompat file:baris), HTTP/AJAX Tester Pro (Environments, Paste cURL, Auto-Capture, OpenAPI/Postman & Code Gen), & PHP Tinker.'
  },
  {
    targetCategory: 'ai',
    title: 'Google Gemini AI, Security Scanner & Git',
    accent: '#c084fc',
    icon: <Sparkles size={16} />,
    desc: 'Chat kontekstual AI, Generator 3-File CRUD Wisanggeni, Inline Refactor (Ctrl+I), Perbaiki Error php -l, Offline SAST & PHP 8 Security Scanner (0 kuota AI), Git Source Control, Live Web Preview, Terminal ConPTY/SSH, & Rubles 2.0.'
  }
];

type DocCategoryId =
  | 'all'
  | 'shortcuts'
  | 'projects'
  | 'editor'
  | 'database'
  | 'monitor'
  | 'debug'
  | 'ai';

interface ShortcutDocRow {
  keys: string;
  title: string;
  detail: string;
}

interface FeatureDocItem {
  id: string;
  category: Exclude<DocCategoryId, 'all' | 'shortcuts'>;
  title: string;
  badge?: string;
  badgeColor?: string;
  location: string;
  summary: string;
  steps: string[];
  actionLabel?: string;
  onAction?: (st: ReturnType<typeof useIdeStore.getState>) => void;
}

const SHORTCUT_ROWS: ShortcutDocRow[] = [
  { keys: 'F1', title: 'Buka Dokumentasi & Panduan Fitur', detail: 'Menampilkan jendela dokumentasi fitur ini kapan saja' },
  { keys: 'Ctrl + S / Ctrl + Shift + S', title: 'Simpan File Aktif / Simpan Semua', detail: 'Menyimpan file lokal atau langsung mengunggah ke server Remote SFTP' },
  { keys: 'Ctrl + Alt + S', title: 'Simpan Cepat Proyek (.hmwproj)', detail: 'Menyimpan folder lokal, koneksi SFTP, & daftar tab terbuka saat ini' },
  { keys: 'Ctrl + K', title: 'Dynamic Island Omnibox (4 Mode)', detail: 'Cari File, Isi Kode (Live Grep), Simbol PHP/JS/CSS, Tabel DB, & Saved SQL' },
  { keys: 'Ctrl + P / Ctrl + Shift + P', title: 'Buka Cepat File / Command Palette', detail: 'Lompat ke file Lokal & Remote SFTP atau jalankan seluruh perintah IDE & Ruble' },
  { keys: 'Ctrl + Shift + F', title: 'Cari & Ganti Lintas File', detail: 'Pencarian & Replace aman ($ PHP) pada proyek Lokal maupun Server SFTP' },
  { keys: 'Ctrl + \\', title: 'Split Editor Kiri-Kanan', detail: 'Membuka 2 file secara berdampingan untuk membandingkan atau merujuk kode' },
  { keys: 'Shift + Alt + F', title: 'Rapikan / Format Kode', detail: 'Code Formatter otomatis yang aman terhadap string SQL multi-baris di PHP' },
  { keys: 'Ctrl + Klik / F12', title: 'Go to Definition & Buka Include', detail: 'Lompat ke definisi fungsi/class PHP & JS, file include, Blade view(), & route()' },
  { keys: 'Shift + F12', title: 'Lacak Pemakaian (References)', detail: 'Melacak pemakaian fungsi atau tabel DB dengan lencana SELECT/UPDATE/JOIN/CALL' },
  { keys: 'Ctrl + .', title: 'Quick Fix (Lampu Pijar)', detail: 'Koreksi 1-klik typo variabel PHP, typo tabel/kolom SQL, lintas-DB, & SQLi' },
  { keys: 'Alt + O', title: 'Module Companion Switcher', detail: 'Berpindah cepat antar *_idx ↔ *_form ↔ *_save ↔ *_cetak ↔ *_excel / MVC Laravel' },
  { keys: 'Alt + R / Ctrl + Shift + R', title: 'Smart Rename / Extract Code', detail: 'Ganti nama simbol lintas file aman atau pecah blok kode ke fungsi/include baru' },
  { keys: 'Ctrl + Alt + D', title: 'Diff Lokal ↔ Server Remote SFTP', detail: 'Bandingkan file aktif berdampingan dengan salinan live di server SFTP/FTPS' },
  { keys: 'Ctrl + F2 / F2', title: 'Pasang & Lompat Bookmark Baris', detail: 'Menandai baris penting pada file panjang dan melompat cepat antar penanda' },
  { keys: 'Ctrl + I / Ctrl + Shift + A', title: 'Inline Gemini AI / Studio AI', detail: 'Refactor blok kode inline atau buka panel Google Gemini AI Studio' },
  { keys: 'Ctrl + Shift + Enter', title: 'PHP Scratchpad / Tinker', detail: 'Jalankan eksperimen snippet PHP CLI instan dan lihat hasil STDOUT/STDERR' },
  { keys: 'Ctrl + `', title: 'Panel Bawah (Terminal, Log, Xdebug)', detail: 'Buka/tutup Terminal PowerShell/SSH, Transfer Log, Live Error Log, & Xdebug PHP' },
  { keys: 'Ctrl + Space / Tab', title: 'Panggil Saran Manual / Terima Saran', detail: 'Enter tetap baris baru pada mode Santai; klik 💡 Saran di Status Bar untuk ganti mode' },
  { keys: 'Ctrl + Enter / F5', title: 'Jalankan Query SQL', detail: 'Mengeksekusi query di kotak SQL Sidebar maupun SQL Query Runner Layar Lebar' }
];

const FEATURE_DOCS: FeatureDocItem[] = [
  // ==================== PROYEK, SFTP & TIM ====================
  {
    id: 'proj-manager',
    category: 'projects',
    title: 'Manajer Proyek Tersimpan (.hmwproj)',
    badge: 'Proyek',
    badgeColor: '#38bdf8',
    location: 'Toolbar Atas → Proyek / Simpan Proyek (Ctrl+Alt+S)',
    summary:
      'Menyimpan kombinasi folder lokal, koneksi SFTP/FTPS, database aktif, dan seluruh tab file terbuka agar bisa dibuka kembali dalam 1 klik.',
    steps: [
      'Klik tombol "Simpan Proyek" di toolbar atas untuk menyimpan sesi kerja saat ini.',
      'Buka "Proyek" kapan saja untuk berpindah proyek, mengedit nama/catatan, atau ekspor-impor file .hmwproj.'
    ],
    actionLabel: 'Buka Manajer Proyek',
    onAction: (st) => st.setProjectModalOpen(true)
  },
  {
    id: 'proj-hmwpack',
    category: 'projects',
    title: 'Paket Onboarding Tim Terenkripsi (.hmwpack)',
    badge: 'AES-256-GCM',
    badgeColor: '#34d399',
    location: 'Proyek → Kartu Paket Onboarding Tim (.hmwpack)',
    summary:
      'Bagikan seluruh profil server SFTP, profil Database, Saved SQL Queries, Koleksi HTTP Tester, & SSH Snippets ke rekan tim dalam 1 file terenkripsi.',
    steps: [
      'Klik "Proyek" → klik "Ekspor / Impor .hmwpack".',
      'Masukkan passphrase enkripsi (min. 4 karakter) dan pilih apakah password ikut disertakan atau dikosongkan.',
      'Di komputer rekan tim, impor file .hmwpack (profil yang sudah ada tidak akan ditimpa).'
    ],
    actionLabel: 'Buka di Manajer Proyek',
    onAction: (st) => st.setProjectModalOpen(true)
  },
  {
    id: 'sftp-explorer',
    category: 'projects',
    title: 'Dual Explorer & Remote SFTP/FTPS Berkecepatan Tinggi (< 50 ms)',
    badge: 'SFTP Pool',
    badgeColor: '#38bdf8',
    location: 'Panel Kiri → Explorer (ikon Files)',
    summary:
      'Kelola file Lokal dan Server Remote OpenSSH 9+ (kompresi zlib + koneksi persisten keep-alive) & FTPS TLS 1.3 lengkap dengan CRUD penuh.',
    steps: [
      'Edit langsung file server lalu tekan Ctrl+S untuk unggah instan.',
      'Gunakan Drag & Drop dari Windows Explorer untuk unggah file/folder, Cut/Copy/Paste 4 arah (Lokal ↔ Remote), serta klik kanan untuk CHMOD (644/755).',
      'Centang "Server Produksi" di profil koneksi agar muncul lencana pengaman 🔴 PRODUKSI saat mengedit file live.'
    ],
    actionLabel: 'Buka Explorer',
    onAction: (st) => st.setActiveSidebar('explorer')
  },
  {
    id: 'sync-hunk',
    category: 'projects',
    title: 'Visual Synchronizer, Folder Diff & Hunk-Level Merge',
    badge: 'Selective Merge',
    badgeColor: '#c084fc',
    location: 'Explorer → Remote Server → Sinkronisasi (atau Command Palette)',
    summary:
      'Bandingkan direktori Lokal ↔ Server SFTP dua arah, ringkas perubahan dengan AI, dan dorong/tarik hanya blok baris (hunk) tertentu tanpa menimpa seluruh file.',
    steps: [
      'Pilih arah sinkronisasi (Bidirectional / Push / Pull) lalu klik "Pindai Ulang".',
      'Gunakan tab "Daftar Sync" untuk sinkronisasi massal, atau tab "Folder Diff & Hunk Merge" untuk melihat pohon folder dan menekan "→ Push Blok ke Server" / "← Pull Blok ke Lokal" per blok kode.'
    ],
    actionLabel: 'Buka Synchronizer',
    onAction: (st) => st.setSyncModalOpen(true)
  },
  {
    id: 'release-zip',
    category: 'projects',
    title: 'Pembuat Paket Rilis / Patch (.ZIP)',
    badge: 'Deploy',
    badgeColor: '#fbbf24',
    location: 'Command Palette (Ctrl+Shift+P) → Buat Paket Rilis / Patch (.ZIP)',
    summary:
      'Kemas otomatis file yang berubah berdasarkan waktu modifikasi (4/12/24 jam terakhir) atau perubahan Git beserta struktur foldernya utuh + skrip migrasi .SQL.',
    steps: [
      'Tekan Ctrl+Shift+P → pilih "Buat Paket Rilis / Patch (.ZIP)".',
      'Pilih filter sumber file, lampirkan skrip migrasi .sql jika perlu, lalu klik "Buat Paket Rilis (.ZIP)".'
    ],
    actionLabel: 'Buka Paket Rilis',
    onAction: (st) => st.setReleasePatchModalOpen(true)
  },

  // ==================== EDITOR & INTELLISENSE ====================
  {
    id: 'editor-intellisense',
    category: 'editor',
    title: 'IntelliSense PHP 8 + Laravel + Wisanggeni + SQL + Web (JS/CSS)',
    badge: 'Polyglot',
    badgeColor: '#38bdf8',
    location: 'Editor Kode Utama & Diff Editor',
    summary:
      'Saran pintar lintas bahasa: 74 Class & 544 Method Wisanggeni, Facade/Route/Blade/Model Laravel, SQL lintas-database di dalam string PHP (Inline SQL CodeLens), serta JS/jQuery/CSS + Color Picker.',
    steps: [
      'Gunakan Ctrl+Klik atau F12 pada nama fungsi, class, include, view(), atau route() untuk melompat langsung ke definisinya.',
      'Klik tombol CodeLens "▶ Uji Query", "⚡ Explain", atau "📊 Struktur" tepat di atas string SQL di dalam file .php.',
      'Tekan Ctrl+. (Quick Fix) pada garis kuning, atau klik "⚡ Perbaiki Instan (Lokal)" pada banner merah error PHP untuk perbaikan offline < 0,1 detik yang diverifikasi langsung oleh php -l (tanpa perlu Gemini AI).'
    ]
  },
  {
    id: 'editor-calm-suggest',
    category: 'editor',
    title: 'Mode Saran Anti-Mengganggu (Santai / Manual / Aktif)',
    badge: 'Nyaman',
    badgeColor: '#34d399',
    location: 'Status Bar Kanan Bawah → 💡 Saran: Santai (Tab)',
    summary:
      'Saran kode dirancang tenang agar tidak membajak tombol Enter atau meledak saat menekan spasi / mengetik teks biasa di dalam string dan komentar.',
    steps: [
      'Default "Santai (Tab)": Enter selalu membuat baris baru; gunakan Tab atau Klik untuk menerima saran, Esc untuk menutup.',
      'Klik indikator "💡 Saran" di Status Bar untuk beralih ke "🔇 Manual (Ctrl+Space)" (0% popup otomatis) atau "⚡ Aktif".'
    ]
  },
  {
    id: 'editor-toolbar-refactor',
    category: 'editor',
    title: 'Alat Editor, Module Companion (Alt+O), Smart Rename & Multi-Deploy',
    badge: 'Produktivitas',
    badgeColor: '#fb923c',
    location: 'Baris Aksi Editor (Simpan, Edit AI, Diff Server, Rapikan, Alur, ⋯ Alat ▾)',
    summary:
      'Bilah aksi editor 1-baris yang bersih: loncat antar modul pasangan (_idx/_form/_save), peta dependensi file, Rename lintas file, Pin favorit, hingga Multi-Server Broadcast Deploy.',
    steps: [
      'Klik tombol modul di sisi kiri baris aksi (atau tekan Alt+O) untuk berpindah cepat antar _idx, _form, _save, _cetak, & _excel.',
      'Klik "Alur (N)" untuk melihat peta file include dan tabel DB yang dibaca/ditulis file PHP aktif.',
      'Buka dropdown "⋯ Alat ▾" untuk Uji HTTP, PHP Tinker, Multi-Deploy ke banyak server sekaligus, Pin Favorit, Smart Rename (Alt+R), Outline, & Local History.'
    ]
  },
  {
    id: 'editor-guards',
    category: 'editor',
    title: 'Pre-Save Guard, Local History 1-Klik Rollback & Panel Resizable',
    badge: 'Pengaman',
    badgeColor: '#f87171',
    location: 'Otomatis saat Ctrl+S Remote • Panel Kiri History • Garis Pembatas Sidebar/Panel Bawah',
    summary:
      'Mendeteksi sisa var_dump/dd()/konflik Git sebelum simpan ke server, menyimpan backup terdeduplikasi tiap simpan dengan 1-klik Rollback, serta mendukung resize lebar sidebar & tinggi panel bawah.',
    steps: [
      'Buka ikon History di panel kiri untuk melihat timeline versi file Lokal/Remote, bandingkan Diff, lalu klik Rollback jika perlu.',
      'Seret garis pembatas kanan Sidebar (240–560px) atau batas atas Panel Bawah (150–560px); klik 2× garis pembatas untuk reset ukuran standar.'
    ],
    actionLabel: 'Buka Local History',
    onAction: (st) => st.setActiveSidebar('history')
  },
  {
    id: 'dynamic-island',
    category: 'editor',
    title: 'Dynamic Island & Desktop Floating Island (Ctrl+K)',
    badge: 'Omnibox',
    badgeColor: '#c084fc',
    location: 'Kapsul Tengah Atas Toolbar (Ctrl+K)',
    summary:
      'Pusat pencarian kilat 4 mode (Semua, File 50.000+ Remote/Lokal, Isi Kode Grep, Simbol & DB + Saved SQL) dan pil melayang di atas desktop saat menguji aplikasi di browser.',
    steps: [
      'Tekan Ctrl+K untuk mencari file (dukung lompat baris mis. modul_save.php:120), isi teks, tabel DB, atau query tersimpan.',
      'Aktifkan "Desktop Floating" di menu Dynamic Island agar pil status tetap mengambang rapi di tepi atas layar Windows.'
    ],
    actionLabel: 'Buka Pencarian Island',
    onAction: (st) => st.openIslandSearch({ mode: 'all' })
  },

  // ==================== DATABASE & SQL ====================
  {
    id: 'db-saved-params',
    category: 'database',
    title: 'Akses 1-Klik Query Tersimpan & Parameter Otomatis ({$id})',
    badge: '1-Klik',
    badgeColor: '#fbbf24',
    location: 'DATABASE & SQL → Tab ⭐ Query (N) & Strip Chip di SQL Runner Layar Lebar',
    summary:
      'Buka, filter per folder, simpan, dan jalankan query berulang dalam 1 klik — lengkap dengan deteksi otomatis placeholder {$id}, {{id}}, :id, ${id}, & $id.',
    steps: [
      'Di panel DATABASE & SQL, klik tab "⭐ Query (N)" (atau ikon bintang di header) untuk melihat seluruh query tersimpan & riwayat eksekusi.',
      'Di SQL Runner Layar Lebar, klik chip query di strip atas "⭐ Query Tersimpan:" (klik 1× muat, klik 2× langsung jalankan).',
      'Jika query memakai placeholder seperti WHERE id_rekomendasi=\'{$id}\', kotak biru Parameter Query otomatis fokus — ketik angkanya lalu tekan Enter tanpa merusak template asli!'
    ],
    actionLabel: 'Buka Panel Database',
    onAction: (st) => st.setActiveSidebar('database')
  },
  {
    id: 'db-safe-tx',
    category: 'database',
    title: 'Safe Transaction Workbench (Read-Only Lock & Staging COMMIT/ROLLBACK)',
    badge: 'Enterprise',
    badgeColor: '#34d399',
    location: 'SQL Query Runner Layar Lebar → Sub-toolbar (🔒 Read-Only & Staging: ON)',
    summary:
      'Proteksi mutasi data bergaya TablePlus/DataGrip: database 🔴 PROD terkunci Read-Only otomatis, dan edit data grid ditahan di antrean Pending Changes sebelum COMMIT atomik.',
    steps: [
      'Klik tombol "🔒 Read-Only" untuk membuka/mengunci hak tulis pada koneksi aktif.',
      'Dengan "Staging: ON", klik 2× sel untuk edit, tambah, atau hapus baris — perubahan disorot amber tanpa menyentuh server.',
      'Klik "👁 Preview SQL" untuk meninjau skrip, lalu tekan "✓ COMMIT Transaksi" (atomik) atau "↩ ROLLBACK (Batal)".'
    ],
    actionLabel: 'Buka Panel Database',
    onAction: (st) => st.setActiveSidebar('database')
  },
  {
    id: 'db-explain-fk',
    category: 'database',
    title: 'Visual EXPLAIN Tree, FK Jump-to-Row (↗), Grafik Pivot & Export Excel (.xlsx)',
    badge: 'Profiler',
    badgeColor: '#38bdf8',
    location: 'SQL Query Runner Layar Lebar (klik DATA pada tabel atau ikon ⤢)',
    summary:
      'Pohon visual rencana eksekusi query (Full Scan merah vs Index hijau + Baseline Before/After), lompat relasi Foreign Key (↗) ke panel Master-Detail, Grafik & Pivot, Saran Index, Multi-Query Tabs, & Export .xlsx asli anti-rusak NIP.',
    steps: [
      'Klik "Visual EXPLAIN" untuk melihat skor kesehatan query (0–100) & simpan Baseline sebelum memasang index.',
      'Klik ikon panah "↗" pada kolom referensi (id_perusahaan, kd_unitkerja, dll.) untuk menelusuri baris tabel induknya secara berantai.',
      'Klik "Export Excel (.xlsx)" untuk menghasilkan file Excel OpenXML asli (menjaga NIP 18-digit & angka 0 di depan utuh).'
    ]
  },
  {
    id: 'db-architect',
    category: 'database',
    title: 'HMW Database Architect (ER Diagram, Visual Query Builder, Diff, Sync & Kamus SPBE)',
    badge: '5-in-1',
    badgeColor: '#c084fc',
    location: 'DATABASE & SQL → Tombol Builder atau Alat ▾ (ER Diagram / Schema Diff / Data Sync)',
    summary:
      '5 modul arsitektur database terpadu: Visual ER Diagram 2D, Navicat-Style Drag-and-Drop Query Builder (keluaran SQL/PHP/Wisanggeni/Laravel), Schema Diff ALTER TABLE, Data Sync (+ Masking), Data Diff PK, serta Ekspor Kamus Data SPBE (.HTML/.XLSX).',
    steps: [
      'Klik "Builder" untuk menarik tabel ke kanvas 2D, menghubungkan kolom JOIN, dan menyalin kode SQL/PHP/Laravel siap pakai.',
      'Gunakan tab ER Diagram, Schema Diff, Sync Isi Data, & Data Diff (Baris PK) di bilah atas jendela yang sama.',
      'Klik "Kamus .HTML" atau "Kamus .XLSX" untuk menghasilkan dokumentasi struktur database siap cetak A4.'
    ],
    actionLabel: 'Buka Visual Builder',
    onAction: (st) => st.openVisualJoinBuilder()
  },
  {
    id: 'db-rbac-import-hunter',
    category: 'database',
    title: 'User & RBAC, Import Excel Dry-Run, Cari Isi DB, Seeder & Audit Undo SQL',
    badge: 'Menu Alat ▾',
    badgeColor: '#fb923c',
    location: 'DATABASE & SQL → Dropdown Alat ▾ (dan ikon Perisai Hijau di Toolbar Atas)',
    summary:
      'Lengkapi operasional DBA: kelola user/hak akses & audit keamanan RBAC, impor multi-sheet .xlsx / Paste Excel dengan Uji Dry-Run Rollback, lacak nilai di ratusan tabel paralel, Table Designer, View/Proc, Data Seeder Indonesia, Penjadwal Otomatis, & Audit Trail 1-Klik Undo SQL.',
    steps: [
      'Buka "Alat ▾ → User & RBAC" untuk mengaudit celah akun (root@%, password kosong) dan membuat user preset Read-Only/CRUD.',
      'Buka "Alat ▾ → Import .XLSX" untuk impor atau Paste langsung dari Excel dengan konversi tanggal/Rupiah Indonesia & uji Dry-Run.',
      'Buka "Alat ▾ → Audit & Undo" (atau ikon perisai hijau di toolbar atas) untuk melihat log mutasi & menekan 1-Klik Undo SQL.'
    ],
    actionLabel: 'Buka User & RBAC',
    onAction: (st) => st.setDbRbacModalOpen(true)
  },

  // ==================== MONITOR MYSQL & SSH ====================
  {
    id: 'mon-workbench',
    category: 'monitor',
    title: 'MySQL Workbench Performance Dashboard & Live Health Monitor',
    badge: 'Live Sparkline',
    badgeColor: '#38bdf8',
    location: 'DATABASE & SQL → Tombol Monitor',
    summary:
      'Dashboard performa real-time: grafik Sparkline QPS, Network Traffic (KB/s), InnoDB Disk I/O, 4 kartu Health Gauge (Buffer Pool Hit Ratio, Koneksi, Full Join, Tmp Disk), ditambah 4 tab diagnostik on-demand.',
    steps: [
      'Klik "Monitor" di panel Database untuk melihat grafik live dan metrik kesehatan server.',
      'Gunakan sub-tab "Saran my.cnf", "Slow Digest SQL", "InnoDB Lock Waits (+ 1-Klik Kill Blocker)", dan "Storage & Fragmentasi (+ OPTIMIZE TABLE)".'
    ],
    actionLabel: 'Buka MySQL Monitor',
    onAction: (st) => st.setServerMonitorOpen(true, 'mysql-dashboard')
  },
  {
    id: 'mon-ssh-snippets',
    category: 'monitor',
    title: 'Kesehatan OS Linux (SSH), 1-Klik Reload Service, Crontab & SSH Multi-Snippets',
    badge: 'DevOps SSH',
    badgeColor: '#34d399',
    location: 'Monitor → Tab Kesehatan OS (SSH) / Jadwal Crontab / SSH Snippets & Multi-Exec',
    summary:
      'Pantau CPU, RAM, Disk (peringatan ≥90%), status service (nginx, apache2, php-fpm, mysql, redis) lengkap dengan tombol 1-Klik Reload, jadwal crontab, serta eksekusi perintah siap klik ke banyak server SSH sekaligus.',
    steps: [
      'Buka tab "Kesehatan OS (SSH)" untuk melihat metrik server dan me-reload layanan Linux dengan konfirmasi aman.',
      'Buka tab "SSH Snippets & Multi-Exec", centang satu atau beberapa server target, lalu klik snippet (Clear Cache Laravel, Cek SSL, Top Disk, dll.) untuk eksekusi paralel.'
    ],
    actionLabel: 'Buka Monitor SSH',
    onAction: (st) => st.setServerMonitorOpen(true, 'health')
  },

  // ==================== DEBUG, LOG & HTTP ====================
  {
    id: 'dbg-xdebug',
    category: 'debug',
    title: 'Built-in Visual PHP Debugger (Xdebug DBGp Port 9003)',
    badge: 'Debugger',
    badgeColor: '#fbbf24',
    location: 'Panel Bawah (Ctrl+`) → Tab 🪲 Xdebug PHP & Margin Kiri Editor .php',
    summary:
      'Debugger PHP visual langsung di dalam IDE tanpa perlu ekstensi tambahan: pasang breakpoint titik merah di nomor baris, kontrol Step Over/Into/Out, inspeksi Call Stack, Locals, Superglobals ($_POST/$_SESSION), & Eval ekspresi PHP live.',
    steps: [
      'Klik area pinggir kiri nomor baris pada file .php untuk memasang/menghapus titik merah Breakpoint.',
      'Buka Panel Bawah (Ctrl+`) → tab "🪲 Xdebug PHP" → klik "Listen Port 9003" (isi Path Mapping jika aplikasi berjalan di server Linux remote).',
      'Akses halaman PHP di browser; eksekusi berhenti pada baris kuning dan Anda bisa memeriksa seluruh variabel & melangkah baris demi baris.'
    ],
    actionLabel: 'Buka Panel Xdebug',
    onAction: (st) => st.setBottomPanel(true, 'xdebug')
  },
  {
    id: 'dbg-logs',
    category: 'debug',
    title: 'Live Error Log Monitor (Apache / Nginx / PHP-FPM / Laravel)',
    badge: 'Real-Time',
    badgeColor: '#f87171',
    location: 'Panel Bawah (Ctrl+`) → Tab Live Error Log',
    summary:
      'Pantau error.log server remote via SSH maupun file log lokal secara real-time, lengkap dengan peringatan otomatis ke Dynamic Island, tombol lompat ke file:baris penyebab error, dan analisis Gemini AI.',
    steps: [
      'Buka Panel Bawah → tab "Live Error Log" → klik "Deteksi Otomatis" atau masukkan path file log lalu klik "Mulai Pantau".',
      'Klik langsung entri error untuk membuka file sumber tepat pada nomor baris bermasalah.'
    ],
    actionLabel: 'Buka Live Error Log',
    onAction: (st) => st.setBottomPanel(true, 'logs')
  },
  {
    id: 'dbg-http',
    category: 'debug',
    title: 'HTTP / AJAX Tester Pro (Environments, Auto-Capture, OpenAPI/Postman & Code Gen)',
    badge: 'Mini Postman',
    badgeColor: '#38bdf8',
    location: 'Panel Kiri → Ikon Globe (HTTP Tester)',
    summary:
      'Uji endpoint PHP/API intranet lengkap dengan variabel Environment ({{base_url}}, {{token}}), 1-klik ekstrak field $_POST dari tab PHP aktif, Paste cURL DevTools, Auto-Capture Token/PHPSESSID, impor OpenAPI/Swagger/Postman JSON, & generator kode PHP cURL / Laravel / JS Fetch.',
    steps: [
      'Buka ikon Globe di panel kiri; pilih environment (Development/Production) di dropdown atas.',
      'Klik "Field PHP" untuk menyedot parameter dari file PHP terbuka, atau klik "Paste cURL" untuk menempel request dari Chrome DevTools.',
      'Klik tombol "Kode" untuk menyalin potongan PHP cURL, Laravel Http/Guzzle, atau JS Fetch.'
    ],
    actionLabel: 'Buka HTTP Tester',
    onAction: (st) => st.setActiveSidebar('http')
  },
  {
    id: 'dbg-tinker',
    category: 'debug',
    title: 'PHP Scratchpad / Tinker Instan (Ctrl+Shift+Enter)',
    badge: 'CLI Runner',
    badgeColor: '#fbbf24',
    location: 'Editor → ⋯ Alat ▾ → PHP Tinker (atau Ctrl+Shift+Enter)',
    summary:
      'Uji fungsi, regex, manipulasi array, atau potongan kode PHP secara terisolasi lewat PHP CLI lokal dan lihat hasil output serta durasi eksekusi dalam milidetik.',
    steps: [
      'Blok potongan kode di editor lalu tekan Ctrl+Shift+Enter (atau buka dari menu ⋯ Alat ▾).',
      'Edit seperlunya lalu klik "Jalankan" untuk memeriksa STDOUT & STDERR instan.'
    ],
    actionLabel: 'Buka PHP Tinker',
    onAction: (st) => st.openPhpScratchpad()
  },

  // ==================== GEMINI AI, KEAMANAN & GIT ====================
  {
    id: 'ai-gemini',
    category: 'ai',
    title: 'Google Gemini AI Studio (Chat, Generator CRUD Wisanggeni, Audit SQL & Docs)',
    badge: 'Gemini AI',
    badgeColor: '#c084fc',
    location: 'Toolbar Atas → Gemini AI (Ctrl+Shift+A) & Inline Edit (Ctrl+I)',
    summary:
      'Asisten AI terintegrasi dengan penyimpanan API Key terenkripsi Windows DPAPI dan sensor otomatis file rahasia: Chat kontekstual, Generator 3-File CRUD Wisanggeni (_idx/_form/_save), Inline Refactor, 1-Klik Perbaiki Error php -l, Audit Keamanan SQL, AI Ghost-Text, Smart Commit, & Ringkasan Pra-Deploy.',
    steps: [
      'Buka panel Gemini AI → tab "Key" untuk menyimpan GEMINI_API_KEY & memilih model (tersimpan aman terenkripsi).',
      'Gunakan tab Chat, CRUD, Audit, atau Docs; tekan Ctrl+I di editor untuk merombak blok kode terpilih secara inline dengan pratinjau Diff.'
    ],
    actionLabel: 'Buka Gemini AI Studio',
    onAction: (st) => st.setActiveSidebar('ai')
  },
  {
    id: 'ai-sast-audit',
    category: 'ai',
    title: 'Offline SAST Security, PHP 8 Compatibility & Broken-Include Scanner',
    badge: '0 Kuota AI',
    badgeColor: '#f87171',
    location: 'Toolbar Atas → Ikon Perisai Merah (Security Scanner) & Perisai Hijau (Audit Trail)',
    summary:
      'Pemindai keamanan statis super cepat tanpa internet/kuota AI untuk proyek Lokal maupun Server SFTP: mendeteksi SQL Injection mentah, Reflected XSS, kredensial bocor, fungsi usang PHP 8 (mysql_*, ereg), & file include yang hilang.',
    steps: [
      'Klik ikon Perisai Merah di toolbar atas, pilih sumber (Lokal / Server Remote SFTP), lalu klik "Mulai Pindai".',
      'Klik temuan apa pun untuk langsung melompat ke file dan baris kode terkait.'
    ],
    actionLabel: 'Buka Security Scanner',
    onAction: (st) => st.setSecurityScannerModalOpen(true)
  },
  {
    id: 'ai-git-preview-term',
    category: 'ai',
    title: 'Git Source Control, Live Web Preview, Terminal Lokal/SSH & Rubles 2.0',
    badge: 'Core IDE',
    badgeColor: '#38bdf8',
    location: 'Panel Kiri (Git / Rubles) • Toolbar Atas (Preview / Terminal) • Ctrl+`',
    summary:
      'Ekosistem pengembangan web lengkap dalam 1 aplikasi desktop native: manajemen branch/commit/diff/pull/push Git (dengan pesan commit AI), Live Web Preview responsif, Multi-Tab Terminal PowerShell/CMD/Git Bash/WSL/SSH, serta bundel snippet Rubles 2.0 (wis-*, lv-*).',
    steps: [
      'Buka ikon Git di panel kiri untuk melihat perubahan, membuka Side-by-Side Diff, dan membuat pesan commit otomatis dengan AI.',
      'Klik "Preview" di toolbar atas untuk menjalankan server pratinjau lokal, atau tekan Ctrl+` untuk membuka Terminal Lokal & Direct SSH.'
    ],
    actionLabel: 'Buka Git Panel',
    onAction: (st) => st.setActiveSidebar('git')
  }
];

const CATEGORIES: Array<{
  id: DocCategoryId;
  label: string;
  icon: React.ReactNode;
}> = [
  { id: 'all', label: 'Pengantar & Semua', icon: <BookOpen size={13.5} /> },
  { id: 'shortcuts', label: 'Pintasan Keyboard', icon: <Keyboard size={13.5} /> },
  { id: 'projects', label: 'Proyek, SFTP & Tim', icon: <FolderKanban size={13.5} /> },
  { id: 'editor', label: 'Editor & IntelliSense', icon: <Code2 size={13.5} /> },
  { id: 'database', label: 'Database & SQL', icon: <Database size={13.5} /> },
  { id: 'monitor', label: 'Monitor MySQL & SSH', icon: <Activity size={13.5} /> },
  { id: 'debug', label: 'Debug, Log & HTTP', icon: <Bug size={13.5} /> },
  { id: 'ai', label: 'Gemini AI, SAST & Git', icon: <Sparkles size={13.5} /> }
];

export const DocumentationModal: React.FC = () => {
  const {
    docsModalOpen,
    setDocsModalOpen,
    appUpdateState,
    checkForAppUpdates,
    downloadAppUpdate,
    installAppUpdate
  } = useIdeStore();
  const [activeCategory, setActiveCategory] = useState<DocCategoryId>('all');
  const [searchText, setSearchText] = useState('');

  const needle = searchText.trim().toLowerCase();

  const filteredShortcuts = useMemo(() => {
    if (!needle) return SHORTCUT_ROWS;
    return SHORTCUT_ROWS.filter(
      (r) =>
        r.keys.toLowerCase().includes(needle) ||
        r.title.toLowerCase().includes(needle) ||
        r.detail.toLowerCase().includes(needle)
    );
  }, [needle]);

  const filteredFeatures = useMemo(() => {
    return FEATURE_DOCS.filter((f) => {
      if (activeCategory !== 'all' && activeCategory !== 'shortcuts' && f.category !== activeCategory) {
        return false;
      }
      if (!needle) return true;
      const hay = `${f.title} ${f.badge ?? ''} ${f.location} ${f.summary} ${f.steps.join(' ')}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [activeCategory, needle]);

  const countByCategory = useMemo(() => {
    const map: Record<DocCategoryId, number> = {
      all: FEATURE_DOCS.length,
      shortcuts: SHORTCUT_ROWS.length,
      projects: 0,
      editor: 0,
      database: 0,
      monitor: 0,
      debug: 0,
      ai: 0
    };
    for (const f of FEATURE_DOCS) {
      map[f.category]++;
    }
    return map;
  }, []);

  if (!docsModalOpen) return null;

  const showShortcutsSection =
    activeCategory === 'shortcuts' || (activeCategory === 'all' && (!needle || filteredShortcuts.length > 0));
  const showFeatureCards = activeCategory !== 'shortcuts';

  return (
    <div className="modal-backdrop">
      <div
        className="modal-card"
        style={{ width: 'min(1080px, 95vw)', height: 'min(85vh, 780px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Konsisten dengan Tombol Keluar di Pojok Kanan Atas */}
        <div className="modal-header">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0, flexWrap: 'wrap' }}>
              <BookOpen size={17} color="var(--accent)" style={{ flexShrink: 0 }} />
              <strong style={{ fontSize: 14.5 }}>Dokumentasi &amp; Panduan Fitur HMW Studio</strong>
              <span className="badge" style={{ fontSize: 10.5 }}>
                {FEATURE_DOCS.length} Modul Fitur • {SHORTCUT_ROWS.length} Pintasan
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                flexWrap: 'wrap',
                fontSize: 11.5,
                color: 'var(--text-muted)',
                paddingLeft: 26
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <User size={11.5} color="var(--accent)" />
                Developer: <strong style={{ color: 'var(--text-primary)' }}>{APP_DEVELOPER_NAME}</strong>
              </span>
              <span>•</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Calendar size={11.5} color="#38bdf8" />
                Tanggal: <strong style={{ color: 'var(--text-secondary)' }}>{APP_DOC_DATE}</strong>
              </span>
            </div>
          </div>
          <button
            type="button"
            className="btn-modal-exit"
            onClick={() => setDocsModalOpen(false)}
            title="Keluar / Tutup Dokumentasi (Esc)"
          >
            <X size={14} />
            <span>Keluar</span>
          </button>
        </div>

        {/* Sub-bar Pencarian Cepat */}
        <div className="modal-subbar">
          <div style={{ position: 'relative', flex: '1 1 320px', maxWidth: 520 }}>
            <Search
              size={13.5}
              style={{
                position: 'absolute',
                left: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)'
              }}
            />
            <input
              className="form-input"
              style={{ width: '100%', paddingLeft: 32, paddingRight: needle ? 28 : 10, fontSize: 12 }}
              placeholder="Cari fitur, menu, atau pintasan (misal: Xdebug, Excel, {$id}, RBAC, SFTP, Saran)..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
            {needle && (
              <button
                type="button"
                className="icon-btn"
                style={{
                  position: 'absolute',
                  right: 5,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  padding: 2
                }}
                onClick={() => setSearchText('')}
                title="Hapus kata pencarian"
              >
                <X size={12} />
              </button>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>
              Tekan <code>F1</code> kapan saja untuk membuka panduan ini
            </span>
          </div>
        </div>

        {/* Isi 2 Kolom: Navigasi Kategori Kiri + Katalog Fitur & Cara Pakai Kanan */}
        <div className="modal-body" style={{ padding: 0, flexDirection: 'row', gap: 0, overflow: 'hidden' }}>
          {/* Left Category Sidebar */}
          <aside
            style={{
              width: 225,
              flexShrink: 0,
              borderRight: '1px solid var(--border-subtle)',
              background: 'var(--bg-app)',
              padding: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              overflowY: 'auto'
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 0.6,
                textTransform: 'uppercase',
                color: 'var(--text-muted)',
                padding: '2px 8px 6px'
              }}
            >
              Daftar Kategori
            </div>
            {CATEGORIES.map((cat) => {
              const isAct = activeCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  className={isAct ? 'btn btn-accent' : 'btn-ghost'}
                  style={{
                    justifyContent: 'space-between',
                    padding: '7px 9px',
                    fontSize: 12,
                    fontWeight: isAct ? 700 : 500,
                    borderRadius: 7
                  }}
                  onClick={() => setActiveCategory(cat.id)}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                    <span style={{ flexShrink: 0, display: 'inline-flex' }}>{cat.icon}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {cat.label}
                    </span>
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      padding: '1px 6px',
                      borderRadius: 999,
                      background: isAct ? 'rgba(255,255,255,0.22)' : 'var(--bg-elevated)',
                      color: isAct ? '#ffffff' : 'var(--text-muted)',
                      flexShrink: 0
                    }}
                  >
                    {countByCategory[cat.id]}
                  </span>
                </button>
              );
            })}

            <div
              style={{
                marginTop: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 7
              }}
            >
              <div
                style={{
                  padding: '10px 9px',
                  borderRadius: 7,
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  fontSize: 11,
                  color: 'var(--text-secondary)',
                  lineHeight: 1.45
                }}
              >
                <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: 3 }}>
                  💡 Tips Cepat
                </strong>
                Klik tombol <strong>Buka Fitur →</strong> pada setiap kartu panduan untuk langsung menuju menu terkait.
              </div>

              <div
                style={{
                  padding: '10px 10px',
                  borderRadius: 8,
                  background: 'linear-gradient(180deg, var(--bg-elevated) 0%, var(--bg-surface) 100%)',
                  border: '1px solid var(--border-strong)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 5,
                  fontSize: 11
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <HmwLogo size={22} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: 12, color: 'var(--text-primary)' }}>
                      HMW <span style={{ color: 'var(--accent)' }}>Studio</span>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                      Enterprise IDE • v{appUpdateState.currentVersion}
                    </div>
                  </div>
                </div>
                <div style={{ height: 1, background: 'var(--border-subtle)', margin: '1px 0' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text-secondary)' }}>
                  <User size={11.5} color="var(--accent)" style={{ flexShrink: 0 }} />
                  <span>
                    Developer:{' '}
                    <strong style={{ color: 'var(--text-primary)' }}>{APP_DEVELOPER_NAME}</strong>
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text-secondary)' }}>
                  <Calendar size={11.5} color="#38bdf8" style={{ flexShrink: 0 }} />
                  <span>
                    Tanggal:{' '}
                    <strong style={{ color: 'var(--text-primary)' }}>{APP_DOC_DATE}</strong>
                  </span>
                </div>
                <button
                  type="button"
                  className={
                    appUpdateState.phase === 'available' || appUpdateState.phase === 'downloaded'
                      ? 'btn btn-accent'
                      : 'btn-ghost'
                  }
                  style={{
                    marginTop: 4,
                    justifyContent: 'center',
                    fontSize: 11,
                    padding: '5px 8px',
                    width: '100%'
                  }}
                  disabled={
                    appUpdateState.phase === 'checking' || appUpdateState.phase === 'downloading'
                  }
                  onClick={() => {
                    if (appUpdateState.phase === 'downloaded') {
                      void installAppUpdate();
                    } else if (appUpdateState.phase === 'available') {
                      void downloadAppUpdate();
                    } else {
                      void checkForAppUpdates(false);
                    }
                  }}
                >
                  <RefreshCw size={12} />
                  <span>
                    {appUpdateState.phase === 'checking'
                      ? 'Memeriksa Update...'
                      : appUpdateState.phase === 'downloading'
                        ? `Mengunduh ${Math.round(appUpdateState.downloadPercent ?? 0)}%`
                        : appUpdateState.phase === 'downloaded'
                          ? `Restart & Pasang v${appUpdateState.latestVersion}`
                          : appUpdateState.phase === 'available'
                            ? `Unduh Update v${appUpdateState.latestVersion}`
                            : 'Cek Pembaruan GitHub'}
                  </span>
                </button>
              </div>
            </div>
          </aside>

          {/* Right Scrollable Content */}
          <div
            className="sidebar-scroll"
            style={{
              flex: 1,
              minWidth: 0,
              padding: '16px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: 16
            }}
          >
            {/* Opening General Overview & 6 Major Pillars */}
            {activeCategory === 'all' && !needle && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div
                  style={{
                    padding: '15px 17px',
                    borderRadius: 10,
                    background:
                      'linear-gradient(135deg, rgba(249, 115, 22, 0.12) 0%, rgba(56, 189, 248, 0.08) 100%)',
                    border: '1px solid var(--border-strong)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <HmwLogo size={32} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 15.5, fontWeight: 800, color: 'var(--text-primary)' }}>
                        Tentang HMW <span style={{ color: 'var(--accent)' }}>Studio</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        IDE Desktop Native Windows 64-bit • Developer:{' '}
                        <strong style={{ color: 'var(--text-primary)' }}>{APP_DEVELOPER_NAME}</strong> •{' '}
                        {APP_DOC_DATE}
                      </div>
                    </div>
                  </div>
                  <p style={{ margin: 0, fontSize: 12.2, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    <strong style={{ color: 'var(--text-primary)' }}>HMW Studio</strong> adalah lingkungan
                    pengembangan terpadu (<em>All-in-One Enterprise IDE</em>) berbasis aplikasi desktop
                    Windows native yang menyatukan seluruh kebutuhan kerja pengembang web modern — mulai dari{' '}
                    <strong>pengeditan kode PHP 8, Laravel/Blade, Framework Wisanggeni, JavaScript &amp; CSS</strong>,{' '}
                    <strong>administrasi Database MySQL/MariaDB &amp; PostgreSQL</strong>,{' '}
                    <strong>sinkronisasi &amp; edit langsung server SFTP/FTPS/SSH</strong>,{' '}
                    <strong>pemantauan performa server</strong>, <strong>debugging visual Xdebug</strong>,{' '}
                    <strong>pengujian API/HTTP</strong>, hingga <strong>asisten Google Gemini AI</strong>{' '}
                    dalam satu jendela yang cepat, aman untuk lingkungan produksi, dan nyaman digunakan sehari-hari.
                  </p>
                </div>

                <div>
                  <div
                    style={{
                      fontSize: 11.5,
                      fontWeight: 700,
                      letterSpacing: 0.4,
                      textTransform: 'uppercase',
                      color: 'var(--text-secondary)',
                      marginBottom: 8
                    }}
                  >
                    6 Pilar Fitur Besar HMW Studio (Klik Kartu untuk Melihat Panduan Rinci)
                  </div>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(235px, 1fr))',
                      gap: 9
                    }}
                  >
                    {MAJOR_PILLARS.map((pillar) => (
                      <button
                        key={pillar.targetCategory}
                        type="button"
                        onClick={() => setActiveCategory(pillar.targetCategory)}
                        style={{
                          textAlign: 'left',
                          padding: '11px 12px',
                          borderRadius: 9,
                          background: 'var(--bg-elevated)',
                          border: '1px solid var(--border-subtle)',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6,
                          transition: 'border-color 0.14s ease, transform 0.14s ease'
                        }}
                        title={`Buka rincian kategori ${pillar.title}`}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: pillar.accent }}>
                          {pillar.icon}
                          <strong style={{ fontSize: 12.5, color: 'var(--text-primary)' }}>
                            {pillar.title}
                          </strong>
                        </div>
                        <div style={{ fontSize: 11.3, color: 'var(--text-secondary)', lineHeight: 1.48 }}>
                          {pillar.desc}
                        </div>
                        <div
                          style={{
                            marginTop: 'auto',
                            paddingTop: 3,
                            fontSize: 11,
                            fontWeight: 600,
                            color: pillar.accent,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4
                          }}
                        >
                          <span>Lihat panduan rinci</span>
                          <ArrowRight size={11} />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div
                  style={{
                    fontSize: 11.5,
                    fontWeight: 700,
                    letterSpacing: 0.4,
                    textTransform: 'uppercase',
                    color: 'var(--text-secondary)',
                    paddingTop: 4,
                    borderTop: '1px solid var(--border-subtle)'
                  }}
                >
                  Panduan Lengkap Seluruh Modul ({FEATURE_DOCS.length} Fitur)
                </div>
              </div>
            )}

            {/* Feature Cards */}
            {showFeatureCards && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {filteredFeatures.length === 0 && !showShortcutsSection ? (
                  <div
                    style={{
                      padding: 28,
                      textAlign: 'center',
                      borderRadius: 8,
                      border: '1px dashed var(--border-strong)',
                      color: 'var(--text-muted)',
                      fontSize: 12.5
                    }}
                  >
                    Tidak ditemukan fitur yang cocok dengan kata kunci <strong>&ldquo;{searchText}&rdquo;</strong>.
                  </div>
                ) : (
                  filteredFeatures.map((feat) => (
                    <div
                      key={feat.id}
                      style={{
                        padding: '12px 14px',
                        borderRadius: 9,
                        background: 'var(--bg-elevated)',
                        border: '1px solid var(--border-subtle)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 7
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          justifyContent: 'space-between',
                          gap: 10,
                          flexWrap: 'wrap'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', minWidth: 0 }}>
                          <strong style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                            {feat.title}
                          </strong>
                          {feat.badge && (
                            <span
                              className="badge"
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                color: feat.badgeColor ?? 'var(--accent)',
                                borderColor: feat.badgeColor
                                  ? `${feat.badgeColor}55`
                                  : 'var(--border-strong)'
                              }}
                            >
                              {feat.badge}
                            </span>
                          )}
                        </div>

                        {feat.onAction && feat.actionLabel && (
                          <button
                            type="button"
                            className="btn btn-xs"
                            style={{
                              padding: '3px 9px',
                              fontSize: 11,
                              color: '#38bdf8',
                              borderColor: 'rgba(56, 189, 248, 0.42)',
                              flexShrink: 0
                            }}
                            onClick={() => {
                              setDocsModalOpen(false);
                              feat.onAction?.(useIdeStore.getState());
                            }}
                          >
                            <span>{feat.actionLabel}</span>
                            <ArrowRight size={11} />
                          </button>
                        )}
                      </div>

                      <div
                        style={{
                          fontSize: 11,
                          color: '#7dd3fc',
                          fontFamily: 'var(--font-mono)'
                        }}
                      >
                        📍 {feat.location}
                      </div>

                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                        {feat.summary}
                      </div>

                      <ul
                        style={{
                          margin: '2px 0 0',
                          paddingLeft: 18,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 3,
                          fontSize: 11.5,
                          color: 'var(--text-primary)',
                          lineHeight: 1.5
                        }}
                      >
                        {feat.steps.map((step, idx) => (
                          <li key={idx}>{step}</li>
                        ))}
                      </ul>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Keyboard Shortcuts Table */}
            {showShortcutsSection && filteredShortcuts.length > 0 && (
              <div
                style={{
                  borderRadius: 9,
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-elevated)',
                  overflow: 'hidden'
                }}
              >
                <div
                  style={{
                    padding: '9px 14px',
                    borderBottom: '1px solid var(--border-subtle)',
                    background: 'var(--bg-app)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                    fontSize: 12.5,
                    fontWeight: 700
                  }}
                >
                  <Keyboard size={14} color="var(--accent)" />
                  <span>Pintasan Keyboard Utama ({filteredShortcuts.length})</span>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table
                    style={{
                      width: '100%',
                      borderCollapse: 'collapse',
                      fontSize: 11.5
                    }}
                  >
                    <thead>
                      <tr style={{ background: 'rgba(255,255,255,0.02)', textAlign: 'left' }}>
                        <th style={{ padding: '7px 12px', borderBottom: '1px solid var(--border-subtle)', width: 195 }}>
                          Pintasan
                        </th>
                        <th style={{ padding: '7px 12px', borderBottom: '1px solid var(--border-subtle)', width: 230 }}>
                          Fungsi
                        </th>
                        <th style={{ padding: '7px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
                          Keterangan
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredShortcuts.map((row) => (
                        <tr key={row.keys} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                          <td style={{ padding: '6px 12px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#fde68a' }}>
                            {row.keys}
                          </td>
                          <td style={{ padding: '6px 12px', fontWeight: 600, color: 'var(--text-primary)' }}>
                            {row.title}
                          </td>
                          <td style={{ padding: '6px 12px', color: 'var(--text-secondary)' }}>
                            {row.detail}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
