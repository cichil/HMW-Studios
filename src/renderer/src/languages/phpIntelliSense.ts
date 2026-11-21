import * as monaco from 'monaco-editor';
import type {
  DbSchemaSnapshot,
  DbTableMeta,
  LaravelBladeDirectiveMeta,
  LaravelCatalog,
  LaravelConfigEntry,
  LaravelRouteEntry,
  LaravelValidationRuleMeta,
  LaravelViewEntry,
  PhpClassMemberMeta,
  PhpClassMeta,
  PhpFunctionMeta,
  PhpParamMeta,
  PhpRuntimeCatalog,
  PhpWorkspaceSymbols,
  WisanggeniCatalog
} from '@shared/types';
import {
  SYSTEM_DB_NAMES_LOWER,
  detectPhpSqlContext,
  detectPhpSqlSecurityRisks,
  extractFallbackSqlEntities,
  extractPhpEmbeddedSqlStatements,
  extractReferencedSqlTables,
  extractSqlFileStatements,
  validateSqlAgainstSchema,
  type DetectedPhpSqlContext,
  type SqlQuickFixOption,
  type SqlTemplateParam
} from '@shared/sqlSchemaAnalyzer';
import { analyzePhpVariableIssues } from '@shared/phpVariableAnalyzer';
import {
  detectAmbiguousJoinDiagnosticsInSource,
  learnJoinEdgesFromSources,
  suggestJoinCandidatesForQuery,
  suggestOnConditionsForLastJoin,
  type LearnedJoinEdge
} from '@shared/sqlJoinHelper';
import { detectWebSubContext } from '@shared/webAssetAnalyzer';

export type PhpNavigationTarget =
  | { kind: 'same-file'; line: number; label: string }
  | { kind: 'include-rel'; rawTarget: string }
  | {
      kind: 'laravel-view';
      viewName: string;
      filePath?: string;
      relativePath: string;
    }
  | {
      kind: 'laravel-route';
      routeName: string;
      relativePath?: string;
      line?: number;
    }
  | {
      kind: 'symbol';
      symbolName: string;
      filePath?: string;
      relativePath?: string;
      line?: number;
      origin?: string;
    };

export interface OpenPhpBufferInfo {
  uriOrPath: string;
  title: string;
  content: string;
}

export interface SqlCodeLensDispatchPayload {
  mode: 'run' | 'explain' | 'structure';
  sqlTemplate: string;
  params: SqlTemplateParam[];
  primaryTable?: { schema?: string; table: string } | null;
}

let onSqlCodeLensDispatch: ((payload: SqlCodeLensDispatchPayload) => void) | null = null;

export function setSqlCodeLensActionHandler(
  handler: ((payload: SqlCodeLensDispatchPayload) => void) | null
): void {
  onSqlCodeLensDispatch = handler;
}

interface StoredModelQuickFix {
  line: number;
  startColumn: number;
  endColumn: number;
  message: string;
  quickFixes: SqlQuickFixOption[];
}

const modelQuickFixesMap = new WeakMap<monaco.editor.ITextModel, StoredModelQuickFix[]>();

export function applySqlAndSecurityDiagnosticsToModel(
  model: monaco.editor.ITextModel | null | undefined,
  lang: 'php' | 'sql'
): void {
  if (!model || model.isDisposed()) return;
  const code = model.getValue();
  const maxLine = model.getLineCount();

  const schemaDiags = validateSqlAgainstSchema(
    code,
    lang,
    indexedDbCatalog?.snapshot ?? null
  );
  const ambiguousJoinDiags =
    indexedDbCatalog && indexedDbCatalog.allTables.length > 0
      ? detectAmbiguousJoinDiagnosticsInSource(
          code,
          lang,
          indexedDbCatalog.allTables,
          indexedDbCatalog.snapshot.currentDatabase
        )
      : [];
  const mergedSqlDiags = [...schemaDiags, ...ambiguousJoinDiags];
  const securityDiags = lang === 'php' ? detectPhpSqlSecurityRisks(code) : [];

  const quickFixRecords: StoredModelQuickFix[] = [];

  const schemaMarkers: monaco.editor.IMarkerData[] = mergedSqlDiags
    .filter((d) => d.line >= 1 && d.line <= maxLine)
    .map((d) => {
      const lineMax = model.getLineMaxColumn(d.line);
      const startColumn = Math.max(1, Math.min(d.startColumn, lineMax));
      const endColumn = Math.max(startColumn + 1, Math.min(d.endColumn, lineMax));
      if (d.quickFixes.length > 0) {
        quickFixRecords.push({
          line: d.line,
          startColumn,
          endColumn,
          message: d.message,
          quickFixes: d.quickFixes
        });
      }
      return {
        severity: monaco.MarkerSeverity.Warning,
        source: 'HMW SQL Schema',
        message: d.message,
        startLineNumber: d.line,
        startColumn,
        endLineNumber: d.line,
        endColumn
      };
    });

  const securityMarkers: monaco.editor.IMarkerData[] = securityDiags
    .filter((w) => w.line >= 1 && w.line <= maxLine)
    .map((w) => {
      const lineMax = model.getLineMaxColumn(w.line);
      const startColumn = Math.max(1, Math.min(w.startColumn, lineMax));
      const endColumn = Math.max(startColumn + 1, Math.min(w.endColumn, lineMax));
      if (w.quickFixes.length > 0) {
        quickFixRecords.push({
          line: w.line,
          startColumn,
          endColumn,
          message: w.message,
          quickFixes: w.quickFixes
        });
      }
      return {
        severity: monaco.MarkerSeverity.Warning,
        source: 'HMW Security',
        message: w.message,
        startLineNumber: w.line,
        startColumn,
        endLineNumber: w.line,
        endColumn
      };
    });

  const isBlade = model.uri.path.toLowerCase().endsWith('.blade.php');
  const phpVarDiags = lang === 'php' && !isBlade ? analyzePhpVariableIssues(code) : [];
  const phpVarMarkers: monaco.editor.IMarkerData[] = phpVarDiags
    .filter((v) => v.line >= 1 && v.line <= maxLine)
    .map((v) => {
      const lineMax = model.getLineMaxColumn(v.line);
      const startColumn = Math.max(1, Math.min(v.startColumn, lineMax));
      const endColumn = Math.max(startColumn + 1, Math.min(v.endColumn, lineMax));
      if (v.quickFixes.length > 0) {
        quickFixRecords.push({
          line: v.line,
          startColumn,
          endColumn,
          message: v.message,
          quickFixes: v.quickFixes
        });
      }
      return {
        severity: monaco.MarkerSeverity.Warning,
        source: 'HMW PHP Variable',
        message: v.message,
        startLineNumber: v.line,
        startColumn,
        endLineNumber: v.line,
        endColumn
      };
    });

  modelQuickFixesMap.set(model, quickFixRecords);
  monaco.editor.setModelMarkers(model, 'hmw-sql-schema', schemaMarkers);
  monaco.editor.setModelMarkers(
    model,
    'hmw-sql-security',
    lang === 'php' ? securityMarkers : []
  );
  monaco.editor.setModelMarkers(model, 'hmw-php-vars', phpVarMarkers);
}

const SUPERGLOBALS: Array<{ name: string; type: string; doc: string }> = [
  {
    name: '$_POST',
    type: 'array<string, mixed>',
    doc: 'Data HTTP POST yang dikirim dari form HTML (`method="post"`) atau request body.'
  },
  {
    name: '$_GET',
    type: 'array<string, mixed>',
    doc: 'Parameter query string URL (contoh: `?id=10&aksi=edit`).'
  },
  {
    name: '$_SESSION',
    type: 'array<string, mixed>',
    doc: 'Variabel sesi pengguna aktif di server (pastikan `session_start()` telah dipanggil).'
  },
  {
    name: '$_SERVER',
    type: 'array<string, mixed>',
    doc: 'Informasi lingkungan server HTTP, header request, path script, dan alamat IP klien.'
  },
  {
    name: '$_FILES',
    type: 'array<string, array>',
    doc: 'Informasi file yang diunggah melalui form `enctype="multipart/form-data"`.'
  },
  {
    name: '$_COOKIE',
    type: 'array<string, string>',
    doc: 'Data HTTP Cookie yang dikirim oleh browser klien.'
  },
  {
    name: '$_REQUEST',
    type: 'array<string, mixed>',
    doc: 'Gabungan variabel input HTTP (`$_GET`, `$_POST`, dan `$_COOKIE`).'
  },
  {
    name: '$_ENV',
    type: 'array<string, string>',
    doc: 'Variabel environment sistem operasi / konfigurasi server.'
  },
  {
    name: '$GLOBALS',
    type: 'array<string, mixed>',
    doc: 'Referensi ke seluruh variabel yang didefinisikan pada cakupan global script PHP.'
  },
  {
    name: '$this',
    type: 'static',
    doc: 'Referensi ke instance objek class saat ini.'
  }
];

const SERVER_ARRAY_KEYS = [
  'REQUEST_METHOD',
  'REQUEST_URI',
  'QUERY_STRING',
  'HTTP_HOST',
  'SERVER_NAME',
  'SERVER_PORT',
  'REMOTE_ADDR',
  'HTTP_USER_AGENT',
  'HTTP_REFERER',
  'HTTP_AUTHORIZATION',
  'HTTP_X_REQUESTED_WITH',
  'CONTENT_TYPE',
  'DOCUMENT_ROOT',
  'SCRIPT_FILENAME',
  'SCRIPT_NAME',
  'PHP_SELF',
  'HTTPS',
  'REQUEST_TIME'
];

const FILES_SUBKEYS = ['name', 'type', 'tmp_name', 'error', 'size', 'full_path'];

const PHP_KEYWORDS = [
  'echo',
  'print',
  'return',
  'if',
  'elseif',
  'else',
  'endif',
  'switch',
  'case',
  'default',
  'match',
  'for',
  'foreach',
  'as',
  'endforeach',
  'while',
  'do',
  'break',
  'continue',
  'function',
  'fn',
  'class',
  'interface',
  'trait',
  'enum',
  'extends',
  'implements',
  'public',
  'protected',
  'private',
  'static',
  'readonly',
  'final',
  'abstract',
  'const',
  'new',
  'clone',
  'instanceof',
  'try',
  'catch',
  'finally',
  'throw',
  'include',
  'include_once',
  'require',
  'require_once',
  'namespace',
  'use',
  'global',
  'isset',
  'empty',
  'unset',
  'die',
  'exit',
  'true',
  'false',
  'null',
  'array',
  'string',
  'int',
  'float',
  'bool',
  'mixed',
  'void'
];

interface PhpCodeSnippet {
  trigger: string;
  label: string;
  detail: string;
  body: string;
  doc: string;
}

const PHP_SNIPPETS: PhpCodeSnippet[] = [
  {
    trigger: 'foreach',
    label: 'foreach ($items as $row)',
    detail: 'Perulangan foreach PHP',
    body: 'foreach (${1:\\$items} as ${2:\\$row}) {\n\t$0\n}',
    doc: 'Iterasi setiap elemen array atau koleksi.'
  },
  {
    trigger: 'forek',
    label: 'foreach ($items as $key => $val)',
    detail: 'Perulangan foreach key => value',
    body: 'foreach (${1:\\$items} as ${2:\\$key} => ${3:\\$val}) {\n\t$0\n}',
    doc: 'Iterasi pasangan kunci dan nilai pada associative array.'
  },
  {
    trigger: 'ifelse',
    label: 'if (...) { ... } else { ... }',
    detail: 'Blok percabangan if / else',
    body: 'if (${1:\\$kondisi}) {\n\t$2\n} else {\n\t$0\n}',
    doc: 'Percabangan kondisi if-else.'
  },
  {
    trigger: 'trycatch',
    label: 'try { ... } catch (Throwable $e)',
    detail: 'Penanganan error try / catch',
    body: 'try {\n\t$1\n} catch (\\Throwable ${2:\\$e}) {\n\t${0:error_log(\\$e->getMessage());}\n}',
    doc: 'Menangkap exception dan error runtime PHP 8.'
  },
  {
    trigger: 'mysqli_select',
    label: 'mysqli prepared SELECT query',
    detail: 'Template query SELECT aman dengan MySQLi Prepared Statement',
    body:
      '\\$stmt = ${1:\\$conn}->prepare("${2:SELECT * FROM tabel WHERE id = ?}");\n\\$stmt->bind_param("${3:i}", ${4:\\$id});\n\\$stmt->execute();\n\\$result = \\$stmt->get_result();\nwhile (\\$row = \\$result->fetch_assoc()) {\n\t$0\n}',
    doc: 'Menjalankan query SELECT MySQLi menggunakan prepared statement anti SQL Injection.'
  },
  {
    trigger: 'pdo_select',
    label: 'PDO prepared SELECT query',
    detail: 'Template query SELECT aman dengan PDO',
    body:
      '\\$stmt = ${1:\\$pdo}->prepare("${2:SELECT * FROM tabel WHERE id = :id}");\n\\$stmt->execute([\'${3:id}\' => ${4:\\$id}]);\n\\$rows = \\$stmt->fetchAll(PDO::FETCH_ASSOC);\n$0',
    doc: 'Menjalankan query SELECT menggunakan PDO prepared statement.'
  },
  {
    trigger: 'json_res',
    label: 'JSON API Response Header + Echo',
    detail: 'Kirim respons HTTP JSON UTF-8',
    body:
      "header('Content-Type: application/json; charset=utf-8');\nhttp_response_code(${1:200});\necho json_encode([\n\t'status' => ${2:true},\n\t'message' => '${3:Berhasil}',\n\t'data' => ${4:\\$data}\n], JSON_UNESCAPED_UNICODE);\nexit;",
    doc: 'Mengirimkan respons JSON standar untuk endpoint API / AJAX.'
  },
  {
    trigger: 'func',
    label: 'function namaFungsi(...): mixed',
    detail: 'Deklarasi fungsi PHP',
    body: 'function ${1:namaFungsi}(${2:\\$param}): ${3:mixed}\n{\n\t$0\n}',
    doc: 'Membuat fungsi baru lengkap dengan tipe kembalian.'
  },
  {
    trigger: 'class',
    label: 'class NamaClass { ... }',
    detail: 'Deklarasi class PHP 8',
    body:
      'class ${1:NamaClass}\n{\n\tpublic function __construct(${2})\n\t{\n\t\t$0\n\t}\n}',
    doc: 'Membuat class PHP lengkap dengan constructor.'
  }
];

// Katalog bawaan terkurasi (selalu tersedia instan + memperkaya deskripsi Bahasa Indonesia)
const CURATED_FUNCTIONS: PhpFunctionMeta[] = [
  {
    name: 'isset',
    params: [{ name: '$var', type: 'mixed' }, { name: '...$vars', type: 'mixed', optional: true }],
    returnType: 'bool',
    doc: 'Memeriksa apakah variabel telah didefinisikan dan nilainya bukan `null`.'
  },
  {
    name: 'empty',
    params: [{ name: '$var', type: 'mixed' }],
    returnType: 'bool',
    doc: 'Memeriksa apakah variabel kosong (`""`, `0`, `null`, `false`, atau `[]`).'
  },
  {
    name: 'unset',
    params: [{ name: '$var', type: 'mixed' }],
    returnType: 'void',
    doc: 'Menghapus variabel atau elemen array dari memori.'
  },
  {
    name: 'count',
    params: [{ name: '$value', type: 'Countable|array' }],
    returnType: 'int',
    doc: 'Menghitung jumlah elemen di dalam array atau objek Countable.'
  },
  {
    name: 'in_array',
    params: [
      { name: '$needle', type: 'mixed' },
      { name: '$haystack', type: 'array' },
      { name: '$strict', type: 'bool', optional: true, defaultValue: 'false' }
    ],
    returnType: 'bool',
    doc: 'Memeriksa apakah suatu nilai terdapat di dalam array.'
  },
  {
    name: 'array_key_exists',
    params: [
      { name: '$key', type: 'string|int' },
      { name: '$array', type: 'array' }
    ],
    returnType: 'bool',
    doc: 'Memeriksa apakah kunci/indeks tertentu ada di dalam array.'
  },
  {
    name: 'array_merge',
    params: [{ name: '...$arrays', type: 'array' }],
    returnType: 'array',
    doc: 'Menggabungkan satu atau lebih array menjadi satu array baru.'
  },
  {
    name: 'array_map',
    params: [
      { name: '$callback', type: '?callable' },
      { name: '$array', type: 'array' }
    ],
    returnType: 'array',
    doc: 'Menerapkan fungsi callback ke setiap elemen array.'
  },
  {
    name: 'array_filter',
    params: [
      { name: '$array', type: 'array' },
      { name: '$callback', type: '?callable', optional: true }
    ],
    returnType: 'array',
    doc: 'Menyaring elemen array menggunakan fungsi callback.'
  },
  {
    name: 'array_column',
    params: [
      { name: '$array', type: 'array' },
      { name: '$column_key', type: 'int|string|null' },
      { name: '$index_key', type: 'int|string|null', optional: true }
    ],
    returnType: 'array',
    doc: 'Mengambil nilai dari satu kolom tunggal pada array multidimensi / hasil query.'
  },
  {
    name: 'explode',
    params: [
      { name: '$separator', type: 'string' },
      { name: '$string', type: 'string' },
      { name: '$limit', type: 'int', optional: true }
    ],
    returnType: 'array',
    doc: 'Memecah string menjadi array berdasarkan pemisah (`$separator`).'
  },
  {
    name: 'implode',
    params: [
      { name: '$separator', type: 'string' },
      { name: '$array', type: 'array' }
    ],
    returnType: 'string',
    doc: 'Menggabungkan elemen-elemen array menjadi satu string dengan pemisah.'
  },
  {
    name: 'str_replace',
    params: [
      { name: '$search', type: 'array|string' },
      { name: '$replace', type: 'array|string' },
      { name: '$subject', type: 'array|string' }
    ],
    returnType: 'string|array',
    doc: 'Mengganti semua kemunculan teks pencarian dengan teks pengganti.'
  },
  {
    name: 'str_contains',
    params: [
      { name: '$haystack', type: 'string' },
      { name: '$needle', type: 'string' }
    ],
    returnType: 'bool',
    doc: 'Memeriksa apakah sebuah string mengandung substring tertentu (PHP 8+).'
  },
  {
    name: 'str_starts_with',
    params: [
      { name: '$haystack', type: 'string' },
      { name: '$needle', type: 'string' }
    ],
    returnType: 'bool',
    doc: 'Memeriksa apakah string diawali dengan awalan tertentu (PHP 8+).'
  },
  {
    name: 'str_ends_with',
    params: [
      { name: '$haystack', type: 'string' },
      { name: '$needle', type: 'string' }
    ],
    returnType: 'bool',
    doc: 'Memeriksa apakah string diakhiri dengan akhiran tertentu (PHP 8+).'
  },
  {
    name: 'substr',
    params: [
      { name: '$string', type: 'string' },
      { name: '$offset', type: 'int' },
      { name: '$length', type: '?int', optional: true }
    ],
    returnType: 'string',
    doc: 'Mengambil potongan bagian dari sebuah string.'
  },
  {
    name: 'trim',
    params: [
      { name: '$string', type: 'string' },
      { name: '$characters', type: 'string', optional: true }
    ],
    returnType: 'string',
    doc: 'Menghapus spasi atau karakter kosong di awal dan akhir string.'
  },
  {
    name: 'strtolower',
    params: [{ name: '$string', type: 'string' }],
    returnType: 'string',
    doc: 'Mengubah seluruh huruf dalam string menjadi huruf kecil.'
  },
  {
    name: 'strtoupper',
    params: [{ name: '$string', type: 'string' }],
    returnType: 'string',
    doc: 'Mengubah seluruh huruf dalam string menjadi huruf kapital.'
  },
  {
    name: 'number_format',
    params: [
      { name: '$num', type: 'float' },
      { name: '$decimals', type: 'int', optional: true, defaultValue: '0' },
      { name: '$decimal_separator', type: '?string', optional: true, defaultValue: '"."' },
      { name: '$thousands_separator', type: '?string', optional: true, defaultValue: '","' }
    ],
    returnType: 'string',
    doc: 'Memformat angka dengan pemisah ribuan dan jumlah desimal (contoh format Rupiah).'
  },
  {
    name: 'htmlspecialchars',
    params: [
      { name: '$string', type: 'string' },
      { name: '$flags', type: 'int', optional: true },
      { name: '$encoding', type: '?string', optional: true }
    ],
    returnType: 'string',
    doc: 'Mengonversi karakter khusus menjadi entitas HTML untuk mencegah celah XSS.'
  },
  {
    name: 'sprintf',
    params: [
      { name: '$format', type: 'string' },
      { name: '...$values', type: 'mixed', optional: true }
    ],
    returnType: 'string',
    doc: 'Menghasilkan string terformat berdasarkan template format.'
  },
  {
    name: 'preg_match',
    params: [
      { name: '$pattern', type: 'string' },
      { name: '$subject', type: 'string' },
      { name: '$matches', type: 'array', optional: true }
    ],
    returnType: 'int|false',
    doc: 'Mencocokkan string terhadap pola Regular Expression (PCRE).'
  },
  {
    name: 'preg_replace',
    params: [
      { name: '$pattern', type: 'string|array' },
      { name: '$replacement', type: 'string|array' },
      { name: '$subject', type: 'string|array' }
    ],
    returnType: 'string|array|null',
    doc: 'Mencari dan mengganti teks menggunakan Regular Expression.'
  },
  {
    name: 'json_encode',
    params: [
      { name: '$value', type: 'mixed' },
      { name: '$flags', type: 'int', optional: true, defaultValue: '0' }
    ],
    returnType: 'string|false',
    doc: 'Mengubah array atau objek PHP menjadi representasi string JSON.'
  },
  {
    name: 'json_decode',
    params: [
      { name: '$json', type: 'string' },
      { name: '$associative', type: '?bool', optional: true, defaultValue: 'true' }
    ],
    returnType: 'mixed',
    doc: 'Menguraikan string JSON menjadi array asosiatif atau objek PHP.'
  },
  {
    name: 'date',
    params: [
      { name: '$format', type: 'string' },
      { name: '$timestamp', type: '?int', optional: true }
    ],
    returnType: 'string',
    doc: 'Memformat tanggal/waktu lokal (contoh: `date("Y-m-d H:i:s")`).'
  },
  {
    name: 'strtotime',
    params: [
      { name: '$datetime', type: 'string' },
      { name: '$baseTimestamp', type: '?int', optional: true }
    ],
    returnType: 'int|false',
    doc: 'Mengubah deskripsi tanggal teks menjadi Unix timestamp.'
  },
  {
    name: 'header',
    params: [
      { name: '$header', type: 'string' },
      { name: '$replace', type: 'bool', optional: true, defaultValue: 'true' },
      { name: '$response_code', type: 'int', optional: true }
    ],
    returnType: 'void',
    doc: 'Mengirimkan HTTP header mentah (seperti redirect `Location:` atau `Content-Type:`).'
  },
  {
    name: 'session_start',
    params: [{ name: '$options', type: 'array', optional: true }],
    returnType: 'bool',
    doc: 'Memulai sesi baru atau melanjutkan sesi pengguna yang sudah ada.'
  },
  {
    name: 'password_hash',
    params: [
      { name: '$password', type: 'string' },
      { name: '$algo', type: 'string|int|null', defaultValue: 'PASSWORD_DEFAULT' }
    ],
    returnType: 'string',
    doc: 'Membuat hash password aman menggunakan algoritma Bcrypt / Argon2.'
  },
  {
    name: 'password_verify',
    params: [
      { name: '$password', type: 'string' },
      { name: '$hash', type: 'string' }
    ],
    returnType: 'bool',
    doc: 'Memverifikasi apakah password cocok dengan hash dari `password_hash()`.'
  },
  {
    name: 'file_get_contents',
    params: [{ name: '$filename', type: 'string' }],
    returnType: 'string|false',
    doc: 'Membaca seluruh isi file atau URL ke dalam sebuah string.'
  },
  {
    name: 'file_put_contents',
    params: [
      { name: '$filename', type: 'string' },
      { name: '$data', type: 'mixed' },
      { name: '$flags', type: 'int', optional: true }
    ],
    returnType: 'int|false',
    doc: 'Menulis data langsung ke sebuah file.'
  },
  {
    name: 'file_exists',
    params: [{ name: '$filename', type: 'string' }],
    returnType: 'bool',
    doc: 'Memeriksa apakah suatu file atau direktori ada.'
  },
  {
    name: 'move_uploaded_file',
    params: [
      { name: '$from', type: 'string' },
      { name: '$to', type: 'string' }
    ],
    returnType: 'bool',
    doc: 'Memindahkan file hasil unggahan (`$_FILES[...][\'tmp_name\']`) ke lokasi tujuan.'
  },
  {
    name: 'mysqli_connect',
    params: [
      { name: '$hostname', type: '?string', optional: true },
      { name: '$username', type: '?string', optional: true },
      { name: '$password', type: '?string', optional: true },
      { name: '$database', type: '?string', optional: true },
      { name: '$port', type: '?int', optional: true }
    ],
    returnType: 'mysqli|false',
    doc: 'Membuka koneksi baru ke server database MySQL / MariaDB.'
  },
  {
    name: 'mysqli_query',
    params: [
      { name: '$mysql', type: 'mysqli' },
      { name: '$query', type: 'string' }
    ],
    returnType: 'mysqli_result|bool',
    doc: 'Menjalankan query SQL pada database MySQL / MariaDB.'
  },
  {
    name: 'mysqli_fetch_assoc',
    params: [{ name: '$result', type: 'mysqli_result' }],
    returnType: 'array|null|false',
    doc: 'Mengambil satu baris hasil query sebagai associative array.'
  },
  {
    name: 'mysqli_fetch_array',
    params: [
      { name: '$result', type: 'mysqli_result' },
      { name: '$mode', type: 'int', optional: true, defaultValue: 'MYSQLI_BOTH' }
    ],
    returnType: 'array|null|false',
    doc: 'Mengambil baris hasil query sebagai associative array, numerik, atau keduanya.'
  },
  {
    name: 'mysqli_num_rows',
    params: [{ name: '$result', type: 'mysqli_result' }],
    returnType: 'int|string',
    doc: 'Mengembalikan jumlah baris dalam himpunan hasil `mysqli_result`.'
  },
  {
    name: 'mysqli_real_escape_string',
    params: [
      { name: '$mysql', type: 'mysqli' },
      { name: '$string', type: 'string' }
    ],
    returnType: 'string',
    doc: 'Melakukan escape karakter khusus pada string untuk digunakan dalam pernyataan SQL.'
  },
  {
    name: 'mysqli_insert_id',
    params: [{ name: '$mysql', type: 'mysqli' }],
    returnType: 'int|string',
    doc: 'Mengembalikan nilai AUTO_INCREMENT terakhir yang dihasilkan oleh query INSERT.'
  },
  {
    name: 'mysqli_error',
    params: [{ name: '$mysql', type: 'mysqli' }],
    returnType: 'string',
    doc: 'Mengembalikan pesan kesalahan dari operasi MySQL terakhir.'
  },
  {
    name: 'var_dump',
    params: [{ name: '$value', type: 'mixed' }, { name: '...$values', type: 'mixed', optional: true }],
    returnType: 'void',
    doc: 'Mencetak informasi tipe dan nilai detail dari suatu ekspresi untuk debugging.'
  },
  {
    name: 'print_r',
    params: [
      { name: '$value', type: 'mixed' },
      { name: '$return', type: 'bool', optional: true, defaultValue: 'false' }
    ],
    returnType: 'string|bool',
    doc: 'Mencetak isi variabel / array dalam format yang mudah dibaca manusia.'
  }
];

