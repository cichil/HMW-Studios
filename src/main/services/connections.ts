import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync
} from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import {
  cpus,
  freemem,
  hostname,
  loadavg,
  platform,
  release,
  tmpdir,
  totalmem,
  uptime,
  userInfo
} from 'node:os';
import { basename, dirname, extname, join, posix, resolve } from 'node:path';
import type {
  ConnectionPoolStat,
  ConnectionProfile,
  ConnectionSavePayload,
  MultiServerDeployResult,
  PhpClassMeta,
  PhpFunctionMeta,
  RemoteEntry,
  RemoteFileIndexItem,
  RemoteSearchMatch,
  RemoteWorkspaceIntelPayload,
  ReplaceInFilesOptions,
  ReplaceInFilesResult,
  ServerDiskMount,
  ServerHealthSnapshot,
  ServerServiceStatus,
  WebSymbolCatalog
} from '@shared/types';
import { learnJoinEdgesFromSources } from '@shared/sqlJoinHelper';
import {
  scanSourceFilesForSecurityAndHealth,
  type ProjectSecurityScanReport
} from '@shared/projectSecurityScanner';
import {
  extractWebSymbolsFromSource,
  mergeWebSymbolCatalogs
} from '@shared/webAssetAnalyzer';
import {
  BUILTIN_SSH_SNIPPETS,
  type MultiSshExecItemResult,
  type SshSnippetItem
} from '@shared/sshSnippetsCatalog';
import { DEFAULT_IGNORE_PATTERNS } from './ignoreFilter';
import { FtpTransferDriver } from './ftpDriver';
import { LocalFolderTransferDriver } from './localSyncDriver';
import { extractPhpSymbolsFromSource } from './phpService';
import { openSshClient, SftpTransferDriver } from './sftpDriver';
import type { DecryptedSecrets, RemoteTransferDriver } from './transferTypes';

export interface SecretVaultAdapter {
  encrypt(plainText: string): string;
  decrypt(cipherPayload: string): string;
}

export class FallbackAesVault implements SecretVaultAdapter {
  private readonly key: Buffer;

  constructor(seed?: string) {
    const machineIdentity = seed ?? `${hostname()}::${userInfo().username}::aptana-studio-4-vault`;
    this.key = scryptSync(machineIdentity, 'aptana-modern-salt-v4', 32);
  }

  encrypt(plainText: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(plainText, 'utf-8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `aes256gcm:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
  }

  decrypt(cipherPayload: string): string {
    const parts = cipherPayload.split(':');
    if (parts.length !== 4 || parts[0] !== 'aes256gcm') {
      throw new Error('Invalid encrypted secret format');
    }
    const iv = Buffer.from(parts[1], 'base64');
    const tag = Buffer.from(parts[2], 'base64');
    const data = Buffer.from(parts[3], 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf-8');
  }
}

interface StoredVaultRecord {
  passwordEnc?: string;
  passphraseEnc?: string;
}

interface PooledDriverRecord {
  profile: ConnectionProfile;
  driver: RemoteTransferDriver;
  lastUsedAt: number;
  operationsCount: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

const POOL_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

function isTransientDisconnectError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('not connected') ||
    msg.includes('no sftp connection') ||
    msg.includes('econnreset') ||
    msg.includes('epipe') ||
    msg.includes('socket') ||
    msg.includes('channel closed') ||
    msg.includes('client closed') ||
    msg.includes('connection lost') ||
    msg.includes('fin packet')
  );
}

export type TransferDriverFactory = (
  profile: ConnectionProfile,
  secrets: DecryptedSecrets
) => RemoteTransferDriver;

export class ConnectionManager {
  private readonly storageDir: string;
  private readonly profilesFile: string;
  private readonly vaultFile: string;
  private readonly vault: SecretVaultAdapter;
  private readonly driverFactory?: TransferDriverFactory;
  private readonly pool = new Map<string, PooledDriverRecord>();
  private readonly locks = new Map<string, Promise<void>>();

  constructor(
    storageDir: string,
    vault?: SecretVaultAdapter,
    driverFactory?: TransferDriverFactory
  ) {
    this.storageDir = resolve(storageDir);
    this.profilesFile = join(this.storageDir, 'connections.json');
    this.vaultFile = join(this.storageDir, 'connections.vault.json');
    this.vault = vault ?? new FallbackAesVault();
    this.driverFactory = driverFactory;
  }

  private async runExclusive<T>(id: string, task: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((res) => {
      release = res;
    });
    const chained = prev.then(() => gate);
    this.locks.set(id, chained);

    await prev;
    try {
      return await task();
    } finally {
      release();
      if (this.locks.get(id) === chained) {
        this.locks.delete(id);
      }
    }
  }

  private scheduleIdleEviction(id: string, rec: PooledDriverRecord): void {
    if (rec.idleTimer) {
      clearTimeout(rec.idleTimer);
    }
    const timer = setTimeout(() => {
      void this.disconnectPool(id);
    }, POOL_IDLE_TIMEOUT_MS);
    timer.unref?.();
    rec.idleTimer = timer;
  }

  private async evictDriverUnsafe(id: string): Promise<void> {
    const existing = this.pool.get(id);
    if (!existing) return;
    this.pool.delete(id);
    if (existing.idleTimer) {
      clearTimeout(existing.idleTimer);
      existing.idleTimer = null;
    }
    try {
      await existing.driver.disconnect();
    } catch {
      // Ignore disconnect error
    }
  }

  async disconnectPool(id?: string): Promise<void> {
    if (id) {
      await this.runExclusive(id, async () => {
        await this.evictDriverUnsafe(id);
      });
      return;
    }
    const allIds = Array.from(this.pool.keys());
    await Promise.all(allIds.map((connId) => this.disconnectPool(connId)));
  }

  async disposeAll(): Promise<void> {
    await this.disconnectPool();
  }

  poolStats(): ConnectionPoolStat[] {
    const now = Date.now();
    const out: ConnectionPoolStat[] = [];
    for (const [connectionId, rec] of this.pool.entries()) {
      const alive = rec.driver.isAlive ? rec.driver.isAlive() : true;
      out.push({
        connectionId,
        protocol: rec.profile.protocol,
        alive,
        idleMs: Math.max(0, now - rec.lastUsedAt),
        operationsCount: rec.operationsCount
      });
    }
    return out;
  }

  async withDriver<T>(
    id: string,
    fn: (driver: RemoteTransferDriver, profile: ConnectionProfile) => Promise<T>
  ): Promise<T> {
    return this.runExclusive(id, async () => {
      let rec = this.pool.get(id);
      if (rec) {
        const alive = rec.driver.isAlive ? rec.driver.isAlive() : true;
        if (!alive) {
          await this.evictDriverUnsafe(id);
          rec = undefined;
        }
      }

      if (!rec) {
        const created = await this.createDriver(id);
        await created.driver.connect();
        rec = {
          profile: created.profile,
          driver: created.driver,
          lastUsedAt: Date.now(),
          operationsCount: 0,
          idleTimer: null
        };
        this.pool.set(id, rec);
      }

      this.scheduleIdleEviction(id, rec);

      try {
        const result = await fn(rec.driver, rec.profile);
        rec.lastUsedAt = Date.now();
        rec.operationsCount += 1;
        this.scheduleIdleEviction(id, rec);
        return result;
      } catch (err) {
        if (!isTransientDisconnectError(err)) {
          throw err;
        }
        // Reconnect once transparently if persistent socket dropped mid-flight
        await this.evictDriverUnsafe(id);
        const fresh = await this.createDriver(id);
        await fresh.driver.connect();
        const freshRec: PooledDriverRecord = {
          profile: fresh.profile,
          driver: fresh.driver,
          lastUsedAt: Date.now(),
          operationsCount: 1,
          idleTimer: null
        };
        this.pool.set(id, freshRec);
        this.scheduleIdleEviction(id, freshRec);
        return await fn(freshRec.driver, freshRec.profile);
      }
    });
  }

  private async readProfilesRaw(): Promise<ConnectionProfile[]> {
    if (!existsSync(this.profilesFile)) return [];
    try {
      const content = await readFile(this.profilesFile, 'utf-8');
      return JSON.parse(content) as ConnectionProfile[];
    } catch {
      return [];
    }
  }

  private async writeProfilesRaw(profiles: ConnectionProfile[]): Promise<void> {
    await mkdir(this.storageDir, { recursive: true });
    await writeFile(this.profilesFile, JSON.stringify(profiles, null, 2), 'utf-8');
  }

  private async readVaultRaw(): Promise<Record<string, StoredVaultRecord>> {
    if (!existsSync(this.vaultFile)) return {};
    try {
      const content = await readFile(this.vaultFile, 'utf-8');
      return JSON.parse(content) as Record<string, StoredVaultRecord>;
    } catch {
      return {};
    }
  }

