import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { GoogleGenAI } from '@google/genai';
import type {
  GeminiChatRequest,
  GeminiChatResponse,
  GeminiConfigSavePayload,
  GeminiConfigSummary,
  GeminiDocGenRequest,
  GeminiDocGenResponse,
  GeminiFixErrorRequest,
  GeminiFixErrorResponse,
  GeminiInlineCompletionRequest,
  GeminiInlineTransformRequest,
  GeminiInlineTransformResponse,
  GeminiModelId,
  GeminiSqlAuditRequest,
  GeminiSqlAuditResponse,
  GeminiSummarizeChangesRequest,
  GeminiSummarizeChangesResponse,
  GeminiWisanggeniCrudRequest,
  GeminiWisanggeniCrudResponse
} from '@shared/types';
import type { SecretVaultAdapter } from './connections';

const VALID_MODELS: readonly GeminiModelId[] = [
  'gemini-4-hydrogen',
  'gemini-4-argon',
  'gemini-4-carbon',
  'gemini-3.5-flash-lite'
];

interface StoredGeminiConfig {
  encryptedApiKey?: string;
  model: GeminiModelId;
  ghostTextEnabled: boolean;
  ghostTextModel: GeminiModelId;
  updatedAt: string;
}

export function normalizeGeminiModel(model?: string | null): GeminiModelId {
  if (model && (VALID_MODELS as readonly string[]).includes(model)) {
    return model as GeminiModelId;
  }
  return 'gemini-4-hydrogen';
}

export function maskApiKey(rawKey: string): string {
  const trimmed = rawKey.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 8) return '••••••••';
  return `${trimmed.slice(0, 4)}••••••••${trimmed.slice(-4)}`;
}

/**
 * Menyensor password database, API key, token, dan file kredensial sensitif (seperti connect_db.php / .env)
 * sebelum konteks kode dikirim ke Gemini API.
 */
