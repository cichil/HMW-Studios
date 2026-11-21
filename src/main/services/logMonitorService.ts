import { existsSync } from 'node:fs';
import { open, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type {
  LogMonitorStatus,
  LogSourceConfig,
  ParsedLogEntry
} from '@shared/types';
import type { ConnectionManager } from './connections';

const REMOTE_CANDIDATE_LOG_PATHS = [
  'storage/logs/laravel.log',
  'error_log',
  'php_error.log',
  'logs/error.log',
  '/var/log/apache2/error.log',
  '/var/log/httpd/error_log',
  '/var/log/nginx/error.log',
  '/var/log/php8.4-fpm.log',
  '/var/log/php8.3-fpm.log',
  '/var/log/php8.2-fpm.log',
  '/var/log/php8.1-fpm.log',
  '/var/log/php-fpm/www-error.log'
];

const WINDOWS_COMMON_LOG_PATHS = [
  'C:\\xampp3\\apache\\logs\\error.log',
  'C:\\xampp3\\php\\logs\\php_error_log',
  'D:\\xampp3\\apache\\logs\\error.log',
  'C:\\xampp\\apache\\logs\\error.log',
  'C:\\xampp\\php\\logs\\php_error_log',
  'C:\\laragon\\tmp\\php_errors.log',
  'C:\\wamp64\\logs\\php_error.log',
  'C:\\wamp64\\logs\\apache_error.log'
];

function classifyLogSeverity(line: string): ParsedLogEntry['level'] {
  const lower = line.toLowerCase();
  if (
    lower.includes('fatal error') ||
    lower.includes('parse error') ||
    lower.includes('uncaught ') ||
    lower.includes('.critical:') ||
    lower.includes('.emergency:') ||
    lower.includes('.alert:')
  ) {
    return 'fatal';
  }
  if (
    lower.includes('.error:') ||
    lower.includes('[error]') ||
    lower.includes('php:error') ||
    lower.includes('sqlstate[') ||
    lower.includes('exception:') ||
    lower.includes('error:')
  ) {
    return 'error';
  }
  if (
    lower.includes('warning') ||
    lower.includes('deprecated') ||
    lower.includes('notice') ||
    lower.includes('[warn]')
  ) {
    return 'warning';
  }
  return 'info';
}

function extractFileAndLine(raw: string): { filePath?: string; line?: number } {
  // PHP standard: "... in /path/to/file.php on line 42" or "... in D:\path\file.php on line 42"
  const phpOnLine = raw.match(
    /\bin\s+((?:[A-Za-z]:[\\/]|\/)[^\s:()"']+\.(?:php|phtml|inc|blade\.php))\s+on\s+line\s+(\d+)/i
  );
  if (phpOnLine) {
    return {
      filePath: phpOnLine[1],
      line: Math.max(1, Number(phpOnLine[2]) || 1)
    };
  }

  // PHP / Laravel exception style: "/path/to/file.php:87" or "/path/to/file.php(87)"
  const colonOrParen = raw.match(
    /((?:[A-Za-z]:[\\/]|\/)[^\s:()"']+\.(?:php|phtml|inc|blade\.php))(?::|\()(\d+)(?:\))?/i
  );
  if (colonOrParen) {
    return {
      filePath: colonOrParen[1],
      line: Math.max(1, Number(colonOrParen[2]) || 1)
    };
  }

  return {};
}

function extractTimestampAndBody(raw: string): { timestamp: string; message: string } {
  // Laravel: [2026-11-15 19:10:02] local.ERROR: Message...
  const laravelMatch = raw.match(/^\[(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}[^\]]*)\]\s*(.+)$/);
  if (laravelMatch) {
    return { timestamp: laravelMatch[1], message: laravelMatch[2].trim() };
  }

  // Apache / PHP CLI: [Sun Nov 15 19:10:02.123 2026] [php:error] [pid ...] [client ...] Message...
  const apacheMatch = raw.match(/^\[([^\]]+)\]\s*(?:\[[^\]]+\]\s*)*(.+)$/);
  if (apacheMatch) {
    return { timestamp: apacheMatch[1], message: apacheMatch[2].trim() };
  }

  // Nginx: 2026/11/15 19:10:02 [error] 123#123: *1 FastCGI sent in stderr: "..."
  const nginxMatch = raw.match(/^(\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2})\s+(.+)$/);
  if (nginxMatch) {
    return { timestamp: nginxMatch[1], message: nginxMatch[2].trim() };
  }

  return {
    timestamp: new Date().toLocaleTimeString('id-ID', { hour12: false }),
    message: raw.trim()
  };
}