  private async writeVaultRaw(vaultData: Record<string, StoredVaultRecord>): Promise<void> {
    await mkdir(this.storageDir, { recursive: true });
    await writeFile(this.vaultFile, JSON.stringify(vaultData, null, 2), 'utf-8');
  }

  async list(): Promise<ConnectionProfile[]> {
    const [profiles, vaultData] = await Promise.all([
      this.readProfilesRaw(),
      this.readVaultRaw()
    ]);
    return profiles.map((p) => ({
      ...p,
      hasSavedSecret: Boolean(vaultData[p.id]?.passwordEnc || vaultData[p.id]?.passphraseEnc)
    }));
  }

  async getById(id: string): Promise<ConnectionProfile> {
    const all = await this.list();
    const found = all.find((p) => p.id === id);
    if (!found) {
      throw new Error(`Profil koneksi tidak ditemukan: ${id}`);
    }
    return found;
  }

  async getSecrets(id: string): Promise<DecryptedSecrets> {
    const vaultData = await this.readVaultRaw();
    const rec = vaultData[id];
    if (!rec) return {};
    const out: DecryptedSecrets = {};
    if (rec.passwordEnc) {
      try {
        out.password = this.vault.decrypt(rec.passwordEnc);
      } catch {
        // Ignore undecryptable secret
      }
    }
    if (rec.passphraseEnc) {
      try {
        out.passphrase = this.vault.decrypt(rec.passphraseEnc);
      } catch {
        // Ignore undecryptable secret
      }
    }
    return out;
  }

