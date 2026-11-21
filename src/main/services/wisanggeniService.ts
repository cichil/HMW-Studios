import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import type {
  PhpClassMemberMeta,
  PhpClassMeta,
  PhpFunctionMeta,
  PhpParamMeta,
  WisanggeniCatalog,
  WisanggeniGuideEntry
} from '@shared/types';
import { extractPhpSymbolsFromSource, parsePhpParamsRaw } from './phpService';

export interface RawWisanggeniDocRow {
  type: 'class' | 'method' | 'function' | 'guide';
  name: string;
  class_name?: string | null;
  syntax?: string | null;
  description?: string | null;
  example?: string | null;
}

const DEFAULT_CANDIDATE_ROOTS = [
  'C:\\xampp3\\htdocs\\intranew8\\wisanggeni',
  'D:\\xampp3\\htdocs\\intranew8\\wisanggeni',
  'C:\\xampp\\htdocs\\intranew8\\wisanggeni',
  'D:\\xampp\\htdocs\\intranew8\\wisanggeni',
  'C:\\xampp3\\htdocs\\wisanggeni',
  'C:\\xampp\\htdocs\\wisanggeni',
  'D:\\xampp\\htdocs\\wisanggeni'
];

const DEFAULT_API_ENDPOINTS = [
  'http://localhost/intranew8/wisanggeni/dokumentasi/docs_api.php',
  'http://localhost/wisanggeni/dokumentasi/docs_api.php'
];

export const WISANGGENI_GLOBAL_VAR_TYPES: Record<string, string> = {
  $page: 'TPage',
  $query: 'TQuery',
  $query2: 'TQuery',
  $query3: 'TQuery',
  $pegawai: 'TUser',
  $user: 'TUser',
  $db_conn: 'TMySQL'
};

/**
 * Dokumentasi inti terkurasi dari wisanggeni/dokumentasi/ agar IntelliSense Wisanggeni
 * tetap bekerja 100% offline maupun saat mengedit langsung di Server Remote SFTP/FTPS.
 */