export function parseLogLines(rawContent: string, maxEntries = 200): ParsedLogEntry[] {
  if (!rawContent.trim()) return [];
  const rawLines = rawContent.split(/\r?\n/);
  const entries: ParsedLogEntry[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i].trim();
    if (!line) continue;

    // Skip pure stack-trace continuation lines (#0, #1, [stacktrace], etc.) while attaching location if parent missed it
    if ((line.startsWith('#') || line === '[stacktrace]' || line === '"}') && entries.length > 0) {
      const prev = entries[entries.length - 1];
      prev.raw += `\n${line}`;
      if (!prev.filePath) {
        const loc = extractFileAndLine(line);
        if (loc.filePath) {
          prev.filePath = loc.filePath;
          prev.line = loc.line;
        }
      }
      continue;
    }

    const { timestamp, message } = extractTimestampAndBody(line);
    const level = classifyLogSeverity(line);
    const { filePath, line: lineNo } = extractFileAndLine(line);

    entries.push({
      id: `log-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp,
      level,
      message,
      raw: line,
      filePath,
      line: lineNo
    });
  }

  return entries.length > maxEntries ? entries.slice(-maxEntries) : entries;
}

async function readLocalTail(
  filePath: string,
  maxBytes = 65536
): Promise<{ content: string; size: number; exists: boolean }> {
  const resolved = resolve(filePath);
  let st;
  try {
    st = await stat(resolved);
  } catch {
    return { content: '', size: 0, exists: false };
  }
  if (!st.isFile()) {
    return { content: '', size: 0, exists: false };
  }
  if (st.size === 0) {
    return { content: '', size: 0, exists: true };
  }
  if (st.size <= maxBytes) {
    const content = await readFile(resolved, 'utf-8');
    return { content, size: st.size, exists: true };
  }
  const fh = await open(resolved, 'r');
  try {
    const len = Math.min(maxBytes, st.size);
    const buf = Buffer.alloc(len);
    const { bytesRead } = await fh.read(buf, 0, len, st.size - len);
    return {
      content: buf.subarray(0, bytesRead).toString('utf-8'),
      size: st.size,
      exists: true
    };
  } finally {
    await fh.close();
  }
}

export class LogMonitorService {
  private readonly connectionManager: ConnectionManager;
  private readonly entryListeners = new Set<(entries: ParsedLogEntry[]) => void>();
  private readonly statusListeners = new Set<(status: LogMonitorStatus) => void>();
  private readonly fatalListeners = new Set<(entry: ParsedLogEntry, source: LogSourceConfig) => void>();

  private activeSource: LogSourceConfig | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private pollingInFlight = false;
  private lastKnownSize = 0;
  private lastPolledAt: string | null = null;
  private lastError: string | null = null;

  constructor(connectionManager: ConnectionManager) {
    this.connectionManager = connectionManager;
  }

  onEntries(cb: (entries: ParsedLogEntry[]) => void): () => void {
    this.entryListeners.add(cb);
    return () => this.entryListeners.delete(cb);
  }

  onStatus(cb: (status: LogMonitorStatus) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  onFatalAlert(cb: (entry: ParsedLogEntry, source: LogSourceConfig) => void): () => void {
    this.fatalListeners.add(cb);
    return () => this.fatalListeners.delete(cb);
  }

  getStatus(): LogMonitorStatus {
    return {
      running: Boolean(this.timer && this.activeSource),
      source: this.activeSource,
      lastPolledAt: this.lastPolledAt,
      fileSize: this.lastKnownSize,
      lastError: this.lastError
    };
  }

  private emitStatus(): void {
    const st = this.getStatus();
    for (const fn of this.statusListeners) {
      fn(st);
    }
  }

  private emitEntries(entries: ParsedLogEntry[]): void {
    if (entries.length === 0) return;
    for (const fn of this.entryListeners) {
      fn(entries);
    }
  }

  private async fetchRawTail(
    source: LogSourceConfig,
    maxBytes: number
  ): Promise<{ content: string; size: number; exists: boolean }> {
    if (source.kind === 'remote') {
      if (!source.connectionId) {
        throw new Error('ID koneksi remote diperlukan untuk memantau log server.');
      }
      return this.connectionManager.readRemoteTail(source.connectionId, source.filePath, maxBytes);
    }
    return readLocalTail(source.filePath, maxBytes);
  }

  async readSnapshot(config: LogSourceConfig): Promise<ParsedLogEntry[]> {
    const res = await this.fetchRawTail(config, 65536);
    if (!res.exists) {
      throw new Error(`File log tidak ditemukan: ${config.filePath}`);
    }
    return parseLogLines(res.content, 150);
  }

  async autoDetectPaths(
    connectionId?: string | null,
    workspacePath?: string | null
  ): Promise<LogSourceConfig[]> {
    const found: LogSourceConfig[] = [];

    if (workspacePath) {
      const wsCandidates = [
        join(workspacePath, 'storage', 'logs', 'laravel.log'),
        join(workspacePath, 'error_log'),
        join(workspacePath, 'php_error.log'),
        join(workspacePath, 'logs', 'error.log')
      ];
      for (const p of wsCandidates) {
        if (existsSync(p)) {
          found.push({ kind: 'local', filePath: p });
        }
      }
    }

    for (const winLog of WINDOWS_COMMON_LOG_PATHS) {
      if (existsSync(winLog)) {
        found.push({ kind: 'local', filePath: winLog });
      }
    }

    if (connectionId) {
      for (const remoteCandidate of REMOTE_CANDIDATE_LOG_PATHS) {
        try {
          const exists = await this.connectionManager.checkRemotePathExists(
            connectionId,
            remoteCandidate
          );
          if (exists) {
            found.push({
              kind: 'remote',
              connectionId,
              filePath: remoteCandidate
            });
          }
        } catch {
          break;
        }
      }
    }

    return found;
  }

  async start(config: LogSourceConfig): Promise<LogMonitorStatus> {
    this.stop();
    this.activeSource = { ...config };
    this.lastError = null;

    try {
      const initial = await this.fetchRawTail(config, 65536);
      if (!initial.exists) {
        this.lastError = `File log tidak ditemukan: ${config.filePath}`;
      } else {
        this.lastKnownSize = initial.size;
        this.lastPolledAt = new Date().toISOString();
        const initialEntries = parseLogLines(initial.content, 150);
        this.emitEntries(initialEntries);
      }
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
    }

    const intervalMs = Math.max(1000, config.pollIntervalMs ?? 2500);
    const timer = setInterval(() => {
      void this.pollTick();
    }, intervalMs);
    timer.unref?.();
    this.timer = timer;

    this.emitStatus();
    return this.getStatus();
  }

  private async pollTick(): Promise<void> {
    if (this.pollingInFlight || !this.activeSource) return;
    this.pollingInFlight = true;
    const source = this.activeSource;

    try {
      // Quick tail read: read delta bytes if file grew
      const headCheck = await this.fetchRawTail(source, 65536);
      this.lastPolledAt = new Date().toISOString();

      if (!headCheck.exists) {
        this.lastError = `File log tidak ditemukan: ${source.filePath}`;
        this.emitStatus();
        return;
      }

      this.lastError = null;
      if (headCheck.size < this.lastKnownSize) {
        // Log rotated or truncated
        this.lastKnownSize = headCheck.size;
        const freshEntries = parseLogLines(headCheck.content, 80);
        this.emitEntries(freshEntries);
      } else if (headCheck.size > this.lastKnownSize) {
        const deltaBytes = Math.min(65536, headCheck.size - this.lastKnownSize);
        const deltaTail =
          deltaBytes === headCheck.size
            ? headCheck
            : await this.fetchRawTail(source, deltaBytes);
        this.lastKnownSize = headCheck.size;
        const newEntries = parseLogLines(deltaTail.content, 80);
        if (newEntries.length > 0) {
          this.emitEntries(newEntries);
          const critical = [...newEntries]
            .reverse()
            .find((e) => e.level === 'fatal' || e.level === 'error');
          if (critical) {
            for (const fn of this.fatalListeners) {
              fn(critical, source);
            }
          }
        }
      }
      this.emitStatus();
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      this.emitStatus();
    } finally {
      this.pollingInFlight = false;
    }
  }

  stop(): LogMonitorStatus {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.pollingInFlight = false;
    this.emitStatus();
    return this.getStatus();
  }
}