  async save(payload: ConnectionSavePayload): Promise<ConnectionProfile> {
    const profiles = await this.readProfilesRaw();
    const vaultData = await this.readVaultRaw();
    const now = new Date().toISOString();

    const id = payload.profile.id?.trim() || `conn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const existingIdx = profiles.findIndex((p) => p.id === id);

    const savedProfile: ConnectionProfile = {
      id,
      name: payload.profile.name.trim() || 'Untitled Connection',
      protocol: payload.profile.protocol,
      host: payload.profile.host.trim(),
      port: Number(payload.profile.port) || (payload.profile.protocol === 'sftp' ? 22 : 21),
      username: payload.profile.username.trim(),
      remotePath: payload.profile.remotePath.trim() || '/',
      authType: payload.profile.authType,
      privateKeyPath: payload.profile.privateKeyPath?.trim() || undefined,
      passive: payload.profile.passive ?? true,
      rejectUnauthorized: payload.profile.rejectUnauthorized ?? false,
      keepSynchronized: Boolean(payload.profile.keepSynchronized),
      isProduction: Boolean(payload.profile.isProduction),
      ignorePatterns:
        payload.profile.ignorePatterns?.length > 0
          ? payload.profile.ignorePatterns
          : [...DEFAULT_IGNORE_PATTERNS],
      createdAt: existingIdx >= 0 ? profiles[existingIdx].createdAt : now,
      updatedAt: now
    };

    if (existingIdx >= 0) {
      profiles[existingIdx] = savedProfile;
    } else {
      profiles.push(savedProfile);
    }

    const currentSecrets: StoredVaultRecord = vaultData[id] ?? {};
    if (payload.password !== undefined && payload.password !== '') {
      currentSecrets.passwordEnc = this.vault.encrypt(payload.password);
    }
    if (payload.passphrase !== undefined && payload.passphrase !== '') {
      currentSecrets.passphraseEnc = this.vault.encrypt(payload.passphrase);
    }
    vaultData[id] = currentSecrets;

    await Promise.all([this.writeProfilesRaw(profiles), this.writeVaultRaw(vaultData)]);
    await this.disconnectPool(id);
    return {
      ...savedProfile,
      hasSavedSecret: Boolean(currentSecrets.passwordEnc || currentSecrets.passphraseEnc)
    };
  }

  async remove(id: string): Promise<void> {
    await this.disconnectPool(id);
    const [profiles, vaultData] = await Promise.all([
      this.readProfilesRaw(),
      this.readVaultRaw()
    ]);
    const filtered = profiles.filter((p) => p.id !== id);
    delete vaultData[id];
    await Promise.all([
      this.writeProfilesRaw(filtered),
      this.writeVaultRaw(vaultData),
      this.clearRemoteIndexCache(id)
    ]);
  }

  private remoteIndexCachePath(id: string, kind: 'files' | 'intel'): string {
    const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.storageDir, 'remote-index-cache', `${safeId}.${kind}.json`);
  }

  private async clearRemoteIndexCache(id: string): Promise<void> {
    await Promise.all([
      rm(this.remoteIndexCachePath(id, 'files'), { force: true }).catch(() => {}),
      rm(this.remoteIndexCachePath(id, 'intel'), { force: true }).catch(() => {})
    ]);
  }

  private async readRemoteFilesCacheRaw(
    id: string
  ): Promise<{ updatedAt: number; files: RemoteFileIndexItem[] } | null> {
    const p = this.remoteIndexCachePath(id, 'files');
    if (!existsSync(p)) return null;
    try {
      const raw = await readFile(p, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.files)) {
        return {
          updatedAt: Number(parsed.updatedAt) || 0,
          files: parsed.files as RemoteFileIndexItem[]
        };
      }
    } catch {
      // Ignore corrupt cache
    }
    return null;
  }

  private async saveRemoteFilesCache(id: string, files: RemoteFileIndexItem[]): Promise<void> {
    try {
      const p = this.remoteIndexCachePath(id, 'files');
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, JSON.stringify({ updatedAt: Date.now(), files }), 'utf-8');
    } catch {
      // Ignore write failures
    }
  }

  private async readRemoteIntelCacheRaw(
    id: string
  ): Promise<{ updatedAt: number; intel: RemoteWorkspaceIntelPayload } | null> {
    const p = this.remoteIndexCachePath(id, 'intel');
    if (!existsSync(p)) return null;
    try {
      const raw = await readFile(p, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed.intel && parsed.intel.connectionId) {
        return {
          updatedAt: Number(parsed.updatedAt) || 0,
          intel: parsed.intel as RemoteWorkspaceIntelPayload
        };
      }
    } catch {
      // Ignore corrupt cache
    }
    return null;
  }

  private async saveRemoteIntelCache(
    id: string,
    intel: RemoteWorkspaceIntelPayload
  ): Promise<void> {
    try {
      const p = this.remoteIndexCachePath(id, 'intel');
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, JSON.stringify({ updatedAt: Date.now(), intel }), 'utf-8');
    } catch {
      // Ignore write failures
    }
  }

  async getCachedRemoteIndex(
    id: string
  ): Promise<{ files: RemoteFileIndexItem[]; intel?: RemoteWorkspaceIntelPayload } | null> {
    const [filesCache, intelCache] = await Promise.all([
      this.readRemoteFilesCacheRaw(id),
      this.readRemoteIntelCacheRaw(id)
    ]);
    if (!filesCache && !intelCache) return null;
    return {
      files: filesCache?.files ?? [],
      intel: intelCache?.intel
    };
  }

  async createDriver(id: string): Promise<{ profile: ConnectionProfile; driver: RemoteTransferDriver }> {
    const profile = await this.getById(id);
    const secrets = await this.getSecrets(id);

    if (this.driverFactory) {
      return { profile, driver: this.driverFactory(profile, secrets) };
    }
    if (profile.protocol === 'local') {
      return { profile, driver: new LocalFolderTransferDriver(profile) };
    }
    if (profile.protocol === 'sftp') {
      return { profile, driver: new SftpTransferDriver(profile, secrets) };
    }
    return { profile, driver: new FtpTransferDriver(profile, secrets) };
  }

  async testConnection(
    id: string
  ): Promise<{ ok: boolean; message: string; latencyMs: number }> {
    const started = Date.now();
    await this.disconnectPool(id);
    try {
      const profile = await this.withDriver(id, async (driver, prof) => {
        await driver.listDirectory('');
        return prof;
      });
      const latencyMs = Date.now() - started;
      return {
        ok: true,
        message: `Berhasil terhubung ke ${profile.name} (${profile.protocol.toUpperCase()}) dalam ${latencyMs} ms`,
        latencyMs
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
        latencyMs: Date.now() - started
      };
    }
  }

  async listRemoteDir(id: string, remoteSubPath = ''): Promise<RemoteEntry[]> {
    return this.withDriver(id, (driver) => driver.listDirectory(remoteSubPath));
  }

  async readRemoteFile(id: string, remoteRelativePath: string): Promise<string> {
    return this.withDriver(id, (driver) => driver.readFileText(remoteRelativePath));
  }

  async readRemoteTail(
    id: string,
    remotePathOrRel: string,
    maxBytes = 65536
  ): Promise<{ content: string; size: number; exists: boolean }> {
    return this.withDriver(id, async (driver) => {
      if (driver.readTailText) {
        return driver.readTailText(remotePathOrRel, maxBytes);
      }
      const content = await driver.readFileText(remotePathOrRel);
      const sliced = content.length > maxBytes ? content.slice(-maxBytes) : content;
      return {
        content: sliced,
        size: Buffer.byteLength(content, 'utf-8'),
        exists: true
      };
    });
  }

  async checkRemotePathExists(id: string, remotePathOrRel: string): Promise<boolean> {
    return this.withDriver(id, async (driver) => {
      if (driver.checkAbsoluteOrRelExists) {
        return driver.checkAbsoluteOrRelExists(remotePathOrRel);
      }
      try {
        await driver.readFileText(remotePathOrRel);
        return true;
      } catch {
        return false;
      }
    });
  }

  async writeRemoteFile(
    id: string,
    remoteRelativePath: string,
    content: string
  ): Promise<ConnectionProfile> {
    return this.withDriver(id, async (driver, profile) => {
      await driver.writeFileText(remoteRelativePath.replace(/\\/g, '/'), content);
      return profile;
    });
  }

  async createRemoteEntry(
    id: string,
    remoteRelativePath: string,
    isDirectory: boolean,
    initialContent = ''
  ): Promise<ConnectionProfile> {
    return this.withDriver(id, async (driver, profile) => {
      await driver.createEntry(
        remoteRelativePath.replace(/\\/g, '/'),
        isDirectory,
        initialContent
      );
      return profile;
    });
  }

  async renameRemoteEntry(
    id: string,
    oldRelativePath: string,
    newRelativePath: string
  ): Promise<ConnectionProfile> {
    return this.withDriver(id, async (driver, profile) => {
      await driver.renameEntry(
        oldRelativePath.replace(/\\/g, '/'),
        newRelativePath.replace(/\\/g, '/')
      );
      return profile;
    });
  }

  async deleteRemoteEntry(
    id: string,
    remoteRelativePath: string,
    isDirectory: boolean
  ): Promise<ConnectionProfile> {
    return this.withDriver(id, async (driver, profile) => {
      await driver.deleteEntry(remoteRelativePath.replace(/\\/g, '/'), isDirectory);
      return profile;
    });
  }

  async chmodRemoteEntry(
    id: string,
    remoteRelativePath: string,
    modeOctal: string
  ): Promise<ConnectionProfile> {
    return this.withDriver(id, async (driver, profile) => {
      await driver.chmodEntry(remoteRelativePath.replace(/\\/g, '/'), modeOctal);
      return profile;
    });
  }

  async uploadMultiplePaths(
    id: string,
    localPaths: string[],
    targetRemoteSubPath: string,
    onFileUploaded?: (remoteRelativePath: string) => void
  ): Promise<{ profile: ConnectionProfile; uploaded: number; errors: string[] }> {
    return this.withDriver(id, async (driver, profile) => {
      const cleanSub = targetRemoteSubPath.replace(/^[/\\]+|[/\\]+$/g, '').replace(/\\/g, '/');
      let uploaded = 0;
      const errors: string[] = [];

      const uploadRecursive = async (localTarget: string, remoteRelBase: string): Promise<void> => {
        try {
          const st = await stat(localTarget);
          if (st.isDirectory()) {
            let dirents;
            try {
              dirents = await readdir(localTarget, { withFileTypes: true });
            } catch (err) {
              errors.push(`${localTarget}: ${err instanceof Error ? err.message : String(err)}`);
              return;
            }
            if (dirents.length === 0) {
              try {
                await driver.createEntry(remoteRelBase, true);
              } catch {
                // Abaikan bila direktori sudah ada
              }
            }
            for (const d of dirents) {
              if (d.name === '.git' || d.name === 'node_modules') continue;
              const childLocal = join(localTarget, d.name);
              const childRemote = remoteRelBase ? `${remoteRelBase}/${d.name}` : d.name;
              await uploadRecursive(childLocal, childRemote);
            }
          } else {
            await driver.uploadFile(localTarget, remoteRelBase);
            uploaded += 1;
            onFileUploaded?.(remoteRelBase);
          }
        } catch (err) {
          errors.push(`${localTarget}: ${err instanceof Error ? err.message : String(err)}`);
        }
      };

      for (const rawLocal of localPaths) {
        if (!rawLocal?.trim()) continue;
        const resolvedLocal = resolve(rawLocal);
        const name = basename(resolvedLocal);
        const destRel = cleanSub ? posix.join(cleanSub, name) : name;
        await uploadRecursive(resolvedLocal, destRel);
      }
      return { profile, uploaded, errors };
    });
  }

  async searchRemoteFiles(
    id: string,
    remoteSubPath: string,
    query: string,
    caseSensitive = false,
    maxResults = 200
  ): Promise<RemoteSearchMatch[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const SKIP_DIRS = new Set([
      '.git',
      'node_modules',
      'vendor',
      'cache',
      'storage',
      'dist',
      'out',
      'release',
      '.next',
      '.nuxt'
    ]);

    const TEXT_EXTS = new Set([
      '.php',
      '.phtml',
      '.inc',
      '.html',
      '.htm',
      '.twig',
      '.blade.php',
      '.css',
      '.scss',
      '.less',
      '.js',
      '.mjs',
      '.cjs',
      '.jsx',
      '.ts',
      '.tsx',
      '.vue',
      '.json',
      '.xml',
      '.yml',
      '.yaml',
      '.sql',
      '.md',
      '.txt',
      '.ini',
      '.conf',
      '.env',
      '.sh',
      '.py',
      '.rb',
      '.htaccess'
    ]);

    const isLikelyTextFile = (name: string): boolean => {
      const lower = name.toLowerCase();
      if (
        lower === '.htaccess' ||
        lower === '.env' ||
        lower.startsWith('.env.') ||
        lower === 'dockerfile' ||
        lower === 'makefile' ||
        lower.endsWith('.blade.php')
      ) {
        return true;
      }
      const ext = extname(lower);
      return TEXT_EXTS.has(ext);
    };

    const needle = caseSensitive ? trimmed : trimmed.toLowerCase();
    const matches: RemoteSearchMatch[] = [];
    let scannedFiles = 0;
    const MAX_SCANNED_FILES = 180;
    const MAX_FILE_BYTES = 512 * 1024;

    return this.withDriver(id, async (driver) => {
      const walkRemote = async (subDir: string, depth: number): Promise<void> => {
        if (depth > 8 || matches.length >= maxResults || scannedFiles >= MAX_SCANNED_FILES) {
          return;
        }
        let entries: RemoteEntry[];
        try {
          entries = await driver.listDirectory(subDir);
        } catch {
          return;
        }

        for (const entry of entries) {
          if (matches.length >= maxResults || scannedFiles >= MAX_SCANNED_FILES) break;
          if (entry.isDirectory) {
            if (SKIP_DIRS.has(entry.name.toLowerCase())) continue;
            await walkRemote(entry.relativePath, depth + 1);
          } else {
            if (entry.size > MAX_FILE_BYTES || !isLikelyTextFile(entry.name)) continue;
            scannedFiles += 1;
            let content: string;
            try {
              content = await driver.readFileText(entry.relativePath);
            } catch {
              continue;
            }
            if (content.includes('\u0000')) continue;
            const lines = content.split(/\r?\n/);
            for (let i = 0; i < lines.length; i += 1) {
              const lineStr = lines[i];
              const hay = caseSensitive ? lineStr : lineStr.toLowerCase();
              const idx = hay.indexOf(needle);
              if (idx !== -1) {
                matches.push({
                  connectionId: id,
                  relativePath: entry.relativePath,
                  line: i + 1,
                  column: idx + 1,
                  lineText: lineStr.trim().slice(0, 240)
                });
                if (matches.length >= maxResults) break;
              }
            }
          }
        }
      };

      const startSub = remoteSubPath.replace(/^[/\\]+|[/\\]+$/g, '').replace(/\\/g, '/');
      await walkRemote(startSub, 0);
      return matches;
    });
  }

  async listRemoteFilesIndex(
    id: string,
    remoteSubPath = '',
    maxFiles = 50000
  ): Promise<RemoteFileIndexItem[]> {
    const SKIP_DIRS = new Set([
      '.git',
      '.svn',
      'node_modules',
      'vendor',
      'cache',
      'storage',
      'dist',
      'out',
      'release',
      '.next',
      '.nuxt'
    ]);

    const safeLimit = Math.max(50, Math.min(80000, maxFiles));
    const startSub = remoteSubPath.replace(/^[/\\]+|[/\\]+$/g, '').replace(/\\/g, '/');
    const profile = await this.getById(id);
    if (!profile) {
      throw new Error(`Profil koneksi "${id}" tidak ditemukan.`);
    }

    // 1. Ultra-Fast SSH `find` Path for real SFTP servers (< 500ms for 50,000 files + Incremental Delta Sync!)
    if (profile.protocol === 'sftp' && !this.driverFactory) {
      try {
        const existingCache = !startSub ? await this.readRemoteFilesCacheRaw(id) : null;
        const ageMinutes = existingCache
          ? Math.ceil(Math.max(1, (Date.now() - existingCache.updatedAt) / 60000)) + 2
          : 0;
        const canUseDelta = Boolean(
          existingCache && existingCache.files.length >= 200 && ageMinutes > 0 && ageMinutes <= 180
        );

        const secrets = await this.getSecrets(id);
        const ssh = await openSshClient(profile, secrets);
        const baseRemote = (profile.remotePath || '/').replace(/\\/g, '/').replace(/\/+$/, '') || '/';
        const targetDir = startSub ? posix.join(baseRemote, startSub) : baseRemote;
        const sqDir = `'${targetDir.replace(/'/g, "'\\''")}'`;