const EMBEDDED_DOCS: RawWisanggeniDocRow[] = [
  // === CLASSES ===
  {
    type: 'class',
    name: 'TTabel',
    syntax: "new TTabel(string $judul_box = '')",
    description:
      'Membangun dan merender grid data/tabel HTML secara dinamis lengkap dengan pagination, pencarian, pengurutan, dan tombol aksi.',
    example:
      '$tbl = new TTabel("Daftar Pegawai");\n$tbl->setJudul(array("No", "Nama", "NIP", "Aksi"));\n$tbl->setPaging(10, "pegawai_idx.php?");\n$tbl->loadData($sql);\nwhile ($row = $tbl->fetch()) {\n    $tbl->addBaris(array("_NO_URUT_", $row["nama"], $row["nip"], $aksi));\n}\necho $tbl->html();'
  },
  {
    type: 'class',
    name: 'TForm',
    syntax: "new TForm(string $action = '', string $method = 'post', string $enctype = '', string $auto_complete = '')",
    description:
      'Membuat formulir input/edit data secara otomatis lengkap dengan validasi JavaScript sisi klien, mendukung textbox, combobox, combobox_db, datepicker, dan file upload.',
    example:
      '$form = new TForm("pegawai_save.php", "post");\n$form->setTitle("Form Registrasi");\n$form->addElement("Nama Lengkap", $form->textbox("nama", "class=\'form-control\'"));\n$form->setMandatory(array("nama" => "Nama Lengkap"));\necho $form->html();'
  },
  {
    type: 'class',
    name: 'TQuery',
    syntax: 'new TQuery($db_link = null)',
    description:
      'Mengeksekusi query SQL database secara aman menggunakan dukungan binding parameter (`___nama_param___`) untuk mencegah SQL Injection serta mencatat audit trail.',
    example:
      '$query = new TQuery($GLOBALS["db_conn"]->link_id);\n$query->setParam(array("id" => $id));\n$query->execute("SELECT * FROM pegawai WHERE id = \'___id___\'");\nwhile ($row = $query->fetch()) {\n    // proses baris\n}'
  },
  {
    type: 'class',
    name: 'TPage',
    syntax: 'new TPage(string $template_path)',
    description:
      'Kerangka halaman utama aplikasi Wisanggeni (`$page` dari `base.php`) untuk mengatur judul halaman, breadcrumb, sidebar, header script/jQuery, dan konten utama.',
    example:
      'include "base.php";\n$page->setJudulHalaman("Data Perizinan");\n$page->addBreadCrumb("Dashboard", "index.php");\n$page->setContent($s);'
  },
  {
    type: 'class',
    name: 'TUploadFile',
    syntax: 'new TUploadFile(string $field_name, string $folder_tujuan, string $nama_file_baru)',
    description:
      'Memproses unggahan berkas ke server (otomatis di bawah folder `/files/`), menyaring ekstensi file yang diizinkan, serta memvalidasi ukuran file.',
    example:
      '$upload = new TUploadFile("foto_berkas", "pegawai_foto", "nip_123.jpg");\n$upload->setAllowedExt(array("jpg", "jpeg", "png", "pdf"));\nif ($upload->cekFileSize()) {\n    $upload->upload();\n}'
  },
  {
    type: 'class',
    name: 'TAuth',
    syntax: 'new TAuth(string $username, string $password)',
    description:
      'Melakukan otentikasi login pengguna terhadap database kepegawaian internal secara terintegrasi.',
    example:
      '$auth = new TAuth($nip, $password);\nif ($auth->result) {\n    $_SESSION["_nip"] = $auth->result;\n}'
  },
  {
    type: 'class',
    name: 'TMenuBox',
    syntax: 'new TMenuBox(string $judul_menu)',
    description: 'Membangun navigasi menu sidebar aplikasi bergaya AdminLTE / Bootstrap.',
    example:
      '$menu = new TMenuBox("MENU UTAMA");\n$menu->addItem("Dashboard", "index.php", "<i class=\'fa fa-dashboard\'></i>");\necho $menu->html();'
  },
  {
    type: 'class',
    name: 'TModal',
    syntax: 'new TModal(string $id)',
    description: 'Membangun komponen dialog modal Bootstrap interaktif lengkap dengan tombol pemicu (trigger).',
    example:
      '$modal = new TModal("modalDetail");\n$modal->setTitle("Detail Data");\n$modal->setSize("modal-lg");\n$modal->setContent($html_detail);\necho $modal->html();'
  },
  {
    type: 'class',
    name: 'TAlert',
    syntax: "new TAlert(string $tipe = 'info', string $title = '')",
    description: 'Menampilkan kotak notifikasi / peringatan Bootstrap (`success`, `info`, `warning`, `danger`).'
  },
  {
    type: 'class',
    name: 'TKotak',
    syntax: "new TKotak(string $judul = '', string $icon = '', string $type = 'box-info')",
    description: 'Merender panel container Box AdminLTE (`box-info`, `box-primary`, `box-success`, `box-warning`, `box-danger`).'
  },
  {
    type: 'class',
    name: 'TUser',
    syntax: 'new TUser(string $nip)',
    description: 'Representasi objek pegawai yang sedang login (`$pegawai` di `base.php`) beserta profil dan kewenangannya.'
  },
  {
    type: 'class',
    name: 'TTable',
    syntax: "new TTable(string $table_name, string $primary_key = '', string $id = '')",
    description: 'Helper Active-Record ringan Wisanggeni untuk operasi simpan (`save()`), hapus (`delete()`), dan pemetaan `$_POST` langsung ke tabel database.'
  },

  // === METHODS: TTabel ===
  {
    type: 'method',
    name: 'setJudul',
    class_name: 'TTabel',
    syntax: 'setJudul(array $kolom_header)',
    description: 'Mengatur daftar judul header kolom pada tabel.',
    example: '$tbl->setJudul(array("No", "NIP", "Nama Pegawai", "Aksi"));'
  },
  {
    type: 'method',
    name: 'setPaging',
    class_name: 'TTabel',
    syntax: "setPaging(int $limit = 10, string $url = '', string $paging_att = '')",
    description: 'Mengaktifkan paginasi tabel dengan membatasi jumlah baris per halaman.',
    example: '$tbl->setPaging(10, "pegawai_idx.php?");'
  },
  {
    type: 'method',
    name: 'setSearchElement',
    class_name: 'TTabel',
    syntax: "setSearchElement(string $param_name, string $url = '', string $placeholder = '')",
    description: 'Menambahkan kotak pencarian cepat di bagian atas tabel.',
    example: '$tbl->setSearchElement("q", "pegawai_idx.php", "Cari nama atau NIP...");'
  },
  {
    type: 'method',
    name: 'setStrInputBaru',
    class_name: 'TTabel',
    syntax: "setStrInputBaru(string $label, string $url = '', int $width = 4, string $attr = '')",
    description: 'Menambahkan tombol tambah data baru di bagian header tabel.',
    example: '$tbl->setStrInputBaru("Tambah Pegawai", "pegawai_form.php");'
  },
  {
    type: 'method',
    name: 'loadData',
    class_name: 'TTabel',
    syntax: 'loadData(string $sql, int $show_sql = 0)',
    description: 'Menjalankan query SQL SELECT untuk mengisi sumber data tabel.',
    example: '$tbl->loadData("SELECT * FROM pegawai ORDER BY id DESC");'
  },
  {
    type: 'method',
    name: 'fetch',
    class_name: 'TTabel',
    syntax: 'fetch()',
    description: 'Mengambil baris berikutnya dari hasil `loadData()` sebagai associative array (atau `false` jika habis).',
    example: 'while ($row = $tbl->fetch()) {\n    // susun baris\n}'
  },
  {
    type: 'method',
    name: 'addBaris',
    class_name: 'TTabel',
    syntax: 'addBaris(array $baris_data)',
    description: 'Menambahkan satu baris data ke dalam tabel. Gunakan `"_NO_URUT_"` untuk penomoran otomatis yang mengikuti halaman paging.',
    example: '$tbl->addBaris(array("_NO_URUT_", $row["nip"], $row["nama"], $aksi));'
  },
  {
    type: 'method',
    name: 'setWidthKolom',
    class_name: 'TTabel',
    syntax: 'setWidthKolom(array $ar_width)',
    description: 'Mengatur lebar masing-masing kolom tabel (misal `array("5%", "20%", "55%", "20%")`).'
  },
  {
    type: 'method',
    name: 'setAlignKolom',
    class_name: 'TTabel',
    syntax: 'setAlignKolom(array $alignment)',
    description: 'Mengatur perataan teks kolom (`left`, `center`, `right`).'
  },
  {
    type: 'method',
    name: 'html',
    class_name: 'TTabel',
    syntax: 'html()',
    description: 'Mengembalikan string kode HTML tabel yang siap dirender ke `$page->setContent($s)`.',
    example: '$s .= $tbl->html();'
  },

  // === METHODS: TForm ===
  {
    type: 'method',
    name: 'setTitle',
    class_name: 'TForm',
    syntax: 'setTitle(string $judul_form)',
    description: 'Mengatur judul panel/box formulir.',
    example: '$form->setTitle("Form Edit Pegawai");'
  },
  {
    type: 'method',
    name: 'addElement',
    class_name: 'TForm',
    syntax: "addElement(string $label, string $element_html = '')",
    description: 'Menambahkan satu baris field (pasangan label dan kontrol input HTML) ke dalam form.',
    example: '$form->addElement("Alamat Lengkap", $form->textarea("alamat", "rows=3 class=\'form-control\'"));'
  },
  {
    type: 'method',
    name: 'hidden',
    class_name: 'TForm',
    syntax: 'hidden(string $name, $value)',
    description: 'Membuat elemen `<input type="hidden">` terikat dengan data form.',
    example: '$form->addElement("", $form->hidden("id", encid($id)));'
  },
  {
    type: 'method',
    name: 'textbox',
    class_name: 'TForm',
    syntax: "textbox(string $name, string $attributes = 'size=50')",
    description: 'Membuat elemen input teks `<input type="text">` yang otomatis terisi saat `loadFromSQL()` dipanggil.',
    example: '$form->textbox("username", "class=\'form-control\' placeholder=\'Masukkan Username\'");'
  },
  {
    type: 'method',
    name: 'textarea',
    class_name: 'TForm',
    syntax: "textarea(string $name, string $attributes = '')",
    description: 'Membuat elemen `<textarea>` multi-baris pada formulir.'
  },
  {
    type: 'method',
    name: 'combobox',
    class_name: 'TForm',
    syntax: "combobox(string $name, array $options, string $attributes = '')",
    description: 'Membuat elemen dropdown `<select>` dari associative array opsi.',
    example: '$form->combobox("jk", array("L" => "Laki-laki", "P" => "Perempuan"), "class=\'form-control\'");'
  },
  {
    type: 'method',
    name: 'combobox_db',
    class_name: 'TForm',
    syntax: "combobox_db(string $name, string $table_name, string $sql_tambahan = '', string $attr = '')",
    description: 'Membuat elemen dropdown `<select>` yang datanya diambil otomatis dari tabel referensi di database.'
  },
  {
    type: 'method',
    name: 'comboSearch',
    class_name: 'TForm',
    syntax: "comboSearch(string $name, array $opt, string $attr = '')",
    description: 'Membuat dropdown Select2 dengan fitur ketik untuk mencari opsi.'
  },
  {
    type: 'method',
    name: 'filebox',
    class_name: 'TForm',
    syntax: "filebox(string $name, string $attributes = '')",
    description: 'Membuat elemen upload file (`<input type="file">`) dan otomatis mengatur `enctype="multipart/form-data"` pada form.',
    example: '$form->filebox("dokumen_pdf", "class=\'form-control\'");'
  },
  {
    type: 'method',
    name: 'setMandatory',
    class_name: 'TForm',
    syntax: 'setMandatory(array $fields)',
    description: 'Mengatur daftar field yang wajib diisi (divalidasi otomatis dengan JavaScript sebelum submit).',
    example: '$form->setMandatory(array("nip" => "NIP Pegawai", "nama" => "Nama Lengkap"));'
  },
  {
    type: 'method',
    name: 'loadFromSQL',
    class_name: 'TForm',
    syntax: 'loadFromSQL(string $sql, int $show_sql = 0)',
    description: 'Memuat nilai field formulir secara otomatis dari satu baris hasil query SQL (digunakan pada mode Edit).',
    example: '$form->loadFromSQL("SELECT * FROM pegawai WHERE id = \'" . sanit($id) . "\'");'
  },
  {
    type: 'method',
    name: 'html',
    class_name: 'TForm',
    syntax: 'html()',
    description: 'Menghasilkan kode HTML lengkap formulir beserta script validasinya.',
    example: '$s .= $form->html();'
  },

  // === METHODS: TQuery ===
  {
    type: 'method',
    name: 'setParam',
    class_name: 'TQuery',
    syntax: 'setParam(array $params)',
    description: 'Mengikat parameter ke placeholder `___key___` di SQL secara aman menggunakan sanitasi anti SQL Injection.',
    example: '$query->setParam(array("nip" => $nip, "status" => 1));'
  },
  {
    type: 'method',
    name: 'execute',
    class_name: 'TQuery',
    syntax: 'execute(string $sql, int $debug_query = 0)',
    description: 'Mengeksekusi pernyataan SQL (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) dan mencatat audit trail otomatis.',
    example: '$query->execute("SELECT * FROM pegawai WHERE nip = \'___nip___\'");'
  },
  {
    type: 'method',
    name: 'fetch',
    class_name: 'TQuery',
    syntax: 'fetch()',
    description: 'Mengambil baris berikutnya dari hasil `$query->execute(...)`.'
  },
  {
    type: 'method',
    name: 'first',
    class_name: 'TQuery',
    syntax: 'first()',
    description: 'Mengambil baris pertama hasil query secara langsung.'
  },

  // === METHODS: TPage ===
  {
    type: 'method',
    name: 'setJudulHalaman',
    class_name: 'TPage',
    syntax: 'setJudulHalaman(string $judul)',
    description: 'Mengatur judul utama halaman pada header template Wisanggeni.',
    example: '$page->setJudulHalaman("Rekapitulasi Rekomendasi");'
  },
  {
    type: 'method',
    name: 'setContent',
    class_name: 'TPage',
    syntax: 'setContent(string $html)',
    description: 'Memasukkan seluruh konten HTML halaman ke kerangka utama dan menampilkannya ke browser.',
    example: '$page->setContent($s);'
  },
  {
    type: 'method',
    name: 'addBreadCrumb',
    class_name: 'TPage',
    syntax: "addBreadCrumb(string $caption, string $url = '')",
    description: 'Menambahkan jejak navigasi breadcrumb di kanan atas halaman.',
    example: '$page->addBreadCrumb("Daftar Permohonan", "rekom_idx.php");'
  },
  {
    type: 'method',
    name: 'hideSideBar',
    class_name: 'TPage',
    syntax: 'hideSideBar()',
    description: 'Menyembunyikan panel sidebar kiri agar area kerja halaman tampil penuh (full-width).'
  },

  // === GLOBAL HELPER FUNCTIONS ===
  {
    type: 'function',
    name: 'getGET',
    syntax: 'getGET(string $key)',
    description: 'Helper keamanan Wisanggeni untuk mengambil nilai parameter query URL (`$_GET`) yang telah disanitasi.',
    example: '$id = decid(getGET("id"));'
  },
  {
    type: 'function',
    name: 'getPOST',
    syntax: 'getPOST(string $key)',
    description: 'Helper keamanan Wisanggeni untuk mengambil nilai input form (`$_POST`) yang telah disanitasi.',
    example: '$nama = getPOST("nama");'
  },
  {
    type: 'function',
    name: 'encid',
    syntax: 'encid($id)',
    description: 'Mengenkripsi / mengacak ID record sebelum dikirimkan melalui URL agar terhindar dari celah IDOR.',
    example: '$url = "pegawai_form.php?id=" . encid($row["id"]);'
  },
  {
    type: 'function',
    name: 'decid',
    syntax: 'decid(string $encrypted_id)',
    description: 'Mendekripsi kembali nilai ID yang sebelumnya dienkripsi menggunakan `encid()`.',
    example: '$id = decid(getGET("id"));'
  },
  {
    type: 'function',
    name: 'dosql',
    syntax: 'dosql(string $thequery, int $showquery = 0, $link = 0)',
    description: 'Helper cepat Wisanggeni untuk mengeksekusi query SQL langsung menggunakan koneksi aktif.',
    example: '$res = dosql("SELECT * FROM mst_unitkerja WHERE aktif = 1");'
  },
  {
    type: 'function',
    name: 'sanit',
    syntax: 'sanit(string $s)',
    description: 'Membersihkan dan melakukan escape karakter berbahaya pada input string sebelum digunakan di query SQL.'
  },
  {
    type: 'function',
    name: 'alert',
    syntax: "alert(string $pesan, string $type = 'danger', string $icon = 'fa fa-exclamation-circle')",
    description: 'Menghasilkan komponen pesan alert singkat bergaya Bootstrap.'
  },
  {
    type: 'function',
    name: 'alert_box',
    syntax: "alert_box(string $judul, string $isi, string $jenis = 'danger', string $icon = '')",
    description: 'Menghasilkan kotak notifikasi Bootstrap lengkap dengan judul dan isi pesan (`success`, `info`, `warning`, `danger`).',
    example: '$s .= alert_box("Berhasil", "Data berhasil disimpan.", "success");'
  },
  {
    type: 'function',
    name: 'callout_box',
    syntax: "callout_box(string $judul, string $isi, string $tipe = 'danger')",
    description: 'Menghasilkan komponen Callout AdminLTE dengan aksen garis samping tebal.'
  },
  {
    type: 'function',
    name: 'button_link',
    syntax: "button_link(string $caption, string $url, string $icon = 'fa fa-plus', string $class = 'btn-xs btn-primary', string $attr = '')",
    description: 'Membuat tombol tautan `<a>` bergaya Bootstrap lengkap dengan ikon FontAwesome.',
    example: '$btn = button_link("Edit", "form.php?id=" . encid($id), "fa fa-edit", "btn-xs btn-warning");'
  },
  {
    type: 'function',
    name: 'href',
    syntax: "href(string $url, string $s = '', string $attr = '')",
    description: 'Menghasilkan elemen hyperlink `<a href="...">` HTML dengan cepat.'
  },
  {
    type: 'function',
    name: 'combosearch',
    syntax: "combosearch(string $name, $val, array $opt, string $attr = '')",
    description: 'Helper standalone untuk merender dropdown Select2 yang mendukung pencarian ketik.'
  },
  {
    type: 'function',
    name: 'build_opt',
    syntax: 'build_opt(string $sql, int $debug = 0, int $encid = 0)',
    description: 'Membangun associative array opsi `key => label` langsung dari query SQL 2 kolom untuk diumpankan ke `combobox` / `combosearch`.'
  },
  {
    type: 'function',
    name: 'getnamapegawai',
    syntax: 'getnamapegawai(string $nip)',
    description: 'Mengambil nama pegawai berdasarkan NIP dari database kepegawaian.'
  },
  {
    type: 'function',
    name: 'getnamadangelar',
    syntax: "getnamadangelar(string $nip = '', int $style = 0)",
    description: 'Mengambil nama lengkap pegawai beserta gelar akademik depan & belakang berdasarkan NIP.'
  },
  {
    type: 'function',
    name: 'getunitkerja',
    syntax: "getunitkerja(string $nip = '')",
    description: 'Mengambil kode unit kerja pegawai berdasarkan NIP.'
  },
  {
    type: 'function',
    name: 'getstrtgl',
    syntax: 'getstrtgl(string $tgl, int $style = 0)',
    description: 'Memformat tanggal `YYYY-MM-DD` menjadi teks tanggal Bahasa Indonesia (contoh: `15 November 2026`).'
  },
  {
    type: 'function',
    name: 'getstrtgljam',
    syntax: 'getstrtgljam(string $tgl, int $style = 0)',
    description: 'Memformat timestamp MySQL menjadi teks tanggal & jam Bahasa Indonesia.'
  },
  {
    type: 'function',
    name: 'terbilang',
    syntax: 'terbilang(float $angka)',
    description: 'Mengubah angka nominal menjadi teks ejaan Bahasa Indonesia.'
  },
  {
    type: 'function',
    name: 'num_format',
    syntax: 'num_format($value, int $decimal_places = 0, int $trim_0 = 0)',
    description: 'Memformat angka dengan pemisah ribuan titik ala Indonesia.'
  },
  {
    type: 'function',
    name: 'getdataniboss',
    syntax: 'getdataniboss(string $nib)',
    description: 'Mengambil data profil perusahaan dan NIB terintegrasi dari layanan OSS.'
  },
  {
    type: 'function',
    name: 'updateposisioss',
    syntax:
      "updateposisioss($kd_status, $id_izin, $kd_izin, $id_rekomendasi_aju, string $catatan = '', string $catatan_internal = '', int $id_kurang_data = 0, string $nip = '')",
    description: 'Memperbarui status posisi pemrosesan perizinan/rekomendasi ke integrasi OSS.'
  },
  {
    type: 'function',
    name: 'updateposisiossfinal',
    syntax:
      "updateposisiossfinal($kd_status, $id_izin, $kd_izin, $id_rekomendasi_aju, $nomor_izin, string $catatan = '', string $nip = '', string $file_lampiran = '')",
    description: 'Mengirimkan status persetujuan/penolakan final rekomendasi beserta lampiran ke OSS.'
  }
];

