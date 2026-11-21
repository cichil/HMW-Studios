import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { RubleBundle, RubleCommand, RubleSnippet } from '@shared/types';

export const BUILTIN_RUBLES: RubleBundle[] = [
  {
    id: 'ruble-html-modern',
    name: 'HTML5 & Web Standards Ruble',
    version: '4.0.0',
    author: 'HMW Studio',
    description: 'Templat dokumen HTML5 semantik, kartu komponen responsif, SEO meta, dan form modern.',
    builtIn: true,
    snippets: [
      {
        id: 'snip-html5-doc',
        trigger: 'html5',
        name: 'HTML5 Modern Document',
        scope: 'html',
        description: 'Kerangka lengkap HTML5 responsif dengan viewport dan stylesheet',
        body: [
          '<!DOCTYPE html>',
          '<html lang="${1:id}">',
          '<head>',
          '  <meta charset="UTF-8" />',
          '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
          '  <title>${2:Judul Halaman}</title>',
          '  <link rel="stylesheet" href="${3:./style.css}" />',
          '</head>',
          '<body>',
          '  <main>',
          '    $0',
          '  </main>',
          '</body>',
          '</html>'
        ].join('\n')
      },
      {
        id: 'snip-html-section',
        trigger: 'sec-hero',
        name: 'Hero Section Card',
        scope: 'html',
        description: 'Komponen hero section siap pakai',
        body: [
          '<section class="hero">',
          '  <div class="hero__content">',
          '    <h1>${1:Judul Utama}</h1>',
          '    <p>${2:Deskripsi singkat layanan atau produk Anda.}</p>',
          '    <a href="${3:#mulai}" class="btn-primary">${4:Mulai Sekarang}</a>',
          '  </div>',
          '</section>'
        ].join('\n')
      }
    ],
    commands: []
  },
  {
    id: 'ruble-js-ts-modern',
    name: 'ES2025 & TypeScript Ruble',
    version: '4.0.0',
    author: 'HMW Studio',
    description: 'Snippet fetch async/await modern, modul TypeScript, dan React functional component.',
    builtIn: true,
    snippets: [
      {
        id: 'snip-ts-fetch',
        trigger: 'afetch',
        name: 'Async Fetch JSON Helper',
        scope: 'typescript',
        description: 'Fungsi fetch JSON aman dengan AbortSignal & error handling',
        body: [
          'export async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {',
          '  const response = await fetch(url, {',
          "    headers: { Accept: 'application/json' },",
          '    signal',
          '  });',
          '  if (!response.ok) {',
          '    throw new Error(`HTTP ${response.status}: ${response.statusText}`);',
          '  }',
          '  return (await response.json()) as T;',
          '}'
        ].join('\n')
      },
      {
        id: 'snip-js-fetch',
        trigger: 'afetch',
        name: 'Async Fetch JSON (ES2025)',
        scope: 'javascript',
        description: 'Fungsi async/await fetch JSON modern',
        body: [
          'export async function fetchJson(url) {',
          '  const response = await fetch(url);',
          '  if (!response.ok) throw new Error(`HTTP ${response.status}`);',
          '  return await response.json();',
          '}'
        ].join('\n')
      },
      {
        id: 'snip-css-grid',
        trigger: 'grid-auto',
        name: 'Responsive Auto-Fit CSS Grid',
        scope: 'css',
        description: 'Grid CSS responsif otomatis tanpa media query rumit',
        body: [
          '.${1:grid-container} {',
          '  display: grid;',
          '  grid-template-columns: repeat(auto-fit, minmax(${2:260px}, 1fr));',
          '  gap: ${3:1.25rem};',
          '}'
        ].join('\n')
      }
    ],
    commands: [
      {
        id: 'cmd-node-version',
        name: 'Cek Versi Node & NPM',
        description: 'Menampilkan versi runtime Node.js di workspace',
        commandLine: 'node -v',
        shortcut: 'Alt+Shift+N'
      }
    ]
  },
  {
    id: 'ruble-php8-polyglot',
    name: 'PHP 8+ & Python Web Ruble',
    version: '4.0.0',
    author: 'HMW Studio',
    description: 'Snippet PHP 8.3+ strict types, readonly DTO, JSON API endpoint, dan Python FastAPI/CLI.',
    builtIn: true,
    snippets: [
      {
        id: 'snip-php8-api',
        trigger: 'php8api',
        name: 'PHP 8 Strict JSON Endpoint',
        scope: 'php',
        description: 'Endpoint JSON modern PHP 8+ dengan strict_types dan readonly class',
        body: [
          '<?php',
          'declare(strict_types=1);',
          '',
          "header('Content-Type: application/json; charset=utf-8');",
          '',
            'final readonly class ${1:ApiResponse} {',
            '    public function __construct(',
            '        public bool \\$ok,',
            '        public string \\$message,',
            '    ) {}',
            '}',
          '',
          'echo json_encode(new ${1:ApiResponse}(true, "${2:Success}"), JSON_THROW_ON_ERROR);'
        ].join('\n')
      },
      {
        id: 'snip-py-main',
        trigger: 'pymain',
        name: 'Python 3.12+ Typed Entrypoint',
        scope: 'python',
        description: 'Kerangka skrip Python modern dengan type hints',
        body: [
          'from __future__ import annotations',
          '',
          'def main() -> None:',
          '    ${1:print("Hello from HMW Studio!")}',
          '',
          'if __name__ == "__main__":',
          '    main()'
        ].join('\n')
      }
    ],
    commands: [
      {
        id: 'cmd-git-short-status',
        name: 'Git Ringkasan Status Cepat',
        description: 'Menjalankan git status singkat pada proyek aktif',
        commandLine: 'git status -sb',
        shortcut: 'Alt+Shift+G'
      }
    ]
  },
  {
    id: 'ruble-wisanggeni-framework',
    name: 'Wisanggeni Framework Ruble',
    version: '1.0.0',
    author: 'HMW Studio • Wisanggeni',
    description:
      'Template cepat Pola 3 Berkas CRUD Wisanggeni (TTabel _idx.php, TForm _form.php, TQuery _save.php, TUploadFile, TAuth, TMenuBox, dan TModal).',
    builtIn: true,
    snippets: [
      {
        id: 'snip-wis-tabel',
        trigger: 'wis-tabel',
        name: 'Wisanggeni TTabel Index Page (_idx.php)',
        scope: 'php',
        description:
          'Kerangka lengkap halaman daftar tabel dinamis Wisanggeni lengkap dengan Paging, Pencarian, Tombol Input Baru, dan encid().',
        body: [
          'include "base.php";',
          '',
          '\\$page->setJudulHalaman("${1:Judul Halaman}");',
          '\\$tbl = new TTabel("${2:Daftar Data}");',
          '\\$tbl->setJudul(array("No", "${3:Kolom 1}", "${4:Kolom 2}", "Aksi"));',
          '\\$tbl->setPaging(10, "${5:modul}_idx.php?");',
          '\\$tbl->setSearchElement("q", "${5:modul}_idx.php", "Cari data...");',
          '\\$tbl->setStrInputBaru("Tambah ${6:Data}", "${5:modul}_form.php");',
          '',
          '\\$sql = "SELECT * FROM ${7:nama_tabel} WHERE 1=1";',
          'if (getGET("q") != "") {',
          '    \\$sql .= " AND (${8:kolom_cari} LIKE \'%" . sanit(getGET("q")) . "%\')";',
          '}',
          '\\$sql .= " ORDER BY id DESC";',
          '',
          '\\$tbl->loadData(\\$sql);',
          'while (\\$row = \\$tbl->fetch()) {',
          '    \\$id_enc = encid(\\$row["id"]);',
          '    \\$btn_edit = button_link("Edit", "${5:modul}_form.php?id=" . \\$id_enc, "fa fa-edit", "btn-xs btn-warning");',
          '    \\$btn_del = "<a href=\'${5:modul}_save.php?act=del&id=" . \\$id_enc . "\' class=\'btn btn-xs btn-danger\' onclick=\'return confirm(\\"Hapus data ini?\\")\'><i class=\'fa fa-trash\'></i> Hapus</a>";',
          '    \\$tbl->addBaris(array("_NO_URUT_", \\$row["${9:field1}"], \\$row["${10:field2}"], \\$btn_edit . " " . \\$btn_del));',
          '}',
          '',
          '\\$s = "<div class=\'row\'><div class=\'col-xs-12\'>" . \\$tbl->html() . "</div></div>";',
          '\\$page->setContent(\\$s);'
        ].join('\n')
      },
      {
        id: 'snip-wis-form',
        trigger: 'wis-form',
        name: 'Wisanggeni TForm Input/Edit Page (_form.php)',
        scope: 'php',
        description:
          'Kerangka lengkap halaman formulir tambah/ubah data Wisanggeni dengan TForm, setMandatory, dan loadFromSQL.',
        body: [
          'include "base.php";',
          '',
          '\\$id = decid(getGET("id"));',
          '\\$is_edit = (\\$id != "");',
          '',
          '\\$page->setJudulHalaman(\\$is_edit ? "Edit ${1:Data}" : "Tambah ${1:Data}");',
          '\\$form = new TForm("${2:modul}_save.php", "post");',
          '\\$form->setTitle(\\$is_edit ? "Form Edit ${1:Data}" : "Form Input ${1:Data}");',
          '',
          'if (\\$is_edit) {',
          '    \\$form->addElement("", \\$form->hidden("id", encid(\\$id)));',
          '}',
          '',
          '\\$form->addElement("${3:Label Input}", \\$form->textbox("${4:nama_field}", "class=\'form-control\' placeholder=\'Masukkan ${3:Label Input}\'"));',
          '\\$form->setMandatory(array("${4:nama_field}" => "${3:Label Input}"));',
          '',
          'if (\\$is_edit) {',
          '    \\$form->loadFromSQL("SELECT * FROM ${5:nama_tabel} WHERE id = \'" . sanit(\\$id) . "\'");',
          '}',
          '',
          '\\$s = "<div class=\'row\'><div class=\'col-md-8 col-xs-12\'>" . \\$form->html() . "</div></div>";',
          '\\$page->setContent(\\$s);'
        ].join('\n')
      },
      {
        id: 'snip-wis-save',
        trigger: 'wis-save',
        name: 'Wisanggeni TQuery Save/Delete Handler (_save.php)',
        scope: 'php',
        description:
          'Proses backend simpan, update, dan hapus aman menggunakan TQuery->setParam() dan execute().',
        body: [
          'include "base.php";',
          '',
          '\\$query = new TQuery(\\$GLOBALS["db_conn"]->link_id);',
          '',
          'if (getGET("act") == "del") {',
          '    \\$id = decid(getGET("id"));',
          '    \\$query->setParam(array("id" => \\$id));',
          '    \\$query->execute("DELETE FROM ${1:nama_tabel} WHERE id = \'___id___\'");',
          '    header("Location: ${2:modul}_idx.php");',
          '    exit();',
          '}',
          '',
          'if (\\$_SERVER["REQUEST_METHOD"] == "POST") {',
          '    \\$id = decid(getPOST("id"));',
          '    \\$val1 = getPOST("${3:nama_field}");',
          '    if (\\$id != "") {',
          '        \\$query->setParam(array("field1" => \\$val1, "id" => \\$id));',
          '        \\$query->execute("UPDATE ${1:nama_tabel} SET ${3:nama_field} = \'___field1___\' WHERE id = \'___id___\'");',
          '    } else {',
          '        \\$query->setParam(array("field1" => \\$val1));',
          '        \\$query->execute("INSERT INTO ${1:nama_tabel} (${3:nama_field}) VALUES (\'___field1___\')");',
          '    }',
          '    header("Location: ${2:modul}_idx.php");',
          '    exit();',
          '}'
        ].join('\n')
      },
      {
        id: 'snip-wis-upload',
        trigger: 'wis-upload',
        name: 'Wisanggeni TUploadFile Handler',
        scope: 'php',
        description: 'Proses upload berkas aman menggunakan TUploadFile lengkap dengan filter ekstensi & ukuran.',
        body: [
          '\\$upload = new TUploadFile("${1:nama_input_file}", "${2:folder_tujuan}", "${3:nama_file_baru.pdf}");',
          '\\$upload->setAllowedExt(array("pdf", "jpg", "jpeg", "png"));',
          'if (\\$upload->cekFileSize()) {',
          '    \\$upload->upload();',
          '}'
        ].join('\n')
      },
      {
        id: 'snip-wis-auth',
        trigger: 'wis-auth',
        name: 'Wisanggeni TAuth Login Check',
        scope: 'php',
        description: 'Otentikasi login pegawai menggunakan TAuth.',
        body: [
          '\\$auth = new TAuth(\\$username, \\$password);',
          'if (\\$auth->result) {',
          '    \\$_SESSION["_nip"] = \\$auth->result;',
          '    header("Location: index.php");',
          '    exit();',
          '} else {',
          '    \\$error_msg = "NIP atau Password tidak sesuai!";',
          '}'
        ].join('\n')
      },
      {
        id: 'snip-wis-menu',
        trigger: 'wis-menu',
        name: 'Wisanggeni TMenuBox Sidebar',
        scope: 'php',
        description: 'Menu navigasi sidebar AdminLTE menggunakan TMenuBox.',
        body: [
          '\\$menu = new TMenuBox("${1:MENU UTAMA}");',
          '\\$menu->addGroupHeader("${2:Master Data}", "#", "<i class=\'fa fa-database\'></i>");',
          '\\$menu->addGroupItem("${3:Data Pegawai}", "${4:pegawai_idx.php}", "<i class=\'fa fa-circle-o\'></i>");',
          '\\$menu->addItem("${5:Dashboard}", "${6:index.php}", "<i class=\'fa fa-dashboard\'></i>");',
          'echo \\$menu->html();'
        ].join('\n')
      },
      {
        id: 'snip-wis-modal',
        trigger: 'wis-modal',
        name: 'Wisanggeni TModal Bootstrap Dialog',
        scope: 'php',
        description: 'Membuat pop-up dialog modal Bootstrap menggunakan TModal.',
        body: [
          '\\$modal = new TModal("${1:modalDetail}");',
          '\\$modal->setTitle("${2:Judul Modal}");',
          '\\$modal->setSize("modal-lg");',
          '\\$modal->setContent(${3:\\$html_konten});',
          'echo \\$modal->html();'
        ].join('\n')
      },
      {
        id: 'snip-wis-query',
        trigger: 'wis-query',
        name: 'Wisanggeni TQuery Parameterized Loop',
        scope: 'php',
        description: 'Menjalankan SELECT aman dengan TQuery->setParam() dan perulangan fetch().',
        body: [
          '\\$query->setParam(array("${1:id}" => ${2:\\$id}));',
          '\\$query->execute("SELECT * FROM ${3:nama_tabel} WHERE ${1:id} = \'___${1:id}___\'");',
          'while (\\$row = \\$query->fetch()) {',
          '    $0',
          '}'
        ].join('\n')
      }
    ],
    commands: []
  },
  {
    id: 'ruble-laravel-framework',
    name: 'Laravel 11/12 & Blade Ruble',
    version: '1.0.0',
    author: 'HMW Studio • Laravel',
    description:
      'Snippet lengkap Laravel Controller, Eloquent Model, FormRequest, Migration Blueprint, Route Group, Blade Layout/Form, dan perintah Artisan CLI.',
    builtIn: true,
    snippets: [
      {
        id: 'snip-lv-route-group',
        trigger: 'lv-route-group',
        name: 'Laravel Authenticated Route Group',
        scope: 'php',
        description: 'Grup Route Laravel dengan middleware auth, prefix, name, dan resource controller.',
        body: [
          "Route::middleware(['${1:auth}'])->prefix('${2:admin}')->name('${2:admin}.')->group(function () {",
          "    Route::resource('${3:users}', ${4:UserController}::class);",
          '    $0',
          '});'
        ].join('\n')
      },
      {
        id: 'snip-lv-controller',
        trigger: 'lv-controller',
        name: 'Laravel Resource Controller',
        scope: 'php',
        description: 'Kerangka Controller CRUD Laravel modern dengan Eloquent & Form Validation.',
        body: [
          '<?php',
          '',
          'namespace App\\Http\\Controllers;',
          '',
          'use App\\Models\\${1:Post};',
          'use Illuminate\\Http\\RedirectResponse;',
          'use Illuminate\\Http\\Request;',
          'use Illuminate\\View\\View;',
          '',
          'class ${1:Post}Controller extends Controller',
          '{',
          '    public function index(): View',
          '    {',
          '        \\$items = ${1:Post}::latest()->paginate(15);',
          "        return view('${2:posts}.index', compact('items'));",
          '    }',
          '',
          '    public function store(Request \\$request): RedirectResponse',
          '    {',
          '        \\$validated = \\$request->validate([',
          "            '${3:title}' => 'required|string|max:255',",
          '        ]);',
          '',
          '        ${1:Post}::create(\\$validated);',
          '',
          "        return to_route('${2:posts}.index')->with('success', 'Data berhasil disimpan.');",
          '    }',
          '}'
        ].join('\n')
      },
      {
        id: 'snip-lv-model',
        trigger: 'lv-model',
        name: 'Laravel Eloquent Model',
        scope: 'php',
        description: 'Kerangka Eloquent Model lengkap dengan $fillable, casts(), local scope, dan relasi.',
        body: [
          '<?php',
          '',
          'namespace App\\Models;',
          '',
          'use Illuminate\\Database\\Eloquent\\Builder;',
          'use Illuminate\\Database\\Eloquent\\Factories\\HasFactory;',
          'use Illuminate\\Database\\Eloquent\\Model;',
          'use Illuminate\\Database\\Eloquent\\Relations\\BelongsTo;',
          '',
          'class ${1:Post} extends Model',
          '{',
          '    use HasFactory;',
          '',
          '    protected \\$fillable = [',
          "        '${2:title}',",
          "        '${3:user_id}',",
          "        '${4:is_active}',",
          '    ];',
          '',
          '    protected function casts(): array',
          '    {',
          '        return [',
          "            '${4:is_active}' => 'boolean',",
          '        ];',
          '    }',
          '',
          '    public function scopeActive(Builder \\$query): void',
          '    {',
          "        \\$query->where('${4:is_active}', true);",
          '    }',
          '',
          '    public function user(): BelongsTo',
          '    {',
          '        return \\$this->belongsTo(User::class);',
          '    }',
          '}'
        ].join('\n')
      },
      {
        id: 'snip-lv-migration',
        trigger: 'lv-migration',
        name: 'Laravel Schema Migration',
        scope: 'php',
        description: 'Kerangka file Migration anonim Laravel dengan Schema::create & Blueprint.',
        body: [
          '<?php',
          '',
          'use Illuminate\\Database\\Migrations\\Migration;',
          'use Illuminate\\Database\\Schema\\Blueprint;',
          'use Illuminate\\Support\\Facades\\Schema;',
          '',
          'return new class extends Migration',
          '{',
          '    public function up(): void',
          '    {',
          "        Schema::create('${1:posts}', function (Blueprint \\$table) {",
          '            \\$table->id();',
          "            \\$table->foreignId('${2:user_id}')->constrained()->cascadeOnDelete();",
          "            \\$table->string('${3:title}');",
          '            \\$table->timestamps();',
          '        });',
          '    }',
          '',
          '    public function down(): void',
          '    {',
          "        Schema::dropIfExists('${1:posts}');",
          '    }',
          '};'
        ].join('\n')
      },
      {
        id: 'snip-lv-request',
        trigger: 'lv-request',
        name: 'Laravel FormRequest Validation',
        scope: 'php',
        description: 'Class FormRequest Laravel untuk memisahkan validasi & otorisasi.',
        body: [
          '<?php',
          '',
          'namespace App\\Http\\Requests;',
          '',
          'use Illuminate\\Foundation\\Http\\FormRequest;',
          '',
          'class ${1:StorePostRequest} extends FormRequest',
          '{',
          '    public function authorize(): bool',
          '    {',
          '        return true;',
          '    }',
          '',
          '    public function rules(): array',
          '    {',
          '        return [',
          "            '${2:title}' => ['required', 'string', 'max:255'],",
          '            $0',
          '        ];',
          '    }',
          '}'
        ].join('\n')
      },
      {
        id: 'snip-lv-blade-form',
        trigger: 'lv-blade-form',
        name: 'Laravel Blade Form (@csrf + @error)',
        scope: 'php',
        description: 'Template form Blade lengkap dengan @csrf, old(), dan pesan validasi @error.',
        body: [
          '@extends(\'${1:layouts.app}\')',
          '',
          '@section(\'${2:content}\')',
          '<form action="{{ route(\'${3:posts.store}\') }}" method="POST">',
          '    @csrf',
          '    <div class="mb-3">',
          '        <label for="${4:title}">${5:Judul}</label>',
          '        <input type="text" id="${4:title}" name="${4:title}" value="{{ old(\'${4:title}\') }}" required />',
          '        @error(\'${4:title}\')',
          '            <div class="text-danger">{{ \\$message }}</div>',
          '        @enderror',
          '    </div>',
          '    <button type="submit">Simpan</button>',
          '</form>',
          '@endsection'
        ].join('\n')
      }
    ],
    commands: [
      {
        id: 'cmd-artisan-routes',
        name: 'Artisan: Daftar Semua Route',
        description: 'Menampilkan tabel daftar route terdaftar pada proyek Laravel',
        commandLine: 'php artisan route:list'
      },
      {
        id: 'cmd-artisan-migrate-status',
        name: 'Artisan: Cek Status Migrasi Database',
        description: 'Memeriksa status eksekusi migrasi pada proyek Laravel',
        commandLine: 'php artisan migrate:status'
      },
      {
        id: 'cmd-artisan-optimize-clear',
        name: 'Artisan: Bersihkan Seluruh Cache (optimize:clear)',
        description: 'Membersihkan cache route, view Blade, config, dan event Laravel',
        commandLine: 'php artisan optimize:clear'
      }
    ]
  }
];