        const mminFlag = canUseDelta ? `-mmin -${ageMinutes} ` : '';
        const findCmd = [
          `cd ${sqDir} 2>/dev/null || exit 1`,
          `(find . -maxdepth 10 \\( -name .git -o -name .svn -o -name node_modules -o -name vendor -o -name cache -o -name storage -o -name dist -o -name out -o -name release -o -name .next -o -name .nuxt \\) -prune -o -type f ${mminFlag}-printf '%P\\t%s\\t%Ts\\n' 2>/dev/null || find . -maxdepth 10 \\( -name .git -o -name .svn -o -name node_modules -o -name vendor -o -name cache -o -name storage \\) -prune -o -type f ${mminFlag}-print 2>/dev/null) | head -n ${safeLimit}`
        ].join('\n');

        const rawFind = await new Promise<string>((resOut, rejOut) => {
          ssh.exec(findCmd, (err, stream) => {
            if (err) {
              rejOut(err);
              return;
            }
            let out = '';
            let exitCode = 0;
            stream.on('data', (chunk: Buffer | string) => {
              out += chunk.toString();
            });
            stream.stderr.on('data', () => {});
            stream.on('exit', (code: number) => {
              exitCode = code ?? 0;
            });
            stream.on('close', () => {
              if (exitCode !== 0 && !out.trim()) {
                rejOut(new Error(`SSH find exited with ${exitCode}`));
              } else {
                resOut(out);
              }
            });
          });
        }).finally(() => {
          ssh.end();
        });