const CURATED_CLASSES: PhpClassMeta[] = [
  {
    name: 'mysqli',
    members: [
      {
        name: 'query',
        kind: 'method',
        params: [{ name: '$query', type: 'string' }],
        type: 'mysqli_result|bool',
        doc: 'Menjalankan query SQL dan mengembalikan objek `mysqli_result` untuk query SELECT.'
      },
      {
        name: 'prepare',
        kind: 'method',
        params: [{ name: '$query', type: 'string' }],
        type: 'mysqli_stmt|false',
        doc: 'Menyiapkan pernyataan SQL prepared statement.'
      },
      {
        name: 'real_escape_string',
        kind: 'method',
        params: [{ name: '$string', type: 'string' }],
        type: 'string',
        doc: 'Melakukan escape string sebelum dimasukkan ke dalam SQL.'
      },
      { name: 'begin_transaction', kind: 'method', params: [], type: 'bool' },
      { name: 'commit', kind: 'method', params: [], type: 'bool' },
      { name: 'rollback', kind: 'method', params: [], type: 'bool' },
      {
        name: 'set_charset',
        kind: 'method',
        params: [{ name: '$charset', type: 'string' }],
        type: 'bool'
      },
      { name: 'close', kind: 'method', params: [], type: 'true' },
      { name: 'insert_id', kind: 'property', type: 'int|string', doc: 'ID terakhir hasil INSERT.' },
      { name: 'affected_rows', kind: 'property', type: 'int|string', doc: 'Jumlah baris terdampak.' },
      { name: 'connect_error', kind: 'property', type: '?string', doc: 'Pesan gagal koneksi.' },
      { name: 'error', kind: 'property', type: 'string', doc: 'Pesan error SQL terakhir.' }
    ]
  },
  {
    name: 'mysqli_result',
    members: [
      {
        name: 'num_rows',
        kind: 'property',
        type: 'int|string',
        doc: 'Jumlah baris hasil query SELECT (contoh: `if ($res->num_rows < 1)`).'
      },
      {
        name: 'fetch_assoc',
        kind: 'method',
        params: [],
        type: 'array|null|false',
        doc: 'Mengambil baris berikutnya sebagai associative array (`$row["kolom"]`).'
      },
      {
        name: 'fetch_array',
        kind: 'method',
        params: [{ name: '$mode', type: 'int', optional: true }],
        type: 'array|null|false'
      },
      {
        name: 'fetch_object',
        kind: 'method',
        params: [],
        type: 'object|null|false'
      },
      {
        name: 'fetch_all',
        kind: 'method',
        params: [{ name: '$mode', type: 'int', optional: true }],
        type: 'array'
      },
      { name: 'free', kind: 'method', params: [], type: 'void' }
    ]
  },
  {
    name: 'mysqli_stmt',
    members: [
      {
        name: 'bind_param',
        kind: 'method',
        params: [
          { name: '$types', type: 'string' },
          { name: '...$vars', type: 'mixed' }
        ],
        type: 'bool',
        doc: 'Mengikat variabel ke parameter `?` (tipe: `i`=int, `s`=string, `d`=double, `b`=blob).'
      },
      { name: 'execute', kind: 'method', params: [], type: 'bool' },
      { name: 'get_result', kind: 'method', params: [], type: 'mysqli_result|false' },
      { name: 'close', kind: 'method', params: [], type: 'true' },
      { name: 'affected_rows', kind: 'property', type: 'int|string' },
      { name: 'insert_id', kind: 'property', type: 'int|string' }
    ]
  },
  {
    name: 'PDO',
    members: [
      { name: 'FETCH_ASSOC', kind: 'constant', isStatic: true },
      { name: 'FETCH_OBJ', kind: 'constant', isStatic: true },
      { name: 'FETCH_BOTH', kind: 'constant', isStatic: true },
      { name: 'ERRMODE_EXCEPTION', kind: 'constant', isStatic: true },
      { name: 'ATTR_ERRMODE', kind: 'constant', isStatic: true },
      { name: 'ATTR_DEFAULT_FETCH_MODE', kind: 'constant', isStatic: true },
      { name: 'PARAM_INT', kind: 'constant', isStatic: true },
      { name: 'PARAM_STR', kind: 'constant', isStatic: true },
      {
        name: 'prepare',
        kind: 'method',
        params: [{ name: '$query', type: 'string' }],
        type: 'PDOStatement|false'
      },
      {
        name: 'query',
        kind: 'method',
        params: [{ name: '$query', type: 'string' }],
        type: 'PDOStatement|false'
      },
      {
        name: 'exec',
        kind: 'method',
        params: [{ name: '$statement', type: 'string' }],
        type: 'int|false'
      },
      { name: 'lastInsertId', kind: 'method', params: [], type: 'string|false' },
      { name: 'beginTransaction', kind: 'method', params: [], type: 'bool' },
      { name: 'commit', kind: 'method', params: [], type: 'bool' },
      { name: 'rollBack', kind: 'method', params: [], type: 'bool' }
    ]
  },
  {
    name: 'PDOStatement',
    members: [
      {
        name: 'execute',
        kind: 'method',
        params: [{ name: '$params', type: '?array', optional: true }],
        type: 'bool'
      },
      {
        name: 'fetch',
        kind: 'method',
        params: [{ name: '$mode', type: 'int', optional: true }],
        type: 'mixed'
      },
      {
        name: 'fetchAll',
        kind: 'method',
        params: [{ name: '$mode', type: 'int', optional: true }],
        type: 'array'
      },
      { name: 'fetchColumn', kind: 'method', params: [], type: 'mixed' },
      { name: 'rowCount', kind: 'method', params: [], type: 'int' },
      {
        name: 'bindValue',
        kind: 'method',
        params: [
          { name: '$param', type: 'int|string' },
          { name: '$value', type: 'mixed' },
          { name: '$type', type: 'int', optional: true }
        ],
        type: 'bool'
      }
    ]
  }
];

const DEFAULT_CONSTANTS = [
  'PHP_VERSION',
  'PHP_EOL',
  'DIRECTORY_SEPARATOR',
  'MYSQLI_ASSOC',
  'MYSQLI_NUM',
  'MYSQLI_BOTH',
  'JSON_PRETTY_PRINT',
  'JSON_UNESCAPED_UNICODE',
  'JSON_UNESCAPED_SLASHES',
  'PASSWORD_DEFAULT',
  'PASSWORD_BCRYPT',
  'FILTER_VALIDATE_EMAIL',
  'FILTER_VALIDATE_INT',
  'FILTER_VALIDATE_URL',
  'CURLOPT_URL',
  'CURLOPT_RETURNTRANSFER',
  'CURLOPT_POST',
  'CURLOPT_POSTFIELDS',
  'CURLOPT_HTTPHEADER',
  'UPLOAD_ERR_OK'
];

// Live merged stores
const functionMap = new Map<string, PhpFunctionMeta>();
const classMap = new Map<string, PhpClassMeta>();
const constantSet = new Set<string>(DEFAULT_CONSTANTS);

// Wisanggeni Framework dedicated stores
const wisanggeniFunctionMap = new Map<string, PhpFunctionMeta>();
const wisanggeniClassMap = new Map<string, PhpClassMeta>();
let wisanggeniGlobalVars: Record<string, string> = {
  $page: 'TPage',
  $query: 'TQuery',
  $query2: 'TQuery',
  $query3: 'TQuery',
  $pegawai: 'TUser',
  $user: 'TUser',
  $db_conn: 'TMySQL'
};

const WISANGGENI_CONVENTION_VARS: Record<string, string> = {
  $tbl: 'TTabel',
  $table: 'TTabel',
  $form: 'TForm',
  $menu: 'TMenuBox',
  $modal: 'TModal',
  $upload: 'TUploadFile',
  $kotak: 'TKotak',
  $alert: 'TAlert',
  $tab: 'TTab'
};

// Laravel Framework dedicated stores
const laravelFunctionMap = new Map<string, PhpFunctionMeta>();
const laravelClassMap = new Map<string, PhpClassMeta>();
let laravelBladeDirectives: LaravelBladeDirectiveMeta[] = [];
let laravelValidationRules: LaravelValidationRuleMeta[] = [];
let laravelRoutes: LaravelRouteEntry[] = [];
let laravelViews: LaravelViewEntry[] = [];
let laravelConfigKeys: LaravelConfigEntry[] = [];
let laravelEnvKeys: string[] = [];
let laravelTranslationKeys: string[] = [];
let laravelMiddlewareAliases: string[] = [];
let isActiveLaravelProject = false;

const BLADE_LOOP_CLASS: PhpClassMeta = {
  name: 'BladeLoop',
  origin: 'laravel',
  doc: 'Variabel otomatis `$loop` yang disediakan Laravel di dalam perulangan `@foreach` / `@forelse`.',
  members: [
    { name: 'index', kind: 'property', type: 'int', doc: 'Indeks iterasi saat ini mulai dari 0.' },
    { name: 'iteration', kind: 'property', type: 'int', doc: 'Nomor urut iterasi saat ini mulai dari 1.' },
    { name: 'remaining', kind: 'property', type: 'int', doc: 'Sisa item yang belum diiterasi pada loop.' },
    { name: 'count', kind: 'property', type: 'int', doc: 'Total jumlah item pada array/koleksi yang diiterasi.' },
    { name: 'first', kind: 'property', type: 'bool', doc: 'Bernilai `true` jika ini adalah iterasi pertama.' },
    { name: 'last', kind: 'property', type: 'bool', doc: 'Bernilai `true` jika ini adalah iterasi terakhir.' },
    { name: 'even', kind: 'property', type: 'bool', doc: 'Bernilai `true` pada iterasi genap.' },
    { name: 'odd', kind: 'property', type: 'bool', doc: 'Bernilai `true` pada iterasi ganjil.' },
    { name: 'depth', kind: 'property', type: 'int', doc: 'Tingkat kedalaman bersarang (nesting level) dari loop saat ini.' },
    { name: 'parent', kind: 'property', type: 'BladeLoop|null', doc: 'Referensi ke variabel `$loop` milik `@foreach` induk.' }
  ]
};

let workspaceSymbols: PhpWorkspaceSymbols = {
  functions: [],
  classes: [],
  arrayKeys: []
};

let remoteWorkspaceSymbols: PhpWorkspaceSymbols = {
  functions: [],
  classes: [],
  arrayKeys: []
};

let getOpenPhpBuffers: () => OpenPhpBufferInfo[] = () => [];
let registered = false;

function seedCuratedCatalog(): void {
  if (functionMap.size > 0) return;
  for (const fn of CURATED_FUNCTIONS) {
    functionMap.set(fn.name.toLowerCase(), fn);
  }
  for (const cls of CURATED_CLASSES) {
    classMap.set(cls.name.toLowerCase(), cls);
  }
}

export function setOpenPhpBuffersProvider(provider: () => OpenPhpBufferInfo[]): void {
  getOpenPhpBuffers = provider;
}

export function hydratePhpRuntimeCatalog(catalog: PhpRuntimeCatalog): void {
  seedCuratedCatalog();
  for (const fn of catalog.functions) {
    const key = fn.name.toLowerCase();
    const existing = functionMap.get(key);
    functionMap.set(key, {
      ...fn,
      doc: existing?.doc ?? fn.doc
    });
  }

  for (const cls of catalog.classes) {
    const key = cls.name.toLowerCase();
    const existing = classMap.get(key);
    if (!existing) {
      classMap.set(key, cls);
    } else {
      const mergedMembers = [...existing.members];
      const seen = new Set(mergedMembers.map((m) => `${m.kind}:${m.name}`));
      for (const m of cls.members) {
        if (!seen.has(`${m.kind}:${m.name}`)) {
          mergedMembers.push(m);
        }
      }
      classMap.set(key, { ...cls, members: mergedMembers });
    }
  }

  for (const c of catalog.constants) {
    constantSet.add(c);
  }
}

export function hydratePhpWorkspaceSymbols(symbols: PhpWorkspaceSymbols): void {
  workspaceSymbols = symbols;
}

export function hydrateRemotePhpWorkspaceSymbols(symbols: PhpWorkspaceSymbols | null): void {
  remoteWorkspaceSymbols = symbols ?? { functions: [], classes: [], arrayKeys: [] };
}

export function hydrateWisanggeniCatalog(catalog: WisanggeniCatalog): void {
  wisanggeniFunctionMap.clear();
  wisanggeniClassMap.clear();

  for (const fn of catalog.functions) {
    wisanggeniFunctionMap.set(fn.name.toLowerCase(), {
      ...fn,
      origin: 'wisanggeni'
    });
  }

  for (const cls of catalog.classes) {
    wisanggeniClassMap.set(cls.name.toLowerCase(), {
      ...cls,
      origin: 'wisanggeni'
    });
  }

  if (catalog.globalVarTypes) {
    wisanggeniGlobalVars = { ...catalog.globalVarTypes };
  }
}

export function hydrateLaravelCatalog(catalog: LaravelCatalog): void {
  laravelFunctionMap.clear();
  laravelClassMap.clear();

  isActiveLaravelProject = catalog.isLaravelProject;
  laravelClassMap.set('bladeloop', BLADE_LOOP_CLASS);

  for (const fn of catalog.functions) {
    laravelFunctionMap.set(fn.name.toLowerCase(), {
      ...fn,
      origin: 'laravel'
    });
  }

  for (const cls of catalog.classes) {
    laravelClassMap.set(cls.name.toLowerCase(), {
      ...cls,
      origin: 'laravel'
    });
  }

  laravelBladeDirectives = catalog.bladeDirectives ?? [];
  laravelValidationRules = catalog.validationRules ?? [];
  laravelRoutes = catalog.routes ?? [];
  laravelViews = catalog.views ?? [];
  laravelConfigKeys = catalog.configKeys ?? [];
  laravelEnvKeys = catalog.envKeys ?? [];
  laravelTranslationKeys = catalog.translationKeys ?? [];
  laravelMiddlewareAliases = catalog.middlewareAliases ?? [];
}

interface IndexedDbCatalog {
  snapshot: DbSchemaSnapshot;
  userDatabases: string[];
  allTables: DbTableMeta[];
  tablesByDbLower: Map<string, DbTableMeta[]>;
  tablesByNameLower: Map<string, DbTableMeta[]>;
  tableByFullKeyLower: Map<string, DbTableMeta>;
}

let indexedDbCatalog: IndexedDbCatalog | null = null;
let workspaceLearnedJoinEdges: LearnedJoinEdge[] = [];
let remoteLearnedJoinEdges: LearnedJoinEdge[] = [];

export function hydrateWorkspaceLearnedJoinEdges(edges: LearnedJoinEdge[]): void {
  workspaceLearnedJoinEdges = edges ?? [];
}

export function hydrateRemoteLearnedJoinEdges(edges: LearnedJoinEdge[]): void {
  remoteLearnedJoinEdges = edges ?? [];
}

export function getCombinedLearnedJoinEdges(extraSources: string[] = []): LearnedJoinEdge[] {
  const openSources = getOpenPhpBuffers().map((b) => b.content);
  const liveEdges = learnJoinEdgesFromSources([...openSources, ...extraSources]);
  const allPools = [...remoteLearnedJoinEdges, ...workspaceLearnedJoinEdges, ...liveEdges];
  if (allPools.length === 0) return [];

  const merged = new Map<string, LearnedJoinEdge>();
  for (const e of allPools) {
    const k1 = `${(e.leftSchema ?? '').toLowerCase()}.${e.leftTable.toLowerCase()}.${e.leftColumn.toLowerCase()}`;
    const k2 = `${(e.rightSchema ?? '').toLowerCase()}.${e.rightTable.toLowerCase()}.${e.rightColumn.toLowerCase()}`;
    const key = k1 < k2 ? `${k1}<->${k2}` : `${k2}<->${k1}`;
    const prev = merged.get(key);
    if (prev) {
      merged.set(key, {
        ...prev,
        frequency: Math.max(prev.frequency, e.frequency)
      });
    } else {
      merged.set(key, { ...e });
    }
  }
  return Array.from(merged.values()).sort((a, b) => b.frequency - a.frequency);
}