function extractParamsFromSyntax(syntax?: string | null): PhpParamMeta[] {
  if (!syntax) return [];
  const openIdx = syntax.indexOf('(');
  const closeIdx = syntax.lastIndexOf(')');
  if (openIdx < 0 || closeIdx <= openIdx) return [];
  return parsePhpParamsRaw(syntax.slice(openIdx + 1, closeIdx));
}

function buildMarkdownDoc(row: {
  syntax?: string | null;
  description?: string | null;
  example?: string | null;
  badge?: string;
}): string {
  const parts: string[] = [];
  if (row.badge) {
    parts.push(`**${row.badge}**`);
  }
  if (row.description?.trim()) {
    parts.push(row.description.trim());
  }
  if (row.syntax?.trim()) {
    parts.push(`*Sintaks:*\n\`\`\`php\n${row.syntax.trim()}\n\`\`\``);
  }
  if (row.example?.trim()) {
    const cleanExample = row.example.replace(/\\n/g, '\n').trim();
    if (cleanExample.startsWith('#') || cleanExample.includes('```')) {
      parts.push(cleanExample);
    } else {
      parts.push(`*Contoh Penggunaan:*\n\`\`\`php\n${cleanExample}\n\`\`\``);
    }
  }
  return parts.join('\n\n');
}