        const sshItems: RemoteFileIndexItem[] = [];
        for (const rawLine of rawFind.split(/\r?\n/)) {
          if (!rawLine) continue;
          const parts = rawLine.split('\t');
          const cleanRelInSub = (parts[0] ?? '').replace(/^\.\//, '').trim();
          if (!cleanRelInSub) continue;
          const fullRel = startSub ? `${startSub}/${cleanRelInSub}` : cleanRelInSub;
          const name = cleanRelInSub.split('/').pop() || cleanRelInSub;
          const size = Number(parts[1]) || 0;
          const mtimeSec = Number(parts[2]) || 0;
          sshItems.push({
            name,
            relativePath: fullRel,
            size,
            mtimeMs: mtimeSec > 0 ? mtimeSec * 1000 : 0
          });
          if (sshItems.length >= safeLimit) break;
        }

        if (canUseDelta && existingCache) {
          const mergedMap = new Map<string, RemoteFileIndexItem>();
          for (const f of existingCache.files) {
            mergedMap.set(f.relativePath, f);
          }
          for (const deltaItem of sshItems) {
            mergedMap.set(deltaItem.relativePath, deltaItem);
          }
          const mergedList = Array.from(mergedMap.values()).slice(0, safeLimit);
          if (!startSub) {
            await this.saveRemoteFilesCache(id, mergedList);
          }
          return mergedList;
        }

        if (sshItems.length > 0) {
          if (!startSub) {
            await this.saveRemoteFilesCache(id, sshItems);
          }
          return sshItems;
        }
      } catch {
        // Fall through seamlessly to SFTP directory walker (e.g. SFTP-only chroot accounts)
      }
    }

    // 2. Concurrent Breadth-First SFTP/FTPS/FTP/Local Directory Walker Fallback
    const items: RemoteFileIndexItem[] = [];

    const walked = await this.withDriver(id, async (driver) => {
      let frontier: Array<{ subDir: string; depth: number }> = [{ subDir: startSub, depth: 0 }];

      while (frontier.length > 0 && items.length < safeLimit) {
        const batch = frontier.slice(0, 6);
        frontier = frontier.slice(6);

        const batchResults = await Promise.all(
          batch.map(async (current) => {
            if (current.depth > 9) return [] as Array<{ entry: RemoteEntry; nextDepth: number }>;
            try {
              const entries = await driver.listDirectory(current.subDir);
              return entries.map((entry) => ({ entry, nextDepth: current.depth + 1 }));
            } catch {
              return [] as Array<{ entry: RemoteEntry; nextDepth: number }>;
            }
          })
        );

        for (const group of batchResults) {
          for (const { entry, nextDepth } of group) {
            if (items.length >= safeLimit) break;
            if (entry.isDirectory) {
              if (SKIP_DIRS.has(entry.name.toLowerCase())) continue;
              frontier.push({ subDir: entry.relativePath, depth: nextDepth });
            } else {
              items.push({
                name: entry.name,
                relativePath: entry.relativePath,
                size: entry.size,
                mtimeMs: entry.mtimeMs
              });
            }
          }
        }
      }

      return items;
    });

    if (!startSub && walked.length > 0) {
      await this.saveRemoteFilesCache(id, walked);
    }
    return walked;
  }

  /**
   * Scans PHP functions/classes/array-keys, JavaScript functions/classes, CSS classes/variables,
   * HTML `#id`s, and SQL `JOIN` edges directly on a Remote Server (SFTP/FTPS/FTP) so IntelliSense
   * works across the entire remote project — not just local folders!
   */
  async scanRemoteWorkspaceSymbols(
    id: string,
    remoteSubPath = '',
    maxFiles = 220
  ): Promise<RemoteWorkspaceIntelPayload> {
    const profile = await this.getById(id);
    if (!profile) {
      throw new Error(`Profil koneksi "${id}" tidak ditemukan.`);
    }

    const startSub = remoteSubPath.replace(/^[/\\]+|[/\\]+$/g, '').replace(/\\/g, '/');
    const collectedFiles: Array<{ relPath: string; content: string }> = [];
    const extraJsPaths: string[] = [];
    const extraCssPaths: string[] = [];
    const safeMaxFiles = Math.max(20, Math.min(400, maxFiles));

    // 1. Fast SSH Single-Stream Batch Reader for real SFTP servers (~1s for 220 files + 0-diff short-circuit!)
    if (profile.protocol === 'sftp' && !this.driverFactory) {
      try {
        const cachedIntel = !startSub ? await this.readRemoteIntelCacheRaw(id) : null;
        const intelAgeMin = cachedIntel
          ? Math.ceil(Math.max(1, (Date.now() - cachedIntel.updatedAt) / 60000)) + 2
          : 0;

        const secrets = await this.getSecrets(id);
        const ssh = await openSshClient(profile, secrets);
        const baseRemote = (profile.remotePath || '/').replace(/\\/g, '/').replace(/\/+$/, '') || '/';
        const targetDir = startSub ? posix.join(baseRemote, startSub) : baseRemote;
        const sqDir = `'${targetDir.replace(/'/g, "'\\''")}'`;

        if (cachedIntel && intelAgeMin > 0 && intelAgeMin <= 360) {
          const checkCmd = `cd ${sqDir} 2>/dev/null && find . -maxdepth 7 \\( -name .git -o -name .svn -o -name node_modules -o -name vendor -o -name cache -o -name storage \\) -prune -o -type f \\( -name '*.php' -o -name '*.js' -o -name '*.css' -o -name '*.sql' \\) -mmin -${intelAgeMin} -print 2>/dev/null | head -n 1`;
          const changedCheck = await new Promise<string>((resOut) => {
            ssh.exec(checkCmd, (err, stream) => {
              if (err) {
                resOut('CHANGED');
                return;
              }
              let out = '';
              stream.on('data', (c: Buffer | string) => {
                out += c.toString();
              });
              stream.stderr.on('data', () => {});
              stream.on('close', () => resOut(out.trim()));
            });
          });
          if (!changedCheck) {
            ssh.end();
            return cachedIntel.intel;
          }
        }

        const batchScript = [
          `cd ${sqDir} 2>/dev/null || exit 1`,
          `find . -maxdepth 7 \\( -name .git -o -name .svn -o -name node_modules -o -name vendor -o -name cache -o -name storage -o -name logs -o -name tmp -o -name upload -o -name uploads \\) -prune -o -type f \\( -name '*.php' -o -name '*.phtml' -o -name '*.js' -o -name '*.mjs' -o -name '*.cjs' -o -name '*.jsx' -o -name '*.ts' -o -name '*.tsx' -o -name '*.css' -o -name '*.scss' -o -name '*.less' -o -name '*.html' -o -name '*.sql' \\) ! -name '*.min.js' ! -name '*.min.css' -size -220k -print 2>/dev/null | head -n ${safeMaxFiles} | while IFS= read -r f; do`,
          `  rel="\${f#./}"`,
          `  echo "===HMW_RFILE:\${rel}==="`,
          `  cat "$f" 2>/dev/null`,
          `  echo ""`,
          `done`
        ].join('\n');

        const rawStream = await new Promise<string>((resOut, rejOut) => {
          ssh.exec(batchScript, (err, stream) => {
            if (err) {
              rejOut(err);
              return;
            }
            let out = '';
            const MAX_STREAM_CHARS = 6 * 1024 * 1024;
            stream.on('data', (chunk: Buffer | string) => {
              if (out.length < MAX_STREAM_CHARS) {
                out += chunk.toString();
              }
            });
            stream.stderr.on('data', () => {});
            stream.on('close', () => resOut(out));
          });
        }).finally(() => {
          ssh.end();
        });

        const markerRegex = /^===HMW_RFILE:(.+?)===$/gm;
        const matches = Array.from(rawStream.matchAll(markerRegex));
        for (let i = 0; i < matches.length; i++) {
          const m = matches[i];
          const relInSub = (m[1] ?? '').trim();
          const bodyStart = (m.index ?? 0) + m[0].length + 1;
          const bodyEnd = i + 1 < matches.length ? (matches[i + 1].index ?? rawStream.length) : rawStream.length;
          const content = rawStream.slice(bodyStart, bodyEnd);
          const fullRel = startSub ? `${startSub}/${relInSub}` : relInSub;
          if (fullRel && content) {
            collectedFiles.push({ relPath: fullRel, content });
          }
        }
      } catch {
        // Fall through to driver-based reader
      }
    }

    // 2. Fallback Driver Reader (FTPS, FTP, SFTP-chroot, Local target, & Unit Test Mock Drivers)
    if (collectedFiles.length === 0) {
      const indexed = await this.listRemoteFilesIndex(id, remoteSubPath, 5000);
      const codeExts = new Set([
        '.php',
        '.phtml',
        '.js',
        '.mjs',
        '.cjs',
        '.jsx',
        '.ts',
        '.tsx',
        '.css',
        '.scss',
        '.less',
        '.html',
        '.sql'
      ]);

      const candidates: RemoteFileIndexItem[] = [];
      for (const item of indexed) {
        const low = item.name.toLowerCase();
        if (low.endsWith('.min.js')) {
          extraJsPaths.push(item.relativePath);
          continue;
        }
        if (low.endsWith('.min.css')) {
          extraCssPaths.push(item.relativePath);
          continue;
        }
        const ext = extname(low);
        if (!codeExts.has(ext)) continue;
        if (item.size > 220 * 1024) continue;
        candidates.push(item);
      }

      const toRead = candidates.slice(0, Math.min(safeMaxFiles, 110));
      await this.withDriver(id, async (driver) => {
        for (const item of toRead) {
          try {
            const content = await driver.readFileText(item.relativePath);
            collectedFiles.push({ relPath: item.relativePath, content });
          } catch {
            // Skip unreadable file
          }
        }
      });
    }

    // 3. Parse PHP Symbols, Web (JS/CSS/HTML) Symbols, & Learned SQL JOINs
    const phpFnMap = new Map<string, PhpFunctionMeta>();
    const phpClsMap = new Map<string, PhpClassMeta>();
    const phpArrayKeys = new Set<string>();
    const webCatalogs: WebSymbolCatalog[] = [];
    const sqlAndPhpSources: string[] = [];

    if (extraJsPaths.length > 0 || extraCssPaths.length > 0) {
      webCatalogs.push({
        jsFunctions: [],
        jsClasses: [],
        cssClasses: [],
        cssVariables: [],
        htmlIds: [],
        jsFiles: extraJsPaths,
        cssFiles: extraCssPaths
      });
    }

    for (const { relPath, content } of collectedFiles) {
      const remoteUri = `remote://${profile.id}/${relPath}`;
      const low = relPath.toLowerCase();

      if (low.endsWith('.php') || low.endsWith('.phtml')) {
        const phpPart = extractPhpSymbolsFromSource(content, remoteUri, relPath);
        for (const fn of phpPart.functions) {
          const k = fn.name.toLowerCase();
          if (!phpFnMap.has(k)) phpFnMap.set(k, fn);
        }
        for (const cls of phpPart.classes) {
          const k = cls.name.toLowerCase();
          if (!phpClsMap.has(k)) phpClsMap.set(k, cls);
        }
        for (const ak of phpPart.arrayKeys) {
          phpArrayKeys.add(ak);
        }
        if (/join/i.test(content)) {
          sqlAndPhpSources.push(content);
        }
      } else if (low.endsWith('.sql') && /join/i.test(content)) {
        sqlAndPhpSources.push(content);
      }

      webCatalogs.push(extractWebSymbolsFromSource(content, relPath, remoteUri));
    }

    const intelPayload: RemoteWorkspaceIntelPayload = {
      connectionId: profile.id,
      connectionName: profile.name,
      scannedFiles: collectedFiles.length,
      phpSymbols: {
        functions: Array.from(phpFnMap.values()),
        classes: Array.from(phpClsMap.values()),
        arrayKeys: Array.from(phpArrayKeys)
      },
      webCatalog: mergeWebSymbolCatalogs(webCatalogs),
      joinEdges: learnJoinEdgesFromSources(sqlAndPhpSources)
    };
    if (!startSub) {
      await this.saveRemoteIntelCache(id, intelPayload);
    }
    return intelPayload;
  }

  /**
   * Scans PHP/JS/SQL files on a Remote Server (SFTP/FTPS/FTP/Local) for SQLi, XSS, hardcoded secrets,
   * PHP 8 compatibility issues, and broken `include`/`require` paths.
   */
  async scanRemoteSecurityBatch(
    id: string,
    maxFiles = 250
  ): Promise<ProjectSecurityScanReport> {
    const profile = await this.getById(id);
    if (!profile) {
      throw new Error(`Profil koneksi "${id}" tidak ditemukan.`);
    }
    const safeMaxFiles = Math.max(20, Math.min(500, maxFiles));
    const indexed = await this.listRemoteFilesIndex(id, '', 25000);
    const knownRelPaths = indexed.map((f) => f.relativePath);
    const collectedFiles: Array<{ relPath: string; content: string }> = [];

    if (profile.protocol === 'sftp' && !this.driverFactory) {
      try {
        const secrets = await this.getSecrets(id);
        const ssh = await openSshClient(profile, secrets);
        const baseRemote = (profile.remotePath || '/').replace(/\\/g, '/').replace(/\/+$/, '') || '/';
        const sqDir = `'${baseRemote.replace(/'/g, "'\\''")}'`;

        const batchScript = [
          `cd ${sqDir} 2>/dev/null || exit 1`,
          `find . -maxdepth 7 \\( -name .git -o -name .svn -o -name node_modules -o -name vendor -o -name cache -o -name storage -o -name logs -o -name tmp -o -name upload -o -name uploads \\) -prune -o -type f \\( -name '*.php' -o -name '*.phtml' -o -name '*.inc' -o -name '*.js' -o -name '*.ts' -o -name '*.env' \\) ! -name '*.min.js' -size -220k -print 2>/dev/null | head -n ${safeMaxFiles} | while IFS= read -r f; do`,
          `  rel="\${f#./}"`,
          `  echo "===HMW_SFILE:\${rel}==="`,
          `  cat "$f" 2>/dev/null`,
          `  echo ""`,
          `done`
        ].join('\n');

        const rawStream = await new Promise<string>((resOut, rejOut) => {
          ssh.exec(batchScript, (err, stream) => {
            if (err) {
              rejOut(err);
              return;
            }
            let out = '';
            const MAX_STREAM_CHARS = 7 * 1024 * 1024;
            stream.on('data', (chunk: Buffer | string) => {
              if (out.length < MAX_STREAM_CHARS) {
                out += chunk.toString();
              }
            });
            stream.stderr.on('data', () => {});
            stream.on('close', () => resOut(out));
          });
        }).finally(() => {
          ssh.end();
        });

        const markerRegex = /^===HMW_SFILE:(.+?)===$/gm;
        const matches = Array.from(rawStream.matchAll(markerRegex));
        for (let i = 0; i < matches.length; i++) {
          const m = matches[i];
          const relPath = (m[1] ?? '').trim();
          const bodyStart = (m.index ?? 0) + m[0].length + 1;
          const bodyEnd =
            i + 1 < matches.length ? (matches[i + 1].index ?? rawStream.length) : rawStream.length;
          const content = rawStream.slice(bodyStart, bodyEnd);
          if (relPath && content) {
            collectedFiles.push({ relPath, content });
          }
        }
      } catch {
        // Fallback to driver reader below
      }
    }

    if (collectedFiles.length === 0) {
      const scanExts = new Set(['.php', '.phtml', '.inc', '.js', '.ts', '.env']);
      const candidates = indexed
        .filter((f) => {
          const low = f.name.toLowerCase();
          if (low.endsWith('.min.js')) return false;
          const ext = low === '.env' ? '.env' : extname(low);
          return scanExts.has(ext) && f.size <= 220 * 1024;
        })
        .slice(0, Math.min(safeMaxFiles, 120));

      await this.withDriver(id, async (driver) => {
        for (const item of candidates) {
          try {
            const content = await driver.readFileText(item.relativePath);
            collectedFiles.push({ relPath: item.relativePath, content });
          } catch {
            // Skip unreadable
          }
        }
      });
    }

    return scanSourceFilesForSecurityAndHealth({
      files: collectedFiles,
      knownRelPaths
    });
  }

  async replaceInRemoteFiles(
    id: string,
    remoteSubPath: string,
    query: string,
    replacement: string,
    options?: ReplaceInFilesOptions,
    onBeforeModify?: (relPath: string, originalContent: string, profile: ConnectionProfile) => Promise<void>
  ): Promise<ReplaceInFilesResult> {
    if (!query) {
      return { filesModified: 0, occurrencesReplaced: 0, modifiedRelPaths: [], errors: [] };
    }
    const caseSensitive = Boolean(options?.caseSensitive);
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, caseSensitive ? 'g' : 'gi');

    let targetRelPaths: string[];
    if (options?.includeRelPaths && options.includeRelPaths.length > 0) {
      targetRelPaths = Array.from(
        new Set(options.includeRelPaths.map((p) => p.replace(/^[/\\]+/, '').replace(/\\/g, '/')))
      );
    } else {
      const searchHits = await this.searchRemoteFiles(id, remoteSubPath, query, caseSensitive, 500);
      targetRelPaths = Array.from(new Set(searchHits.map((m) => m.relativePath)));
    }

    if (targetRelPaths.length === 0) {
      return { filesModified: 0, occurrencesReplaced: 0, modifiedRelPaths: [], errors: [] };
    }

    return this.withDriver(id, async (driver, profile) => {
      let filesModified = 0;
      let occurrencesReplaced = 0;
      const modifiedRelPaths: string[] = [];
      const errors: string[] = [];

      for (const relPath of targetRelPaths) {
        try {
          const original = await driver.readFileText(relPath);
          if (original.includes('\u0000')) continue;
          let countInFile = 0;
          const updated = original.replace(regex, () => {
            countInFile += 1;
            return replacement;
          });
          if (countInFile > 0 && updated !== original) {
            if (onBeforeModify) {
              await onBeforeModify(relPath, original, profile).catch(() => {});
            }
            await driver.writeFileText(relPath, updated);
            filesModified += 1;
            occurrencesReplaced += countInFile;
            modifiedRelPaths.push(relPath);
          }
        } catch (err) {
          errors.push(`${relPath}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      return { filesModified, occurrencesReplaced, modifiedRelPaths, errors };
    });
  }

  async uploadSingleFile(id: string, workspacePath: string, relativePath: string): Promise<void> {
    const localFilePath = resolve(workspacePath, relativePath);
    await this.withDriver(id, (driver) =>
      driver.uploadFile(localFilePath, relativePath.replace(/\\/g, '/'))
    );
  }

  async downloadSingleFile(id: string, workspacePath: string, relativePath: string): Promise<void> {
    const localFilePath = resolve(workspacePath, relativePath);
    await this.withDriver(id, (driver) =>
      driver.downloadFile(relativePath.replace(/\\/g, '/'), localFilePath)
    );
  }

  async downloadEntryToLocalDir(
    id: string,
    remoteRelativePath: string,
    isDirectory: boolean,
    targetLocalDir: string,
    deleteSourceAfter = false
  ): Promise<{ downloaded: number; localDestPath: string }> {
    const cleanRel = remoteRelativePath.replace(/^[/\\]+|[/\\]+$/g, '').replace(/\\/g, '/');
    if (!cleanRel) {
      throw new Error('Path item remote tidak valid.');
    }
    const entryName = posix.basename(cleanRel);
    const localDestPath = join(resolve(targetLocalDir), entryName);

    return this.withDriver(id, async (driver) => {
      let downloaded = 0;
      const downloadDirRecursive = async (remoteSub: string, localDir: string): Promise<void> => {
        await mkdir(localDir, { recursive: true });
        const entries = await driver.listDirectory(remoteSub);
        for (const item of entries) {
          const childLocal = join(localDir, item.name);
          if (item.isDirectory) {
            await downloadDirRecursive(item.relativePath, childLocal);
          } else {
            await driver.downloadFile(item.relativePath, childLocal);
            downloaded += 1;
          }
        }
      };

      if (isDirectory) {
        await downloadDirRecursive(cleanRel, localDestPath);
      } else {
        await mkdir(dirname(localDestPath), { recursive: true });
        await driver.downloadFile(cleanRel, localDestPath);
        downloaded = 1;
      }
      if (deleteSourceAfter) {
        await driver.deleteEntry(cleanRel, isDirectory);
      }
      return { downloaded, localDestPath };
    });
  }

  async copyOrMoveRemoteEntry(
    sourceId: string,
    sourceRelativePath: string,
    isDirectory: boolean,
    destId: string,
    targetRemoteSubPath: string,
    mode: 'copy' | 'cut'
  ): Promise<{ destRelativePath: string; transferred: number }> {
    const cleanSrc = sourceRelativePath.replace(/^[/\\]+|[/\\]+$/g, '').replace(/\\/g, '/');
    const cleanDestDir = targetRemoteSubPath.replace(/^[/\\]+|[/\\]+$/g, '').replace(/\\/g, '/');
    if (!cleanSrc) {
      throw new Error('Path sumber remote tidak valid.');
    }

    let destItemName = posix.basename(cleanSrc);
    let destRel = cleanDestDir ? `${cleanDestDir}/${destItemName}` : destItemName;

    if (
      isDirectory &&
      sourceId === destId &&
      ((mode === 'copy' && cleanDestDir === cleanSrc) ||
        (cleanDestDir + '/').startsWith(cleanSrc + '/') ||
        (destRel + '/').startsWith(cleanSrc + '/'))
    ) {
      throw new Error('Tidak dapat menyalin/memindahkan folder remote ke dalam dirinya sendiri.');
    }

    // Fast server-side move on the same SFTP/FTPS/Local server
    if (mode === 'cut' && sourceId === destId) {
      if (destRel === cleanSrc) {
        return { destRelativePath: cleanSrc, transferred: 0 };
      }
      await this.renameRemoteEntry(sourceId, cleanSrc, destRel);
      return { destRelativePath: destRel, transferred: 1 };
    }

    // Duplicate in same remote directory -> append _copy suffix
    if (mode === 'copy' && sourceId === destId && destRel === cleanSrc) {
      const siblings = await this.listRemoteDir(destId, cleanDestDir);
      const existingNames = new Set(siblings.map((s) => s.name.toLowerCase()));
      const ext = isDirectory ? '' : posix.extname(destItemName);
      const stem = ext ? destItemName.slice(0, -ext.length) : destItemName;
      let idx = 1;
      do {
        const suffix = idx === 1 ? '_copy' : `_copy${idx}`;
        destItemName = `${stem}${suffix}${ext}`;
        idx += 1;
      } while (existingNames.has(destItemName.toLowerCase()));
      destRel = cleanDestDir ? `${cleanDestDir}/${destItemName}` : destItemName;
    }

    const stageRoot = await mkdtemp(join(tmpdir(), 'hmw-rclip-'));
    try {
      const dl = await this.downloadEntryToLocalDir(sourceId, cleanSrc, isDirectory, stageRoot, false);
      let stagedPath = dl.localDestPath;
      if (basename(stagedPath) !== destItemName) {
        const renamedStage = join(stageRoot, destItemName);
        await rename(stagedPath, renamedStage);
        stagedPath = renamedStage;
      }
      const up = await this.uploadMultiplePaths(destId, [stagedPath], cleanDestDir);
      if (up.errors.length > 0) {
        throw new Error(up.errors[0]);
      }
      if (mode === 'cut') {
        await this.deleteRemoteEntry(sourceId, cleanSrc, isDirectory);
      }
      return { destRelativePath: destRel, transferred: up.uploaded };
    } finally {
      await rm(stageRoot, { recursive: true, force: true }).catch(() => {});
    }
  }

  async broadcastWriteFile(
    connectionIds: string[],
    remoteRelativePath: string,
    content: string
  ): Promise<MultiServerDeployResult> {
    const uniqueIds = Array.from(new Set(connectionIds.map((id) => id.trim()).filter(Boolean)));
    const cleanRel = remoteRelativePath.replace(/^[/\\]+/, '').replace(/\\/g, '/');
    if (!cleanRel) {
      throw new Error('Path relatif file remote untuk Multi-Deploy kosong.');
    }

    const succeeded: MultiServerDeployResult['succeeded'] = [];
    const failed: MultiServerDeployResult['failed'] = [];

    await Promise.all(
      uniqueIds.map(async (cid) => {
        const started = Date.now();
        let connName = cid;
        try {
          const prof = await this.getById(cid);
          connName = prof.name;
          await this.writeRemoteFile(cid, cleanRel, content);
          succeeded.push({
            connectionId: cid,
            connectionName: connName,
            durationMs: Math.max(1, Date.now() - started)
          });
        } catch (err) {
          failed.push({
            connectionId: cid,
            connectionName: connName,
            error: err instanceof Error ? err.message : String(err)
          });
        }
      })
    );

    return {
      totalTargets: uniqueIds.length,
      succeeded,
      failed
    };
  }

  async inspectServerHealth(id: string): Promise<ServerHealthSnapshot> {
    const profile = await this.getById(id);
    const started = Date.now();

    if (profile.protocol === 'local') {
      const totalMb = Math.round(totalmem() / (1024 * 1024));
      const availMb = Math.round(freemem() / (1024 * 1024));
      const usedMb = Math.max(0, totalMb - availMb);
      const upSec = Math.floor(uptime());
      const days = Math.floor(upSec / 86400);
      const hours = Math.floor((upSec % 86400) / 3600);
      const mins = Math.floor((upSec % 3600) / 60);
      const la = loadavg();

      return {
        connectionId: profile.id,
        connectionName: profile.name,
        hostname: hostname(),
        osInfo: `${platform()} ${release()}`,
        uptimeText: `${days}h ${hours}j ${mins}m`,
        loadAvg: la.map((v) => v.toFixed(2)).join(', '),
        cpuCores: cpus().length || 1,
        memTotalMb: totalMb,
        memUsedMb: usedMb,
        memAvailableMb: availMb,
        memUsedPercent: totalMb > 0 ? Math.round((usedMb / totalMb) * 100) : 0,
        disks: [],
        services: [],
        crontabText: '(Profil Folder Lokal — Crontab Linux tersedia pada koneksi SFTP/SSH)',
        collectedAt: new Date().toISOString(),
        latencyMs: Math.max(1, Date.now() - started)
      };
    }

    if (profile.protocol !== 'sftp') {
      throw new Error(
        `Monitor kesehatan OS server membutuhkan protokol SFTP/SSH (profil "${profile.name}" menggunakan ${profile.protocol.toUpperCase()}). Gunakan tab Database Processlist untuk memantau query MySQL/PostgreSQL.`
      );
    }

    const secrets = await this.getSecrets(id);
    const ssh = await openSshClient(profile, secrets);
    const probeScript = [
      'echo "===HOST==="',
      'hostname 2>/dev/null || uname -n 2>/dev/null || echo "unknown"',
      'echo "===OS==="',
      '(grep -E "^PRETTY_NAME=" /etc/os-release 2>/dev/null | head -n 1 | cut -d= -f2- | tr -d \'"\') || uname -sr 2>/dev/null || echo "Linux"',
      'echo "===UPTIME==="',
      'uptime 2>/dev/null || cat /proc/loadavg 2>/dev/null || echo ""',
      'echo "===CORES==="',
      'nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo 2>/dev/null || echo "1"',
      'echo "===MEM==="',
      'free -m 2>/dev/null || cat /proc/meminfo 2>/dev/null | head -n 5 || echo ""',
      'echo "===DISK==="',
      'df -P -h 2>/dev/null | head -n 25 || echo ""',
      'echo "===SERVICES==="',
      'for s in nginx apache2 httpd php-fpm php8.3-fpm php8.2-fpm php8.1-fpm php7.4-fpm mariadb mysql mysqld postgresql redis-server supervisor cron crond; do',
      '  if command -v systemctl >/dev/null 2>&1; then',
      '    st=$(systemctl is-active "$s" 2>/dev/null || true)',
      '    if [ "$st" = "active" ]; then echo "$s|active|systemctl";',
      '    elif [ "$st" = "failed" ]; then echo "$s|inactive|failed"; fi',
      '  elif pgrep -x "$s" >/dev/null 2>&1; then',
      '    echo "$s|active|process"',
      '  fi',
      'done',
      'echo "===CRON==="',
      'crontab -l 2>/dev/null || echo "(Tidak ada crontab aktif untuk user ini)"',
      'echo "===END==="'
    ].join('\n');

    try {
      const rawOutput = await new Promise<string>((resOut, rejOut) => {
        ssh.exec(probeScript, (err, stream) => {
          if (err) {
            rejOut(err);
            return;
          }
          let out = '';
          stream.on('data', (chunk: Buffer | string) => {
            out += chunk.toString();
          });
          stream.stderr.on('data', () => {
            // Ignore non-fatal stderr warnings from missing tools
          });
          stream.on('close', () => {
            resOut(out);
          });
        });
      });

      const latencyMs = Math.max(1, Date.now() - started);
      return parsePosixServerHealthOutput(rawOutput, {
        connectionId: profile.id,
        connectionName: profile.name,
        latencyMs
      });
    } finally {
      ssh.end();
    }
  }

  // Phase 30 #8: Multi-Server SSH Snippets & Live Service Controller
  private get sshSnippetsFile(): string {
    return join(this.storageDir, 'ssh-snippets.json');
  }

  async listSshSnippets(): Promise<SshSnippetItem[]> {
    let custom: SshSnippetItem[] = [];
    if (existsSync(this.sshSnippetsFile)) {
      try {
        custom = JSON.parse(await readFile(this.sshSnippetsFile, 'utf-8')) as SshSnippetItem[];
      } catch {
        custom = [];
      }
    }
    return [...BUILTIN_SSH_SNIPPETS, ...custom];
  }

  async saveSshSnippet(
    payload: Omit<SshSnippetItem, 'id' | 'builtIn'> & { id?: string }
  ): Promise<SshSnippetItem[]> {
    let custom: SshSnippetItem[] = [];
    if (existsSync(this.sshSnippetsFile)) {
      try {
        custom = JSON.parse(await readFile(this.sshSnippetsFile, 'utf-8')) as SshSnippetItem[];
      } catch {
        custom = [];
      }
    }
    const id = payload.id?.trim() || `snip-custom-${Date.now()}`;
    const item: SshSnippetItem = {
      id,
      name: payload.name.trim() || 'Snippet SSH Baru',
      category: payload.category || 'Custom',
      command: payload.command.trim(),
      description: payload.description.trim(),
      dangerous: Boolean(payload.dangerous),
      builtIn: false
    };
    const idx = custom.findIndex((s) => s.id === id);
    if (idx >= 0) custom[idx] = item;
    else custom.unshift(item);
    await mkdir(this.storageDir, { recursive: true });
    await writeFile(this.sshSnippetsFile, JSON.stringify(custom, null, 2), 'utf-8');
    return [...BUILTIN_SSH_SNIPPETS, ...custom];
  }

  async deleteSshSnippet(id: string): Promise<SshSnippetItem[]> {
    if (existsSync(this.sshSnippetsFile)) {
      try {
        const custom = (
          JSON.parse(await readFile(this.sshSnippetsFile, 'utf-8')) as SshSnippetItem[]
        ).filter((s) => s.id !== id);
        await writeFile(this.sshSnippetsFile, JSON.stringify(custom, null, 2), 'utf-8');
      } catch {
        // ignore
      }
    }
    return this.listSshSnippets();
  }

  async runSshSnippetMulti(
    connectionIds: string[],
    command: string
  ): Promise<MultiSshExecItemResult[]> {
    const cleanCmd = command.trim();
    if (!cleanCmd) throw new Error('Perintah SSH tidak boleh kosong.');
    const uniqueIds = Array.from(new Set(connectionIds.filter(Boolean)));
    if (uniqueIds.length === 0) throw new Error('Pilih minimal 1 server SFTP/SSH target.');

    return Promise.all(
      uniqueIds.map(async (connId): Promise<MultiSshExecItemResult> => {
        const started = Date.now();
        let profile: ConnectionProfile | null = null;
        try {
          profile = await this.getById(connId);
          if (profile.protocol !== 'sftp') {
            return {
              connectionId: profile.id,
              connectionName: profile.name,
              isProduction: Boolean(profile.isProduction),
              ok: false,
              exitCode: 1,
              stdout: '',
              stderr: 'Eksekusi SSH Snippet hanya mendukung koneksi protokol SFTP (SSH).',
              durationMs: Date.now() - started
            };
          }
          const secrets = await this.getSecrets(profile.id);
          const ssh = await openSshClient(profile, secrets);
          try {
            const wrapped = profile.remotePath?.trim()
              ? `cd '${profile.remotePath.replace(/'/g, "'\\''")}' 2>/dev/null || true; ${cleanCmd}`
              : cleanCmd;
            const execRes = await new Promise<{ stdout: string; stderr: string; code: number }>(
              (resOut, rejOut) => {
                ssh.exec(wrapped, (err, stream) => {
                  if (err) {
                    rejOut(err);
                    return;
                  }
                  let stdout = '';
                  let stderr = '';
                  const MAX_OUT = 256 * 1024;
                  stream.on('data', (chunk: Buffer | string) => {
                    if (stdout.length < MAX_OUT) stdout += chunk.toString();
                  });
                  stream.stderr.on('data', (chunk: Buffer | string) => {
                    if (stderr.length < MAX_OUT) stderr += chunk.toString();
                  });
                  stream.on('close', (code?: number) => {
                    resOut({ stdout, stderr, code: typeof code === 'number' ? code : 0 });
                  });
                });
              }
            );
            return {
              connectionId: profile.id,
              connectionName: profile.name,
              isProduction: Boolean(profile.isProduction),
              ok: execRes.code === 0,
              exitCode: execRes.code,
              stdout: execRes.stdout,
              stderr: execRes.stderr,
              durationMs: Date.now() - started
            };
          } finally {
            ssh.end();
          }
        } catch (err) {
          return {
            connectionId: connId,
            connectionName: profile?.name ?? connId,
            isProduction: Boolean(profile?.isProduction),
            ok: false,
            exitCode: 1,
            stdout: '',
            stderr: err instanceof Error ? err.message : String(err),
            durationMs: Date.now() - started
          };
        }
      })
    );
  }

  // Phase 30 #9: Export SFTP/FTP connections for encrypted team workspace bundle (.hmwpack)
  async exportConnectionsForBundle(includeSecrets: boolean): Promise<
    Array<{
      profile: Omit<ConnectionProfile, 'id' | 'createdAt' | 'updatedAt'>;
      secret?: { password?: string; passphrase?: string; privateKeyPath?: string };
    }>
  > {
    const list = await this.list();
    const out: Array<{
      profile: Omit<ConnectionProfile, 'id' | 'createdAt' | 'updatedAt'>;
      secret?: { password?: string; passphrase?: string; privateKeyPath?: string };
    }> = [];
    for (const item of list) {
      const { id, createdAt: _c, updatedAt: _u, ...rest } = item;
      let secret: { password?: string; passphrase?: string; privateKeyPath?: string } | undefined;
      if (includeSecrets) {
        const dec = await this.getSecrets(id);
        if (dec.password || dec.passphrase) {
          secret = {
            password: dec.password,
            passphrase: dec.passphrase,
            privateKeyPath: item.privateKeyPath
          };
        }
      }
      out.push({ profile: rest, secret });
    }
    return out;
  }
}