export function redactSecretsFromContext(text: string, fileName = ''): string {
  if (!text) return '';
  const lowerName = fileName.toLowerCase();
  if (
    lowerName.endsWith('connect_db.php') ||
    lowerName === '.env' ||
    lowerName.endsWith('/.env') ||
    lowerName.endsWith('\\.env') ||
    lowerName.endsWith('.pem') ||
    lowerName.endsWith('.key')
  ) {
    return '/* [KEAMANAN HMW STUDIO: Isi file kredensial disensor otomatis demi keamanan] */';
  }

  let safe = text;

  // Sensor blok Private Key PEM
  safe = safe.replace(
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    '[REDACTED_PRIVATE_KEY]'
  );

  // Sensor variabel password / secret PHP ($my_password = '...', $db_pass = "...", $apiKey = '...')
  safe = safe.replace(
    /(\$(?:[a-zA-Z0-9_]*(?:pass(?:word)?|pwd|secret|api_?key|private_?key|access_?token)[a-zA-Z0-9_]*)\s*=\s*)(['"])([^'"]*)(\2)/gi,
    '$1$2[REDACTED_SECRET]$4'
  );

  // Sensor konstanta define('DB_PASS', '...')
  safe = safe.replace(
    /(define\s*\(\s*(['"])[a-zA-Z0-9_]*(?:PASS(?:WORD)?|PWD|SECRET|API_KEY|TOKEN)[a-zA-Z0-9_]*\2\s*,\s*)(['"])([^'"]*)(\3\s*\))/gi,
    '$1$3[REDACTED_SECRET]$5'
  );

  // Sensor pasangan key-value array atau .env (password => '...', DB_PASSWORD=...)
  safe = safe.replace(
    /((?:['"](?:db_?)?(?:password|passwd|pwd|secret|api_?key|token)['"]\s*=>\s*))(['"])([^'"]+)(\2)/gi,
    '$1$2[REDACTED_SECRET]$4'
  );
  safe = safe.replace(
    /^(\s*[A-Z0-9_]*(?:PASSWORD|PASSWD|SECRET|API_KEY|PRIVATE_KEY)[A-Z0-9_]*\s*=\s*)(.+)$/gm,
    '$1[REDACTED_SECRET]'
  );

  return safe;
}

export function parseStructuredJson<T>(rawText: string): T {
  const trimmed = (rawText ?? '').trim();
  if (!trimmed) {
    throw new Error('Respons JSON kosong dari Gemini.');
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // Fallback jika dibungkus blok markdown ```json ... ```
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      return JSON.parse(fenced[1].trim()) as T;
    }
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as T;
    }
    throw new Error('Gagal mengurai respons terstruktur dari Gemini.');
  }
}

export function stripMarkdownCodeFence(raw: string): string {
  const trimmed = (raw ?? '').trim();
  const match = trimmed.match(/^```[a-zA-Z0-9_-]*\r?\n([\s\S]*?)\r?\n```$/);
  if (match) return match[1];
  return trimmed;
}

export interface LineRangePatch {
  startLine: number;
  endLine: number;
  replacement: string;
}

export interface FocusedErrorWindow {
  startLine: number;
  endLine: number;
  errorLines: number[];
  numberedSnippet: string;
  totalLines: number;
}

/**
 * Mengekstrak jendela kode fokus (±radiusLines di sekitar baris error) agar perbaikan error AI
 * berjalan 20x–50x lebih cepat tanpa harus mengirim & men-generate ulang seluruh file.
 */
export function extractFocusedErrorWindow(
  code: string,
  errorText: string,
  radiusLines = 35
): FocusedErrorWindow | null {
  const lines = code.split(/\r?\n/);
  const totalLines = lines.length;
  if (totalLines === 0) return null;

  const found = new Set<number>();
  const lineRegexes = [
    /\b(?:baris|line)\s*[:#]?\s*(\d{1,6})\b/gi,
    /:(\d{1,6})(?::\d+)?\b/g
  ];
  for (const rx of lineRegexes) {
    let m: RegExpExecArray | null;
    while ((m = rx.exec(errorText)) !== null) {
      const n = Number(m[1]);
      if (Number.isInteger(n) && n >= 1 && n <= totalLines) {
        found.add(n);
      }
    }
  }

  if (found.size === 0) return null;
  const errorLines = Array.from(found).sort((a, b) => a - b);
  const startLine = Math.max(1, errorLines[0] - radiusLines);
  const endLine = Math.min(totalLines, errorLines[errorLines.length - 1] + radiusLines);

  // If the window spans too many lines because multiple errors are far apart, cap around first error
  const effectiveEnd =
    endLine - startLine > 160 ? Math.min(totalLines, errorLines[0] + radiusLines) : endLine;

  const errSet = new Set(errorLines);
  const numberedLines: string[] = [];
  for (let ln = startLine; ln <= effectiveEnd; ln++) {
    const marker = errSet.has(ln) ? '>>> ' : '    ';
    numberedLines.push(`${String(ln).padStart(4, ' ')} |${marker}${lines[ln - 1]}`);
  }

  return {
    startLine,
    endLine: effectiveEnd,
    errorLines,
    numberedSnippet: numberedLines.join('\n'),
    totalLines
  };
}

/**
 * Menerapkan patch berbasis rentang baris 1-based secara presisi ke seluruh isi file asli
 * (mempertahankan EOL asli `\r\n` atau `\n` dan tidak pernah memotong bagian file lain).
 */
export function applyLineRangePatches(originalCode: string, edits: LineRangePatch[]): string {
  if (!edits || edits.length === 0) return originalCode;
  const eol = originalCode.includes('\r\n') ? '\r\n' : '\n';
  const lines = originalCode.split(/\r?\n/);

  const valid = edits
    .filter(
      (e) =>
        Number.isInteger(e.startLine) &&
        Number.isInteger(e.endLine) &&
        e.startLine >= 1 &&
        e.endLine >= e.startLine &&
        e.startLine <= lines.length + 1
    )
    .sort((a, b) => b.startLine - a.startLine);

  for (const ed of valid) {
    const startIdx = Math.max(0, Math.min(lines.length, ed.startLine - 1));
    const endIdx = Math.max(startIdx, Math.min(lines.length, ed.endLine));
    const cleanRep = stripMarkdownCodeFence(ed.replacement ?? '');
    const repLines = cleanRep === '' ? [] : cleanRep.split(/\r?\n/);
    lines.splice(startIdx, endIdx - startIdx, ...repLines);
  }

  return lines.join(eol);
}

const FAST_FIX_SYSTEM_INSTRUCTION =
  'Anda adalah ahli perbaikan sintaks & bug PHP/SQL/JS/CSS di IDE HMW Studio. Jawab SANGAT cepat, presisi, minimal perubahan, tanpa mengubah logika bisnis yang sudah benar. Jelaskan penyebab dan perbaikan dalam 1-2 kalimat Bahasa Indonesia.';

const WISANGGENI_SYSTEM_KNOWLEDGE = `
Anda adalah asisten AI resmi di dalam IDE desktop **HMW Studio**.
Gunakan Bahasa Indonesia yang ringkas, akurat, dan profesional.

Pengetahuan Arsitektur **Wisanggeni Framework (PHP)**:
- Bootstrap standar: \`include_once '../wisanggeni/main_lib.php';\` atau \`include 'base.php';\` dilanjutkan \`cekLogin();\` bila halaman terautentikasi.
- Objek global utama yang sudah tersedia otomatis:
  - \`$page\` (\`TPage\`): mengatur layout halaman (\`$page->setTitle(...)\`, \`$page->showHeader()\`, \`$page->showFooter()\`).
  - \`$query\` (\`TQuery\`): eksekusi SQL aman menggunakan parameter binding:
    \`$query->clearParam();\`
    \`$query->setSQL("SELECT * FROM tabel WHERE id = :id");\`
    \`$query->setParam(':id', $id);\`
    \`$rows = $query->open();\` (untuk SELECT) atau \`$query->exec();\` (untuk INSERT/UPDATE/DELETE).
  - \`$pegawai\` (\`TPegawai\`): informasi sesi user/pegawai aktif (\`$pegawai->nip\`, \`$pegawai->nama\`).
  - \`$db_conn\` (\`TConn\`): koneksi database utama.
- Helper keamanan & input wajib:
  - \`getGET('nama_param', '')\`, \`getPOST('nama_param', '')\`, \`getPostInt('nama_param', 0)\`.
  - \`encid($id)\` untuk mengenkripsi ID di URL/hidden input, dan \`decid($id_terenkripsi)\` untuk mendekripsi ID agar aman dari IDOR.
  - Gunakan \`htmlspecialchars((string)$val, ENT_QUOTES, 'UTF-8')\` saat mencetak output bebas ke HTML agar aman dari XSS.
- Komponen UI utama:
  - \`TTabel\`: \`$tbl = new TTabel('Judul');\`, \`$tbl->setJudul(array('No', 'Kolom', 'Aksi'));\`, \`$tbl->loadData($sql)\` atau tambah baris manual, lalu \`$tbl->display();\`.
  - \`TForm\`: \`$frm = new TForm('modul_save.php', 'Judul Form');\`, \`$frm->addHidden('act', $act);\`, \`$frm->addHidden('id', encid($id));\`, \`$frm->addText('Label', 'nama_field', $nilai);\`, \`$frm->addSubmit('Simpan');\`, \`$frm->display();\`.
- Kompatibilitas PHP 8.2+: hindari dynamic property tak terdeklarasi, periksa \`isset()\` / \`?? ''\` sebelum fungsi string seperti \`strlen((string)$x)\` atau \`trim((string)$x)\`.
`.trim();

export class GeminiService {
  private readonly storageDir: string;
  private readonly configFile: string;
  private readonly vault: SecretVaultAdapter;
  private readonly completionCache = new Map<string, string>();

  constructor(storageDir: string, vault: SecretVaultAdapter) {
    this.storageDir = resolve(storageDir);
    this.configFile = join(this.storageDir, 'gemini.config.json');
    this.vault = vault;
  }

  private async readStoredConfig(): Promise<StoredGeminiConfig> {
    const defaults: StoredGeminiConfig = {
      model: 'gemini-4-hydrogen',
      ghostTextEnabled: false,
      ghostTextModel: 'gemini-3.5-flash-lite',
      updatedAt: new Date().toISOString()
    };
    if (!existsSync(this.configFile)) return defaults;
    try {
      const raw = await readFile(this.configFile, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<StoredGeminiConfig>;
      return {
        encryptedApiKey: parsed.encryptedApiKey,
        model: normalizeGeminiModel(parsed.model),
        ghostTextEnabled: Boolean(parsed.ghostTextEnabled),
        ghostTextModel: normalizeGeminiModel(parsed.ghostTextModel ?? 'gemini-3.5-flash-lite'),
        updatedAt: parsed.updatedAt ?? defaults.updatedAt
      };
    } catch {
      return defaults;
    }
  }

  private async writeStoredConfig(cfg: StoredGeminiConfig): Promise<void> {
    await mkdir(this.storageDir, { recursive: true });
    await writeFile(this.configFile, JSON.stringify(cfg, null, 2), 'utf-8');
  }

  private async resolveCredentials(): Promise<{
    apiKey: string;
    source: 'vault' | 'env' | 'none';
    config: StoredGeminiConfig;
  }> {
    const config = await this.readStoredConfig();
    if (config.encryptedApiKey) {
      try {
        const decrypted = this.vault.decrypt(config.encryptedApiKey).trim();
        if (decrypted) {
          return { apiKey: decrypted, source: 'vault', config };
        }
      } catch {
        // Fallback ke environment variable bila gagal dekripsi
      }
    }

    const envKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
    if (envKey) {
      return { apiKey: envKey, source: 'env', config };
    }

    return { apiKey: '', source: 'none', config };
  }

  private async createClient(): Promise<{
    client: GoogleGenAI;
    config: StoredGeminiConfig;
  }> {
    const { apiKey, config } = await this.resolveCredentials();
    if (!apiKey) {
      throw new Error(
        'API Key Gemini belum diatur. Buka tab Pengaturan di panel Gemini AI (✨) untuk memasukkan GEMINI_API_KEY Anda.'
      );
    }
    return {
      client: new GoogleGenAI({ apiKey }),
      config
    };
  }

  private extractOutputText(interaction: {
    output_text?: string | null;
    steps?: Array<{
      type?: string;
      content?: Array<{ type?: string; text?: string }>;
    }>;
  }): string {
    if (typeof interaction.output_text === 'string' && interaction.output_text.length > 0) {
      return interaction.output_text;
    }
    if (Array.isArray(interaction.steps)) {
      const chunks: string[] = [];
      for (const step of interaction.steps) {
        if (step.type === 'model_output' && Array.isArray(step.content)) {
          for (const part of step.content) {
            if (part.type === 'text' && typeof part.text === 'string') {
              chunks.push(part.text);
            }
          }
        }
      }
      if (chunks.length > 0) return chunks.join('');
    }
    return '';
  }

  async getConfig(): Promise<GeminiConfigSummary> {
    const { apiKey, source, config } = await this.resolveCredentials();
    return {
      hasApiKey: Boolean(apiKey),
      apiKeySource: source,
      maskedKey: maskApiKey(apiKey),
      model: config.model,
      ghostTextEnabled: config.ghostTextEnabled,
      ghostTextModel: config.ghostTextModel
    };
  }

  async saveConfig(payload: GeminiConfigSavePayload): Promise<GeminiConfigSummary> {
    const current = await this.readStoredConfig();
    let encryptedApiKey = current.encryptedApiKey;

    if (payload.clearApiKey) {
      encryptedApiKey = undefined;
    } else if (typeof payload.apiKey === 'string' && payload.apiKey.trim().length > 0) {
      encryptedApiKey = this.vault.encrypt(payload.apiKey.trim());
    }

    const updated: StoredGeminiConfig = {
      encryptedApiKey,
      model: payload.model ? normalizeGeminiModel(payload.model) : current.model,
      ghostTextEnabled:
        typeof payload.ghostTextEnabled === 'boolean'
          ? payload.ghostTextEnabled
          : current.ghostTextEnabled,
      ghostTextModel: payload.ghostTextModel
        ? normalizeGeminiModel(payload.ghostTextModel)
        : current.ghostTextModel,
      updatedAt: new Date().toISOString()
    };

    await this.writeStoredConfig(updated);
    this.completionCache.clear();
    return this.getConfig();
  }

  async testConnection(): Promise<{
    ok: boolean;
    message: string;
    model: string;
    latencyMs: number;
  }> {
    const start = Date.now();
    try {
      const { client, config } = await this.createClient();
      const interaction = await client.interactions.create({
        model: config.model,
        input: 'Balas tepat 3 kata Bahasa Indonesia: Koneksi Gemini Aktif.',
        store: false,
        generation_config: {
          max_output_tokens: 40
        }
      });
      const text = this.extractOutputText(interaction).trim();
      return {
        ok: true,
        message: text || 'Terhubung ke Google Gemini Interactions API.',
        model: config.model,
        latencyMs: Date.now() - start
      };
    } catch (err) {
      const { config } = await this.resolveCredentials();
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
        model: config.model,
        latencyMs: Date.now() - start
      };
    }
  }

  // #1 Contextual Gemini AI Assistant Chat (Stateful via previous_interaction_id)
  async chat(req: GeminiChatRequest): Promise<GeminiChatResponse> {
    const { client, config } = await this.createClient();

    const contextSections: string[] = [];
    if (req.wisanggeniContextSummary) {
      contextSections.push(`[Ringkasan Katalog Wisanggeni Aktif]\n${req.wisanggeniContextSummary}`);
    }

    if (req.activeFile) {
      const safeFull = redactSecretsFromContext(
        req.activeFile.content.slice(0, 32000),
        req.activeFile.relativePath
      );
      const locLabel = req.activeFile.isRemote
        ? `Remote Server (${req.activeFile.connectionName ?? 'SFTP'}): ${req.activeFile.relativePath}`
        : `Lokal: ${req.activeFile.relativePath}`;

      contextSections.push(
        `[File Aktif di Editor]\nLokasi: ${locLabel}\nBahasa: ${req.activeFile.language}\n\`\`\`${req.activeFile.language}\n${safeFull}\n\`\`\``
      );

      if (req.activeFile.selectedCode?.trim()) {
        const safeSel = redactSecretsFromContext(
          req.activeFile.selectedCode,
          req.activeFile.relativePath
        );
        contextSections.push(
          `[Blok Kode yang Sedang Diblok/Dipilih User]\n\`\`\`${req.activeFile.language}\n${safeSel}\n\`\`\``
        );
      }
    }

    const composedInput =
      contextSections.length > 0
        ? `${contextSections.join('\n\n')}\n\n[Permintaan Pengguna]\n${req.prompt}`
        : req.prompt;

    const interaction = await client.interactions.create({
      model: config.model,
      system_instruction: `${WISANGGENI_SYSTEM_KNOWLEDGE}\nJika Anda menyarankan perubahan utuh pada file yang sedang dibuka, sertakan blok kode lengkap dengan tag bahasa yang sesuai agar user dapat langsung melakukan Preview Diff & Terapkan ke Editor.`,
      input: composedInput,
      ...(req.previousInteractionId
        ? { previous_interaction_id: req.previousInteractionId }
        : {})
    });

    return {
      interactionId: interaction.id ?? '',
      text: this.extractOutputText(interaction),
      model: config.model
    };
  }

  // #2 Wisanggeni 3-File CRUD Generator (_idx.php, _form.php, _save.php)
  async generateWisanggeniCrud(
    req: GeminiWisanggeniCrudRequest
  ): Promise<GeminiWisanggeniCrudResponse> {
    const { client, config } = await this.createClient();
    const cleanMod =
      req.moduleName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'modul_data';

    const safeSpec = redactSecretsFromContext(req.sqlOrSpec);

    const schema = {
      type: 'object',
      properties: {
        idxFileName: { type: 'string', description: 'Nama file daftar/tabel (_idx.php)' },
        idxContent: { type: 'string', description: 'Kode PHP lengkap untuk halaman daftar TTabel' },
        formFileName: { type: 'string', description: 'Nama file form input/edit (_form.php)' },
        formContent: { type: 'string', description: 'Kode PHP lengkap untuk halaman TForm tambah/ubah' },
        saveFileName: { type: 'string', description: 'Nama file proses simpan/hapus (_save.php)' },
        saveContent: {
          type: 'string',
          description: 'Kode PHP lengkap untuk proses INSERT/UPDATE/DELETE menggunakan $query->setParam()'
        },
        explanation: {
          type: 'string',
          description: 'Penjelasan singkat Bahasa Indonesia mengenai struktur CRUD yang dihasilkan'
        }
      },
      required: [
        'idxFileName',
        'idxContent',
        'formFileName',
        'formContent',
        'saveFileName',
        'saveContent',
        'explanation'
      ]
    };

    const prompt = `Buatkan 3 file modul CRUD PHP lengkap berstandar **Wisanggeni Framework** & **PHP 8.2+** untuk:
- Nama Modul Dasar: \`${cleanMod}\` (nama file wajib: \`${cleanMod}_idx.php\`, \`${cleanMod}_form.php\`, \`${cleanMod}_save.php\`)
- Judul Modul: "${req.moduleTitle || cleanMod}"
- Petunjuk Path Include: ${req.subFolderHint || "include_once __DIR__ . '/../wisanggeni/main_lib.php';"}

Spesifikasi Tabel SQL / Daftar Kolom:
${safeSpec}

Ketentuan Wajib:
1. \`${cleanMod}_idx.php\`: menampilkan filter pencarian aman (\`$query->setParam\`), tombol Tambah Data ke \`${cleanMod}_form.php?act=add\`, daftar data memakai \`TTabel\`, serta tombol Ubah & Hapus dengan ID terenkripsi \`encid($row['...'])\`.
2. \`${cleanMod}_form.php\`: menangani mode \`add\` & \`edit\`, mendekripsi ID memakai \`decid(getGET('id', ''))\`, mengambil data lama dengan \`$query->setParam()\`, serta merender form memakai \`TForm\` yang mengirim ke \`${cleanMod}_save.php\`.
3. \`${cleanMod}_save.php\`: menangani \`insert\`, \`update\`, dan \`delete\` secara aman 100% menggunakan \`$query->clearParam()\`, \`$query->setSQL(...)\`, \`$query->setParam(...)\`, dan \`$query->exec()\`, lalu redirect kembali ke \`${cleanMod}_idx.php\`.`;

    const interaction = await client.interactions.create({
      model: config.model,
      system_instruction: WISANGGENI_SYSTEM_KNOWLEDGE,
      input: prompt,
      store: false,
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema
      }
    });

    const parsed = parseStructuredJson<GeminiWisanggeniCrudResponse>(
      this.extractOutputText(interaction)
    );

    return {
      idxFileName: parsed.idxFileName || `${cleanMod}_idx.php`,
      idxContent: stripMarkdownCodeFence(parsed.idxContent),
      formFileName: parsed.formFileName || `${cleanMod}_form.php`,
      formContent: stripMarkdownCodeFence(parsed.formContent),
      saveFileName: parsed.saveFileName || `${cleanMod}_save.php`,
      saveContent: stripMarkdownCodeFence(parsed.saveContent),
      explanation: parsed.explanation || 'Modul 3-file CRUD Wisanggeni berhasil dibuat.'
    };
  }

  private async runTimedInteraction(
    client: GoogleGenAI,
    params: Parameters<GoogleGenAI['interactions']['create']>[0],
    timeoutMs = 28000
  ): Promise<{
    output_text?: string | null;
    steps?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  }> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(
          new Error(
            `Waktu tunggu Gemini AI habis (${Math.round(timeoutMs / 1000)} detik). Coba lagi atau ganti ke model yang lebih cepat di tab Gemini AI → Key.`
          )
        );
      }, timeoutMs);
    });

    try {
      try {
        return (await Promise.race([
          client.interactions.create(params),
          timeoutPromise
        ])) as {
          output_text?: string | null;
          steps?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Fallback otomatis jika model tertentu menolak thinking_level
        if (
          /thinking_level|thinking/i.test(msg) &&
          typeof params === 'object' &&
          params !== null &&
          'generation_config' in params &&
          params.generation_config
        ) {
          const restGen = { ...(params.generation_config as Record<string, unknown>) };
          delete restGen.thinking_level;
          const retryParams = {
            ...params,
            generation_config: Object.keys(restGen).length > 0 ? restGen : undefined
          } as Parameters<GoogleGenAI['interactions']['create']>[0];
          return (await Promise.race([
            client.interactions.create(retryParams),
            timeoutPromise
          ])) as {
            output_text?: string | null;
            steps?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
          };
        }
        throw err;
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // #3 Inline Code Edit & Refactoring (Ctrl+I)
  async inlineTransform(
    req: GeminiInlineTransformRequest
  ): Promise<GeminiInlineTransformResponse> {
    const { client, config } = await this.createClient();
    const safeSelected = redactSecretsFromContext(req.selectedCode, req.fileName);
    const hasSelection = Boolean(safeSelected.trim());
    // Jika ada blok terpilih, kirim konteks secukupnya di sekitar pilihan agar jauh lebih cepat
    let safeContext = '';
    if (hasSelection) {
      const idx = req.fullFileContent.indexOf(req.selectedCode);
      if (idx >= 0) {
        const ctxStart = Math.max(0, idx - 2500);
        const ctxEnd = Math.min(req.fullFileContent.length, idx + req.selectedCode.length + 2500);
        safeContext = redactSecretsFromContext(
          req.fullFileContent.slice(ctxStart, ctxEnd),
          req.fileName
        );
      } else {
        safeContext = redactSecretsFromContext(req.fullFileContent.slice(0, 8000), req.fileName);
      }
    } else {
      safeContext = redactSecretsFromContext(req.fullFileContent.slice(0, 24000), req.fileName);
    }

    const schema = {
      type: 'object',
      properties: {
        transformedCode: {
          type: 'string',
          description:
            'HANYA kode pengganti murni untuk bagian yang dipilih (tanpa markdown backticks)'
        },
        explanation: {
          type: 'string',
          description: 'Ringkasan singkat Bahasa Indonesia mengenai perubahan yang dilakukan'
        }
      },
      required: ['transformedCode', 'explanation']
    };

    const targetDescription = hasSelection
      ? `Transformasikan HANYA blok kode yang dipilih berikut (kembalikan pengganti langsung untuk blok yang dipilih, pertahankan indentasi sekitar):\n\`\`\`${req.language}\n${safeSelected}\n\`\`\``
      : `Transformasikan seluruh isi file berikut:\n\`\`\`${req.language}\n${safeContext}\n\`\`\``;

    const prompt = `File: ${req.fileName} (${req.language})
Instruksi Refactor / Edit dari Pengguna:
"${req.instruction}"

${hasSelection ? `Konteks Sekitar:\n\`\`\`${req.language}\n${safeContext}\n\`\`\`\n\n` : ''}Tugas:
${targetDescription}`;

    const interaction = await this.runTimedInteraction(
      client,
      {
        model: config.model,
        system_instruction: WISANGGENI_SYSTEM_KNOWLEDGE,
        input: prompt,
        store: false,
        generation_config: {
          thinking_level: 'low',
          max_output_tokens: hasSelection ? 4096 : 8192
        },
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema
        }
      },
      35000
    );

    const parsed = parseStructuredJson<GeminiInlineTransformResponse>(
      this.extractOutputText(interaction)
    );
    return {
      transformedCode: stripMarkdownCodeFence(parsed.transformedCode),
      explanation: parsed.explanation
    };
  }

  // #4 One-Click Fix Syntax / Terminal Error (Ultra-Fast Surgical Patching!)
  async fixError(req: GeminiFixErrorRequest): Promise<GeminiFixErrorResponse> {
    const { client, config } = await this.createClient();
    const safeErr = redactSecretsFromContext(req.errorText);

    // Jalur Kilat: jika nomor baris error terdeteksi (seperti php -l), kirim hanya jendela ±35 baris
    // dan minta patch baris presisi (~50 token output, bukan men-generate ulang ribuan baris!)
    const focused = extractFocusedErrorWindow(req.code, req.errorText, 35);
    if (focused && focused.totalLines > 40) {
      const safeSnippet = redactSecretsFromContext(focused.numberedSnippet, req.fileName);
      const patchSchema = {
        type: 'object',
        properties: {
          edits: {
            type: 'array',
            description:
              'Daftar perubahan baris minimal (1-based inklusif) untuk memperbaiki error tanpa mengubah kode lain',
            items: {
              type: 'object',
              properties: {
                startLine: { type: 'integer', description: 'Nomor baris awal (1-based) yang diganti' },
                endLine: { type: 'integer', description: 'Nomor baris akhir (1-based, inklusif) yang diganti' },
                replacement: {
                  type: 'string',
                  description:
                    'Kode pengganti murni untuk rentang baris startLine..endLine (tanpa nomor baris dan tanpa markdown fence)'
                }
              },
              required: ['startLine', 'endLine', 'replacement']
            }
          },
          explanation: {
            type: 'string',
            description: 'Penjelasan singkat 1-2 kalimat Bahasa Indonesia penyebab error dan perbaikannya'
          }
        },
        required: ['edits', 'explanation']
      };

      const prompt = `File: \`${req.fileName}\` (${req.language}) — Total ${focused.totalLines} baris.
Pesan Error:
${safeErr}

Potongan Kode Sekitar Error (baris ${focused.startLine} s.d. ${focused.endLine}, tanda \`>>>\` menandai baris error):
\`\`\`${req.language}
${safeSnippet}
\`\`\`

Berikan HANYA \`edits\` minimal (startLine, endLine, replacement) untuk memperbaiki error di atas secara tepat. Jangan sertakan nomor baris pada \`replacement\`.`;

      const interaction = await this.runTimedInteraction(
        client,
        {
          model: config.model,
          system_instruction: FAST_FIX_SYSTEM_INSTRUCTION,
          input: prompt,
          store: false,
          generation_config: {
            thinking_level: 'minimal',
            max_output_tokens: 2048
          },
          response_format: {
            type: 'text',
            mime_type: 'application/json',
            schema: patchSchema
          }
        },
        25000
      );

      const parsed = parseStructuredJson<{ edits: LineRangePatch[]; explanation: string }>(
        this.extractOutputText(interaction)
      );

      if (Array.isArray(parsed.edits) && parsed.edits.length > 0) {
        const patchedFull = applyLineRangePatches(req.code, parsed.edits);
        return {
          fixedCode: patchedFull,
          explanation: parsed.explanation || 'Error sintaks berhasil diperbaiki secara presisi.'
        };
      }
    }

    // Jalur File Kecil (<= 40 baris) atau error tanpa nomor baris
    const safeCode = redactSecretsFromContext(req.code.slice(0, 24000), req.fileName);
    const schema = {
      type: 'object',
      properties: {
        fixedCode: {
          type: 'string',
          description: 'Isi kode file utuh yang sudah diperbaiki tanpa markdown code fence'
        },
        explanation: {
          type: 'string',
          description: 'Penjelasan singkat Bahasa Indonesia penyebab error dan perbaikannya'
        }
      },
      required: ['fixedCode', 'explanation']
    };

    const prompt = `Perbaiki error pada file \`${req.fileName}\` (${req.language}) berikut tanpa menghapus logika bisnis yang ada.

Pesan Error / Diagnostik:
${safeErr}

Isi File Saat Ini:
\`\`\`${req.language}
${safeCode}
\`\`\``;

    const interaction = await this.runTimedInteraction(
      client,
      {
        model: config.model,
        system_instruction: FAST_FIX_SYSTEM_INSTRUCTION,
        input: prompt,
        store: false,
        generation_config: {
          thinking_level: 'minimal',
          max_output_tokens: 4096
        },
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema
        }
      },
      28000
    );

    const parsed = parseStructuredJson<GeminiFixErrorResponse>(
      this.extractOutputText(interaction)
    );
    return {
      fixedCode: stripMarkdownCodeFence(parsed.fixedCode),
      explanation: parsed.explanation
    };
  }

  // #5 SQL Query Assistant & Security Auditor (SQLi, XSS, IDOR encid/decid)
  async sqlAndSecurityAudit(req: GeminiSqlAuditRequest): Promise<GeminiSqlAuditResponse> {
    const { client, config } = await this.createClient();
    const safeInput = redactSecretsFromContext(req.input.slice(0, 34000), req.fileName);

    const schema = {
      type: 'object',
      properties: {
        markdownReport: {
          type: 'string',
          description: 'Laporan lengkap dalam format Markdown Bahasa Indonesia'
        },
        suggestedCode: {
          type: 'string',
          description:
            'Query SQL hasil generasi atau kode PHP/SQL utuh yang telah diamankan (tanpa markdown fence)'
        }
      },
      required: ['markdownReport', 'suggestedCode']
    };

    let modeInstruction = '';
    if (req.mode === 'generate-sql') {
      modeInstruction = `Buat query SQL (MySQL/MariaDB) yang optimal beserta contoh pemakaiannya pada \`$query->setSQL()\` & \`$query->setParam()\` Wisanggeni berdasarkan kebutuhan berikut:\n${safeInput}`;
    } else if (req.mode === 'explain-sql') {
      modeInstruction = `Jelaskan alur query SQL berikut secara rinci dalam Bahasa Indonesia, identifikasi potensi bottleneck performa, dan berikan saran indeks (INDEX) atau optimasi query:\n${safeInput}`;
    } else {
      modeInstruction = `Lakukan **Audit Keamanan Kode PHP & SQL** secara menyeluruh pada file \`${req.fileName ?? 'kode.php'}\` berikut:
1. Deteksi celah **SQL Injection** (variabel langsung ditempel di string SQL tanpa \`$query->setParam()\`).
2. Deteksi celah **Cross-Site Scripting (XSS)** (echo variabel input/DB tanpa \`htmlspecialchars\`).
3. Deteksi celah **IDOR** (parameter ID pada URL/form tidak memakai \`encid()\` / \`decid()\`) serta pengecekan autentikasi (\`cekLogin()\` / guard akses).
4. Deteksi potensi bug kompatibilitas **PHP 8.2+**.

Berikan daftar temuan berprioritas di \`markdownReport\` DAN versi kode utuh yang sudah diperbaiki secara aman di \`suggestedCode\`.

Kode Sumber:
\`\`\`php
${safeInput}
\`\`\``;
    }

    // Untuk security-audit gunakan model pilihan user (atau gemini-4-carbon bila dipilih)
    const interaction = await client.interactions.create({
      model: config.model,
      system_instruction: WISANGGENI_SYSTEM_KNOWLEDGE,
      input: modeInstruction,
      store: false,
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema
      }
    });

    const parsed = parseStructuredJson<GeminiSqlAuditResponse>(
      this.extractOutputText(interaction)
    );
    return {
      markdownReport: parsed.markdownReport,
      suggestedCode: stripMarkdownCodeFence(parsed.suggestedCode)
    };
  }

  // #6 AI Ghost-Text Inline Autocomplete (Fast gemini-3.5-flash-lite)
  async inlineCompletion(req: GeminiInlineCompletionRequest): Promise<string> {
    const { apiKey, config } = await this.resolveCredentials();
    if (!apiKey || !config.ghostTextEnabled) return '';

    const lowerName = req.fileName.toLowerCase();
    if (lowerName.endsWith('connect_db.php') || lowerName.endsWith('.env')) {
      return '';
    }

    const prefixWindow = redactSecretsFromContext(req.prefix.slice(-2200), req.fileName);
    const suffixWindow = redactSecretsFromContext(req.suffix.slice(0, 700), req.fileName);
    if (!prefixWindow.trim()) return '';

    const cacheKey = `${req.language}:${prefixWindow.slice(-280)}|${suffixWindow.slice(0, 80)}`;
    const cached = this.completionCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const client = new GoogleGenAI({ apiKey });
    const prompt = `Lanjutkan potongan kode pada posisi <CURSOR> untuk file ${req.fileName} (${req.language}).
ATURAN KETAT:
- Kembalikan HANYA teks kelanjutan kode mentah yang langsung disisipkan di posisi <CURSOR>.
- JANGAN mengulang kode sebelum <CURSOR> atau sesudah <CURSOR>.
- JANGAN membungkus dengan \`\`\` atau penjelasan apa pun.
- Maksimal 1 hingga 5 baris kode yang paling relevan.

<PREFIX>
${prefixWindow}<CURSOR>${suffixWindow}
</SUFFIX>`;

    try {
      const interaction = await client.interactions.create({
        model: config.ghostTextModel || 'gemini-3.5-flash-lite',
        system_instruction:
          'Anda mesin inline code-completion super cepat untuk PHP (Wisanggeni Framework), SQL, JS/TS, HTML, dan CSS. Hanya keluarkan kode mentah lanjutan tanpa penjelasan dan tanpa markdown fence.',
        input: prompt,
        store: false,
        generation_config: {
          max_output_tokens: 140,
          stop_sequences: ['</SUFFIX>', '<PREFIX>', '\n\n\n']
        }
      });

      const cleaned = stripMarkdownCodeFence(this.extractOutputText(interaction));
      if (this.completionCache.size > 80) {
        const oldestKey = this.completionCache.keys().next().value;
        if (oldestKey) this.completionCache.delete(oldestKey);
      }
      this.completionCache.set(cacheKey, cleaned);
      return cleaned;
    } catch {
      return '';
    }
  }

  // #7 Auto Documentation Generator (PHPDoc + INSERT INTO wisanggeni_docs)
  async generateDocs(req: GeminiDocGenRequest): Promise<GeminiDocGenResponse> {
    const { client, config } = await this.createClient();
    const safeCode = redactSecretsFromContext(req.code.slice(0, 30000), req.fileName);

    const schema = {
      type: 'object',
      properties: {
        markdownDoc: {
          type: 'string',
          description: 'Dokumentasi teknis Bahasa Indonesia dalam format Markdown'
        },
        phpDocComment: {
          type: 'string',
          description: 'Komentar blok PHPDoc /** ... */ siap tempel'
        },
        wisanggeniSqlInsert: {
          type: 'string',
          description:
            'Query SQL INSERT INTO wisanggeni_docs (type, name, class_name, syntax, description, example) VALUES ...; yang siap dijalankan'
        }
      },
      required: ['markdownDoc', 'phpDocComment', 'wisanggeniSqlInsert']
    };

    const prompt = `Buat dokumentasi Bahasa Indonesia yang rapi untuk file \`${req.fileName}\`${
      req.targetSymbol ? ` (fokus simbol: \`${req.targetSymbol}\`)` : ''
    }:
1. \`markdownDoc\`: Penjelasan fungsi/class, daftar parameter, nilai kembalian, dan contoh pemakaian.
2. \`phpDocComment\`: Blok komentar \`/** ... */\` standar PHPDoc.
3. \`wisanggeniSqlInsert\`: Pernyataan SQL valid \`INSERT INTO wisanggeni_docs (type, name, class_name, syntax, description, example) VALUES (...);\` untuk semua class/method/function utama di kode ini (gunakan escape kutip tunggal SQL \`\\'\` dengan benar).

Kode Sumber:
\`\`\`php
${safeCode}
\`\`\``;

    const interaction = await client.interactions.create({
      model: config.model,
      system_instruction: WISANGGENI_SYSTEM_KNOWLEDGE,
      input: prompt,
      store: false,
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema
      }
    });

    const parsed = parseStructuredJson<GeminiDocGenResponse>(
      this.extractOutputText(interaction)
    );
    return {
      markdownDoc: parsed.markdownDoc,
      phpDocComment: stripMarkdownCodeFence(parsed.phpDocComment),
      wisanggeniSqlInsert: stripMarkdownCodeFence(parsed.wisanggeniSqlInsert)
    };
  }

  // #8 Smart Git Commit Message & Pre-Deploy Diff Summary
  async summarizeChanges(
    req: GeminiSummarizeChangesRequest
  ): Promise<GeminiSummarizeChangesResponse> {
    const { client, config } = await this.createClient();
    const safeChanges = redactSecretsFromContext(req.changesText.slice(0, 28000));

    const schema = {
      type: 'object',
      properties: {
        commitMessage: {
          type: 'string',
          description:
            'Pesan commit singkat gaya Conventional Commits dalam Bahasa Indonesia (contoh: feat(komoditi): tambah validasi jenis komoditi)'
        },
        summaryMarkdown: {
          type: 'string',
          description: 'Ringkasan poin-poin perubahan dan dampak sebelum deploy ke server'
        }
      },
      required: ['commitMessage', 'summaryMarkdown']
    };

    const prompt =
      req.mode === 'commit-message'
        ? `Analisis daftar perubahan Git / diff berikut dan buatkan pesan commit Conventional Commits Bahasa Indonesia yang jelas beserta ringkasannya:\n\n${safeChanges}`
        : `Analisis daftar file yang akan disinkronkan (Push/Pull) antara Lokal dan Server Remote berikut, lalu berikan ringkasan eksekutif pra-deploy Bahasa Indonesia beserta catatan kehati-hatian bila ada:\n\n${safeChanges}`;

    const interaction = await client.interactions.create({
      model: config.model,
      system_instruction: WISANGGENI_SYSTEM_KNOWLEDGE,
      input: prompt,
      store: false,
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema
      }
    });

    return parseStructuredJson<GeminiSummarizeChangesResponse>(
      this.extractOutputText(interaction)
    );
  }
}