/**
 * Mem-parsing tuple INSERT INTO wisanggeni_docs (type, name, class_name, syntax, description, example) VALUES ...
 * secara aman terhadap tanda kutip tunggal ter-escape (\' atau '') dan baris baru (\n).
 */
export function parseWisanggeniSqlDump(sqlContent: string): RawWisanggeniDocRow[] {
  const results: RawWisanggeniDocRow[] = [];
  const headerRegex = /INSERT\s+INTO\s+`?wisanggeni_docs`?\s*\([^)]*\)\s*VALUES/gi;
  const len = sqlContent.length;

  for (const match of sqlContent.matchAll(headerRegex)) {
    let i = (match.index ?? 0) + match[0].length;

    while (i < len) {
      while (i < len && /[\s,]/.test(sqlContent[i])) i++;
      if (i >= len || sqlContent[i] === ';') break;
      if (sqlContent[i] !== '(') {
        i++;
        continue;
      }
      i++; // lewati '('

      const fields: Array<string | null> = [];
      while (i < len && sqlContent[i] !== ')') {
        while (i < len && /\s/.test(sqlContent[i])) i++;
        if (sqlContent[i] === ',') {
          i++;
          continue;
        }
        if (sqlContent[i] === ')') break;

        if (sqlContent[i] === "'") {
          i++; // lewati pembuka "'"
          let str = '';
          while (i < len) {
            const ch = sqlContent[i];
            if (ch === '\\' && i + 1 < len) {
              const next = sqlContent[i + 1];
              if (next === 'n') str += '\n';
              else if (next === 'r') str += '\r';
              else if (next === 't') str += '\t';
              else str += next;
              i += 2;
              continue;
            }
            if (ch === "'" && sqlContent[i + 1] === "'") {
              str += "'";
              i += 2;
              continue;
            }
            if (ch === "'") {
              i++;
              break;
            }
            str += ch;
            i++;
          }
          fields.push(str);
        } else {
          let token = '';
          while (i < len && sqlContent[i] !== ',' && sqlContent[i] !== ')') {
            token += sqlContent[i];
            i++;
          }
          const trimmed = token.trim();
          fields.push(trimmed.toUpperCase() === 'NULL' ? null : trimmed);
        }

        while (i < len && /\s/.test(sqlContent[i])) i++;
        if (sqlContent[i] === ',') i++;
      }

      if (sqlContent[i] === ')') i++;

      if (fields.length >= 5) {
        const rawType = (fields[0] ?? '').toLowerCase();
        if (
          rawType === 'class' ||
          rawType === 'method' ||
          rawType === 'function' ||
          rawType === 'guide'
        ) {
          results.push({
            type: rawType,
            name: fields[1] ?? '',
            class_name: fields[2],
            syntax: fields[3],
            description: fields[4],
            example: fields[5] ?? null
          });
        }
      }
    }
  }

  return results;
}

function isDatedOrBackupPhpFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  if (lower === 'connect_db.php' || lower.includes('connect_db')) return true;
  if (lower.endsWith('.bak') || lower.endsWith('.copy') || lower.endsWith('.old')) return true;
  if (/(?:_|class|-)\d{6,8}/.test(lower)) return true;
  if (lower.includes('copy') || lower.includes('backup') || lower.includes('_old')) return true;
  return false;
}

export class WisanggeniService {
  private cached: WisanggeniCatalog | null = null;
  private customRootPath: string | null = null;
  private customApiUrl: string | null = null;

  detectWisanggeniRoot(hintPath?: string): string | null {
    const candidates: string[] = [];
    if (hintPath && !hintPath.startsWith('http://') && !hintPath.startsWith('https://')) {
      const resolvedHint = resolve(hintPath);
      candidates.push(resolvedHint);
      candidates.push(join(resolvedHint, 'wisanggeni'));
      candidates.push(dirname(resolvedHint));
    }
    if (this.customRootPath) {
      candidates.push(this.customRootPath);
    }
    candidates.push(...DEFAULT_CANDIDATE_ROOTS);

    for (const candidate of candidates) {
      if (
        existsSync(join(candidate, 'main_lib.php')) ||
        existsSync(join(candidate, 'classes', 'TTabel.class.php'))
      ) {
        return candidate;
      }
    }
    return null;
  }