export function parsePosixServerHealthOutput(
  raw: string,
  meta: { connectionId: string; connectionName: string; latencyMs: number }
): ServerHealthSnapshot {
  const extractSection = (name: string, nextName: string): string => {
    const startTag = `===${name}===`;
    const endTag = `===${nextName}===`;
    const sIdx = raw.indexOf(startTag);
    if (sIdx < 0) return '';
    const bodyStart = sIdx + startTag.length;
    const eIdx = raw.indexOf(endTag, bodyStart);
    return (eIdx >= 0 ? raw.slice(bodyStart, eIdx) : raw.slice(bodyStart)).trim();
  };

  const hostSec = extractSection('HOST', 'OS').split(/\r?\n/)[0]?.trim() || 'unknown';
  const osSec = extractSection('OS', 'UPTIME').split(/\r?\n/)[0]?.trim() || 'Linux';
  const uptimeRaw = extractSection('UPTIME', 'CORES').split(/\r?\n/)[0]?.trim() || '';
  const coresSec = Number.parseInt(extractSection('CORES', 'MEM').trim(), 10);
  const cpuCores = Number.isFinite(coresSec) && coresSec > 0 ? coresSec : 1;

  let loadAvg = '-';
  const loadMatch = uptimeRaw.match(/load averages?:\s*(.+)$/i);
  if (loadMatch) {
    loadAvg = loadMatch[1].trim();
  }
  let uptimeText = uptimeRaw;
  const upPartMatch = uptimeRaw.match(/\bup\s+(.+?),\s*\d+\s+users?/i);
  if (upPartMatch) {
    uptimeText = upPartMatch[1].trim();
  }

  let memTotalMb = 0;
  let memUsedMb = 0;
  let memAvailableMb = 0;
  const memSec = extractSection('MEM', 'DISK');
  const memLine = memSec
    .split(/\r?\n/)
    .find((line) => /^Mem:/i.test(line.trim()));
  if (memLine) {
    const nums = memLine
      .trim()
      .split(/\s+/)
      .slice(1)
      .map((n) => Number.parseInt(n, 10));
    memTotalMb = Number.isFinite(nums[0]) ? nums[0] : 0;
    memUsedMb = Number.isFinite(nums[1]) ? nums[1] : 0;
    // free -m columns: total used free shared buff/cache available
    memAvailableMb = Number.isFinite(nums[5])
      ? nums[5]
      : Number.isFinite(nums[2])
        ? nums[2]
        : Math.max(0, memTotalMb - memUsedMb);
    if (nums[5] !== undefined && Number.isFinite(nums[5]) && memTotalMb > 0) {
      memUsedMb = Math.max(0, memTotalMb - memAvailableMb);
    }
  }
  const memUsedPercent =
    memTotalMb > 0 ? Math.min(100, Math.round((memUsedMb / memTotalMb) * 100)) : 0;

  const disks: ServerDiskMount[] = [];
  const diskLines = extractSection('DISK', 'SERVICES')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = 1; i < diskLines.length; i++) {
    const parts = diskLines[i].split(/\s+/);
    if (parts.length < 6) continue;
    const filesystem = parts[0];
    if (/^(tmpfs|devtmpfs|udev|overlay|squashfs|none)$/i.test(filesystem)) continue;
    const size = parts[1];
    const used = parts[2];
    const avail = parts[3];
    const pctNum = Number.parseInt(parts[4].replace('%', ''), 10);
    const mountPoint = parts.slice(5).join(' ');
    if (mountPoint.startsWith('/snap/')) continue;
    disks.push({
      filesystem,
      size,
      used,
      avail,
      usePercent: Number.isFinite(pctNum) ? pctNum : 0,
      mountPoint
    });
  }

  const services: ServerServiceStatus[] = [];
  const svcLines = extractSection('SERVICES', 'CRON')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of svcLines) {
    const [name, status, detail] = line.split('|');
    if (!name) continue;
    services.push({
      name,
      active: status === 'active',
      detail: detail || undefined
    });
  }

  const crontabText = extractSection('CRON', 'END') || '(Kosong)';

  return {
    connectionId: meta.connectionId,
    connectionName: meta.connectionName,
    hostname: hostSec,
    osInfo: osSec,
    uptimeText: uptimeText || '-',
    loadAvg,
    cpuCores,
    memTotalMb,
    memUsedMb,
    memAvailableMb,
    memUsedPercent,
    disks,
    services,
    crontabText,
    collectedAt: new Date().toISOString(),
    latencyMs: meta.latencyMs
  };
}