export function hydrateDatabaseSchemaCatalog(snapshot: DbSchemaSnapshot | null): void {
  if (!snapshot) {
    indexedDbCatalog = null;
    for (const mdl of monaco.editor.getModels()) {
      if (mdl.isDisposed()) continue;
      const lid = mdl.getLanguageId();
      if (lid === 'php' || lid === 'sql') {
        applySqlAndSecurityDiagnosticsToModel(mdl, lid);
      }
    }
    return;
  }

  const allTables =
    snapshot.allTables && snapshot.allTables.length > 0
      ? snapshot.allTables
      : snapshot.tables;

  const tablesByDbLower = new Map<string, DbTableMeta[]>();
  const tablesByNameLower = new Map<string, DbTableMeta[]>();
  const tableByFullKeyLower = new Map<string, DbTableMeta>();
  const dbNameMap = new Map<string, string>();

  for (const db of snapshot.databases) {
    if (!db) continue;
    const low = db.toLowerCase();
    if (!SYSTEM_DB_NAMES_LOWER.has(low)) {
      dbNameMap.set(low, db);
    }
  }

  for (const tbl of allTables) {
    const schemaName = tbl.schema || snapshot.currentDatabase || '';
    const schemaLow = schemaName.toLowerCase();
    const tblLow = tbl.name.toLowerCase();

    if (schemaName && !SYSTEM_DB_NAMES_LOWER.has(schemaLow) && !dbNameMap.has(schemaLow)) {
      dbNameMap.set(schemaLow, schemaName);
    }

    if (schemaLow) {
      const byDb = tablesByDbLower.get(schemaLow) ?? [];
      byDb.push(tbl);
      tablesByDbLower.set(schemaLow, byDb);
      tableByFullKeyLower.set(`${schemaLow}.${tblLow}`, tbl);
    }

    const byName = tablesByNameLower.get(tblLow) ?? [];
    byName.push(tbl);
    tablesByNameLower.set(tblLow, byName);
  }

  indexedDbCatalog = {
    snapshot,
    userDatabases: Array.from(dbNameMap.values()),
    allTables,
    tablesByDbLower,
    tablesByNameLower,
    tableByFullKeyLower
  };

  for (const mdl of monaco.editor.getModels()) {
    if (mdl.isDisposed()) continue;
    const lid = mdl.getLanguageId();
    if (lid === 'php' || lid === 'sql') {
      applySqlAndSecurityDiagnosticsToModel(mdl, lid);
    }
  }
}

function formatParamsSignature(params: PhpParamMeta[] = []): string {
  return params
    .map((p) => {
      const typePrefix = p.type ? `${p.type} ` : '';
      const defSuffix = p.defaultValue !== undefined ? ` = ${p.defaultValue}` : p.optional ? ' = ...' : '';
      return `${typePrefix}${p.name}${defSuffix}`;
    })
    .join(', ');
}

function formatFunctionSignature(fn: PhpFunctionMeta): string {
  const ret = fn.returnType ? `: ${fn.returnType}` : '';
  return `${fn.name}(${formatParamsSignature(fn.params)})${ret}`;
}

function buildFunctionSnippetInsert(name: string, params: PhpParamMeta[] = []): string {
  const required = params.filter((p) => !p.optional && !p.name.startsWith('...'));
  if (required.length === 0) {
    return params.length > 0 ? `${name}($0)` : `${name}()`;
  }
  const placeholders = required
    .slice(0, 4)
    .map((p, idx) => `\${${idx + 1}:${p.name.replace(/\$/g, '\\$')}}`)
    .join(', ');
  return `${name}(${placeholders})`;
}

interface AnalyzedPhpBuffer {
  variables: Map<string, string>; // '$rekom' -> inferred class/type or 'mixed'
  functions: PhpFunctionMeta[];
  classes: PhpClassMeta[];
  arrayKeys: Set<string>;
  enclosingClassAtLine: (line: number) => PhpClassMeta | null;
}

const PHP_SCALAR_TYPES = new Set([
  'string',
  'int',
  'integer',
  'float',
  'double',
  'bool',
  'boolean',
  'array',
  'callable',
  'iterable',
  'mixed',
  'object',
  'void',
  'null',
  'false',
  'true',
  'never',
  'self',
  'static',
  'parent'
]);

function extractShortTypeClassName(rawType?: string): string | null {
  if (!rawType) return null;
  const candidates = rawType
    .split('|')
    .map((t) => t.trim().replace(/^\?/, ''))
    .filter(Boolean);
  for (const cand of candidates) {
    const shortName = cand.split('\\').pop() ?? cand;
    if (shortName && !PHP_SCALAR_TYPES.has(shortName.toLowerCase())) {
      return shortName;
    }
  }
  return null;
}

function looksLikeLaravelBuffer(source: string, title: string): boolean {
  if (title.toLowerCase().endsWith('.blade.php')) return true;
  if (/\buse\s+Illuminate\\|\bRoute::|\bSchema::|\bEloquent\b|@(?:extends|section|foreach|csrf)\b/.test(source)) {
    return true;
  }
  if (
    isActiveLaravelProject &&
    !/wisanggeni|main_lib\.php|\bnew\s+T(?:Tabel|Form|Query|Modal)\b/.test(source)
  ) {
    return true;
  }
  return false;
}