interface UserRubleStore {
  snippets: RubleSnippet[];
  commands: RubleCommand[];
}

export class RubleManager {
  private readonly userRubleFile: string;

  constructor(storageDir: string) {
    this.userRubleFile = join(resolve(storageDir), 'user-rubles.json');
  }

  private async readUserStore(): Promise<UserRubleStore> {
    if (!existsSync(this.userRubleFile)) {
      return { snippets: [], commands: [] };
    }
    try {
      const raw = await readFile(this.userRubleFile, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<UserRubleStore>;
      return {
        snippets: Array.isArray(parsed.snippets) ? parsed.snippets : [],
        commands: Array.isArray(parsed.commands) ? parsed.commands : []
      };
    } catch {
      return { snippets: [], commands: [] };
    }
  }

  private async writeUserStore(data: UserRubleStore): Promise<void> {
    const dir = resolve(this.userRubleFile, '..');
    await mkdir(dir, { recursive: true });
    await writeFile(this.userRubleFile, JSON.stringify(data, null, 2), 'utf-8');
  }

  async list(): Promise<RubleBundle[]> {
    const userStore = await this.readUserStore();
    const customBundle: RubleBundle = {
      id: 'ruble-user-custom',
      name: 'User Custom Rubles',
      version: '1.0.0',
      author: 'Local Developer',
      description: 'Kumpulan snippet dan perintah otomatisasi kustom milik Anda.',
      builtIn: false,
      snippets: userStore.snippets,
      commands: userStore.commands
    };
    return [...BUILTIN_RUBLES, customBundle];
  }

  async saveSnippet(
    input: Omit<RubleSnippet, 'id'> & { id?: string }
  ): Promise<RubleBundle[]> {
    const store = await this.readUserStore();
    const id = input.id?.trim() || `usr-snip-${Date.now()}`;
    const record: RubleSnippet = {
      id,
      trigger: input.trigger.trim(),
      name: input.name.trim(),
      scope: input.scope,
      description: input.description.trim(),
      body: input.body
    };

    const idx = store.snippets.findIndex((s) => s.id === id);
    if (idx >= 0) {
      store.snippets[idx] = record;
    } else {
      store.snippets.push(record);
    }
    await this.writeUserStore(store);
    return this.list();
  }

  async deleteSnippet(snippetId: string): Promise<RubleBundle[]> {
    const store = await this.readUserStore();
    store.snippets = store.snippets.filter((s) => s.id !== snippetId);
    await this.writeUserStore(store);
    return this.list();
  }

  async saveCommand(
    input: Omit<RubleCommand, 'id'> & { id?: string }
  ): Promise<RubleBundle[]> {
    const store = await this.readUserStore();
    const id = input.id?.trim() || `usr-cmd-${Date.now()}`;
    const record: RubleCommand = {
      id,
      name: input.name.trim(),
      description: input.description.trim(),
      commandLine: input.commandLine.trim(),
      shortcut: input.shortcut?.trim() || undefined
    };

    const idx = store.commands.findIndex((c) => c.id === id);
    if (idx >= 0) {
      store.commands[idx] = record;
    } else {
      store.commands.push(record);
    }
    await this.writeUserStore(store);
    return this.list();
  }

  async deleteCommand(commandId: string): Promise<RubleBundle[]> {
    const store = await this.readUserStore();
    store.commands = store.commands.filter((c) => c.id !== commandId);
    await this.writeUserStore(store);
    return this.list();
  }
}