  private async findSqlDocFiles(rootPath: string): Promise<string[]> {
    const sqlFiles: string[] = [];
    try {
      const entries = await readdir(rootPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.toLowerCase().startsWith('dokumentasi')) {
          const subDir = join(rootPath, entry.name);
          const candidateSql = join(subDir, 'wisanggeni_docs_schema.sql');
          if (existsSync(candidateSql)) {
            sqlFiles.push(candidateSql);
          }
        }
      }
    } catch {
      // Ignore
    }
    return sqlFiles;
  }

  private async fetchLiveApiRows(
    explicitUrl?: string
  ): Promise<{ rows: RawWisanggeniDocRow[]; endpoint: string | null }> {
    const urls: string[] = [];
    if (explicitUrl && (explicitUrl.startsWith('http://') || explicitUrl.startsWith('https://'))) {
      urls.push(explicitUrl);
    }
    if (this.customApiUrl) {
      urls.push(this.customApiUrl);
    }
    urls.push(...DEFAULT_API_ENDPOINTS);

    for (const url of Array.from(new Set(urls))) {
      try {
        const res = await fetch(url, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(1800)
        });
        if (!res.ok) continue;
        const json = (await res.json()) as {
          status?: string;
          data?: RawWisanggeniDocRow[];
        };
        if (json.status === 'success' && Array.isArray(json.data)) {
          return { rows: json.data, endpoint: url };
        }
      } catch {
        // Apache / MySQL sedang tidak aktif; lanjutkan mode offline tanpa menghambat startup
      }
    }

    return { rows: [], endpoint: null };
  }

  async getCatalog(
    forceRefresh = false,
    customPathOrUrl?: string
  ): Promise<WisanggeniCatalog> {
    if (customPathOrUrl) {
      if (customPathOrUrl.startsWith('http://') || customPathOrUrl.startsWith('https://')) {
        this.customApiUrl = customPathOrUrl;
      } else {
        this.customRootPath = customPathOrUrl;
      }
    }

    if (this.cached && !forceRefresh && !customPathOrUrl) {
      return this.cached;
    }

    const classesMap = new Map<string, PhpClassMeta>();
    const functionsMap = new Map<string, PhpFunctionMeta>();
    const guidesMap = new Map<string, WisanggeniGuideEntry>();
    let docCount = 0;

    const rootPath = this.detectWisanggeniRoot(customPathOrUrl);

    // LAYER 1: Pindai langsung kode sumber PHP asli di wisanggeni/classes/ & helper utama (Read-Only)
    if (rootPath) {
      const classesDir = join(rootPath, 'classes');
      const filesToScan: string[] = [];

      if (existsSync(classesDir)) {
        try {
          const classEntries = await readdir(classesDir, { withFileTypes: true });
          for (const entry of classEntries) {
            if (!entry.isFile()) continue;
            if (!entry.name.toLowerCase().endsWith('.php')) continue;
            if (isDatedOrBackupPhpFile(entry.name)) continue;
            filesToScan.push(join(classesDir, entry.name));
          }
        } catch {
          // Ignore
        }
      }

      try {
        const rootEntries = await readdir(rootPath, { withFileTypes: true });
        for (const entry of rootEntries) {
          if (!entry.isFile()) continue;
          const lower = entry.name.toLowerCase();
          if (!lower.endsWith('.php')) continue;
          if (isDatedOrBackupPhpFile(entry.name)) continue;
          if (
            lower === 'main_lib.php' ||
            lower.endsWith('.function.php') ||
            lower.endsWith('_lib.php')
          ) {
            filesToScan.push(join(rootPath, entry.name));
          }
        }
      } catch {
        // Ignore
      }

      for (const fileFull of filesToScan) {
        try {
          const st = await stat(fileFull);
          if (st.size > 768 * 1024) continue;
          const content = await readFile(fileFull, 'utf-8');
          const rel = `wisanggeni/${relative(rootPath, fileFull).replace(/\\/g, '/')}`;
          const extracted = extractPhpSymbolsFromSource(content, fileFull, rel);

          for (const cls of extracted.classes) {
            const key = cls.name.toLowerCase();
            const existing = classesMap.get(key);
            if (!existing) {
              classesMap.set(key, {
                ...cls,
                origin: 'wisanggeni'
              });
            } else {
              const seen = new Set(
                existing.members.map((m) => `${m.kind}:${m.name.toLowerCase()}`)
              );
              for (const m of cls.members) {
                const mk = `${m.kind}:${m.name.toLowerCase()}`;
                if (!seen.has(mk)) {
                  existing.members.push(m);
                  seen.add(mk);
                }
              }
              if (!existing.constructorParams && cls.constructorParams) {
                existing.constructorParams = cls.constructorParams;
              }
            }
          }

          for (const fn of extracted.functions) {
            const key = fn.name.toLowerCase();
            if (!functionsMap.has(key)) {
              functionsMap.set(key, {
                ...fn,
                origin: 'wisanggeni'
              });
            }
          }
        } catch {
          // Ignore unreadable file
        }
      }
    }

    // Helper untuk menggabungkan baris dokumentasi (Embedded + SQL Schema + Live API)
    const applyDocRows = (rows: RawWisanggeniDocRow[], sourceBadge: string): void => {
      for (const row of rows) {
        const name = row.name?.trim();
        if (!name) continue;

        if (row.type === 'guide') {
          guidesMap.set(name.toLowerCase(), {
            title: name,
            syntax: row.syntax ?? undefined,
            description: row.description ?? '',
            example: row.example ?? undefined
          });
          docCount += 1;
          continue;
        }

        if (row.type === 'class') {
          const key = name.toLowerCase();
          const existing = classesMap.get(key);
          const parsedCtorParams = extractParamsFromSyntax(row.syntax);
          const md = buildMarkdownDoc({
            syntax: row.syntax,
            description: row.description,
            example: row.example,
            badge: `Wisanggeni Class (${sourceBadge})`
          });

          if (!existing) {
            classesMap.set(key, {
              name,
              members: [],
              constructorParams: parsedCtorParams.length > 0 ? parsedCtorParams : undefined,
              doc: md || undefined,
              origin: 'wisanggeni'
            });
          } else {
            existing.name = name;
            if (row.description || row.example || !existing.doc) {
              existing.doc = md || existing.doc;
            }
            if (!existing.constructorParams?.length && parsedCtorParams.length > 0) {
              existing.constructorParams = parsedCtorParams;
            }
          }
          docCount += 1;
          continue;
        }

        if (row.type === 'method') {
          const ownerName = row.class_name?.trim();
          if (!ownerName) continue;
          const ownerKey = ownerName.toLowerCase();
          let ownerCls = classesMap.get(ownerKey);
          if (!ownerCls) {
            ownerCls = {
              name: ownerName,
              members: [],
              origin: 'wisanggeni'
            };
            classesMap.set(ownerKey, ownerCls);
          }

          const parsedParams = extractParamsFromSyntax(row.syntax);
          const md = buildMarkdownDoc({
            syntax: row.syntax ? `${ownerCls.name}->${row.syntax}` : undefined,
            description: row.description,
            example: row.example,
            badge: `Wisanggeni ${ownerCls.name} Method`
          });

          const existingMember = ownerCls.members.find(
            (m): m is PhpClassMemberMeta =>
              m.kind === 'method' && m.name.toLowerCase() === name.toLowerCase()
          );

          if (!existingMember) {
            ownerCls.members.push({
              name,
              kind: 'method',
              params: parsedParams,
              doc: md || undefined
            });
          } else {
            if (!existingMember.params?.length && parsedParams.length > 0) {
              existingMember.params = parsedParams;
            } else if (existingMember.params && parsedParams.length === existingMember.params.length) {
              // Perkaya tipe parameter dari dokumentasi (misal `array $kolom_header` memperkaya `$ar_isi`)
              existingMember.params = existingMember.params.map((p, idx) => ({
                ...p,
                type: p.type ?? parsedParams[idx]?.type
              }));
            }
            if (row.description || row.example || !existingMember.doc) {
              existingMember.doc = md || existingMember.doc;
            }
          }
          docCount += 1;
          continue;
        }

        if (row.type === 'function') {
          const key = name.toLowerCase();
          const existingFn = functionsMap.get(key);
          const parsedParams = extractParamsFromSyntax(row.syntax);
          const md = buildMarkdownDoc({
            syntax: row.syntax,
            description: row.description,
            example: row.example,
            badge: 'Wisanggeni Global Helper'
          });

          if (!existingFn) {
            functionsMap.set(key, {
              name,
              params: parsedParams,
              doc: md || undefined,
              origin: 'wisanggeni'
            });
          } else {
            // Utamakan penulisan camelCase dari dokumentasi (contoh: `getGET`, `getPOST`)
            if (name !== name.toLowerCase()) {
              existingFn.name = name;
            }
            if (!existingFn.params.length && parsedParams.length > 0) {
              existingFn.params = parsedParams;
            } else if (parsedParams.length === existingFn.params.length) {
              existingFn.params = existingFn.params.map((p, idx) => ({
                ...p,
                type: p.type ?? parsedParams[idx]?.type
              }));
            }
            if (row.description || row.example || !existingFn.doc) {
              existingFn.doc = md || existingFn.doc;
            }
          }
          docCount += 1;
        }
      }
    };

    // LAYER 2A: Terapkan dokumentasi terkurasi bawaan
    applyDocRows(EMBEDDED_DOCS, 'Dokumentasi Bawaan');

    // LAYER 2B: Baca file SQL dokumentasi lokal jika ditemukan di wisanggeni/dokumentasi*/
    if (rootPath) {
      const sqlFiles = await this.findSqlDocFiles(rootPath);
      for (const sqlPath of sqlFiles) {
        try {
          const rawSql = await readFile(sqlPath, 'utf-8');
          const parsedSqlRows = parseWisanggeniSqlDump(rawSql);
          applyDocRows(parsedSqlRows, 'dokumentasi SQL');
        } catch {
          // Ignore
        }
      }
    }

    // LAYER 3: Sinkronisasi dinamis dari endpoint live `dokumentasi/docs_api.php` bila Apache+MySQL aktif
    const live = await this.fetchLiveApiRows(customPathOrUrl);
    if (live.rows.length > 0) {
      applyDocRows(live.rows, 'Live docs_api.php');
    }

    const classes = Array.from(classesMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    const functions = Array.from(functionsMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    let methodCount = 0;
    let propertyCount = 0;
    for (const c of classes) {
      for (const m of c.members) {
        if (m.kind === 'method') methodCount += 1;
        else if (m.kind === 'property') propertyCount += 1;
      }
    }

    this.cached = {
      available: classes.length > 0 || functions.length > 0,
      rootPath,
      apiSynced: live.rows.length > 0,
      apiEndpoint: live.endpoint,
      classes,
      functions,
      globalVarTypes: { ...WISANGGENI_GLOBAL_VAR_TYPES },
      guides: Array.from(guidesMap.values()),
      stats: {
        classCount: classes.length,
        methodCount,
        propertyCount,
        functionCount: functions.length,
        docCount
      }
    };

    return this.cached;
  }
}