function analyzePhpSource(source: string, title = 'current'): AnalyzedPhpBuffer {
  const variables = new Map<string, string>();
  const functions: PhpFunctionMeta[] = [];
  const classes: PhpClassMeta[] = [];
  const arrayKeys = new Set<string>();
  const classSpans: Array<{ start: number; end: number; cls: PhpClassMeta }> = [];
  const isLaravelCtx = looksLikeLaravelBuffer(source, title);

  const lines = source.split(/\r?\n/);
  let currentClass: PhpClassMeta | null = null;
  let currentClassStart = 1;
  let braceDepth = 0;
  let classDepth = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // 1. Collect associative array keys: ['id_rekomendasi'] or ["ssm"]
    for (const km of line.matchAll(/\[\s*['"]([A-Za-z_][A-Za-z0-9_-]{1,48})['"]\s*\]/g)) {
      arrayKeys.add(km[1]);
    }

    // 2. Collect variables & infer common types (mysqli, PDO, new ClassName, Laravel facades/helpers, type-hinted params)
    for (const vm of line.matchAll(/(\$[A-Za-z_][A-Za-z0-9_]*)/g)) {
      const vName = vm[1];
      if (!variables.has(vName)) {
        variables.set(vName, 'mixed');
      }
    }

    // Infer type-hinted parameters in named functions, methods, closures `function (Blueprint $table)`, and arrow `fn (User $u)`
    for (const sigMatch of line.matchAll(/(?:\bfunction(?:\s+&?\s*[A-Za-z_][A-Za-z0-9_]*)?|\bfn)\s*\(([^)]*)\)/g)) {
      const paramList = sigMatch[1] ?? '';
      for (const part of paramList.split(',')) {
        const lhs = part.split('=')[0]?.trim();
        if (!lhs) continue;
        const pm = lhs.match(/^([?\\A-Za-z0-9_|]+)\s+(?:\.\.\.)?&?(\$[A-Za-z_][A-Za-z0-9_]*)$/);
        if (pm) {
          const shortType = extractShortTypeClassName(pm[1]);
          if (shortType) {
            variables.set(pm[2], shortType);
          }
        }
      }
    }

    const newObjMatch = line.match(
      /(\$[A-Za-z_][A-Za-z0-9_]*)\s*=\s*new\s+\\?([A-Za-z_][A-Za-z0-9_\\]*)/
    );
    if (newObjMatch) {
      const shortCls = newObjMatch[2].split('\\').pop() ?? newObjMatch[2];
      variables.set(newObjMatch[1], shortCls);
    }

    // Laravel helper & static Facade/Eloquent assignments
    const helperAssignMatch = line.match(
      /(\$[A-Za-z_][A-Za-z0-9_]*)\s*=\s*(request|response|redirect|back|to_route|collect|now|today|auth|validator)\s*\(/
    );
    if (helperAssignMatch) {
      const helperRetMap: Record<string, string> = {
        request: 'Request',
        response: 'Response',
        redirect: 'RedirectResponse',
        back: 'RedirectResponse',
        to_route: 'RedirectResponse',
        collect: 'Collection',
        now: 'Carbon',
        today: 'Carbon',
        auth: 'Auth',
        validator: 'Validator'
      };
      const mapped = helperRetMap[helperAssignMatch[2]];
      if (mapped) variables.set(helperAssignMatch[1], mapped);
    }

    const staticAssignMatch = line.match(
      /(\$[A-Za-z_][A-Za-z0-9_]*)\s*=\s*\\?([A-Za-z_][A-Za-z0-9_\\]*)::([A-Za-z_][A-Za-z0-9_]*)\s*\(/
    );
    if (staticAssignMatch) {
      const targetVar = staticAssignMatch[1];
      const clsShort = staticAssignMatch[2].split('\\').pop() ?? staticAssignMatch[2];
      const mName = staticAssignMatch[3];
      if (clsShort === 'DB' && mName === 'table') {
        variables.set(targetVar, 'QueryBuilder');
      } else if (clsShort === 'Http') {
        variables.set(
          targetVar,
          ['get', 'post', 'put', 'patch', 'delete'].includes(mName) ? 'HttpResponse' : 'Http'
        );
      } else if (clsShort === 'Carbon') {
        variables.set(targetVar, 'Carbon');
      } else if (clsShort === 'Validator' && mName === 'make') {
        variables.set(targetVar, 'Validator');
      } else if (
        ['find', 'findOrFail', 'first', 'firstOrFail', 'firstWhere', 'create', 'firstOrCreate', 'firstOrNew', 'updateOrCreate'].includes(
          mName
        ) &&
        !/->\s*(?:get|pluck|count|paginate)\s*\(/.test(line)
      ) {
        variables.set(targetVar, clsShort);
      } else if (
        ['query', 'where', 'whereIn', 'whereHas', 'with', 'withCount', 'latest', 'oldest', 'orderBy'].includes(
          mName
        )
      ) {
        variables.set(
          targetVar,
          /->\s*(?:first|firstOrFail)\s*\(/.test(line)
            ? clsShort
            : /->\s*(?:get|pluck)\s*\(/.test(line)
              ? 'Collection'
              : 'EloquentBuilder'
        );
      }
    }

    const mysqliConnMatch = line.match(/(\$[A-Za-z_][A-Za-z0-9_]*)\s*=\s*mysqli_connect\s*\(/);
    if (mysqliConnMatch) {
      variables.set(mysqliConnMatch[1], 'mysqli');
    }

    const queryResMatch = line.match(
      /(\$[A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:mysqli_query\s*\(|\$[A-Za-z_][A-Za-z0-9_]*\s*->\s*(?:query|get_result)\s*\()/
    );
    if (queryResMatch && !isLaravelCtx) {
      variables.set(queryResMatch[1], 'mysqli_result');
    }

    const stmtMatch = line.match(
      /(\$[A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:mysqli_prepare\s*\(|\$[A-Za-z_][A-Za-z0-9_]*\s*->\s*prepare\s*\()/
    );
    if (stmtMatch) {
      const rhsVar = line.match(/=\s*(\$[A-Za-z_][A-Za-z0-9_]*)\s*->\s*prepare/)?.[1];
      const rhsType = rhsVar ? variables.get(rhsVar) : undefined;
      variables.set(stmtMatch[1], rhsType === 'PDO' ? 'PDOStatement' : 'mysqli_stmt');
    }

    // 3. Collect classes & functions
    const clsMatch = line.match(
      /^\s*(?:final\s+|abstract\s+|readonly\s+)*(?:class|interface|trait)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+extends\s+([\\A-Za-z0-9_]+))?/
    );
    if (clsMatch) {
      const extShort = clsMatch[2]?.split('\\').pop();
      currentClass = {
        name: clsMatch[1],
        extendsClass: extShort,
        members: [],
        relativePath: title,
        line: lineNum
      };
      classes.push(currentClass);
      currentClassStart = lineNum;
      classDepth = braceDepth;
    }

    const fnMatch = line.match(
      /^\s*(?:(?:public|protected|private|static|final|abstract)\s+)*function\s+&?\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)(?:\s*:\s*([?A-Za-z0-9_|\\]+))?/
    );
    if (fnMatch) {
      const rawParams = (fnMatch[2] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((p): PhpParamMeta => {
          const [lhs, rhs] = p.split('=').map((x) => x.trim());
          const parts = lhs.split(/\s+/).filter(Boolean);
          const vTok = parts.find((t) => t.includes('$')) ?? lhs;
          const tTok = parts.filter((t) => t !== vTok).join(' ');
          return {
            name: vTok.replace(/^&/, ''),
            type: tTok || undefined,
            optional: p.includes('='),
            defaultValue: rhs
          };
        });

      if (currentClass && braceDepth > classDepth) {
        currentClass.members.push({
          name: fnMatch[1],
          kind: 'method',
          isStatic: /\bstatic\b/.test(line),
          params: rawParams,
          type: fnMatch[3]?.trim(),
          line: lineNum
        });
      } else {
        functions.push({
          name: fnMatch[1],
          params: rawParams,
          returnType: fnMatch[3]?.trim(),
          relativePath: title,
          line: lineNum
        });
      }
    }

    if (currentClass && braceDepth > classDepth) {
      const propMatch = line.match(
        /^\s*(?:(?:public|protected|private)\s+(?:(?:static|readonly)\s+)*(?:([?A-Za-z0-9_|\\]+)\s+)?|var\s+)\$([A-Za-z_][A-Za-z0-9_]*)/
      );
      if (propMatch) {
        currentClass.members.push({
          name: propMatch[2],
          kind: 'property',
          isStatic: /\bstatic\b/.test(line),
          type: propMatch[1],
          line: lineNum
        });
      }
    }

    for (const ch of line) {
      if (ch === '{') braceDepth += 1;
      else if (ch === '}') {
        braceDepth = Math.max(0, braceDepth - 1);
        if (currentClass && braceDepth <= classDepth) {
          classSpans.push({ start: currentClassStart, end: lineNum, cls: currentClass });
          currentClass = null;
          classDepth = -1;
        }
      }
    }
  }

  if (currentClass) {
    classSpans.push({ start: currentClassStart, end: lines.length, cls: currentClass });
  }

  // Enrich in-buffer classes that extend Laravel Model / Authenticatable / FormRequest
  for (const cls of classes) {
    const ext = cls.extendsClass;
    if (ext && ['Model', 'Authenticatable', 'Pivot', 'MorphPivot', 'FormRequest'].includes(ext)) {
      const parentBase =
        laravelClassMap.get(ext.toLowerCase()) ?? laravelClassMap.get('model');
      if (parentBase) {
        const seen = new Set(
          cls.members.map((item) => `${item.kind}:${item.name}:${item.isStatic ? 'S' : 'I'}`)
        );
        for (const pm of parentBase.members) {
          const k = `${pm.kind}:${pm.name}:${pm.isStatic ? 'S' : 'I'}`;
          if (!seen.has(k)) {
            seen.add(k);
            cls.members.push(pm);
          }
        }
      }
    }
  }

  // Terapkan inferensi variabel konvensi (Blade/Laravel vs Wisanggeni)
  if (isLaravelCtx) {
    if (!variables.has('$loop') || variables.get('$loop') === 'mixed') {
      variables.set('$loop', 'BladeLoop');
    }
    for (const [vName, currentType] of variables) {
      if (currentType !== 'mixed') continue;
      if (vName === '$request') variables.set(vName, 'Request');
      else if (vName === '$user') {
        variables.set(vName, laravelClassMap.has('user') ? 'User' : 'Authenticatable');
      }
    }
  } else {
    for (const [vName, currentType] of variables) {
      if (currentType === 'mixed') {
        const wsgGlobal = wisanggeniGlobalVars[vName];
        const wsgConv = WISANGGENI_CONVENTION_VARS[vName];
        if (wsgGlobal) {
          variables.set(vName, wsgGlobal);
        } else if (wsgConv && wisanggeniClassMap.has(wsgConv.toLowerCase())) {
          variables.set(vName, wsgConv);
        }
      }
    }
  }

  return {
    variables,
    functions,
    classes,
    arrayKeys,
    enclosingClassAtLine: (ln) =>
      classSpans.find((sp) => ln >= sp.start && ln <= sp.end)?.cls ?? null
  };
}

function collectCombinedContext(model: monaco.editor.ITextModel) {
  seedCuratedCatalog();
  const currentText = model.getValue();
  const modelUriPath = model.uri?.path ?? 'File Aktif';
  const isLaravelCtx = looksLikeLaravelBuffer(currentText, modelUriPath);
  const currentAnalysis = analyzePhpSource(currentText, modelUriPath);

  const mergedVars = new Map<string, string>(currentAnalysis.variables);

  // Sediakan variabel global kerangka Wisanggeni ($page, $query, $pegawai, $db_conn) bila bukan berkas Laravel murni
  if (wisanggeniClassMap.size > 0 && !isLaravelCtx) {
    for (const [gVar, gCls] of Object.entries(wisanggeniGlobalVars)) {
      if (!mergedVars.has(gVar) || mergedVars.get(gVar) === 'mixed') {
        mergedVars.set(gVar, gCls);
      }
    }
  }

  const mergedUserFuncs = new Map<string, PhpFunctionMeta>();
  const mergedUserClasses = new Map<string, PhpClassMeta>();
  const mergedArrayKeys = new Set<string>(currentAnalysis.arrayKeys);

  for (const fn of currentAnalysis.functions) {
    mergedUserFuncs.set(fn.name.toLowerCase(), fn);
  }
  for (const cls of currentAnalysis.classes) {
    mergedUserClasses.set(cls.name.toLowerCase(), cls);
  }

  // Merge open PHP editor tabs (vital for Remote SFTP/FTPS projects!)
  for (const buf of getOpenPhpBuffers()) {
    if (buf.content === currentText || buf.title.toLowerCase().endsWith('.sql')) continue;
    const other = analyzePhpSource(buf.content, buf.title);
    for (const [v, t] of other.variables) {
      if (!mergedVars.has(v) || (mergedVars.get(v) === 'mixed' && t !== 'mixed')) {
        mergedVars.set(v, t);
      }
    }
    for (const fn of other.functions) {
      const k = fn.name.toLowerCase();
      if (!mergedUserFuncs.has(k)) mergedUserFuncs.set(k, fn);
    }
    for (const cls of other.classes) {
      const k = cls.name.toLowerCase();
      if (!mergedUserClasses.has(k)) mergedUserClasses.set(k, cls);
    }
    for (const ak of other.arrayKeys) {
      mergedArrayKeys.add(ak);
    }
  }

  // Merge background-scanned remote SFTP server symbols + local workspace symbols
  for (const fn of [...remoteWorkspaceSymbols.functions, ...workspaceSymbols.functions]) {
    const k = fn.name.toLowerCase();
    if (!mergedUserFuncs.has(k)) mergedUserFuncs.set(k, fn);
  }
  for (const cls of [...remoteWorkspaceSymbols.classes, ...workspaceSymbols.classes]) {
    const k = cls.name.toLowerCase();
    if (!mergedUserClasses.has(k)) {
      // Enrich workspace class if a richer Laravel Eloquent/Request scan exists for the same class name
      const lvRich = laravelClassMap.get(k);
      mergedUserClasses.set(k, lvRich ?? cls);
    }
  }
  for (const ak of [...remoteWorkspaceSymbols.arrayKeys, ...workspaceSymbols.arrayKeys]) {
    mergedArrayKeys.add(ak);
  }

  return {
    isLaravelCtx,
    currentAnalysis,
    mergedVars,
    mergedUserFuncs,
    mergedUserClasses,
    mergedArrayKeys
  };
}

function resolveAnyClass(
  className: string,
  userClasses: Map<string, PhpClassMeta>
): PhpClassMeta | undefined {
  const short = (className.split('\\').pop() ?? className).replace(/^\?/, '');
  const lower = short.toLowerCase();
  const direct =
    userClasses.get(lower) ??
    laravelClassMap.get(lower) ??
    wisanggeniClassMap.get(lower) ??
    classMap.get(lower);
  if (direct) return direct;
  if (short.endsWith('Request')) {
    return laravelClassMap.get('formrequest') ?? laravelClassMap.get('request');
  }
  return undefined;
}

function collapseBalancedParens(input: string): string {
  let out = '';
  let depth = 0;
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const prev = i > 0 ? input[i - 1] : '';
    if (ch === "'" && !inDouble && prev !== '\\') {
      inSingle = !inSingle;
      if (depth === 0) out += ch;
      continue;
    }
    if (ch === '"' && !inSingle && prev !== '\\') {
      inDouble = !inDouble;
      if (depth === 0) out += ch;
      continue;
    }
    if (inSingle || inDouble) {
      if (depth === 0) out += ch;
      continue;
    }
    if (ch === '(') {
      if (depth === 0) out += '(';
      depth += 1;
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1);
      if (depth === 0) out += ')';
    } else if (depth === 0) {
      out += ch;
    }
  }
  return out;
}

function mergeClassWithBuilder(modelCls: PhpClassMeta, builderCls?: PhpClassMeta): PhpClassMeta {
  if (!builderCls) return modelCls;
  const members: PhpClassMemberMeta[] = [...builderCls.members];
  const seen = new Set(members.map((x) => `${x.kind}:${x.name.toLowerCase()}`));
  for (const m of modelCls.members) {
    if (m.isStatic || m.kind !== 'method') continue;
    const k = `${m.kind}:${m.name.toLowerCase()}`;
    if (!seen.has(k)) {
      seen.add(k);
      members.push(m);
    }
  }
  return {
    ...builderCls,
    name: `${modelCls.name}|EloquentBuilder`,
    origin: 'laravel',
    members
  };
}

function inferFluentChainClass(
  exprBeforeArrow: string,
  ctx: ReturnType<typeof collectCombinedContext>,
  lineNumber: number
): PhpClassMeta | undefined {
  const collapsed = collapseBalancedParens(exprBeforeArrow).trimEnd();
  const chainMatch = collapsed.match(
    /(\\?[A-Za-z_$][A-Za-z0-9_\\]*(?:::[A-Za-z_][A-Za-z0-9_]*\(\))?|\$[A-Za-z_][A-Za-z0-9_]*|[A-Za-z_][A-Za-z0-9_]*\(\))((?:\s*->\s*[A-Za-z_][A-Za-z0-9_]*(?:\(\))?)*)$/
  );
  if (!chainMatch) return undefined;

  const head = chainMatch[1].trim();
  const tail = chainMatch[2] ?? '';

  let currentCls: PhpClassMeta | undefined;
  let originModelCls: PhpClassMeta | undefined;

  if (head.startsWith('$')) {
    if (head === '$this') {
      currentCls = ctx.currentAnalysis.enclosingClassAtLine(lineNumber) ?? undefined;
    } else {
      const vType = ctx.mergedVars.get(head);
      if (vType && vType !== 'mixed') {
        currentCls = resolveAnyClass(vType, ctx.mergedUserClasses);
      }
    }
  } else if (head.includes('::')) {
    const [rawCls, rawStaticCall] = head.split('::');
    const methodName = rawStaticCall.replace(/\(\)$/, '').toLowerCase();
    const rootCls =
      rawCls === 'self' || rawCls === 'static'
        ? ctx.currentAnalysis.enclosingClassAtLine(lineNumber) ?? undefined
        : resolveAnyClass(rawCls, ctx.mergedUserClasses);

    if (rootCls) {
      if (rootCls.extendsClass === 'Model' || rootCls.extendsClass === 'Authenticatable') {
        originModelCls = rootCls;
      }
      const foundMethod = rootCls.members.find(
        (item) => item.kind === 'method' && item.name.toLowerCase() === methodName
      );
      const retType = extractShortTypeClassName(foundMethod?.type);
      if (retType === 'self' || retType === rootCls.name) {
        currentCls = rootCls;
      } else if (retType === 'EloquentBuilder' && originModelCls) {
        currentCls = mergeClassWithBuilder(
          originModelCls,
          laravelClassMap.get('eloquentbuilder')
        );
      } else if (retType) {
        currentCls = resolveAnyClass(retType, ctx.mergedUserClasses);
      } else if (originModelCls) {
        currentCls = mergeClassWithBuilder(
          originModelCls,
          laravelClassMap.get('eloquentbuilder')
        );
      }
    }
  } else if (head.endsWith('()')) {
    const fnName = head.slice(0, -2).toLowerCase();
    const fnMeta =
      ctx.mergedUserFuncs.get(fnName) ??
      laravelFunctionMap.get(fnName) ??
      wisanggeniFunctionMap.get(fnName) ??
      functionMap.get(fnName);
    const retType = extractShortTypeClassName(fnMeta?.returnType);
    if (retType) {
      currentCls = resolveAnyClass(retType, ctx.mergedUserClasses);
    }
  }

  if (!currentCls) return undefined;

  for (const step of tail.matchAll(/->\s*([A-Za-z_][A-Za-z0-9_]*)(\(\))?/g)) {
    const memberName = step[1].toLowerCase();
    const isCall = Boolean(step[2]);
    const found = currentCls.members.find(
      (item) =>
        item.name.toLowerCase() === memberName &&
        (isCall ? item.kind === 'method' : item.kind !== 'constant')
    );
    if (!found) {
      // Keep fluent builder alive on unknown intermediate scopes/macros
      if (
        currentCls.name.includes('Builder') ||
        currentCls.name === 'Blueprint' ||
        currentCls.name === 'RouteRegistrar' ||
        currentCls.name === 'Collection'
      ) {
        continue;
      }
      return undefined;
    }
    const nextType = extractShortTypeClassName(found.type);
    if (!nextType || found.type === 'self' || found.type === '$this') {
      continue;
    }
    if (nextType === 'Model' && originModelCls) {
      currentCls = originModelCls;
    } else if (nextType === 'EloquentBuilder' && originModelCls) {
      currentCls = mergeClassWithBuilder(
        originModelCls,
        laravelClassMap.get('eloquentbuilder')
      );
    } else {
      currentCls = resolveAnyClass(nextType, ctx.mergedUserClasses) ?? currentCls;
    }
  }

  return currentCls;
}

function memberToCompletion(
  m: PhpClassMemberMeta,
  ownerClassName: string,
  range: monaco.IRange,
  sortPrefix: string,
  originTag: 'wisanggeni' | 'laravel' | 'default' = 'default'
): monaco.languages.CompletionItem {
  const badge =
    originTag === 'wisanggeni'
      ? `[Wisanggeni ${ownerClassName}] `
      : originTag === 'laravel'
        ? `[Laravel ${ownerClassName}] `
        : `${ownerClassName}::`;
  if (m.kind === 'method') {
    const sig = `${m.name}(${formatParamsSignature(m.params ?? [])})${m.type ? `: ${m.type}` : ''}`;
    return {
      label: m.name,
      kind: monaco.languages.CompletionItemKind.Method,
      detail: `${badge}${sig}`,
      documentation: m.doc ? { value: m.doc } : undefined,
      insertText: buildFunctionSnippetInsert(m.name, m.params ?? []),
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      sortText: `${sortPrefix}_${m.name}`,
      range,
      command:
        (m.params?.length ?? 0) > 0
          ? { id: 'editor.action.triggerParameterHints', title: 'Parameter Hints' }
          : undefined
    };
  }

  if (m.kind === 'constant') {
    return {
      label: m.name,
      kind: monaco.languages.CompletionItemKind.Constant,
      detail: `${badge}${m.name}`,
      insertText: m.name,
      sortText: `${sortPrefix}_${m.name}`,
      range
    };
  }

  return {
    label: m.name,
    kind: monaco.languages.CompletionItemKind.Property,
    detail: `${badge}$${m.name}${m.type ? ` (${m.type})` : ''}`,
    documentation: m.doc ? { value: m.doc } : undefined,
    insertText: m.name,
    sortText: `${sortPrefix}_${m.name}`,
    range
  };
}

function isInsidePhpLineCommentOrPlainQuote(linePrefix: string): boolean {
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < linePrefix.length; i++) {
    const ch = linePrefix[i];
    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === '/' && linePrefix[i + 1] === '/') return true;
    if (ch === '#' && linePrefix[i + 1] !== '[') return true;
    if (ch === '/' && linePrefix[i + 1] === '*') {
      const closeIdx = linePrefix.indexOf('*/', i + 2);
      if (closeIdx < 0) return true;
      i = closeIdx + 1;
    }
  }
  return quote !== null;
}

function isInsidePhpLineCommentOnly(linePrefix: string): boolean {
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < linePrefix.length; i++) {
    const ch = linePrefix[i];
    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === '/' && linePrefix[i + 1] === '/') return true;
    if (ch === '#' && linePrefix[i + 1] !== '[') return true;
    if (ch === '/' && linePrefix[i + 1] === '*') {
      const closeIdx = linePrefix.indexOf('*/', i + 2);
      if (closeIdx < 0) return true;
      i = closeIdx + 1;
    }
  }
  return false;
}

function isInsideSqlSingleQuoteLiteral(sqlTextBeforeCursor: string): boolean {
  let inSingle = false;
  for (let i = 0; i < sqlTextBeforeCursor.length; i++) {
    const ch = sqlTextBeforeCursor[i];
    if (inSingle) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === "'" && sqlTextBeforeCursor[i + 1] === "'") {
        i++;
        continue;
      }
      if (ch === "'") inSingle = false;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
    }
  }
  return inSingle;
}

export function registerPhpIntelliSense(): void {
  if (registered) return;
  registered = true;
  seedCuratedCatalog();

  // 1. COMPLETION ITEM PROVIDER
  monaco.languages.registerCompletionItemProvider('php', {
    triggerCharacters: ['$', '>', ':', '\\', "'", '"', '<', '@', '.', '`'],
    provideCompletionItems(model, position, context) {
      const lineContent = model.getLineContent(position.lineNumber);
      const linePrefix = lineContent.slice(0, position.column - 1);
      const ctx = collectCombinedContext(model);

      // A. Pembuka Tag PHP (<?php / <?=)
      const openTagMatch = linePrefix.match(/<\?([A-Za-z]*)$/);
      if (openTagMatch) {
        const range: monaco.IRange = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: position.column - openTagMatch[0].length,
          endColumn: position.column
        };
        return {
          suggestions: [
            {
              label: '<?php ... ?>',
              kind: monaco.languages.CompletionItemKind.Snippet,
              detail: 'Blok kode PHP',
              insertText: '<?php\n\t$0\n?>',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              filterText: '<?php',
              range
            },
            {
              label: '<?= ... ?>',
              kind: monaco.languages.CompletionItemKind.Snippet,
              detail: 'Short echo tag PHP',
              insertText: '<?= ${1:\\$variabel} ?>',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              filterText: '<?=',
              range
            }
          ]
        };
      }

      // A1-Web: Jika kursor berada di luar tag `<?php ... ?>` dan bukan ekspresi Blade `{{ ... }}` / `@directive(...)`,
      // serahkan autocomplete sepenuhnya ke Web IntelliSense (<script> JS, <style> CSS, class="...", style="...") & Emmet HTML!
      const webWindowBefore = model.getValueInRange({
        startLineNumber: Math.max(1, position.lineNumber - 150),
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column
      });
      const webSub = detectWebSubContext(webWindowBefore, linePrefix, 'php');
      if (webSub.region !== 'php') {
        const isBladeEchoOrDirective =
          /(?:^|[\s>({])@[A-Za-z]*$/.test(linePrefix) ||
          /@[A-Za-z]+\s*\([^)]*$/.test(linePrefix) ||
          /\{\{(?!--)[^}]*$/.test(linePrefix) ||
          /\{!![^!]*$/.test(linePrefix);
        if (!isBladeEchoOrDirective) {
          return { suggestions: [] };
        }
      }

      // A1. Blade Directives (@extends, @section, @foreach, @csrf, @error, @vite, dll.)
      const bladeDirMatch = linePrefix.match(/(?:^|[\s>({])(@[A-Za-z]*)$/);
      if (bladeDirMatch && laravelBladeDirectives.length > 0) {
        const typedDir = bladeDirMatch[1];
        const range: monaco.IRange = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: position.column - typedDir.length,
          endColumn: position.column
        };
        return {
          suggestions: laravelBladeDirectives.map((dir, idx) => ({
            label: dir.name,
            kind: monaco.languages.CompletionItemKind.Snippet,
            detail: `[Laravel Blade] ${dir.detail}`,
            documentation: { value: dir.doc },
            insertText: dir.insertText,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            filterText: dir.name,
            sortText: `0_${String(idx).padStart(3, '0')}_${dir.name}`,
            range
          }))
        };
      }

      // A2. Laravel String-Argument IntelliSense (Route Names, Blade Views, Config Keys, Env Keys, Middleware, Translations, Validation Rules)
      const routeArgMatch = linePrefix.match(
        /(?:\b(?:route|to_route|signedRoute|temporarySignedRoute|routeIs)|Route::(?:is|has)|Redirect::route)\s*\(\s*['"]([A-Za-z0-9_.*-]*)$/
      );
      if (routeArgMatch && laravelRoutes.length > 0) {
        const typed = routeArgMatch[1];
        const range: monaco.IRange = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: position.column - typed.length,
          endColumn: position.column
        };
        return {
          suggestions: laravelRoutes.map((rt) => ({
            label: rt.name,
            kind: monaco.languages.CompletionItemKind.Value,
            detail: `[Laravel Route] ${rt.method ? `${rt.method} ` : ''}${rt.uri ?? ''}${
              rt.action ? ` → ${rt.action}` : ''
            }`,
            documentation: rt.relativePath
              ? { value: `Didefinisikan di \`${rt.relativePath}\`${rt.line ? ` (baris ${rt.line})` : ''}` }
              : undefined,
            insertText: rt.name,
            filterText: rt.name,
            sortText: `0_${rt.name}`,
            range
          }))
        };
      }

      const viewArgMatch =
        linePrefix.match(
          /(?:\bview|View::(?:make|exists)|@(?:extends|include|includeIf|includeFirst|each|component))\s*\(\s*['"]([A-Za-z0-9_./-]*)$/
        ) ??
        linePrefix.match(
          /(?:Route::view|@(?:includeWhen|includeUnless))\s*\([^,]+,\s*['"]([A-Za-z0-9_./-]*)$/
        );
      if (viewArgMatch && laravelViews.length > 0) {
        const typed = viewArgMatch[1];
        const range: monaco.IRange = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: position.column - typed.length,
          endColumn: position.column
        };
        return {
          suggestions: laravelViews.map((vw) => ({
            label: vw.name,
            kind: monaco.languages.CompletionItemKind.File,
            detail: `[Blade View] ${vw.relativePath}`,
            documentation: { value: `Template Blade: \`${vw.relativePath}\`` },
            insertText: vw.name,
            filterText: vw.name,
            sortText: `0_${vw.name}`,
            range
          }))
        };
      }

      const configArgMatch = linePrefix.match(
        /(?:\bconfig|Config::(?:get|set|has))\s*\(\s*['"]([A-Za-z0-9_.-]*)$/
      );
      if (configArgMatch && laravelConfigKeys.length > 0) {
        const typed = configArgMatch[1];
        const range: monaco.IRange = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: position.column - typed.length,
          endColumn: position.column
        };
        return {
          suggestions: laravelConfigKeys.map((ck) => ({
            label: ck.key,
            kind: monaco.languages.CompletionItemKind.Property,
            detail: `[Laravel Config] ${ck.relativePath ?? 'config/*.php'}`,
            documentation: ck.doc ? { value: ck.doc } : undefined,
            insertText: ck.key,
            filterText: ck.key,
            sortText: `0_${ck.key}`,
            range
          }))
        };
      }

      const envArgMatch = linePrefix.match(/\benv\s*\(\s*['"]([A-Za-z0-9_]*)$/);
      if (envArgMatch && laravelEnvKeys.length > 0) {
        const typed = envArgMatch[1];
        const range: monaco.IRange = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: position.column - typed.length,
          endColumn: position.column
        };
        return {
          suggestions: laravelEnvKeys.map((ek) => ({
            label: ek,
            kind: monaco.languages.CompletionItemKind.Constant,
            detail: '[Laravel .env Key]',
            documentation: {
              value: `Kunci variabel lingkungan \`${ek}\` (hanya nama kunci yang dipindai — nilai rahasia tetap terproteksi).`
            },
            insertText: ek,
            filterText: ek,
            sortText: `0_${ek}`,
            range
          }))
        };
      }

      const middlewareArgMatch = linePrefix.match(
        /(?:->|Route::)middleware\s*\(\s*(?:\[\s*(?:['"][^'"]*['"]\s*,\s*)*)?['"]([A-Za-z0-9_:-]*)$/
      );
      if (middlewareArgMatch && laravelMiddlewareAliases.length > 0) {
        const typed = middlewareArgMatch[1];
        const range: monaco.IRange = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: position.column - typed.length,
          endColumn: position.column
        };
        return {
          suggestions: laravelMiddlewareAliases.map((mw) => ({
            label: mw,
            kind: monaco.languages.CompletionItemKind.Module,
            detail: '[Laravel Middleware]',
            insertText: mw,
            filterText: mw,
            sortText: `0_${mw}`,
            range
          }))
        };
      }

      const transArgMatch = linePrefix.match(
        /(?:\b(?:__|trans|trans_choice)|@lang)\s*\(\s*['"]([A-Za-z0-9_.-]*)$/
      );
      if (transArgMatch && laravelTranslationKeys.length > 0) {
        const typed = transArgMatch[1];
        const range: monaco.IRange = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: position.column - typed.length,
          endColumn: position.column
        };
        return {
          suggestions: laravelTranslationKeys.map((tk) => ({
            label: tk,
            kind: monaco.languages.CompletionItemKind.Text,
            detail: '[Laravel Lang Key]',
            insertText: tk,
            filterText: tk,
            sortText: `0_${tk}`,
            range
          }))
        };
      }

      // Laravel Validation Rules: after '|' in `'required|email|...'` OR in validation rule arrays/maps
      const pipeRuleMatch = linePrefix.match(/['"][A-Za-z0-9_:,./-]+\|([A-Za-z0-9_]*)$/);
      const firstRuleMatch = !pipeRuleMatch
        ? linePrefix.match(/['"][A-Za-z0-9_.*]+['"]\s*=>\s*(?:\[\s*)?['"]([A-Za-z0-9_]*)$/)
        : null;
      if ((pipeRuleMatch || firstRuleMatch) && laravelValidationRules.length > 0) {
        const nearbyText = model.getValueInRange({
          startLineNumber: Math.max(1, position.lineNumber - 12),
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column
        });
        const inValidationZone =
          Boolean(pipeRuleMatch) ||
          /\b(?:validate|validateWithBag|Validator::make|function\s+rules)\b/.test(nearbyText);
        if (inValidationZone) {
          const typedRule = (pipeRuleMatch ?? firstRuleMatch)![1];
          const range: monaco.IRange = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: position.column - typedRule.length,
            endColumn: position.column
          };
          return {
            suggestions: laravelValidationRules.map((rl) => ({
              label: rl.name,
              kind: monaco.languages.CompletionItemKind.Keyword,
              detail: `[Laravel Validation] ${rl.detail}`,
              documentation: { value: rl.doc },
              insertText: rl.insertText,
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              filterText: rl.name,
              sortText: `0_${rl.name}`,
              range
            }))
          };
        }
      }

      // B. Kunci Associative Array: $rekom["..."] / $_SERVER['...'] / $_FILES['x']['...']
      const filesSubKeyMatch = linePrefix.match(
        /\$_FILES\s*\[\s*['"][^'"]+['"]\s*\]\s*\[\s*['"]([A-Za-z0-9_-]*)$/
      );
      if (filesSubKeyMatch) {
        const typed = filesSubKeyMatch[1];
        const range: monaco.IRange = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: position.column - typed.length,
          endColumn: position.column
        };
        return {
          suggestions: FILES_SUBKEYS.map((k) => ({
            label: k,
            kind: monaco.languages.CompletionItemKind.Field,
            detail: `Atribut $_FILES['...']['${k}']`,
            insertText: k,
            range
          }))
        };
      }

      const arrayKeyMatch = linePrefix.match(
        /(\$[A-Za-z_][A-Za-z0-9_]*)\s*\[\s*['"]([A-Za-z0-9_-]*)$/
      );
      if (arrayKeyMatch) {
        const varName = arrayKeyMatch[1];
        const typedKey = arrayKeyMatch[2];
        const range: monaco.IRange = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: position.column - typedKey.length,
          endColumn: position.column
        };

        if (varName === '$_SERVER') {
          return {
            suggestions: SERVER_ARRAY_KEYS.map((k) => ({
              label: k,
              kind: monaco.languages.CompletionItemKind.Field,
              detail: '$_SERVER key',
              insertText: k,
              range
            }))
          };
        }

        const keySuggestions: monaco.languages.CompletionItem[] = [];
        const seenKeys = new Set<string>();
        const isSuperglobal = /^\$_(?:GET|POST|SESSION|COOKIE|REQUEST|ENV|FILES)$/.test(varName);

        // Prioritize columns of SQL tables referenced in the current PHP file (e.g. $spt['kd_unitkerja'])
        if (!isSuperglobal && indexedDbCatalog) {
          const fileSqlRefs = extractReferencedSqlTables(model.getValue());
          for (const ref of fileSqlRefs.refs) {
            const matchedTables = ref.schemaLower
              ? [indexedDbCatalog.tableByFullKeyLower.get(`${ref.schemaLower}.${ref.tableLower}`)].filter(
                  (t): t is DbTableMeta => Boolean(t)
                )
              : indexedDbCatalog.tablesByNameLower.get(ref.tableLower) ?? [];
            for (const tbl of matchedTables) {
              for (const col of tbl.columns) {
                const low = col.name.toLowerCase();
                if (seenKeys.has(low)) continue;
                seenKeys.add(low);
                keySuggestions.push({
                  label: col.name,
                  kind: monaco.languages.CompletionItemKind.Field,
                  detail: `★ [Field ${tbl.schema ? `${tbl.schema}.` : ''}${tbl.name}] ${col.columnType}`,
                  insertText: col.name,
                  sortText: `00_qcol_${col.name}`,
                  range
                });
              }
            }
          }
        }

        for (const k of ctx.mergedArrayKeys) {
          const low = k.toLowerCase();
          if (seenKeys.has(low)) continue;
          seenKeys.add(low);
          keySuggestions.push({
            label: k,
            kind: monaco.languages.CompletionItemKind.Field,
            detail: `Array key pada proyek (${varName})`,
            insertText: k,
            sortText: `01_arr_${k}`,
            range
          });
        }

        if (!isSuperglobal && indexedDbCatalog) {
          let dbColAdded = 0;
          const prioritizedTables = [
            ...indexedDbCatalog.snapshot.tables,
            ...indexedDbCatalog.allTables
          ];
          for (const tbl of prioritizedTables) {
            if (dbColAdded >= 400) break;
            for (const col of tbl.columns) {
              const low = col.name.toLowerCase();
              if (seenKeys.has(low)) continue;
              seenKeys.add(low);
              dbColAdded++;
              keySuggestions.push({
                label: col.name,
                kind: monaco.languages.CompletionItemKind.Field,
                detail: `[DB Field] ${col.columnType} (${tbl.schema ? `${tbl.schema}.` : ''}${tbl.name})`,
                insertText: col.name,
                sortText: `02_dbcol_${col.name}`,
                range
              });
            }
          }
        }

        return { suggestions: keySuggestions };
      }

      // B2. Konteks Query SQL (Multi-Baris maupun Satu Baris) & Builder Tabel di dalam String PHP
      const phpSqlWindow = model.getValueInRange({
        startLineNumber: Math.max(1, position.lineNumber - 65),
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column
      });
      const detectedPhpSql = detectPhpSqlContext(phpSqlWindow, linePrefix);
      if (detectedPhpSql) {
        return provideDbSchemaCompletions(model, position, context, 'php', detectedPhpSql);
      }

      // Cegah spasi di luar konteks SQL memunculkan ratusan fungsi umum secara tiba-tiba
      if (
        context.triggerKind === monaco.languages.CompletionTriggerKind.TriggerCharacter &&
        context.triggerCharacter === ' ' &&
        !/\b(?:new|extends|implements|use)\s+$/i.test(linePrefix)
      ) {
        return { suggestions: [] };
      }

      // C. Object Member & Fluent Chaining Access: $var->... / Route::middleware('auth')->... / DB::table('users')->... / $table->string('x')->...
      const fluentArrowMatch = linePrefix.match(/^(.*?)->\s*([A-Za-z_0-9]*)$/);
      if (fluentArrowMatch) {
        const exprBeforeArrow = fluentArrowMatch[1];
        const typedMember = fluentArrowMatch[2];
        const simpleVarMatch = exprBeforeArrow.match(/(\$[A-Za-z_][A-Za-z0-9_]*)\s*$/);
        const range: monaco.IRange = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: position.column - typedMember.length,
          endColumn: position.column
        };

        const suggestions: monaco.languages.CompletionItem[] = [];
        const added = new Set<string>();
        let matchedSpecificType = false;

        const resolveOriginBadge = (cls: PhpClassMeta): 'wisanggeni' | 'laravel' | 'default' => {
          if (cls.origin === 'wisanggeni' || wisanggeniClassMap.has(cls.name.toLowerCase())) {
            return 'wisanggeni';
          }
          if (cls.origin === 'laravel' || laravelClassMap.has(cls.name.toLowerCase())) {
            return 'laravel';
          }
          return 'default';
        };

        const pushClassMembers = (cls: PhpClassMeta, priority: string): void => {
          const originTag = resolveOriginBadge(cls);
          for (const m of cls.members) {
            if (m.isStatic || m.kind === 'constant') continue;
            const key = `${m.kind}:${m.name.toLowerCase()}`;
            if (added.has(key)) continue;
            added.add(key);
            suggestions.push(memberToCompletion(m, cls.name, range, priority, originTag));
          }
        };

        // Multi-line fluent chain context (up to 4 preceding lines for multiline Eloquent/Route chains)
        const multiLineExpr =
          position.lineNumber > 1 && /^\s*$/.test(exprBeforeArrow)
            ? model
                .getValueInRange({
                  startLineNumber: Math.max(1, position.lineNumber - 5),
                  startColumn: 1,
                  endLineNumber: position.lineNumber,
                  endColumn: position.column - typedMember.length - 2
                })
                .replace(/\r?\n/g, ' ')
            : exprBeforeArrow;

        const chainedCls = inferFluentChainClass(multiLineExpr, ctx, position.lineNumber);
        if (chainedCls) {
          pushClassMembers(chainedCls, '0');
          matchedSpecificType = true;
        }

        if (!matchedSpecificType && simpleVarMatch) {
          const varName = simpleVarMatch[1];
          if (varName === '$this') {
            const currentCls = ctx.currentAnalysis.enclosingClassAtLine(position.lineNumber);
            if (currentCls) {
              pushClassMembers(currentCls, '0');
              matchedSpecificType = true;
            }
          } else {
            const inferredType = ctx.mergedVars.get(varName);
            if (inferredType && inferredType !== 'mixed') {
              const resolved = resolveAnyClass(inferredType, ctx.mergedUserClasses);
              if (resolved) {
                pushClassMembers(resolved, '0');
                matchedSpecificType = true;
              }
            }
          }
        }

        // Fallback ketika tipe penerima belum diketahui secara statis
        if (!matchedSpecificType) {
          if (ctx.isLaravelCtx) {
            for (const lvCore of [
              'eloquentbuilder',
              'model',
              'request',
              'collection',
              'blueprint',
              'carbon',
              'response',
              'redirectresponse'
            ]) {
              const lc = laravelClassMap.get(lvCore);
              if (lc) pushClassMembers(lc, '1');
            }
          } else {
            for (const wsgCore of ['ttabel', 'tform', 'tquery', 'tpage', 'tuploadfile', 'tmodal']) {
              const wc = wisanggeniClassMap.get(wsgCore);
              if (wc) pushClassMembers(wc, '1');
            }
          }
          for (const commonName of [
            'mysqli_result',
            'mysqli',
            'mysqli_stmt',
            'pdostatement',
            'pdo',
            'datetime'
          ]) {
            const c = classMap.get(commonName);
            if (c) pushClassMembers(c, '2');
          }
          for (const [, userCls] of ctx.mergedUserClasses) {
            pushClassMembers(userCls, '3');
          }
        }

        return { suggestions };
      }

      // D. Static Scope Access: Route::... / DB::... / Schema::... / User::... / PDO::FETCH_ASSOC / self::...
      const staticMatch = linePrefix.match(/\\?([A-Za-z_][A-Za-z0-9_\\]*)\s*::\s*([A-Za-z_0-9]*)$/);
      if (staticMatch) {
        const rawClass = staticMatch[1].split('\\').pop() ?? staticMatch[1];
        const typedStatic = staticMatch[2];
        const range: monaco.IRange = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: position.column - typedStatic.length,
          endColumn: position.column
        };

        let targetCls: PhpClassMeta | undefined;
        if (rawClass === 'self' || rawClass === 'static') {
          targetCls =
            ctx.currentAnalysis.enclosingClassAtLine(position.lineNumber) ?? undefined;
        } else {
          targetCls = resolveAnyClass(rawClass, ctx.mergedUserClasses);
        }

        const suggestions: monaco.languages.CompletionItem[] = [
          {
            label: 'class',
            kind: monaco.languages.CompletionItemKind.Keyword,
            detail: 'Nama FQCN class (::class)',
            insertText: 'class',
            sortText: '0_class',
            range
          }
        ];

        if (targetCls) {
          const originTag: 'wisanggeni' | 'laravel' | 'default' =
            targetCls.origin === 'wisanggeni' || wisanggeniClassMap.has(targetCls.name.toLowerCase())
              ? 'wisanggeni'
              : targetCls.origin === 'laravel' || laravelClassMap.has(targetCls.name.toLowerCase())
                ? 'laravel'
                : 'default';
          for (const m of targetCls.members) {
            if (!m.isStatic && m.kind !== 'constant') continue;
            suggestions.push(memberToCompletion(m, targetCls.name, range, '0', originTag));
          }
        }

        return { suggestions };
      }

      // E. Variabel & Superglobal ($...)
      const varMatch = linePrefix.match(/(\$[A-Za-z_0-9]*)$/);
      if (varMatch && !isInsidePhpLineCommentOnly(linePrefix)) {
        const typedVar = varMatch[1];
        const range: monaco.IRange = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: position.column - typedVar.length,
          endColumn: position.column
        };

        const suggestions: monaco.languages.CompletionItem[] = [];
        const superSet = new Set(SUPERGLOBALS.map((s) => s.name));

        for (const [vName, vType] of ctx.mergedVars) {
          if (superSet.has(vName)) continue;
          const isWsgGlobal = !ctx.isLaravelCtx && Boolean(wisanggeniGlobalVars[vName]);
          const refCls =
            vType !== 'mixed'
              ? laravelClassMap.get(vType.toLowerCase()) ??
                wisanggeniClassMap.get(vType.toLowerCase())
              : undefined;
          suggestions.push({
            label: vName,
            kind: monaco.languages.CompletionItemKind.Variable,
            detail: isWsgGlobal
              ? `[Wisanggeni Global] ${vType}`
              : vType === 'BladeLoop'
                ? '[Laravel Blade] $loop'
                : vType !== 'mixed'
                  ? `Variabel (${vType})`
                  : 'Variabel PHP',
            documentation: refCls?.doc ? { value: refCls.doc } : undefined,
            insertText: vName,
            filterText: vName,
            sortText: `0_${vName}`,
            range
          });
        }

        for (const sg of SUPERGLOBALS) {
          suggestions.push({
            label: sg.name,
            kind: monaco.languages.CompletionItemKind.Variable,
            detail: `Superglobal (${sg.type})`,
            documentation: { value: sg.doc },
            insertText: sg.name,
            filterText: sg.name,
            sortText: `1_${sg.name}`,
            range
          });
        }

        return { suggestions };
      }

      // F1. Instansiasi Objek Baru: `new User(...)` / `new Collection(...)` / `new TTabel(...)`
      const newInstMatch = linePrefix.match(/\bnew\s+\\?([A-Za-z_0-9]*)$/);
      if (newInstMatch) {
        const word = model.getWordUntilPosition(position);
        const range: monaco.IRange = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn
        };

        const suggestions: monaco.languages.CompletionItem[] = [];
        const seenCls = new Set<string>();

        const pushCtorClass = (
          cls: PhpClassMeta,
          badge: string,
          sortPrefix: string
        ): void => {
          const k = cls.name.toLowerCase();
          if (seenCls.has(k)) return;
          seenCls.add(k);
          const ctorParams = cls.constructorParams ?? [];
          const sig = `${cls.name}(${formatParamsSignature(ctorParams)})`;
          suggestions.push({
            label: cls.name,
            kind: monaco.languages.CompletionItemKind.Class,
            detail: `${badge} new ${sig}`,
            documentation: cls.doc ? { value: cls.doc } : undefined,
            insertText: buildFunctionSnippetInsert(cls.name, ctorParams),
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            sortText: `${sortPrefix}_${cls.name}`,
            range,
            command:
              ctorParams.length > 0
                ? { id: 'editor.action.triggerParameterHints', title: 'Parameter Hints' }
                : undefined
          });
        };

        for (const [, uCls] of ctx.mergedUserClasses) {
          pushCtorClass(uCls, '[Class Proyek]', '0');
        }
        for (const [, lCls] of laravelClassMap) {
          pushCtorClass(lCls, '[Laravel]', '0');
        }
        for (const [, wCls] of wisanggeniClassMap) {
          pushCtorClass(wCls, '[Wisanggeni]', '0');
        }
        for (const [, bCls] of classMap) {
          pushCtorClass(bCls, '[PHP]', '1');
        }

        return { suggestions };
      }

      // F2. Identifier Umum: Fungsi Proyek, Laravel Helpers & Facades, Wisanggeni Helpers & Classes, Snippet PHP, Fungsi Bawaan PHP 8
      // Guard ketat agar saran tidak mengganggu saat mengetik di komentar, string biasa, atau trigger acak (kecuali Ctrl+Space manual)
      const isExplicitInvoke =
        context.triggerKind === monaco.languages.CompletionTriggerKind.Invoke;
      if (!isExplicitInvoke) {
        if (isInsidePhpLineCommentOrPlainQuote(linePrefix)) {
          return { suggestions: [] };
        }
        if (context.triggerKind === monaco.languages.CompletionTriggerKind.TriggerCharacter) {
          return { suggestions: [] };
        }
      }
      const word = model.getWordUntilPosition(position);
      if (!isExplicitInvoke && word.word.length < 2) {
        return { suggestions: [] };
      }
      const range: monaco.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn
      };

      const suggestions: monaco.languages.CompletionItem[] = [];
      const seenFuncKeys = new Set<string>();

      // 1. Fungsi buatan pengguna di file aktif / tab lain / workspace
      for (const [fKey, uFn] of ctx.mergedUserFuncs) {
        seenFuncKeys.add(fKey);
        suggestions.push({
          label: uFn.name,
          kind: monaco.languages.CompletionItemKind.Function,
          detail: `[Proyek] ${formatFunctionSignature(uFn)}`,
          documentation: uFn.relativePath
            ? { value: `Didefinisikan di \`${uFn.relativePath}\`` }
            : undefined,
          insertText: buildFunctionSnippetInsert(uFn.name, uFn.params),
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          sortText: `0_${uFn.name}`,
          range,
          command:
            uFn.params.length > 0
              ? { id: 'editor.action.triggerParameterHints', title: 'Parameter Hints' }
              : undefined
        });
      }

      // 1A. Fungsi Global / Helper Framework Laravel (route, view, redirect, collect, request, response, auth, config, env, abort, dd, dll.)
      for (const [fKey, lFn] of laravelFunctionMap) {
        if (seenFuncKeys.has(fKey)) continue;
        seenFuncKeys.add(fKey);
        suggestions.push({
          label: lFn.name,
          kind: monaco.languages.CompletionItemKind.Function,
          detail: `[Laravel Helper] ${formatFunctionSignature(lFn)}`,
          documentation: lFn.doc ? { value: lFn.doc } : undefined,
          insertText: buildFunctionSnippetInsert(lFn.name, lFn.params),
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          sortText: ctx.isLaravelCtx ? `0_lv_${lFn.name}` : `1_lv_${lFn.name}`,
          range,
          command:
            lFn.params.length > 0
              ? { id: 'editor.action.triggerParameterHints', title: 'Parameter Hints' }
              : undefined
        });
      }

      // 1B. Fungsi Global / Helper Framework Wisanggeni (getGET, getPOST, encid, decid, dosql, alert_box, button_link, dll.)
      for (const [fKey, wFn] of wisanggeniFunctionMap) {
        if (seenFuncKeys.has(fKey)) continue;
        seenFuncKeys.add(fKey);
        suggestions.push({
          label: wFn.name,
          kind: monaco.languages.CompletionItemKind.Function,
          detail: `[Wisanggeni] ${formatFunctionSignature(wFn)}`,
          documentation: wFn.doc
            ? { value: wFn.doc }
            : wFn.relativePath
              ? { value: `Helper Wisanggeni di \`${wFn.relativePath}\`` }
              : undefined,
          insertText: buildFunctionSnippetInsert(wFn.name, wFn.params),
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          sortText: !ctx.isLaravelCtx && wFn.doc ? `0_wsg_${wFn.name}` : `1_wsg_${wFn.name}`,
          range,
          command:
            wFn.params.length > 0
              ? { id: 'editor.action.triggerParameterHints', title: 'Parameter Hints' }
              : undefined
        });
      }

      // 2. Snippet kontrol & template database PHP
      for (const snip of PHP_SNIPPETS) {
        suggestions.push({
          label: snip.trigger,
          kind: monaco.languages.CompletionItemKind.Snippet,
          detail: `[PHP Snippet] ${snip.detail}`,
          documentation: { value: snip.doc },
          insertText: snip.body,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          sortText: `1_${snip.trigger}`,
          range
        });
      }

      // 3. Keyword PHP
      for (const kw of PHP_KEYWORDS) {
        suggestions.push({
          label: kw,
          kind: monaco.languages.CompletionItemKind.Keyword,
          detail: 'PHP Keyword',
          insertText: kw,
          sortText: `2_${kw}`,
          range
        });
      }

      // 4. Seluruh fungsi bawaan PHP 8 (terkurasi + hasil refleksi runtime PHP CLI)
      for (const [fKey, fn] of functionMap) {
        if (seenFuncKeys.has(fKey)) continue;
        suggestions.push({
          label: fn.name,
          kind: monaco.languages.CompletionItemKind.Function,
          detail: formatFunctionSignature(fn),
          documentation: fn.doc ? { value: fn.doc } : undefined,
          insertText: buildFunctionSnippetInsert(fn.name, fn.params),
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          sortText: fn.doc ? `2_${fn.name}` : `3_${fn.name}`,
          range,
          command:
            fn.params.length > 0
              ? { id: 'editor.action.triggerParameterHints', title: 'Parameter Hints' }
              : undefined
        });
      }

      // 5. Class Proyek, Facade & Model Laravel, Class Wisanggeni, & Class Bawaan PHP
      const seenClasses = new Set<string>();
      for (const [cKey, uCls] of ctx.mergedUserClasses) {
        seenClasses.add(cKey);
        suggestions.push({
          label: uCls.name,
          kind: monaco.languages.CompletionItemKind.Class,
          detail: `[Class Proyek] ${uCls.relativePath ?? ''}`,
          documentation: uCls.doc ? { value: uCls.doc } : undefined,
          insertText: uCls.name,
          sortText: `0_usr_${uCls.name}`,
          range
        });
      }
      for (const [cKey, lCls] of laravelClassMap) {
        if (cKey === 'bladeloop' || seenClasses.has(cKey)) continue;
        seenClasses.add(cKey);
        suggestions.push({
          label: lCls.name,
          kind: monaco.languages.CompletionItemKind.Class,
          detail: `[Laravel] ${lCls.relativePath ?? 'Illuminate\\Support\\Facades'}`,
          documentation: lCls.doc ? { value: lCls.doc } : undefined,
          insertText: lCls.name,
          sortText: ctx.isLaravelCtx ? `0_lv_${lCls.name}` : `1_lv_${lCls.name}`,
          range
        });
      }
      for (const [cKey, wCls] of wisanggeniClassMap) {
        if (seenClasses.has(cKey)) continue;
        seenClasses.add(cKey);
        suggestions.push({
          label: wCls.name,
          kind: monaco.languages.CompletionItemKind.Class,
          detail: `[Wisanggeni Class] ${wCls.relativePath ?? 'wisanggeni/classes'}`,
          documentation: wCls.doc ? { value: wCls.doc } : undefined,
          insertText: wCls.name,
          sortText: !ctx.isLaravelCtx ? `0_wsg_${wCls.name}` : `1_wsg_${wCls.name}`,
          range
        });
      }
      for (const [cKey, bCls] of classMap) {
        if (seenClasses.has(cKey)) continue;
        suggestions.push({
          label: bCls.name,
          kind: monaco.languages.CompletionItemKind.Class,
          detail: 'PHP Built-in Class',
          insertText: bCls.name,
          sortText: `3_${bCls.name}`,
          range
        });
      }

      // 6. Konstanta PHP
      for (const cst of constantSet) {
        suggestions.push({
          label: cst,
          kind: monaco.languages.CompletionItemKind.Constant,
          detail: 'PHP Constant',
          insertText: cst,
          sortText: `4_${cst}`,
          range
        });
      }

      return { suggestions };
    }
  });

  // 2. PARAMETER HINTS (SIGNATURE HELP PROVIDER)
  monaco.languages.registerSignatureHelpProvider('php', {
    signatureHelpTriggerCharacters: ['(', ','],
    signatureHelpRetriggerCharacters: [','],
    provideSignatureHelp(model, position) {
      const startLine = Math.max(1, position.lineNumber - 8);
      const textBefore = model.getValueInRange({
        startLineNumber: startLine,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column
      });

      // Scan backward to find unmatched '(' and count top-level commas
      let depth = 0;
      let activeParam = 0;
      let openParenIdx = -1;
      for (let i = textBefore.length - 1; i >= 0; i--) {
        const ch = textBefore[i];
        if (ch === ')') depth += 1;
        else if (ch === '(') {
          if (depth === 0) {
            openParenIdx = i;
            break;
          }
          depth -= 1;
        } else if (ch === ',' && depth === 0) {
          activeParam += 1;
        }
      }

      if (openParenIdx < 0) return null;

      const prefix = textBefore.slice(0, openParenIdx).trimEnd();
      const ctx = collectCombinedContext(model);

      let targetMeta: PhpFunctionMeta | undefined;

      // Case A1: Static Facade / Eloquent call `Route::get(`, `DB::table(`, `User::where(`
      const staticCall = prefix.match(/\\?([A-Za-z_][A-Za-z0-9_\\]*)\s*::\s*([A-Za-z_][A-Za-z0-9_]*)$/);
      // Case A2: Instance or fluent chained method call `$var->method(` or `DB::table('x')->where(`
      const arrowCall = !staticCall
        ? prefix.match(/([\s\S]*?)->\s*([A-Za-z_][A-Za-z0-9_]*)$/)
        : null;
      // Case B: Constructor call `new ClassName(`
      const ctorCall =
        !staticCall && !arrowCall ? prefix.match(/\bnew\s+\\?([A-Za-z_][A-Za-z0-9_\\]*)$/) : null;

      if (staticCall) {
        const rawCls = staticCall[1].split('\\').pop() ?? staticCall[1];
        const mLower = staticCall[2].toLowerCase();
        const cls =
          rawCls === 'self' || rawCls === 'static'
            ? ctx.currentAnalysis.enclosingClassAtLine(position.lineNumber) ?? undefined
            : resolveAnyClass(rawCls, ctx.mergedUserClasses);
        if (cls) {
          const found = cls.members.find(
            (item) => item.kind === 'method' && item.name.toLowerCase() === mLower
          );
          if (found) {
            targetMeta = {
              name: `${cls.name}::${found.name}`,
              params: found.params ?? [],
              returnType: found.type,
              doc: found.doc
            };
          }
        }
      } else if (arrowCall) {
        const exprBeforeArrow = arrowCall[1].replace(/\r?\n/g, ' ');
        const mName = arrowCall[2];
        const mLower = mName.toLowerCase();

        const preferredClass = inferFluentChainClass(
          exprBeforeArrow,
          ctx,
          position.lineNumber
        );

        const candidateClasses: PhpClassMeta[] = preferredClass
          ? [
              preferredClass,
              ...ctx.mergedUserClasses.values(),
              ...laravelClassMap.values(),
              ...wisanggeniClassMap.values(),
              ...classMap.values()
            ]
          : [
              ...ctx.mergedUserClasses.values(),
              ...laravelClassMap.values(),
              ...wisanggeniClassMap.values(),
              ...classMap.values()
            ];

        for (const cls of candidateClasses) {
          const found = cls.members.find(
            (m) => m.kind === 'method' && m.name.toLowerCase() === mLower
          );
          if (found) {
            targetMeta = {
              name: `${cls.name}->${found.name}`,
              params: found.params ?? [],
              returnType: found.type,
              doc: found.doc
            };
            break;
          }
        }
      } else if (ctorCall) {
        const shortCtor = ctorCall[1].split('\\').pop() ?? ctorCall[1];
        const cls = resolveAnyClass(shortCtor, ctx.mergedUserClasses);
        if (cls) {
          targetMeta = {
            name: `new ${cls.name}`,
            params: cls.constructorParams ?? [],
            returnType: cls.name,
            doc: cls.doc
          };
        }
      } else {
        const fnCall = prefix.match(/([A-Za-z_][A-Za-z0-9_]*)$/);
        if (fnCall) {
          const fKey = fnCall[1].toLowerCase();
          targetMeta =
            ctx.mergedUserFuncs.get(fKey) ??
            laravelFunctionMap.get(fKey) ??
            wisanggeniFunctionMap.get(fKey) ??
            functionMap.get(fKey);
        }
      }

      if (!targetMeta) return null;

      const paramInfos: monaco.languages.ParameterInformation[] = targetMeta.params.map((p) => {
        const label = formatParamsSignature([p]);
        return {
          label,
          documentation: p.optional ? 'Parameter opsional' : 'Parameter wajib'
        };
      });

      return {
        value: {
          signatures: [
            {
              label: formatFunctionSignature(targetMeta),
              documentation: targetMeta.doc ? { value: targetMeta.doc } : undefined,
              parameters: paramInfos
            }
          ],
          activeSignature: 0,
          activeParameter: Math.min(activeParam, Math.max(0, paramInfos.length - 1))
        },
        dispose: () => {}
      };
    }
  });

  // 3. HOVER DOCUMENTATION PROVIDER
  monaco.languages.registerHoverProvider('php', {
    provideHover(model, position) {
      const word = model.getWordAtPosition(position);
      if (!word) return null;

      const token = word.word;
      const ctx = collectCombinedContext(model);
      const range: monaco.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn
      };

      const lineBefore = model
        .getLineContent(position.lineNumber)
        .slice(0, word.startColumn - 1);

      // Blade @directive hover (e.g. @foreach, @csrf, @section, @vite)
      if (lineBefore.endsWith('@')) {
        const dirName = `@${token}`;
        const bladeDir = laravelBladeDirectives.find(
          (d) => d.name.toLowerCase() === dirName.toLowerCase()
        );
        if (bladeDir) {
          return {
            range: {
              ...range,
              startColumn: word.startColumn - 1
            },
            contents: [
              { value: `\`\`\`blade\n${bladeDir.name} — ${bladeDir.detail}\n\`\`\`` },
              { value: bladeDir.doc }
            ]
          };
        }
      }

      // Superglobal or local/Laravel/Wisanggeni variable
      if (token.startsWith('$')) {
        const sg = SUPERGLOBALS.find((s) => s.name === token);
        if (sg) {
          return {
            range,
            contents: [
              { value: `\`\`\`php\n${sg.name}: ${sg.type}\n\`\`\`` },
              { value: sg.doc }
            ]
          };
        }
        const vType = ctx.mergedVars.get(token);
        if (vType) {
          const contents: monaco.IMarkdownString[] = [
            { value: `\`\`\`php\n${token}: ${vType}\n\`\`\`` }
          ];
          if (!ctx.isLaravelCtx && wisanggeniGlobalVars[token]) {
            contents.push({
              value: `Instance global **Wisanggeni Framework** (dimuat melalui \`base.php\` / \`main_lib.php\`).`
            });
          }
          const refCls =
            vType !== 'mixed'
              ? laravelClassMap.get(vType.toLowerCase()) ??
                wisanggeniClassMap.get(vType.toLowerCase())
              : undefined;
          if (refCls?.doc) {
            contents.push({ value: refCls.doc });
          }
          return { range, contents };
        }
        return null;
      }

      const lower = token.toLowerCase();

      // Periksa akses static member (`Route::get`, `DB::table`, `Schema::create`, `User::where`)
      const staticPrefixMatch = lineBefore.match(/\\?([A-Za-z_][A-Za-z0-9_\\]*)\s*::\s*$/);
      if (staticPrefixMatch) {
        const rawCls = staticPrefixMatch[1].split('\\').pop() ?? staticPrefixMatch[1];
        const targetCls =
          rawCls === 'self' || rawCls === 'static'
            ? ctx.currentAnalysis.enclosingClassAtLine(position.lineNumber) ?? undefined
            : resolveAnyClass(rawCls, ctx.mergedUserClasses);
        if (targetCls) {
          const m = targetCls.members.find((item) => item.name.toLowerCase() === lower);
          if (m) {
            const sig =
              m.kind === 'method'
                ? `${targetCls.name}::${m.name}(${formatParamsSignature(m.params ?? [])})${
                    m.type ? `: ${m.type}` : ''
                  }`
                : `${targetCls.name}::${m.name}`;
            const contents: monaco.IMarkdownString[] = [{ value: `\`\`\`php\n${sig}\n\`\`\`` }];
            if (m.doc) contents.push({ value: m.doc });
            if (targetCls.relativePath) {
              contents.push({
                value: `*Sumber Class:* \`${targetCls.relativePath}\`${m.line ? ` (baris ${m.line})` : ''}`
              });
            }
            return { range, contents };
          }
        }
      }

      // Periksa akses member objek & fluent chain (`$request->validate`, `DB::table('x')->where`, `$form->textbox`)
      if (/->\s*$/.test(lineBefore)) {
        const exprBeforeArrow = lineBefore.replace(/->\s*$/, '');
        const preferredCls = inferFluentChainClass(
          exprBeforeArrow,
          ctx,
          position.lineNumber
        );

        const searchOrder: PhpClassMeta[] = preferredCls
          ? [
              preferredCls,
              ...ctx.mergedUserClasses.values(),
              ...laravelClassMap.values(),
              ...wisanggeniClassMap.values(),
              ...classMap.values()
            ]
          : [
              ...ctx.mergedUserClasses.values(),
              ...laravelClassMap.values(),
              ...wisanggeniClassMap.values(),
              ...classMap.values()
            ];

        for (const cls of searchOrder) {
          const m = cls.members.find((item) => item.name.toLowerCase() === lower);
          if (m) {
            const sig =
              m.kind === 'method'
                ? `${cls.name}->${m.name}(${formatParamsSignature(m.params ?? [])})${
                    m.type ? `: ${m.type}` : ''
                  }`
                : `${cls.name}::$${m.name}${m.type ? `: ${m.type}` : ''}`;
            const contents: monaco.IMarkdownString[] = [{ value: `\`\`\`php\n${sig}\n\`\`\`` }];
            if (m.doc) contents.push({ value: m.doc });
            if (cls.relativePath) {
              contents.push({
                value: `*Sumber Class:* \`${cls.relativePath}\`${m.line ? ` (baris ${m.line})` : ''}`
              });
            }
            return { range, contents };
          }
        }
      }

      // Periksa Class terlebih dahulu bila didahului `new ` atau `::` di kanan, atau tidak bentrok fungsi
      const lineAfter = model.getLineContent(position.lineNumber).slice(word.endColumn - 1);
      const cls = resolveAnyClass(token, ctx.mergedUserClasses);
      if (
        cls &&
        (/\bnew\s+\\?$/.test(lineBefore) ||
          /^\s*::/.test(lineAfter) ||
          (!functionMap.has(lower) && !laravelFunctionMap.has(lower)))
      ) {
        const ctorSig = cls.constructorParams
          ? `new ${cls.name}(${formatParamsSignature(cls.constructorParams)})`
          : `class ${cls.name}`;
        const contents: monaco.IMarkdownString[] = [
          {
            value: `\`\`\`php\n${ctorSig} // ${cls.members.length} anggota publik\n\`\`\``
          }
        ];
        if (cls.doc) contents.push({ value: cls.doc });
        if (cls.relativePath) {
          contents.push({
            value: `*Sumber:* \`${cls.relativePath}\`${cls.line ? ` (baris ${cls.line})` : ''}`
          });
        }
        return { range, contents };
      }

      const fn =
        ctx.mergedUserFuncs.get(lower) ??
        laravelFunctionMap.get(lower) ??
        wisanggeniFunctionMap.get(lower) ??
        functionMap.get(lower);
      if (fn) {
        const contents: monaco.IMarkdownString[] = [
          { value: `\`\`\`php\nfunction ${formatFunctionSignature(fn)}\n\`\`\`` }
        ];
        if (fn.doc) contents.push({ value: fn.doc });
        if (fn.relativePath) {
          contents.push({ value: `*Sumber:* \`${fn.relativePath}\` (baris ${fn.line ?? 1})` });
        } else if (fn.origin === 'laravel') {
          contents.push({ value: `*Kerangka Kerja:* **Laravel Helper**` });
        } else if (fn.extension) {
          contents.push({ value: `*Ekstensi PHP:* \`${fn.extension}\`` });
        }
        return { range, contents };
      }

      if (cls) {
        const contents: monaco.IMarkdownString[] = [
          {
            value: `\`\`\`php\nclass ${cls.name} // ${cls.members.length} anggota publik\n\`\`\``
          }
        ];
        if (cls.doc) contents.push({ value: cls.doc });
        return { range, contents };
      }

      return null;
    }
  });

  // 4. DOCUMENT SYMBOL & DEFINITION PROVIDER (F12 / Ctrl+Shift+O pada file aktif)
  monaco.languages.registerDocumentSymbolProvider('php', {
    provideDocumentSymbols(model) {
      const analysis = analyzePhpSource(model.getValue(), 'current');
      const symbols: monaco.languages.DocumentSymbol[] = [];

      for (const fn of analysis.functions) {
        const ln = fn.line ?? 1;
        const r = new monaco.Range(ln, 1, ln, model.getLineMaxColumn(ln));
        symbols.push({
          name: fn.name,
          detail: `(${formatParamsSignature(fn.params)})`,
          kind: monaco.languages.SymbolKind.Function,
          tags: [],
          range: r,
          selectionRange: r
        });
      }

      for (const cls of analysis.classes) {
        const ln = cls.line ?? 1;
        const r = new monaco.Range(ln, 1, ln, model.getLineMaxColumn(ln));
        symbols.push({
          name: cls.name,
          detail: 'class',
          kind: monaco.languages.SymbolKind.Class,
          tags: [],
          range: r,
          selectionRange: r,
          children: cls.members.map((m) => {
            const mln = m.line ?? ln;
            const mr = new monaco.Range(mln, 1, mln, model.getLineMaxColumn(mln));
            return {
              name: m.name,
              detail: m.type ?? '',
              kind:
                m.kind === 'method'
                  ? monaco.languages.SymbolKind.Method
                  : monaco.languages.SymbolKind.Property,
              tags: [],
              range: mr,
              selectionRange: mr
            };
          })
        });
      }

      return symbols;
    }
  });

  monaco.languages.registerDefinitionProvider('php', {
    provideDefinition(model, position) {
      const word = model.getWordAtPosition(position);
      if (!word) return null;
      const analysis = analyzePhpSource(model.getValue(), 'current');
      const lower = word.word.toLowerCase();

      const fn = analysis.functions.find((f) => f.name.toLowerCase() === lower);
      if (fn?.line) {
        return {
          uri: model.uri,
          range: new monaco.Range(fn.line, 1, fn.line, model.getLineMaxColumn(fn.line))
        };
      }

      const cls = analysis.classes.find((c) => c.name.toLowerCase() === lower);
      if (cls?.line) {
        return {
          uri: model.uri,
          range: new monaco.Range(cls.line, 1, cls.line, model.getLineMaxColumn(cls.line))
        };
      }

      return null;
    }
  });

  // 5. LIVE DATABASE SCHEMA & CONTEXT-AWARE SQL AUTOCOMPLETE (SQL Runner, .sql, & PHP SQL Strings)
  const SQL_KEYWORDS: Array<{ label: string; insertText: string; detail: string; isSnippet?: boolean }> = [
    {
      label: 'SELECT * FROM ... LIMIT 100',
      insertText: 'SELECT * FROM ${1:nama_tabel} LIMIT ${2:100};',
      detail: 'Template Query SELECT Cepat',
      isSnippet: true
    },
    {
      label: 'SELECT ... WHERE ...',
      insertText: 'SELECT ${1:*} FROM ${2:nama_tabel} WHERE ${3:kolom} = ${4:nilai};',
      detail: 'Template SELECT dengan Filter WHERE',
      isSnippet: true
    },
    {
      label: 'INSERT INTO ... VALUES ...',
      insertText: 'INSERT INTO ${1:nama_tabel} (${2:kolom1, kolom2}) VALUES (${3:nilai1, nilai2});',
      detail: 'Template INSERT Baris Baru',
      isSnippet: true
    },
    {
      label: 'UPDATE ... SET ... WHERE ...',
      insertText: 'UPDATE ${1:nama_tabel} SET ${2:kolom} = ${3:nilai} WHERE ${4:id} = ${5:1};',
      detail: 'Template UPDATE Aman dengan WHERE',
      isSnippet: true
    },
    {
      label: 'DELETE FROM ... WHERE ...',
      insertText: 'DELETE FROM ${1:nama_tabel} WHERE ${2:id} = ${3:1};',
      detail: 'Template DELETE dengan WHERE',
      isSnippet: true
    },
    {
      label: 'LEFT JOIN ... ON ...',
      insertText: 'LEFT JOIN ${1:tabel_relasi} ${2:b} ON ${2:b}.${3:id} = ${4:a}.${3:id}',
      detail: 'Template Relasi LEFT JOIN',
      isSnippet: true
    },
    { label: 'SELECT', insertText: 'SELECT ', detail: 'SQL Clause' },
    { label: 'DISTINCT', insertText: 'DISTINCT ', detail: 'SQL Keyword' },
    { label: 'FROM', insertText: 'FROM ', detail: 'SQL Clause' },
    { label: 'WHERE', insertText: 'WHERE ', detail: 'SQL Clause' },
    { label: 'AND', insertText: 'AND ', detail: 'SQL Operator' },
    { label: 'OR', insertText: 'OR ', detail: 'SQL Operator' },
    { label: 'ORDER BY', insertText: 'ORDER BY ', detail: 'SQL Clause' },
    { label: 'GROUP BY', insertText: 'GROUP BY ', detail: 'SQL Clause' },
    { label: 'HAVING', insertText: 'HAVING ', detail: 'SQL Clause' },
    { label: 'LIMIT', insertText: 'LIMIT ', detail: 'SQL Clause' },
    { label: 'OFFSET', insertText: 'OFFSET ', detail: 'SQL Clause' },
    { label: 'LEFT JOIN', insertText: 'LEFT JOIN ', detail: 'SQL Join' },
    { label: 'INNER JOIN', insertText: 'INNER JOIN ', detail: 'SQL Join' },
    { label: 'RIGHT JOIN', insertText: 'RIGHT JOIN ', detail: 'SQL Join' },
    { label: 'ON', insertText: 'ON ', detail: 'SQL Join Condition' },
    { label: 'AS', insertText: 'AS ', detail: 'SQL Alias' },
    { label: 'IN (...)', insertText: 'IN (${1:nilai})', detail: 'SQL Operator', isSnippet: true },
    { label: 'NOT IN (...)', insertText: 'NOT IN (${1:nilai})', detail: 'SQL Operator', isSnippet: true },
    { label: 'LIKE', insertText: "LIKE '%${1:kata}%'", detail: 'SQL Pattern Match', isSnippet: true },
    { label: 'BETWEEN', insertText: 'BETWEEN ${1:awal} AND ${2:akhir}', detail: 'SQL Range', isSnippet: true },
    { label: 'IS NULL', insertText: 'IS NULL', detail: 'SQL Null Check' },
    { label: 'IS NOT NULL', insertText: 'IS NOT NULL', detail: 'SQL Not Null Check' },
    { label: 'ASC', insertText: 'ASC', detail: 'Urutan Menaik' },
    { label: 'DESC', insertText: 'DESC', detail: 'Urutan Menurun' },
    { label: 'UNION ALL', insertText: 'UNION ALL\n', detail: 'SQL Set Operator' },
    { label: 'INSERT INTO', insertText: 'INSERT INTO ', detail: 'SQL DML' },
    { label: 'VALUES', insertText: 'VALUES ', detail: 'SQL DML' },
    { label: 'UPDATE', insertText: 'UPDATE ', detail: 'SQL DML' },
    { label: 'SET', insertText: 'SET ', detail: 'SQL DML' },
    { label: 'DELETE FROM', insertText: 'DELETE FROM ', detail: 'SQL DML' },
    { label: 'SHOW TABLES', insertText: 'SHOW TABLES;', detail: 'SQL Utility' },
    { label: 'DESCRIBE', insertText: 'DESCRIBE ', detail: 'SQL Struktur Tabel' },
    { label: 'EXPLAIN', insertText: 'EXPLAIN ', detail: 'SQL Query Plan' },
    { label: 'COUNT(*)', insertText: 'COUNT(${1:*})', detail: 'SQL Aggregate Function', isSnippet: true },
    { label: 'SUM(...)', insertText: 'SUM(${1:kolom})', detail: 'SQL Aggregate Function', isSnippet: true },
    { label: 'AVG(...)', insertText: 'AVG(${1:kolom})', detail: 'SQL Aggregate Function', isSnippet: true },
    { label: 'MAX(...)', insertText: 'MAX(${1:kolom})', detail: 'SQL Aggregate Function', isSnippet: true },
    { label: 'MIN(...)', insertText: 'MIN(${1:kolom})', detail: 'SQL Aggregate Function', isSnippet: true },
    { label: 'COALESCE(...)', insertText: 'COALESCE(${1:kolom}, ${2:0})', detail: 'SQL Null Fallback', isSnippet: true },
    { label: 'IFNULL(...)', insertText: 'IFNULL(${1:kolom}, ${2:0})', detail: 'MySQL Null Fallback', isSnippet: true },
    { label: 'CONCAT(...)', insertText: "CONCAT(${1:kolom1}, ' ', ${2:kolom2})", detail: 'SQL String Function', isSnippet: true },
    { label: 'GROUP_CONCAT(...)', insertText: 'GROUP_CONCAT(${1:kolom})', detail: 'MySQL Aggregate String', isSnippet: true },
    { label: 'DATE_FORMAT(...)', insertText: "DATE_FORMAT(${1:kolom_tgl}, '%Y-%m-%d')", detail: 'MySQL Date Format', isSnippet: true },
    { label: 'NOW()', insertText: 'NOW()', detail: 'Waktu Saat Ini' },
    { label: 'CURDATE()', insertText: 'CURDATE()', detail: 'Tanggal Hari Ini' },
    {
      label: 'CASE WHEN ... END',
      insertText: 'CASE WHEN ${1:kondisi} THEN ${2:hasil1} ELSE ${3:hasil2} END',
      detail: 'SQL Conditional Expression',
      isSnippet: true
    }
  ];

  function provideDbSchemaCompletions(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    context: monaco.languages.CompletionContext,
    lang: 'sql' | 'php',
    phpSqlCtx?: DetectedPhpSqlContext
  ): monaco.languages.CompletionList {
    const linePrefix = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
    const fullText = model.getValue();
    const textBeforeCursor = model.getValueInRange({
      startLineNumber: Math.max(1, position.lineNumber - 45),
      startColumn: 1,
      endLineNumber: position.lineNumber,
      endColumn: position.column
    });

    const isExplicitInvoke =
      context.triggerKind === monaco.languages.CompletionTriggerKind.Invoke;

    // Jangan ganggu pengguna saat mengetik nilai string di dalam '...' pada SQL (kecuali dipanggil manual Ctrl+Space)
    if (lang === 'sql' && !isExplicitInvoke && isInsideSqlSingleQuoteLiteral(textBeforeCursor)) {
      return { suggestions: [] };
    }

    const liveCat = indexedDbCatalog;
    const curDb = liveCat?.snapshot.currentDatabase ?? '';
    const curDbLower = curDb.toLowerCase();
    const engineLabel = liveCat ? liveCat.snapshot.engine.toUpperCase() : 'SQL';

    // Fallback catalog extracted automatically from open PHP & SQL buffers (works offline & for remote SFTP code!)
    const fallbackSources = [fullText, ...getOpenPhpBuffers().map((b) => b.content)];
    const fallbackCat = extractFallbackSqlEntities(fallbackSources);

    // Unified lookup helpers combining Live DB Schema + Fallback Code SQL Entities
    const mergedDbNames: Array<{ name: string; tableCount: number; source: 'live' | 'code' }> = [];
    const seenDbLower = new Set<string>();
    if (liveCat) {
      for (const dbName of liveCat.userDatabases) {
        const low = dbName.toLowerCase();
        if (seenDbLower.has(low)) continue;
        seenDbLower.add(low);
        mergedDbNames.push({
          name: dbName,
          tableCount: liveCat.tablesByDbLower.get(low)?.length ?? 0,
          source: 'live'
        });
      }
    }
    for (const dbName of fallbackCat.databases) {
      const low = dbName.toLowerCase();
      if (seenDbLower.has(low)) continue;
      seenDbLower.add(low);
      const count = fallbackCat.tables.filter((t) => t.schema?.toLowerCase() === low).length;
      mergedDbNames.push({ name: dbName, tableCount: count, source: 'code' });
    }

    const findTablesForDbLower = (dbLow: string): DbTableMeta[] => {
      const out: DbTableMeta[] = [];
      const seen = new Set<string>();
      for (const t of liveCat?.tablesByDbLower.get(dbLow) ?? []) {
        seen.add(t.name.toLowerCase());
        out.push(t);
      }
      for (const t of fallbackCat.tables) {
        if (t.schema?.toLowerCase() === dbLow && !seen.has(t.name.toLowerCase())) {
          seen.add(t.name.toLowerCase());
          out.push(t);
        }
      }
      return out;
    };

    const findTableByFullKey = (dbLow: string, tblLow: string): DbTableMeta | undefined => {
      const liveMatch = liveCat?.tableByFullKeyLower.get(`${dbLow}.${tblLow}`);
      if (liveMatch) return liveMatch;
      return fallbackCat.tables.find(
        (t) => t.schema?.toLowerCase() === dbLow && t.name.toLowerCase() === tblLow
      );
    };

    const findTablesByNameLower = (tblLow: string): DbTableMeta[] => {
      const out: DbTableMeta[] = [];
      const seenFull = new Set<string>();
      const liveMatches = liveCat?.tablesByNameLower.get(tblLow) ?? [];
      // Put currentDatabase table first if present
      const sortedLive = [...liveMatches].sort((a, b) => {
        const aCur = (a.schema ?? '').toLowerCase() === curDbLower ? 0 : 1;
        const bCur = (b.schema ?? '').toLowerCase() === curDbLower ? 0 : 1;
        return aCur - bCur;
      });
      for (const t of sortedLive) {
        const k = `${(t.schema ?? '').toLowerCase()}.${t.name.toLowerCase()}`;
        seenFull.add(k);
        out.push(t);
      }
      for (const t of fallbackCat.tables) {
        if (t.name.toLowerCase() !== tblLow) continue;
        const k = `${(t.schema ?? '').toLowerCase()}.${t.name.toLowerCase()}`;
        if (!seenFull.has(k)) {
          seenFull.add(k);
          out.push(t);
        }
      }
      return out;
    };

    // Extract referenced tables in active query (fallback to full file if current query hasn't written FROM yet)
    const primarySqlSource = lang === 'php' && phpSqlCtx ? phpSqlCtx.activeSqlText : fullText;
    let queryRefs = extractReferencedSqlTables(primarySqlSource);
    if (queryRefs.refs.length === 0 && lang === 'php') {
      queryRefs = extractReferencedSqlTables(fullText);
    }

    const word = model.getWordUntilPosition(position);
    const range: monaco.IRange = {
      startLineNumber: position.lineNumber,
      endLineNumber: position.lineNumber,
      startColumn: word.startColumn,
      endColumn: word.endColumn
    };

    const suggestions: monaco.languages.CompletionItem[] = [];

    // 1A. Three-level dot completion: `nama_db.nama_tabel.` -> columns of `nama_db.nama_tabel`
    const threeDotMatch = linePrefix.match(
      /[`"']?([A-Za-z_][A-Za-z0-9_]*)[`"']?\.\s*[`"']?([A-Za-z_][A-Za-z0-9_]*)[`"']?\.\s*([A-Za-z_0-9]*)$/
    );
    if (threeDotMatch) {
      const dbLow = threeDotMatch[1].toLowerCase();
      const tblLow = threeDotMatch[2].toLowerCase();
      const typedCol = threeDotMatch[3];
      const dotRange: monaco.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: position.column - typedCol.length,
        endColumn: position.column
      };
      const exactTbl = findTableByFullKey(dbLow, tblLow);
      if (exactTbl) {
        for (const col of exactTbl.columns) {
          suggestions.push({
            label: { label: col.name, description: `${exactTbl.schema ?? threeDotMatch[1]}.${exactTbl.name}` },
            kind: monaco.languages.CompletionItemKind.Field,
            detail: `★ [Field] ${col.columnType}${col.isPrimaryKey ? ' • PK' : ''}`,
            documentation: `Kolom \`${col.name}\` pada \`${exactTbl.schema ?? threeDotMatch[1]}.${exactTbl.name}\``,
            insertText: col.name,
            filterText: col.name,
            sortText: `00_col_${col.name}`,
            range: dotRange
          });
        }
        return { suggestions };
      }
    }

    // 1B. Two-level dot completion: `alias.` or `nama_db.` or `nama_tabel.`
    const twoDotMatch = linePrefix.match(/[`"']?([A-Za-z_][A-Za-z0-9_]*)[`"']?\.\s*([A-Za-z_0-9]*)$/);
    if (twoDotMatch) {
      const rawPrefix = twoDotMatch[1];
      const prefixLow = rawPrefix.toLowerCase();
      const typedAfterDot = twoDotMatch[2];
      const dotRange: monaco.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: position.column - typedAfterDot.length,
        endColumn: position.column
      };

      const seenDotItems = new Set<string>();

      // (i) Alias / referenced table in current query (`u.` -> `sipegi.mst_unitkerja` columns)
      const aliasTarget = queryRefs.aliasToRef.get(prefixLow);
      if (aliasTarget) {
        const resolvedTbl = aliasTarget.schemaLower
          ? findTableByFullKey(aliasTarget.schemaLower, aliasTarget.tableLower)
          : findTablesByNameLower(aliasTarget.tableLower)[0];
        if (resolvedTbl) {
          for (const col of resolvedTbl.columns) {
            const k = `col:${col.name.toLowerCase()}`;
            if (seenDotItems.has(k)) continue;
            seenDotItems.add(k);
            suggestions.push({
              label: {
                label: col.name,
                description: resolvedTbl.schema ? `${resolvedTbl.schema}.${resolvedTbl.name}` : resolvedTbl.name
              },
              kind: monaco.languages.CompletionItemKind.Field,
              detail: `★ [Field ${resolvedTbl.name}] ${col.columnType}${col.isPrimaryKey ? ' • PK' : ''}`,
              documentation: `Kolom \`${col.name}\` pada tabel \`${resolvedTbl.name}\``,
              insertText: col.name,
              filterText: col.name,
              sortText: `00_0col_${col.name}`,
              range: dotRange
            });
          }
        }
      }

      // (ii) Database / Schema name (`sipegi.` -> all tables in `sipegi`)
      const dbTables = findTablesForDbLower(prefixLow);
      for (const tbl of dbTables) {
        const k = `tbl:${tbl.name.toLowerCase()}`;
        if (seenDotItems.has(k)) continue;
        seenDotItems.add(k);
        const colPreview = tbl.columns
          .slice(0, 12)
          .map((c) => `- \`${c.name}\` (${c.columnType}${c.isPrimaryKey ? ', PK' : ''})`)
          .join('\n');
        suggestions.push({
          label: { label: tbl.name, description: tbl.schema || rawPrefix },
          kind: monaco.languages.CompletionItemKind.Struct,
          detail: `[DB ${tbl.kind === 'view' ? 'View' : 'Table'}] ${tbl.columns.length} kolom`,
          documentation: colPreview
            ? {
                value: `**${tbl.schema || rawPrefix}.${tbl.name}**\n\n${colPreview}${
                  tbl.columns.length > 12 ? `\n- ... (+${tbl.columns.length - 12} kolom lainnya)` : ''
                }`
              }
            : undefined,
          insertText: tbl.name,
          filterText: tbl.name,
          sortText: `00_1tbl_${tbl.name}`,
          range: dotRange
        });
      }

      // (iii) Direct table name (`rekomendasi.` or `mst_unitkerja.` -> columns)
      if (!aliasTarget) {
        const namedTables = findTablesByNameLower(prefixLow);
        for (const tbl of namedTables) {
          for (const col of tbl.columns) {
            const k = `col:${col.name.toLowerCase()}`;
            if (seenDotItems.has(k)) continue;
            seenDotItems.add(k);
            suggestions.push({
              label: {
                label: col.name,
                description: tbl.schema ? `${tbl.schema}.${tbl.name}` : tbl.name
              },
              kind: monaco.languages.CompletionItemKind.Field,
              detail: `★ [Field ${tbl.name}] ${col.columnType}${col.isPrimaryKey ? ' • PK' : ''}`,
              insertText: col.name,
              filterText: col.name,
              sortText: `00_2col_${col.name}`,
              range: dotRange
            });
          }
        }
      }

      if (suggestions.length > 0) {
        return { suggestions };
      }
    }

    // 1C. PHP Table-Name-Only Builder Context (`DB::table('...')`, `Schema::table('...')`, `combobox_db('...')`)
    if (lang === 'php' && phpSqlCtx?.mode === 'table-only') {
      const seenTbls = new Set<string>();
      for (const tbl of liveCat?.snapshot.tables ?? []) {
        const k = `${curDbLower}.${tbl.name.toLowerCase()}`;
        seenTbls.add(k);
        suggestions.push({
          label: { label: tbl.name, description: curDb || engineLabel },
          kind: monaco.languages.CompletionItemKind.Struct,
          detail: `★ [Tabel Aktif] ${tbl.columns.length} kolom`,
          insertText: tbl.name,
          filterText: tbl.name,
          sortText: `00_0tbl_${tbl.name}`,
          range
        });
      }
      for (const tbl of [...(liveCat?.allTables ?? []), ...fallbackCat.tables]) {
        const schema = tbl.schema ?? '';
        const k = `${schema.toLowerCase()}.${tbl.name.toLowerCase()}`;
        if (seenTbls.has(k)) continue;
        seenTbls.add(k);
        const isOtherDb = Boolean(schema && curDbLower && schema.toLowerCase() !== curDbLower);
        const ins = isOtherDb ? `${schema}.${tbl.name}` : tbl.name;
        suggestions.push({
          label: { label: tbl.name, description: schema || 'SQL Proyek' },
          kind: monaco.languages.CompletionItemKind.Struct,
          detail: `[DB Table] ${tbl.columns.length} kolom`,
          insertText: ins,
          filterText: `${tbl.name} ${schema}.${tbl.name}`,
          sortText: `00_1xtbl_${tbl.name}`,
          range
        });
      }
      for (const db of mergedDbNames) {
        suggestions.push({
          label: { label: db.name, description: 'Database' },
          kind: monaco.languages.CompletionItemKind.Module,
          detail: `[Database] ${db.tableCount} tabel — ketik "." untuk daftar tabel`,
          insertText: db.name,
          filterText: db.name,
          sortText: `00_2db_${db.name}`,
          range
        });
      }
      return { suggestions };
    }

    // 2. Detect SQL Clause Context accurately (multi-line safe!)
    // Setelah dot-completion (`db.`, `alias.`) dan `DB::table('...')`, jangan memunculkan popup otomatis
    // sebelum minimal 2 huruf diketik (kecuali saat pengguna sengaja menekan Ctrl+Space).
    if (!isExplicitInvoke && word.word.length < 2) {
      return { suggestions: [] };
    }

    const sqlBefore = lang === 'php' && phpSqlCtx ? phpSqlCtx.activeSqlText : textBeforeCursor;
    const stmtBeforeCursor = sqlBefore.slice(sqlBefore.lastIndexOf(';') + 1);

    const isUseDbContext = /\buse\s+[`"']?[A-Za-z0-9_]*$/i.test(stmtBeforeCursor);

    const isTableClauseContext =
      /\b(?:from|join|update|into|describe|desc|truncate(?:\s+table)?|alter\s+table|drop\s+table(?:\s+if\s+exists)?)\s+(?:[`"']?[A-Za-z_][A-Za-z0-9_]*[`"']?(?:\.[`"']?[A-Za-z_][A-Za-z0-9_]*[`"']?)?(?:\s+(?:as\s+)?[A-Za-z_][A-Za-z0-9_]*)?\s*,\s*)*[`"']?[A-Za-z0-9_]*$/i.test(
        stmtBeforeCursor
      );

    const isJoinTableTargetContext = /\bjoin\s+[`"']?[A-Za-z0-9_]*$/i.test(stmtBeforeCursor);

    const isOnConditionStartContext = /\bon\s+[`"']?[A-Za-z0-9_]*$/i.test(stmtBeforeCursor);

    const isPostTableSpaceContext =
      /\b(?:from|join)\s+(?:[`"']?[A-Za-z_][A-Za-z0-9_]*[`"']?\.)?[`"']?[A-Za-z_][A-Za-z0-9_]*[`"']?(?:\s+(?:as\s+)?[A-Za-z_][A-Za-z0-9_]*)?\s+$/i.test(
        stmtBeforeCursor
      ) && !isTableClauseContext;

    const isColumnClauseContext =
      /\b(?:select|distinct|where|and|or|on|having|set|by|when|then|else)\s+[`"']?[A-Za-z0-9_]*$/i.test(
        stmtBeforeCursor
      ) || /(?:,|!=|<>|<=|>=|=|<|>|\()\s*[`"']?[A-Za-z0-9_]*$/.test(stmtBeforeCursor);

    // Build combined schema tables + learned JOIN patterns for Smart JOIN completions
    const combinedSchemaTables: DbTableMeta[] = (() => {
      const seen = new Set<string>();
      const list: DbTableMeta[] = [];
      for (const t of [...(liveCat?.allTables ?? []), ...fallbackCat.tables]) {
        const k = `${(t.schema ?? '').toLowerCase()}.${t.name.toLowerCase()}`;
        if (!seen.has(k)) {
          seen.add(k);
          list.push(t);
        }
      }
      return list;
    })();

    const learnedJoinEdges =
      isJoinTableTargetContext || isOnConditionStartContext || isPostTableSpaceContext
        ? getCombinedLearnedJoinEdges([fullText])
        : [];

    const isSpaceTrigger =
      context.triggerKind === monaco.languages.CompletionTriggerKind.TriggerCharacter &&
      context.triggerCharacter === ' ';

    if (isSpaceTrigger || (isExplicitInvoke && isPostTableSpaceContext && word.word.length === 0)) {
      if (isPostTableSpaceContext) {
        const currentStmtRefs = extractReferencedSqlTables(stmtBeforeCursor).refs;
        const smartSpaceJoins = suggestJoinCandidatesForQuery({
          existingRefs: currentStmtRefs,
          allTables: combinedSchemaTables,
          activeDatabase: curDb,
          learnedEdges: learnedJoinEdges,
          maxResults: 5
        });

        const nextClauses = [
          { label: 'WHERE', insertText: 'WHERE ', detail: 'Filter baris kondisi' },
          { label: 'LEFT JOIN', insertText: 'LEFT JOIN ', detail: 'Gabungkan tabel relasi (Left)' },
          { label: 'INNER JOIN', insertText: 'INNER JOIN ', detail: 'Gabungkan tabel relasi (Inner)' },
          { label: 'ORDER BY', insertText: 'ORDER BY ', detail: 'Urutkan hasil query' },
          { label: 'LIMIT 100', insertText: 'LIMIT ${1:100}', detail: 'Batasi jumlah baris', snippet: true },
          { label: 'GROUP BY', insertText: 'GROUP BY ', detail: 'Kelompokkan agregasi' }
        ];

        const spaceSuggestions: monaco.languages.CompletionItem[] = smartSpaceJoins.map(
          (jc, idx) => ({
            label: {
              label: `LEFT JOIN ${jc.fullJoinTail}`,
              description: `★ ${jc.reasonLabel}`
            },
            kind: monaco.languages.CompletionItemKind.Snippet,
            detail: `★ [Smart JOIN] Gabungkan dengan ${jc.targetSchema ? `${jc.targetSchema}.` : ''}${jc.targetTable}`,
            documentation: {
              value: `**Smart JOIN Otomatis**\n\n\`\`\`sql\nLEFT JOIN ${jc.fullJoinTail}\n\`\`\`\n\nSumber relasi: **${jc.reasonLabel}**`
            },
            insertText: `LEFT JOIN ${jc.fullJoinTail}`,
            filterText: `LEFT JOIN ${jc.targetTable} ${jc.fullJoinTail}`,
            sortText: `00_0sj_${String(idx).padStart(2, '0')}`,
            range
          })
        );

        for (let idx = 0; idx < nextClauses.length; idx++) {
          const c = nextClauses[idx];
          spaceSuggestions.push({
            label: c.label,
            kind: monaco.languages.CompletionItemKind.Keyword,
            detail: `[SQL Clause] ${c.detail}`,
            insertText: c.insertText,
            insertTextRules: c.snippet
              ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
              : undefined,
            sortText: `00_1cl_${idx}_${c.label}`,
            range
          });
        }

        return { suggestions: spaceSuggestions };
      }
      if (!isUseDbContext && !isTableClauseContext && !isColumnClauseContext) {
        return { suggestions: [] };
      }
    }

    // 2A-JOIN-ON: Right after `ON ` (e.g. `LEFT JOIN sipegi.mst_unitkerja u ON `) -> suggest full `u.kd_unitkerja = p.kd_unitkerja`!
    if (isOnConditionStartContext) {
      const sqlPriorToOn = stmtBeforeCursor.replace(/\bon\s+[`"']?[A-Za-z0-9_]*$/i, '');
      const refsPriorToOn = extractReferencedSqlTables(sqlPriorToOn).refs;
      const onCandidates = suggestOnConditionsForLastJoin({
        existingRefs: refsPriorToOn,
        allTables: combinedSchemaTables,
        activeDatabase: curDb,
        learnedEdges: learnedJoinEdges
      });

      onCandidates.forEach((oc, idx) => {
        suggestions.push({
          label: {
            label: oc.onExpression,
            description: `★ ${oc.reasonLabel}`
          },
          kind: monaco.languages.CompletionItemKind.Snippet,
          detail: `★ [Smart ON] Hubungkan ${oc.targetTable} ↔ ${oc.sourceTable}`,
          documentation: {
            value: `**Kondisi JOIN Otomatis**\n\n\`\`\`sql\nON ${oc.onExpression}\n\`\`\`\n\nAlasan kecocokan: **${oc.reasonLabel}**`
          },
          insertText: oc.onExpression,
          filterText: `${oc.onExpression} ${oc.targetColumn} ${oc.sourceColumn}`,
          sortText: `00_000on_${String(idx).padStart(2, '0')}`,
          range
        });
      });
    }

    // 2A. `USE <nama_database>` context
    if (isUseDbContext) {
      for (const db of mergedDbNames) {
        suggestions.push({
          label: { label: db.name, description: 'Database' },
          kind: monaco.languages.CompletionItemKind.Module,
          detail: `[Database ${engineLabel}] ${db.tableCount} tabel`,
          insertText: db.name,
          filterText: db.name,
          sortText: `00_db_${db.name}`,
          range
        });
      }
      return { suggestions };
    }

    // Helper to build markdown preview of table columns
    const formatTableDoc = (tbl: DbTableMeta, ownerLabel: string): { value: string } => {
      const colPreview = tbl.columns
        .slice(0, 14)
        .map((c) => `- \`${c.name}\` (${c.columnType}${c.isPrimaryKey ? ', PK' : ''})`)
        .join('\n');
      return {
        value: `**${tbl.schema ? `${tbl.schema}.` : ''}${tbl.name}** — *${ownerLabel}*\n\n${
          colPreview || '_Kolom diekstrak dari kode proyek_'
        }${tbl.columns.length > 14 ? `\n- ... (+${tbl.columns.length - 14} kolom lainnya)` : ''}`
      };
    };

    // 3. Database Names (`nama_database`) & Table/View Names (`nama_tabel`)
    if (isTableClauseContext || !isSpaceTrigger) {
      // (0) Smart JOIN + ON Full Completion right after `JOIN ` / `LEFT JOIN ` / `INNER JOIN `!
      if (isJoinTableTargetContext) {
        const sqlPriorToJoin = stmtBeforeCursor.replace(
          /\b(?:left|right|inner|cross|outer)?\s*(?:outer\s+)?join\s+[`"']?[A-Za-z0-9_]*$/i,
          ''
        );
        const priorJoinRefs = extractReferencedSqlTables(sqlPriorToJoin).refs;
        const joinCands = suggestJoinCandidatesForQuery({
          existingRefs: priorJoinRefs,
          allTables: combinedSchemaTables,
          activeDatabase: curDb,
          learnedEdges: learnedJoinEdges,
          maxResults: 16
        });

        joinCands.forEach((jc, idx) => {
          suggestions.push({
            label: {
              label: jc.fullJoinTail,
              description: `★ ${jc.reasonLabel}`
            },
            kind: monaco.languages.CompletionItemKind.Snippet,
            detail: `★ [Smart JOIN] ${jc.targetSchema ? `${jc.targetSchema}.` : ''}${jc.targetTable} ↔ ${jc.sourceTable}`,
            documentation: {
              value: `**Smart JOIN + ON Otomatis**\n\n\`\`\`sql\n${jc.fullJoinTail}\n\`\`\`\n\nKecocokan relasi: **${jc.reasonLabel}**`
            },
            insertText: jc.fullJoinTail,
            filterText: `${jc.targetTable} ${jc.targetSchema ? `${jc.targetSchema}.${jc.targetTable}` : ''} ${jc.fullJoinTail}`,
            sortText: `00_000join_${String(idx).padStart(2, '0')}`,
            range
          });
        });
      }

      const seenTableKeys = new Set<string>();

      // (a) Tables in current active database (`DB Aktif`)
      for (const tbl of liveCat?.snapshot.tables ?? []) {
        const fullKey = `${curDbLower}.${tbl.name.toLowerCase()}`;
        seenTableKeys.add(fullKey);
        suggestions.push({
          label: { label: tbl.name, description: curDb || engineLabel },
          kind: monaco.languages.CompletionItemKind.Struct,
          detail: `★ [DB ${tbl.kind === 'view' ? 'View' : 'Table'}] ${tbl.columns.length} kolom (${curDb})`,
          documentation: formatTableDoc(tbl, `${engineLabel}:${curDb}`),
          insertText: tbl.name,
          filterText: `${tbl.name} ${curDb ? `${curDb}.${tbl.name}` : ''}`,
          sortText: isTableClauseContext ? `00_0tbl_${tbl.name}` : `02_0tbl_${tbl.name}`,
          range
        });
      }

      // (b) Tables across ALL other user databases on the connected server + Fallback code tables
      const crossAndFallbackTables: Array<{ tbl: DbTableMeta; fromLive: boolean }> = [
        ...(liveCat?.allTables ?? []).map((tbl) => ({ tbl, fromLive: true })),
        ...fallbackCat.tables.map((tbl) => ({ tbl, fromLive: false }))
      ];

      for (const { tbl, fromLive } of crossAndFallbackTables) {
        const schema = tbl.schema ?? '';
        const schemaLow = schema.toLowerCase();
        const fullKey = `${schemaLow}.${tbl.name.toLowerCase()}`;
        if (seenTableKeys.has(fullKey)) continue;
        // Also skip fallback unqualified table if live DB already has a table with the same name
        if (!fromLive && !schema && (liveCat?.tablesByNameLower.get(tbl.name.toLowerCase())?.length ?? 0) > 0) {
          continue;
        }
        seenTableKeys.add(fullKey);

        const needsSchemaPrefix = Boolean(
          schema && ((fromLive && curDbLower && schemaLow !== curDbLower) || (!fromLive && schema))
        );
        const insertTarget = needsSchemaPrefix ? `${schema}.${tbl.name}` : tbl.name;
        const badgeOwner = fromLive ? `${engineLabel}:${schema || curDb}` : schema ? `Kode:${schema}` : 'SQL Proyek';

        suggestions.push({
          label: { label: tbl.name, description: schema || 'SQL Proyek' },
          kind: monaco.languages.CompletionItemKind.Struct,
          detail: `[${fromLive ? `DB ${tbl.kind === 'view' ? 'View' : 'Table'}` : 'Tabel Proyek'}] ${tbl.columns.length} kolom (${badgeOwner})`,
          documentation: formatTableDoc(tbl, badgeOwner),
          insertText: insertTarget,
          filterText: schema ? `${tbl.name} ${schema}.${tbl.name}` : tbl.name,
          sortText: isTableClauseContext ? `00_1xtbl_${tbl.name}_${schema}` : `02_1xtbl_${tbl.name}_${schema}`,
          range
        });
      }

      // (c) Database / Schema Names (`nama_database`, e.g. `sipegi`)
      for (const db of mergedDbNames) {
        suggestions.push({
          label: { label: db.name, description: 'Database' },
          kind: monaco.languages.CompletionItemKind.Module,
          detail: `[Database ${db.source === 'live' ? engineLabel : 'Kode'}] ${db.tableCount} tabel — ketik "." untuk daftar tabel`,
          documentation: `Database/Schema \`${db.name}\` (${db.tableCount} tabel). Ketik \`${db.name}.\` untuk menelusuri tabel di dalamnya.`,
          insertText: db.name,
          filterText: db.name,
          sortText: isTableClauseContext ? `00_2db_${db.name}` : `02_2db_${db.name}`,
          range
        });
      }
    }

    // 4. Column / Field Names (`nama_field`)
    if (!isTableClauseContext) {
      const seenCols = new Set<string>();

      // (a) Columns belonging to tables referenced in the current query (`FROM sipegi.mst_unitkerja u`, etc.)
      for (const ref of queryRefs.refs) {
        const matchedTables = ref.schemaLower
          ? [findTableByFullKey(ref.schemaLower, ref.tableLower)].filter((t): t is DbTableMeta => Boolean(t))
          : findTablesByNameLower(ref.tableLower);

        for (const tbl of matchedTables) {
          for (const col of tbl.columns) {
            const low = col.name.toLowerCase();
            if (seenCols.has(low)) continue;
            seenCols.add(low);
            const ownerDesc = tbl.schema ? `${tbl.schema}.${tbl.name}` : tbl.name;
            suggestions.push({
              label: { label: col.name, description: ownerDesc },
              kind: monaco.languages.CompletionItemKind.Field,
              detail: `★ [Field ${tbl.name}] ${col.columnType}${col.isPrimaryKey ? ' • PK' : ''}`,
              documentation: `Kolom aktif dari tabel \`${ownerDesc}\``,
              insertText: col.name,
              filterText: col.name,
              sortText: `00_0acol_${col.name}`,
              range
            });
          }
        }

        if (ref.aliasLower) {
          suggestions.push({
            label: { label: ref.aliasLower, description: `Alias → ${ref.table}` },
            kind: monaco.languages.CompletionItemKind.Variable,
            detail: `[SQL Alias] Tabel ${ref.schema ? `${ref.schema}.` : ''}${ref.table}`,
            insertText: ref.aliasLower,
            filterText: ref.aliasLower,
            sortText: `00_1alias_${ref.aliasLower}`,
            range
          });
        }
      }

      // (b) Columns from `currentDatabase` + all other user databases + fallback code SQL columns
      if (!isSpaceTrigger || queryRefs.refs.length === 0) {
        let addedGlobalCols = 0;

        for (const tbl of liveCat?.snapshot.tables ?? []) {
          for (const col of tbl.columns) {
            const low = col.name.toLowerCase();
            if (seenCols.has(low)) continue;
            seenCols.add(low);
            addedGlobalCols++;
            suggestions.push({
              label: { label: col.name, description: tbl.name },
              kind: monaco.languages.CompletionItemKind.Field,
              detail: `[Field ${tbl.name}] ${col.columnType}${col.isPrimaryKey ? ' • PK' : ''}`,
              documentation: `Kolom database dari tabel \`${curDb ? `${curDb}.` : ''}${tbl.name}\``,
              insertText: col.name,
              filterText: col.name,
              sortText: isColumnClauseContext ? `01_0ccol_${col.name}` : `03_0ccol_${col.name}`,
              range
            });
          }
        }

        for (const tbl of [...(liveCat?.allTables ?? []), ...fallbackCat.tables]) {
          if (addedGlobalCols >= 1500) break;
          for (const col of tbl.columns) {
            if (addedGlobalCols >= 1500) break;
            const low = col.name.toLowerCase();
            if (seenCols.has(low)) continue;
            seenCols.add(low);
            addedGlobalCols++;
            const ownerDesc = tbl.schema ? `${tbl.schema}.${tbl.name}` : tbl.name;
            suggestions.push({
              label: { label: col.name, description: ownerDesc },
              kind: monaco.languages.CompletionItemKind.Field,
              detail: `[Field ${ownerDesc}] ${col.columnType}${col.isPrimaryKey ? ' • PK' : ''}`,
              documentation: `Kolom dari \`${ownerDesc}\``,
              insertText: col.name,
              filterText: col.name,
              sortText: isColumnClauseContext ? `01_1xcol_${col.name}` : `03_1xcol_${col.name}`,
              range
            });
          }
        }

        for (const fCol of fallbackCat.columns) {
          if (addedGlobalCols >= 1600) break;
          const low = fCol.toLowerCase();
          if (seenCols.has(low)) continue;
          seenCols.add(low);
          addedGlobalCols++;
          suggestions.push({
            label: { label: fCol, description: 'SQL Proyek' },
            kind: monaco.languages.CompletionItemKind.Field,
            detail: '[Field SQL Kode Proyek]',
            insertText: fCol,
            filterText: fCol,
            sortText: isColumnClauseContext ? `01_2fcol_${fCol}` : `03_2fcol_${fCol}`,
            range
          });
        }
      }
    }

    // 5. SQL Keywords, Clauses, Functions & Templates (available in SQL editors & PHP SQL strings!)
    const hasAnySchemaItems = mergedDbNames.length > 0 || (liveCat?.allTables.length ?? 0) > 0 || fallbackCat.tables.length > 0;
    if (!isSpaceTrigger || !hasAnySchemaItems) {
      for (let i = 0; i < SQL_KEYWORDS.length; i++) {
        const kw = SQL_KEYWORDS[i];
        if (isTableClauseContext && !kw.label.includes('JOIN')) continue;
        // Inside PHP strings, skip full-statement templates Ending with `;` if mid-query
        if (lang === 'php' && kw.isSnippet && kw.insertText.endsWith(';')) continue;
        suggestions.push({
          label: kw.label,
          kind: kw.isSnippet
            ? monaco.languages.CompletionItemKind.Snippet
            : monaco.languages.CompletionItemKind.Keyword,
          detail: kw.detail,
          insertText: kw.insertText,
          insertTextRules: kw.isSnippet
            ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
            : undefined,
          sortText: `${kw.isSnippet ? '04_snip' : '02_9kw'}_${String(i).padStart(2, '0')}_${kw.label}`,
          range
        });
      }
    }

    return { suggestions };
  }

  monaco.languages.registerCompletionItemProvider('sql', {
    triggerCharacters: ['.', '`'],
    provideCompletionItems: (model, position, context) =>
      provideDbSchemaCompletions(model, position, context, 'sql')
  });

  // Hover dokumentasi database, tabel & kolom langsung di editor SQL (mencakup seluruh database di server)
  monaco.languages.registerHoverProvider('sql', {
    provideHover(model, position) {
      if (!indexedDbCatalog) return null;
      const word = model.getWordAtPosition(position);
      if (!word) return null;
      const lower = word.word.toLowerCase();
      const range = new monaco.Range(
        position.lineNumber,
        word.startColumn,
        position.lineNumber,
        word.endColumn
      );
      const engine = indexedDbCatalog.snapshot.engine.toUpperCase();

      // 1. Database name hover
      if (indexedDbCatalog.tablesByDbLower.has(lower)) {
        const dbTables = indexedDbCatalog.tablesByDbLower.get(lower) ?? [];
        const tblPreview = dbTables
          .slice(0, 18)
          .map((t) => `- \`${t.name}\` (${t.columns.length} kolom)`)
          .join('\n');
        return {
          range,
          contents: [
            { value: `**[Database ${engine}] \`${word.word}\`** *(${dbTables.length} tabel)*` },
            {
              value: `${tblPreview}${
                dbTables.length > 18 ? `\n- ... (+${dbTables.length - 18} tabel lainnya)` : ''
              }`
            }
          ]
        };
      }

      // 2. Table / View hover across all databases
      const matchedTables = indexedDbCatalog.tablesByNameLower.get(lower) ?? [];
      if (matchedTables.length > 0) {
        const tbl =
          matchedTables.find(
            (t) => (t.schema ?? '').toLowerCase() === indexedDbCatalog!.snapshot.currentDatabase.toLowerCase()
          ) ?? matchedTables[0];
        const ownerBadge = `${engine} • ${tbl.schema || indexedDbCatalog.snapshot.currentDatabase}`;
        const colsMd = tbl.columns
          .slice(0, 20)
          .map(
            (c) =>
              `- \`${c.name}\`: **${c.columnType}**${c.isPrimaryKey ? ' 🔑 *PK*' : ''}${
                !c.nullable ? ' *(NOT NULL)*' : ''
              }`
          )
          .join('\n');
        return {
          range,
          contents: [
            {
              value: `**[DB ${tbl.kind === 'view' ? 'View' : 'Table'}] \`${tbl.schema ? `${tbl.schema}.` : ''}${tbl.name}\`** *(${ownerBadge})*`
            },
            {
              value: `${colsMd}${
                tbl.columns.length > 20 ? `\n- ... (+${tbl.columns.length - 20} kolom lainnya)` : ''
              }`
            }
          ]
        };
      }

      // 3. Column hover across all databases
      const matchingCols: string[] = [];
      for (const t of indexedDbCatalog.allTables) {
        const c = t.columns.find((col) => col.name.toLowerCase() === lower);
        if (c) {
          matchingCols.push(
            `- Tabel \`${t.schema ? `${t.schema}.` : ''}${t.name}\`: **${c.columnType}**${
              c.isPrimaryKey ? ' 🔑 *PK*' : ''
            }${!c.nullable ? ' *(NOT NULL)*' : ''}`
          );
          if (matchingCols.length >= 12) break;
        }
      }
      if (matchingCols.length > 0) {
        return {
          range,
          contents: [
            { value: `**[DB Field] \`${word.word}\`** *(${engine})*` },
            { value: matchingCols.join('\n') }
          ]
        };
      }
      return null;
    }
  });

  // =========================================================================
  // #1. Inline SQL CodeLens ("▶ Uji Query", "⚡ Explain", "📊 Struktur Tabel")
  // =========================================================================
  monaco.editor.registerCommand(
    'hmw.sqlCodeLensAction',
    (_accessor, payload?: SqlCodeLensDispatchPayload) => {
      if (payload && onSqlCodeLensDispatch) {
        onSqlCodeLensDispatch(payload);
      }
    }
  );

  monaco.languages.registerCodeLensProvider(['php', 'sql'], {
    provideCodeLenses(model) {
      if (model.isDisposed()) return { lenses: [], dispose: () => {} };
      const langId = model.getLanguageId();
      const source = model.getValue();
      const stmts =
        langId === 'php'
          ? extractPhpEmbeddedSqlStatements(source)
          : extractSqlFileStatements(source);

      const lenses: monaco.languages.CodeLens[] = [];
      for (const stmt of stmts) {
        const line = Math.max(1, Math.min(stmt.startLine, model.getLineCount()));
        const range = new monaco.Range(line, 1, line, 1);

        lenses.push({
          range,
          id: `${stmt.id}-run`,
          command: {
            id: 'hmw.sqlCodeLensAction',
            title:
              stmt.params.length > 0
                ? `▶ Uji Query (${stmt.params.length} variabel PHP)`
                : '▶ Uji Query di DB',
            tooltip:
              'Buka & uji query ini di SQL Runner (otomatis menangani variabel PHP)',
            arguments: [
              {
                mode: 'run',
                sqlTemplate: stmt.sqlTemplate,
                params: stmt.params,
                primaryTable: stmt.primaryTable
              } satisfies SqlCodeLensDispatchPayload
            ]
          }
        });

        if (/^\s*select\b/i.test(stmt.sqlTemplate)) {
          lenses.push({
            range,
            id: `${stmt.id}-explain`,
            command: {
              id: 'hmw.sqlCodeLensAction',
              title: '⚡ Explain Index',
              tooltip: 'Jalankan EXPLAIN untuk memeriksa pemakaian indeks & performa query',
              arguments: [
                {
                  mode: 'explain',
                  sqlTemplate: stmt.sqlTemplate,
                  params: stmt.params,
                  primaryTable: stmt.primaryTable
                } satisfies SqlCodeLensDispatchPayload
              ]
            }
          });
        }

        if (stmt.primaryTable) {
          const tblLabel = stmt.primaryTable.schema
            ? `${stmt.primaryTable.schema}.${stmt.primaryTable.table}`
            : stmt.primaryTable.table;
          lenses.push({
            range,
            id: `${stmt.id}-struct`,
            command: {
              id: 'hmw.sqlCodeLensAction',
              title: `📊 Struktur: ${tblLabel}`,
              tooltip: `Lihat daftar kolom & struktur tabel ${tblLabel}`,
              arguments: [
                {
                  mode: 'structure',
                  sqlTemplate: stmt.sqlTemplate,
                  params: stmt.params,
                  primaryTable: stmt.primaryTable
                } satisfies SqlCodeLensDispatchPayload
              ]
            }
          });
        }
      }

      return {
        lenses,
        dispose: () => {}
      };
    }
  });

  // =========================================================================
  // #2 & #5A. Quick Fix CodeActionProvider (`Ctrl+.`) untuk Typo SQL & SQL Injection
  // =========================================================================
  monaco.languages.registerCodeActionProvider(
    ['php', 'sql'],
    {
      provideCodeActions(model, range) {
      const records = modelQuickFixesMap.get(model);
      if (!records || records.length === 0) {
        return { actions: [], dispose: () => {} };
      }

      const actions: monaco.languages.CodeAction[] = [];
      for (const rec of records) {
        if (rec.line < range.startLineNumber || rec.line > range.endLineNumber) {
          continue;
        }
        const overlaps =
          range.endColumn >= rec.startColumn && range.startColumn <= rec.endColumn;
        if (!overlaps) continue;

        const editRange = new monaco.Range(
          rec.line,
          rec.startColumn,
          rec.line,
          rec.endColumn
        );

        rec.quickFixes.forEach((qf, idx) => {
          actions.push({
            title: `💡 ${qf.title}`,
            kind: 'quickfix',
            isPreferred: idx === 0,
            edit: {
              edits: [
                {
                  resource: model.uri,
                  textEdit: {
                    range: editRange,
                    text: qf.replacement
                  },
                  versionId: model.getVersionId()
                }
              ]
            }
          });
        });
      }

      return {
        actions,
        dispose: () => {}
      };
      }
    },
    { providedCodeActionKinds: ['quickfix'] }
  );
}

function parseIncludePathFromLine(lineContent: string): string | null {
  if (!/\b(?:include|include_once|require|require_once)\b/.test(lineContent)) {
    return null;
  }
  const afterKw = lineContent.replace(
    /^.*?\b(?:include_once|require_once|include|require)\b\s*/,
    ''
  );
  // Collect all string literals on the include expression (handles `__DIR__ . '/..' . "/wisanggeni/main_lib.php"`)
  const literals: string[] = [];
  for (const m of afterKw.matchAll(/['"]([^'"]+)['"]/g)) {
    literals.push(m[1]);
  }
  if (literals.length === 0) return null;
  const joined = literals.join('');
  const cleaned = joined.replace(/\\/g, '/').replace(/\/+/g, '/').trim();
  if (!cleaned) return null;
  return cleaned.startsWith('/') && /\b(?:__DIR__|dirname\s*\(\s*__FILE__\s*\))/.test(afterKw)
    ? cleaned.slice(1)
    : cleaned;
}

export function resolvePhpNavigationTarget(
  lineContent: string,
  column: number,
  wordAtCursor: string | null,
  fullSource: string,
  title = 'current.php'
): PhpNavigationTarget | null {
  // 1. Check PHP include / require_once on this line
  const incTarget = parseIncludePathFromLine(lineContent);
  if (incTarget) {
    return { kind: 'include-rel', rawTarget: incTarget };
  }

  // 2. Check Laravel Blade / Helper view('...'), @extends('...'), @include('...')
  for (const vm of lineContent.matchAll(
    /(?:\bview\s*\(|@(?:extends|include|includeIf|component)\s*\()\s*['"]([A-Za-z0-9_.-]+)['"]/g
  )) {
    const startCol = (vm.index ?? 0) + 1;
    const endCol = startCol + vm[0].length;
    if (column >= startCol && column <= endCol + 1) {
      const viewName = vm[1];
      const known = laravelViews.find((v) => v.name === viewName);
      const fallbackRel = `resources/views/${viewName.replace(/\./g, '/')}.blade.php`;
      return {
        kind: 'laravel-view',
        viewName,
        filePath: known?.filePath,
        relativePath: known?.relativePath ?? fallbackRel
      };
    }
  }

  // 3. Check Laravel route('...') / to_route('...')
  for (const rm of lineContent.matchAll(/\b(?:route|to_route)\s*\(\s*['"]([A-Za-z0-9_.-]+)['"]/g)) {
    const startCol = (rm.index ?? 0) + 1;
    const endCol = startCol + rm[0].length;
    if (column >= startCol && column <= endCol + 1) {
      const routeName = rm[1];
      const known = laravelRoutes.find((r) => r.name === routeName);
      return {
        kind: 'laravel-route',
        routeName,
        relativePath: known?.relativePath ?? 'routes/web.php',
        line: known?.line ?? 1
      };
    }
  }

  const token = wordAtCursor?.replace(/^\$/, '').trim();
  if (!token) return null;
  const lower = token.toLowerCase();

  const currentAnalysis = analyzePhpSource(fullSource, title);

  // Merge user symbols across open buffers + workspace symbols
  const mergedUserFuncs = new Map<string, PhpFunctionMeta>();
  const mergedUserClasses = new Map<string, PhpClassMeta>();
  for (const fn of [...workspaceSymbols.functions, ...remoteWorkspaceSymbols.functions]) {
    mergedUserFuncs.set(fn.name.toLowerCase(), fn);
  }
  for (const cls of [...workspaceSymbols.classes, ...remoteWorkspaceSymbols.classes]) {
    mergedUserClasses.set(cls.name.toLowerCase(), cls);
  }
  for (const buf of getOpenPhpBuffers()) {
    const parsed = analyzePhpSource(buf.content, buf.title);
    for (const fn of parsed.functions) {
      mergedUserFuncs.set(fn.name.toLowerCase(), {
        ...fn,
        filePath: buf.uriOrPath,
        relativePath: buf.title
      });
    }
    for (const cls of parsed.classes) {
      mergedUserClasses.set(cls.name.toLowerCase(), {
        ...cls,
        filePath: buf.uriOrPath,
        relativePath: buf.title
      });
    }
  }

  // 4. Same-file function or class/method
  const localFn = currentAnalysis.functions.find((f) => f.name.toLowerCase() === lower);
  if (localFn?.line) {
    return { kind: 'same-file', line: localFn.line, label: `function ${localFn.name}()` };
  }
  const localCls = currentAnalysis.classes.find((c) => c.name.toLowerCase() === lower);
  if (localCls?.line) {
    return { kind: 'same-file', line: localCls.line, label: `class ${localCls.name}` };
  }
  for (const c of currentAnalysis.classes) {
    const m = c.members.find((item) => item.name.toLowerCase() === lower);
    if (m?.line) {
      return { kind: 'same-file', line: m.line, label: `${c.name}::${m.name}` };
    }
  }

  // 5. Static call `ClassName::method`
  const beforeCol = lineContent.slice(0, Math.max(0, column));
  const staticBefore = beforeCol.match(/\\?([A-Za-z_][A-Za-z0-9_\\]*)\s*::\s*[A-Za-z_0-9]*$/);
  if (staticBefore) {
    const clsShort = staticBefore[1].split('\\').pop() ?? staticBefore[1];
    const cls = resolveAnyClass(clsShort, mergedUserClasses);
    if (cls && (cls.filePath || cls.relativePath)) {
      const m = cls.members.find((item) => item.name.toLowerCase() === lower);
      return {
        kind: 'symbol',
        symbolName: `${cls.name}::${token}`,
        filePath: cls.filePath,
        relativePath: cls.relativePath,
        line: m?.line ?? cls.line ?? 1,
        origin: cls.origin
      };
    }
  }

  // 6. Member access `$obj->method`
  const arrowBefore = beforeCol.match(/(\$[A-Za-z_][A-Za-z0-9_]*)\s*->\s*[A-Za-z_0-9]*$/);
  if (arrowBefore) {
    const varName = arrowBefore[1];
    const inferredType =
      currentAnalysis.variables.get(varName) ?? wisanggeniGlobalVars[varName];
    if (inferredType && inferredType !== 'mixed') {
      const cls = resolveAnyClass(inferredType, mergedUserClasses);
      if (cls && (cls.filePath || cls.relativePath)) {
        const m = cls.members.find((item) => item.name.toLowerCase() === lower);
        return {
          kind: 'symbol',
          symbolName: `${cls.name}->${token}`,
          filePath: cls.filePath,
          relativePath: cls.relativePath,
          line: m?.line ?? cls.line ?? 1,
          origin: cls.origin
        };
      }
    }
    for (const candidateCls of [...mergedUserClasses.values(), ...wisanggeniClassMap.values()]) {
      if (!candidateCls.filePath && !candidateCls.relativePath) continue;
      const m = candidateCls.members.find((item) => item.name.toLowerCase() === lower);
      if (m) {
        return {
          kind: 'symbol',
          symbolName: `${candidateCls.name}->${token}`,
          filePath: candidateCls.filePath,
          relativePath: candidateCls.relativePath,
          line: m.line ?? candidateCls.line ?? 1,
          origin: candidateCls.origin
        };
      }
    }
  }

  // 7. Class or Function across open buffers, workspace, or Wisanggeni
  const targetCls =
    mergedUserClasses.get(lower) ??
    wisanggeniClassMap.get(lower) ??
    laravelClassMap.get(lower);
  if (targetCls && (targetCls.filePath || targetCls.relativePath)) {
    return {
      kind: 'symbol',
      symbolName: targetCls.name,
      filePath: targetCls.filePath,
      relativePath: targetCls.relativePath,
      line: targetCls.line ?? 1,
      origin: targetCls.origin
    };
  }

  const targetFn =
    mergedUserFuncs.get(lower) ??
    wisanggeniFunctionMap.get(lower) ??
    laravelFunctionMap.get(lower);
  if (targetFn && (targetFn.filePath || targetFn.relativePath)) {
    return {
      kind: 'symbol',
      symbolName: `${targetFn.name}()`,
      filePath: targetFn.filePath,
      relativePath: targetFn.relativePath,
      line: targetFn.line ?? 1,
      origin: targetFn.origin
    };
  }

  return null;
}
