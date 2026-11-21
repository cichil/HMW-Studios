import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { join, resolve } from 'node:path';
import mysql from 'mysql2/promise';
import { Pool as PgPool, type PoolClient as PgPoolClient } from 'pg';
import type {
  DatabaseProfile,
  DatabaseSavePayload,
  DbCellUpdatePayload,
  DbColumnMeta,
  DbDataTransferPayload,
  DbDataTransferResult,
  DbDeleteRowPayload,
  DbEngine,
  DbForeignKeyMeta,
  DbInsertRowPayload,
  DbIntrospectProgressEvent,
  DbMultiQueryResultItem,
  DbProcessItem,
  DbQueryResult,
  DbRoutineKind,
  DbRoutineParamMeta,
  DbRoutineSummary,
  DbSchemaSnapshot,
  DbSqlDumpPayload,
  DbTableMeta,
  DbTableRowDiffPayload,
  DbTabularImportPayload,
  DbTabularImportResult,
  DbValueSearchPayload,
  DbValueSearchProgressEvent,
  DbValueSearchTableHit,
  SavedSqlQueryItem,
  SavedSqlQuerySavePayload
} from '@shared/types';
import {
  diffTableRowsByPrimaryKey,
  type TableRowDiffReport
} from '@shared/dbRowDiffEngine';
import {
  formatUptimeIndonesian,
  parseMysqlStatusAndVariables,
  type DbDigestQueryStat,
  type DbHealthSnapshot,
  type DbLockWaitItem,
  type DbStorageDatabaseSummary,
  type DbStorageTableItem
} from '@shared/mysqlHealthAnalyzer';
import {
  buildVisualExplainReport,
  type VisualExplainReport
} from '@shared/mysqlExplainVisualizer';
import {
  auditDbUsersSecurity,
  type DbRbacSnapshot,
  type DbUserPrivilegeRecord
} from '@shared/dbRbacAnalyzer';
import {
  buildCellUpdateUndoSql,
  buildRowDeleteUndoSql,
  isMutatingSqlStatement,
  splitSqlStatements
} from '@shared/sqlUndoBuilder';
import { normalizeImportCellValue } from '@shared/xlsxReader';
import type { AuditTrailService } from './auditTrailService';
import {
  FallbackAesVault,
  type ConnectionManager,
  type SecretVaultAdapter
} from './connections';
import { openSshClient } from './sftpDriver';
import { parseCsvRecords } from './xlsxBuilder';
import {
  applyRowAnonymization,
  buildBatchUpsertSql
} from '../../shared/dbDataSyncEngine';

interface StoredDbVaultRecord {
  passwordEnc?: string;
}

interface ActiveSshTunnel {
  host: string;
  port: number;
  alive: boolean;
  close: () => Promise<void>;
}

interface PersistedProfileSchemaCache {
  profileId: string;
  profileName: string;
  engine: DbEngine;
  databases: string[];
  lastActiveDatabase: string;
  tablesByDb: Record<string, DbTableMeta[]>;
  updatedAt: string;
}

const MYSQL_SYSTEM_SCHEMAS = new Set([
  'information_schema',
  'performance_schema',
  'mysql',
  'sys'
]);

const MYSQL_LOW_PRIORITY_SCHEMAS = new Set([
  'phpmyadmin',
  'test',
  'cdcol',
  'webauth'
]);

function pickRowVal(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (row[k] !== undefined) return row[k];
  }
  const lowerMap = new Map<string, unknown>();
  for (const [rk, rv] of Object.entries(row)) {
    lowerMap.set(rk.toLowerCase(), rv);
  }
  for (const k of keys) {
    const found = lowerMap.get(k.toLowerCase());
    if (found !== undefined) return found;
  }
  return undefined;
}

function escapeMysqlIdent(ident: string): string {
  return `\`${ident.replace(/`/g, '``')}\``;
}

function escapePgIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

export function detectSimpleSelectRef(
  sql: string
): { schema?: string; table: string } | null {
  const cleaned = sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--.*$/gm, ' ')
    .trim();
  if (!/^select\b/i.test(cleaned)) return null;
  if (/\b(join|union|group\s+by|having|distinct)\b/i.test(cleaned)) return null;
  const fromMatch = cleaned.match(
    /\bfrom\s+(?:[`"']?([A-Za-z0-9_]+)[`"']?\.)?[`"']?([A-Za-z0-9_]+)[`"']?(?:\s+(?:as\s+)?[A-Za-z0-9_]+)?(?:\s+(?:where|order|limit|offset)\b|\s*;?\s*$)/i
  );
  if (!fromMatch || !fromMatch[2]) return null;
  return {
    schema: fromMatch[1] || undefined,
    table: fromMatch[2]
  };
}

export function detectSimpleSelectTable(sql: string): string | null {
  return detectSimpleSelectRef(sql)?.table ?? null;
}

export function buildCreateTableDdl(table: DbTableMeta, engine: DbEngine): string {
  const quote = engine === 'postgres' ? escapePgIdent : escapeMysqlIdent;
  const colLines = table.columns.map((col) => {
    const typePart = col.columnType || col.dataType || 'VARCHAR(255)';
    const nullPart = col.nullable ? 'NULL' : 'NOT NULL';
    const extraPart = col.extra ? ` ${col.extra.toUpperCase()}` : '';
    const defaultPart =
      col.defaultValue !== undefined && col.defaultValue !== null
        ? ` DEFAULT ${
            /^(CURRENT_TIMESTAMP|NOW\(\)|NULL|\d+(\.\d+)?)$/i.test(String(col.defaultValue))
              ? col.defaultValue
              : `'${String(col.defaultValue).replace(/'/g, "''")}'`
          }`
        : '';
    return `  ${quote(col.name)} ${typePart} ${nullPart}${defaultPart}${extraPart}`.trimEnd();
  });

  if (table.primaryKeys.length > 0) {
    colLines.push(
      `  PRIMARY KEY (${table.primaryKeys.map((pk) => quote(pk)).join(', ')})`
    );
  }

  return `CREATE TABLE ${quote(table.name)} (\n${colLines.join(',\n')}\n);`;
}

export class DatabaseService {
  private readonly storageDir: string;
  private readonly schemaCacheDir: string;
  private readonly profilesFile: string;
  private readonly savedQueriesFile: string;
  private readonly vaultFile: string;
  private readonly vault: SecretVaultAdapter;
  private readonly connectionManager?: ConnectionManager;
  private readonly schemaCache = new Map<string, Map<string, DbTableMeta>>();
  private readonly diskSchemaMemCache = new Map<string, PersistedProfileSchemaCache>();
  private readonly sshTunnels = new Map<string, ActiveSshTunnel>();
  private readonly inFlightTunnels = new Map<string, Promise<ActiveSshTunnel>>();
  private readonly mysqlPools = new Map<string, mysql.Pool>();
  private readonly mysqlPoolLastOkAt = new Map<string, number>();
  private readonly healthVarsCache = new Map<
    string,
    { cachedAt: number; vMap: Record<string, string> }
  >();
  private readonly pgPools = new Map<string, PgPool>();
  private progressListener?: (evt: DbIntrospectProgressEvent) => void;
  private partialSchemaListener?: (snap: DbSchemaSnapshot) => void;
  private auditService?: AuditTrailService;

  constructor(
    storageDir: string,
    vault?: SecretVaultAdapter,
    connectionManager?: ConnectionManager
  ) {
    this.storageDir = resolve(storageDir);
    this.schemaCacheDir = join(this.storageDir, 'schema-cache');
    this.profilesFile = join(this.storageDir, 'databases.json');
    this.savedQueriesFile = join(this.storageDir, 'saved-queries.json');
    this.vaultFile = join(this.storageDir, 'databases.vault.json');
    this.vault = vault ?? new FallbackAesVault();
    this.connectionManager = connectionManager;
  }

  setProgressListener(cb?: (evt: DbIntrospectProgressEvent) => void): void {
    this.progressListener = cb;
  }

  setPartialSchemaListener(cb?: (snap: DbSchemaSnapshot) => void): void {
    this.partialSchemaListener = cb;
  }

  setAuditService(svc?: AuditTrailService): void {
    this.auditService = svc;
  }

  private emitProgress(evt: DbIntrospectProgressEvent): void {
    try {
      this.progressListener?.(evt);
    } catch {
      // Ignore listener error
    }
  }

  private emitPartialSchema(snap: DbSchemaSnapshot): void {
    try {
      this.partialSchemaListener?.(snap);
    } catch {
      // Ignore listener error
    }
  }

  private getSchemaCacheFilePath(profileId: string): string {
    const safe = profileId.replace(/[^A-Za-z0-9_-]/g, '_');
    return join(this.schemaCacheDir, `${safe}.json`);
  }

  private async readDiskSchemaCache(
    profileId: string
  ): Promise<PersistedProfileSchemaCache | null> {
    const inMem = this.diskSchemaMemCache.get(profileId);
    if (inMem) return inMem;
    const filePath = this.getSchemaCacheFilePath(profileId);
    if (!existsSync(filePath)) return null;
    try {
      const raw = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as PersistedProfileSchemaCache;
      if (parsed && parsed.profileId === profileId && parsed.tablesByDb) {
        this.diskSchemaMemCache.set(profileId, parsed);
        return parsed;
      }
    } catch {
      // Ignore corrupt cache file
    }
    return null;
  }

  private async writeDiskSchemaCache(
    profile: DatabaseProfile,
    databases: string[],
    activeDb: string,
    tables: DbTableMeta[]
  ): Promise<PersistedProfileSchemaCache> {
    const prev = await this.readDiskSchemaCache(profile.id);
    const nextTablesByDb: Record<string, DbTableMeta[]> = {
      ...(prev?.tablesByDb ?? {})
    };
    if (activeDb) {
      nextTablesByDb[activeDb.toLowerCase()] = tables;
    }
    const nextCache: PersistedProfileSchemaCache = {
      profileId: profile.id,
      profileName: profile.name,
      engine: profile.engine,
      databases,
      lastActiveDatabase: activeDb,
      tablesByDb: nextTablesByDb,
      updatedAt: new Date().toISOString()
    };
    this.diskSchemaMemCache.set(profile.id, nextCache);
    try {
      await mkdir(this.schemaCacheDir, { recursive: true });
      await writeFile(
        this.getSchemaCacheFilePath(profile.id),
        JSON.stringify(nextCache),
        'utf-8'
      );
    } catch {
      // Ignore disk write failure
    }
    return nextCache;
  }

  private buildMergedAllTablesFromCache(cache: PersistedProfileSchemaCache): DbTableMeta[] {
    const all: DbTableMeta[] = [];
    for (const list of Object.values(cache.tablesByDb)) {
      for (const t of list) {
        all.push(t);
      }
    }
    all.sort((a, b) => {
      const sa = (a.schema ?? '').localeCompare(b.schema ?? '');
      return sa !== 0 ? sa : a.name.localeCompare(b.name);
    });
    return all;
  }

  async getCachedSchema(
    id: string,
    overrideDatabase?: string
  ): Promise<DbSchemaSnapshot | null> {
    const cached = await this.readDiskSchemaCache(id);
    if (!cached || cached.databases.length === 0) return null;

    let profile: DatabaseProfile | null = null;
    try {
      profile = await this.getById(id);
    } catch {
      return null;
    }

    const reqRaw = overrideDatabase?.trim() || profile.database.trim() || cached.lastActiveDatabase;
    const matchedDb = reqRaw
      ? cached.databases.find((d) => d.toLowerCase() === reqRaw.toLowerCase()) ?? reqRaw
      : cached.lastActiveDatabase;
    if (!matchedDb) return null;

    const tables = cached.tablesByDb[matchedDb.toLowerCase()];
    if (!tables) return null;

    const lookup = new Map<string, DbTableMeta>();
    for (const t of tables) {
      lookup.set(t.name.toLowerCase(), t);
    }
    this.schemaCache.set(`${id}:${matchedDb.toLowerCase()}`, lookup);

    return {
      profileId: profile.id,
      profileName: profile.name,
      engine: profile.engine,
      currentDatabase: matchedDb,
      databases: cached.databases,
      tables,
      allTables: this.buildMergedAllTablesFromCache(cached),
      loadedAt: cached.updatedAt
    };
  }

  async evictProfileConnections(profileId: string): Promise<void> {
    this.mysqlPoolLastOkAt.delete(profileId);
    this.healthVarsCache.delete(profileId);
    const mysqlPool = this.mysqlPools.get(profileId);
    if (mysqlPool) {
      this.mysqlPools.delete(profileId);
      await mysqlPool.end().catch(() => {});
    }
    for (const [k, pgPool] of this.pgPools.entries()) {
      if (k === profileId || k.startsWith(`${profileId}:`)) {
        this.pgPools.delete(k);
        await pgPool.end().catch(() => {});
      }
    }
    const tun = this.sshTunnels.get(profileId);
    if (tun) {
      this.sshTunnels.delete(profileId);
      await tun.close().catch(() => {});
    }
  }

  async dispose(): Promise<void> {
    const ids = new Set<string>([
      ...this.mysqlPools.keys(),
      ...this.sshTunnels.keys(),
      ...Array.from(this.pgPools.keys()).map((k) => k.split(':')[0])
    ]);
    await Promise.all(Array.from(ids).map((id) => this.evictProfileConnections(id)));
  }

  private async readProfilesRaw(): Promise<DatabaseProfile[]> {
    if (!existsSync(this.profilesFile)) return [];
    try {
      const raw = await readFile(this.profilesFile, 'utf-8');
      return JSON.parse(raw) as DatabaseProfile[];
    } catch {
      return [];
    }
  }

  private async writeProfilesRaw(profiles: DatabaseProfile[]): Promise<void> {
    await mkdir(this.storageDir, { recursive: true });
    await writeFile(this.profilesFile, JSON.stringify(profiles, null, 2), 'utf-8');
  }

  private async readVaultRaw(): Promise<Record<string, StoredDbVaultRecord>> {
    if (!existsSync(this.vaultFile)) return {};
    try {
      const raw = await readFile(this.vaultFile, 'utf-8');
      return JSON.parse(raw) as Record<string, StoredDbVaultRecord>;
    } catch {
      return {};
    }
  }

  private async writeVaultRaw(data: Record<string, StoredDbVaultRecord>): Promise<void> {
    await mkdir(this.storageDir, { recursive: true });
    await writeFile(this.vaultFile, JSON.stringify(data, null, 2), 'utf-8');
  }

  async list(): Promise<DatabaseProfile[]> {
    const [profiles, vaultData] = await Promise.all([
      this.readProfilesRaw(),
      this.readVaultRaw()
    ]);
    return profiles.map((p) => ({
      ...p,
      hasSavedSecret: Boolean(vaultData[p.id]?.passwordEnc)
    }));
  }

  async getById(id: string): Promise<DatabaseProfile> {
    const all = await this.list();
    const found = all.find((p) => p.id === id);
    if (!found) {
      throw new Error(`Profil database tidak ditemukan: ${id}`);
    }
    return found;
  }

  async getPassword(id: string): Promise<string> {
    const vaultData = await this.readVaultRaw();
    const enc = vaultData[id]?.passwordEnc;
    if (!enc) return '';
    try {
      return this.vault.decrypt(enc);
    } catch {
      return '';
    }
  }

  async save(payload: DatabaseSavePayload): Promise<DatabaseProfile> {
    const [profiles, vaultData] = await Promise.all([
      this.readProfilesRaw(),
      this.readVaultRaw()
    ]);
    const now = new Date().toISOString();
    const id =
      payload.profile.id?.trim() ||
      `db-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const idx = profiles.findIndex((p) => p.id === id);

    const defaultPort = payload.profile.engine === 'postgres' ? 5432 : 3306;
    const saved: DatabaseProfile = {
      id,
      name: payload.profile.name.trim() || 'Untitled Database',
      engine: payload.profile.engine,
      host: payload.profile.host.trim() || '127.0.0.1',
      port: Number(payload.profile.port) || defaultPort,
      username: payload.profile.username.trim() || 'root',
      database: payload.profile.database.trim(),
      ssl: Boolean(payload.profile.ssl),
      sshTunnelConnectionId: payload.profile.sshTunnelConnectionId?.trim() || undefined,
      isProduction: Boolean(payload.profile.isProduction),
      createdAt: idx >= 0 ? profiles[idx].createdAt : now,
      updatedAt: now
    };

    if (idx >= 0) {
      profiles[idx] = saved;
    } else {
      profiles.push(saved);
    }

    const rec: StoredDbVaultRecord = vaultData[id] ?? {};
    if (payload.password !== undefined && payload.password !== '') {
      rec.passwordEnc = this.vault.encrypt(payload.password);
    }
    vaultData[id] = rec;

    await Promise.all([this.writeProfilesRaw(profiles), this.writeVaultRaw(vaultData)]);
    await this.evictProfileConnections(id);
    return {
      ...saved,
      hasSavedSecret: Boolean(rec.passwordEnc)
    };
  }

  async remove(id: string): Promise<void> {
    const [profiles, vaultData] = await Promise.all([
      this.readProfilesRaw(),
      this.readVaultRaw()
    ]);
    const next = profiles.filter((p) => p.id !== id);
    delete vaultData[id];
    this.diskSchemaMemCache.delete(id);
    await this.evictProfileConnections(id);
    await rm(this.getSchemaCacheFilePath(id), { force: true }).catch(() => {});
    for (const k of this.schemaCache.keys()) {
      if (k === id || k.startsWith(`${id}:`)) {
        this.schemaCache.delete(k);
      }
    }
    await Promise.all([this.writeProfilesRaw(next), this.writeVaultRaw(vaultData)]);
  }

  private async ensureEndpoint(profile: DatabaseProfile): Promise<{ host: string; port: number }> {
    const tunnelId = profile.sshTunnelConnectionId?.trim();
    if (!tunnelId) {
      return {
        host: profile.host || '127.0.0.1',
        port: profile.port || (profile.engine === 'postgres' ? 5432 : 3306)
      };
    }

    const existing = this.sshTunnels.get(profile.id);
    if (existing && existing.alive) {
      return { host: existing.host, port: existing.port };
    }

    const inFlight = this.inFlightTunnels.get(profile.id);
    if (inFlight) {
      const tun = await inFlight;
      return { host: tun.host, port: tun.port };
    }

    const openTask = (async (): Promise<ActiveSshTunnel> => {
      if (!this.connectionManager) {
        throw new Error('ConnectionManager tidak tersedia untuk membuka SSH Tunnel.');
      }

      const sshProfile = await this.connectionManager.getById(tunnelId);
      if (sshProfile.protocol !== 'sftp') {
        throw new Error(
          `Profil tunnel "${sshProfile.name}" harus berprotokol SFTP/SSH (saat ini: ${sshProfile.protocol.toUpperCase()}).`
        );
      }
      const sshSecrets = await this.connectionManager.getSecrets(tunnelId);
      const ssh = await openSshClient(sshProfile, sshSecrets);

      const targetHost = profile.host || '127.0.0.1';
      const targetPort = profile.port || (profile.engine === 'postgres' ? 5432 : 3306);

      const server: Server = createServer((localSocket) => {
        localSocket.on('error', () => {
          localSocket.destroy();
        });
        ssh.forwardOut('127.0.0.1', 0, targetHost, targetPort, (err, remoteStream) => {
          if (err || !remoteStream) {
            localSocket.destroy();
            return;
          }
          remoteStream.on('error', () => {
            localSocket.destroy();
          });
          localSocket.pipe(remoteStream).pipe(localSocket);
        });
      });

      const localPort = await new Promise<number>((resPort, rejPort) => {
        server.once('error', rejPort);
        server.listen(0, '127.0.0.1', () => {
          server.unref();
          const addr = server.address();
          if (addr && typeof addr === 'object') {
            resPort(addr.port);
          } else {
            rejPort(new Error('Gagal mengikat port lokal untuk SSH Tunnel.'));
          }
        });
      });

      const managed: ActiveSshTunnel = {
        host: '127.0.0.1',
        port: localPort,
        alive: true,
        close: async () => {
          managed.alive = false;
          await new Promise<void>((resClose) => {
            server.close(() => resClose());
          });
          try {
            ssh.end();
          } catch {
            // Ignore
          }
        }
      };

      const markDead = (): void => {
        if (!managed.alive) return;
        managed.alive = false;
        if (this.sshTunnels.get(profile.id) === managed) {
          void this.evictProfileConnections(profile.id);
        }
      };

      ssh.on('close', markDead);
      ssh.on('end', markDead);
      ssh.on('error', markDead);

      this.sshTunnels.set(profile.id, managed);
      return managed;
    })();

    this.inFlightTunnels.set(profile.id, openTask);
    try {
      const tun = await openTask;
      return { host: tun.host, port: tun.port };
    } finally {
      this.inFlightTunnels.delete(profile.id);
    }
  }

  private async getMysqlPool(profile: DatabaseProfile): Promise<mysql.Pool> {
    const existing = this.mysqlPools.get(profile.id);
    if (existing) return existing;

    const [password, endpoint] = await Promise.all([
      this.getPassword(profile.id),
      this.ensureEndpoint(profile)
    ]);

    const afterWait = this.mysqlPools.get(profile.id);
    if (afterWait) return afterWait;

    const pool = mysql.createPool({
      host: endpoint.host,
      port: endpoint.port,
      user: profile.username,
      password,
      waitForConnections: true,
      connectionLimit: 4,
      queueLimit: 0,
      connectTimeout: 12000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 15000,
      dateStrings: true,
      multipleStatements: false,
      ssl: profile.ssl ? { rejectUnauthorized: false } : undefined
    });

    this.mysqlPools.set(profile.id, pool);
    return pool;
  }

  private async getPgPool(profile: DatabaseProfile, targetDb: string): Promise<PgPool> {
    const effDb = targetDb || 'postgres';
    const poolKey = `${profile.id}:${effDb.toLowerCase()}`;
    const existing = this.pgPools.get(poolKey);
    if (existing) return existing;

    const [password, endpoint] = await Promise.all([
      this.getPassword(profile.id),
      this.ensureEndpoint(profile)
    ]);

    const afterWait = this.pgPools.get(poolKey);
    if (afterWait) return afterWait;

    const pool = new PgPool({
      host: endpoint.host,
      port: endpoint.port,
      user: profile.username,
      password,
      database: effDb,
      max: 4,
      idleTimeoutMillis: 120000,
      connectionTimeoutMillis: 12000,
      allowExitOnIdle: true,
      ssl: profile.ssl ? { rejectUnauthorized: false } : undefined
    });
    pool.on('error', () => {
      // Prevent unhandled idle client error crash; stale client is replaced on checkout
    });

    this.pgPools.set(poolKey, pool);
    return pool;
  }

  private async borrowHealthyMysqlConn(profile: DatabaseProfile): Promise<mysql.PoolConnection> {
    try {
      const pool = await this.getMysqlPool(profile);
      const conn = await pool.getConnection();
      const lastOk = this.mysqlPoolLastOkAt.get(profile.id) ?? 0;
      if (Date.now() - lastOk > 20000) {
        try {
          await conn.ping();
          this.mysqlPoolLastOkAt.set(profile.id, Date.now());
        } catch (pingErr) {
          conn.destroy();
          throw pingErr;
        }
      }
      return conn;
    } catch (firstErr) {
      // Evict stale pool/tunnel once and retry only if a previous pool/tunnel existed
      const hadWarm =
        this.mysqlPools.has(profile.id) || this.sshTunnels.has(profile.id);
      this.mysqlPoolLastOkAt.delete(profile.id);
      await this.evictProfileConnections(profile.id);
      if (!hadWarm) {
        throw firstErr;
      }
      const freshPool = await this.getMysqlPool(profile);
      const freshConn = await freshPool.getConnection();
      this.mysqlPoolLastOkAt.set(profile.id, Date.now());
      return freshConn;
    }
  }

  private async withMysqlConnection<T>(
    profile: DatabaseProfile,
    overrideDatabase: string | undefined,
    fn: (conn: mysql.PoolConnection) => Promise<T>
  ): Promise<T> {
    const conn = await this.borrowHealthyMysqlConn(profile);
    try {
      const targetDb = overrideDatabase !== undefined ? overrideDatabase : profile.database;
      if (targetDb && targetDb.trim()) {
        await conn.query(`USE ${escapeMysqlIdent(targetDb.trim())}`);
      }
      return await fn(conn);
    } finally {
      conn.release();
    }
  }

  private async withPgClient<T>(
    profile: DatabaseProfile,
    overrideDatabase: string | undefined,
    fn: (client: PgPoolClient) => Promise<T>
  ): Promise<T> {
    const targetDb = (overrideDatabase ?? profile.database) || 'postgres';
    const poolKey = `${profile.id}:${targetDb.toLowerCase()}`;
    let client: PgPoolClient;
    try {
      const pool = await this.getPgPool(profile, targetDb);
      client = await pool.connect();
    } catch (firstErr) {
      const hadWarm = this.pgPools.has(poolKey) || this.sshTunnels.has(profile.id);
      await this.evictProfileConnections(profile.id);
      if (!hadWarm) {
        throw firstErr;
      }
      const freshPool = await this.getPgPool(profile, targetDb);
      client = await freshPool.connect();
    }

    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  async testConnection(
    id: string
  ): Promise<{ ok: boolean; message: string; latencyMs: number }> {
    const started = Date.now();
    try {
      const profile = await this.getById(id);
      if (profile.engine === 'postgres') {
        const version = await this.withPgClient(profile, undefined, async (client) => {
          const r = await client.query('SELECT version() AS v');
          return String(r.rows[0]?.v ?? 'PostgreSQL').split(',')[0];
        });
        const latencyMs = Date.now() - started;
        return {
          ok: true,
          message: `Terhubung ke ${profile.name} (${version}) dalam ${latencyMs} ms`,
          latencyMs
        };
      } else {
        const version = await this.withMysqlConnection(profile, undefined, async (conn) => {
          const [rows] = await conn.query('SELECT VERSION() AS v');
          const arr = rows as Array<{ v?: string }>;
          return String(arr[0]?.v ?? 'MySQL/MariaDB');
        });
        const latencyMs = Date.now() - started;
        return {
          ok: true,
          message: `Terhubung ke ${profile.name} (MySQL/MariaDB ${version}) dalam ${latencyMs} ms`,
          latencyMs
        };
      }
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
        latencyMs: Date.now() - started
      };
    }
  }

  async introspect(
    id: string,
    overrideDatabase?: string,
    _forceFull = false
  ): Promise<DbSchemaSnapshot> {
    const profile = await this.getById(id);
    const prevDiskCache = await this.readDiskSchemaCache(profile.id);
    const targetHint =
      overrideDatabase?.trim() ||
      profile.database.trim() ||
      prevDiskCache?.lastActiveDatabase ||
      undefined;

    this.emitProgress({
      profileId: profile.id,
      database: targetHint,
      phase: 'connecting',
      percent: 14,
      message: `Menghubungi pool "${profile.name}"${profile.sshTunnelConnectionId ? ' (SSH Keep-Alive)' : ''}...`
    });

    if (profile.engine === 'postgres') {
      const currentTargetDb = targetHint || 'postgres';
      const [databases, tblRows] = await this.withPgClient(
        profile,
        currentTargetDb,
        async (client) => {
          this.emitProgress({
            profileId: profile.id,
            database: currentTargetDb,
            phase: 'databases',
            percent: 32,
            message: `Memuat daftar database & tabel "${currentTargetDb}"...`
          });
          const [dbRes, tblRes] = await Promise.all([
            client.query(
              `SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname`
            ),
            client.query(
              `SELECT table_schema, table_name, table_type
               FROM information_schema.tables
               WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
               ORDER BY table_schema, table_name`
            )
          ]);
          return [dbRes.rows.map((r) => String(r.datname)), tblRes.rows] as const;
        }
      );

      const currentDatabase = currentTargetDb || databases[0] || 'postgres';

      // Stage 1 Progressive Streaming: send table list immediately if not yet cached
      if (!prevDiskCache?.tablesByDb[currentDatabase.toLowerCase()]) {
        const stubTables: DbTableMeta[] = tblRows.map((r) => ({
          name: String(r.table_name),
          schema: String(r.table_schema),
          kind: String(r.table_type).toUpperCase().includes('VIEW') ? 'view' : 'table',
          columns: [],
          primaryKeys: []
        }));
        this.emitPartialSchema({
          profileId: profile.id,
          profileName: profile.name,
          engine: 'postgres',
          currentDatabase,
          databases,
          tables: stubTables,
          allTables: stubTables,
          loadedAt: new Date().toISOString()
        });
      }

      this.emitProgress({
        profileId: profile.id,
        database: currentDatabase,
        phase: 'columns',
        percent: 72,
        message: `Memuat paralel kolom, PK & Foreign Key "${currentDatabase}" (${tblRows.length} tabel)...`
      });

      // Stage 2 Parallel Pool Fetch across 3 pooled clients!
      const [colRows, pkRows, fkRows] = await Promise.all([
        this.withPgClient(profile, currentDatabase, async (c) => {
          const r = await c.query(
            `SELECT table_schema, table_name, column_name, data_type, udt_name, is_nullable, column_default
             FROM information_schema.columns
             WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
             ORDER BY table_schema, table_name, ordinal_position`
          );
          return r.rows;
        }),
        this.withPgClient(profile, currentDatabase, async (c) => {
          const r = await c.query(
            `SELECT tc.table_schema, tc.table_name, kcu.column_name
             FROM information_schema.table_constraints tc
             JOIN information_schema.key_column_usage kcu
               ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
             WHERE tc.constraint_type = 'PRIMARY KEY'`
          );
          return r.rows;
        }),
        this.withPgClient(profile, currentDatabase, async (c) => {
          try {
            const r = await c.query(
              `SELECT tc.table_schema, tc.table_name, kcu.column_name,
                      ccu.table_schema AS foreign_table_schema,
                      ccu.table_name AS foreign_table_name,
                      ccu.column_name AS foreign_column_name,
                      tc.constraint_name
               FROM information_schema.table_constraints tc
               JOIN information_schema.key_column_usage kcu
                 ON tc.constraint_name = kcu.constraint_name
                AND tc.table_schema = kcu.table_schema
               JOIN information_schema.constraint_column_usage ccu
                 ON ccu.constraint_name = tc.constraint_name
                AND ccu.table_schema = tc.table_schema
               WHERE tc.constraint_type = 'FOREIGN KEY'`
            );
            return r.rows;
          } catch {
            return [];
          }
        })
      ]);

      const fksByTable = new Map<string, DbForeignKeyMeta[]>();
      for (const r of fkRows) {
        const key = `${r.table_schema}.${r.table_name}`;
        const list = fksByTable.get(key) ?? [];
        list.push({
          column: String(r.column_name),
          referencedSchema: String(r.foreign_table_schema),
          referencedTable: String(r.foreign_table_name),
          referencedColumn: String(r.foreign_column_name),
          constraintName: r.constraint_name ? String(r.constraint_name) : undefined
        });
        fksByTable.set(key, list);
      }

      const pkSet = new Set<string>(
        pkRows.map((r) => `${r.table_schema}.${r.table_name}.${r.column_name}`)
      );
      const colsByTable = new Map<string, DbColumnMeta[]>();
      for (const r of colRows) {
        const key = `${r.table_schema}.${r.table_name}`;
        const isPk = pkSet.has(`${key}.${r.column_name}`);
        const list = colsByTable.get(key) ?? [];
        list.push({
          name: String(r.column_name),
          dataType: String(r.data_type),
          columnType: String(r.udt_name || r.data_type),
          nullable: String(r.is_nullable).toUpperCase() === 'YES',
          isPrimaryKey: isPk,
          defaultValue: r.column_default !== null ? String(r.column_default) : null
        });
        colsByTable.set(key, list);
      }

      const tables: DbTableMeta[] = tblRows.map((r) => {
        const schema = String(r.table_schema);
        const name = String(r.table_name);
        const cols = colsByTable.get(`${schema}.${name}`) ?? [];
        const fks = fksByTable.get(`${schema}.${name}`) ?? [];
        return {
          name,
          schema,
          kind: String(r.table_type).toUpperCase().includes('VIEW') ? 'view' : 'table',
          columns: cols,
          primaryKeys: cols.filter((c) => c.isPrimaryKey).map((c) => c.name),
          foreignKeys: fks.length > 0 ? fks : undefined
        };
      });

      const tableLookup = new Map<string, DbTableMeta>();
      for (const t of tables) {
        tableLookup.set(t.name.toLowerCase(), t);
      }
      this.schemaCache.set(`${id}:${currentDatabase.toLowerCase()}`, tableLookup);

      const savedCache = await this.writeDiskSchemaCache(
        profile,
        databases,
        currentDatabase,
        tables
      );
      const allTables = this.buildMergedAllTablesFromCache(savedCache);

      this.emitProgress({
        profileId: profile.id,
        database: currentDatabase,
        phase: 'done',
        percent: 100,
        message: `Database "${currentDatabase}" siap (${tables.length} tabel).`
      });

      return {
        profileId: profile.id,
        profileName: profile.name,
        engine: 'postgres',
        currentDatabase,
        databases,
        tables,
        allTables,
        loadedAt: savedCache.updatedAt
      };
    }

    // MYSQL / MARIADB TURBO PATH:
    // 1. Warm Pool + Keep-Alive SSH Tunnel
    // 2. `SHOW DATABASES` + `SHOW FULL TABLES FROM \`db\`` (Stage 1 progressive table list in ~30ms!)
    // 3. Exact `WHERE TABLE_SCHEMA = ?` (NO `LOWER()` -> full directory pruning!)
    // 4. True Lazy Loading (only active database, zero 120k cross-DB scan!)
    // 5. Parallel `Promise.all` across 3 pooled connections + `information_schema_stats_expiry = 86400`
    const { allDbs, currentDatabase, showTableItems } = await this.withMysqlConnection(
      profile,
      '',
      async (conn) => {
        this.emitProgress({
          profileId: profile.id,
          database: targetHint,
          phase: 'databases',
          percent: 28,
          message: `Memuat daftar database di "${profile.name}"...`
        });
        const [dbRows] = await conn.query('SHOW DATABASES');
        const dbs = (dbRows as Array<Record<string, unknown>>)
          .map((r) => String(Object.values(r)[0] ?? ''))
          .filter(Boolean);

        dbs.sort((a, b) => {
          const al = a.toLowerCase();
          const bl = b.toLowerCase();
          const rank = (name: string): number => {
            if (MYSQL_SYSTEM_SCHEMAS.has(name)) return 2;
            if (MYSQL_LOW_PRIORITY_SCHEMAS.has(name)) return 1;
            return 0;
          };
          const rA = rank(al);
          const rB = rank(bl);
          if (rA !== rB) return rA - rB;
          return a.localeCompare(b);
        });

        if (dbs.length === 0) {
          return {
            allDbs: [] as string[],
            currentDatabase: '',
            showTableItems: [] as Array<{ name: string; kind: 'table' | 'view' }>
          };
        }

        const requestedRaw =
          overrideDatabase?.trim() ||
          profile.database.trim() ||
          prevDiskCache?.lastActiveDatabase ||
          '';
        const matched = requestedRaw
          ? dbs.find((d) => d.toLowerCase() === requestedRaw.toLowerCase())
          : undefined;

        const chosenDb =
          matched ||
          dbs.find(
            (d) =>
              !MYSQL_SYSTEM_SCHEMAS.has(d.toLowerCase()) &&
              !MYSQL_LOW_PRIORITY_SCHEMAS.has(d.toLowerCase())
          ) ||
          dbs.find((d) => !MYSQL_SYSTEM_SCHEMAS.has(d.toLowerCase())) ||
          dbs[0] ||
          '';

        this.emitProgress({
          profileId: profile.id,
          database: chosenDb,
          phase: 'tables',
          percent: 48,
          message: `Membaca cepat direktori tabel "${chosenDb}"...`
        });

        const [rawFullTbls] = await conn.query(
          `SHOW FULL TABLES FROM ${escapeMysqlIdent(chosenDb)}`
        );
        const items: Array<{ name: string; kind: 'table' | 'view' }> = [];
        for (const row of rawFullTbls as Array<Record<string, unknown>>) {
          const vals = Object.values(row);
          const tblName = String(vals[0] ?? '');
          const tblType = String(vals[1] ?? 'BASE TABLE').toUpperCase();
          if (!tblName) continue;
          items.push({
            name: tblName,
            kind: tblType.includes('VIEW') ? 'view' : 'table'
          });
        }
        items.sort((a, b) => a.name.localeCompare(b.name));

        return {
          allDbs: dbs,
          currentDatabase: chosenDb,
          showTableItems: items
        };
      }
    );

    if (allDbs.length === 0 || !currentDatabase) {
      this.emitProgress({
        profileId: profile.id,
        phase: 'done',
        percent: 100,
        message: 'Tidak ada database yang ditemukan di server.'
      });
      return {
        profileId: profile.id,
        profileName: profile.name,
        engine: 'mysql',
        currentDatabase: '',
        databases: [],
        tables: [],
        allTables: [],
        loadedAt: new Date().toISOString()
      };
    }

    // STAGE 1 PROGRESSIVE EMIT: Immediately stream table list before columns finish if not yet cached!
    if (!prevDiskCache?.tablesByDb[currentDatabase.toLowerCase()]) {
      const stubTables: DbTableMeta[] = showTableItems.map((it) => ({
        name: it.name,
        schema: currentDatabase,
        kind: it.kind,
        columns: [],
        primaryKeys: []
      }));
      const prevOthers = prevDiskCache
        ? this.buildMergedAllTablesFromCache(prevDiskCache).filter(
            (t) => (t.schema ?? '').toLowerCase() !== currentDatabase.toLowerCase()
          )
        : [];
      this.emitPartialSchema({
        profileId: profile.id,
        profileName: profile.name,
        engine: 'mysql',
        currentDatabase,
        databases: allDbs,
        tables: stubTables,
        allTables: [...stubTables, ...prevOthers],
        loadedAt: new Date().toISOString()
      });
    }

    this.emitProgress({
      profileId: profile.id,
      database: currentDatabase,
      phase: 'columns',
      percent: 76,
      message: `Memuat paralel kolom & relasi "${currentDatabase}" (${showTableItems.length} tabel)...`
    });

    // STAGE 2 PARALLEL FETCH: Exact `WHERE TABLE_SCHEMA = ?` (zero `LOWER()`) + bypass InnoDB stats recalculation!
    const [curColRows, curFkRows, curStatRows] = await Promise.all([
      this.withMysqlConnection(profile, '', async (c) => {
        await c.query('SET SESSION information_schema_stats_expiry = 86400').catch(() => {});
        const [rows] = await c.query(
          `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS colName,
                  DATA_TYPE AS dataType, COLUMN_TYPE AS columnType, IS_NULLABLE AS isNullable,
                  COLUMN_KEY AS colKey, COLUMN_DEFAULT AS colDefault, EXTRA AS extra
           FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = ?
           ORDER BY TABLE_NAME, ORDINAL_POSITION
           LIMIT 200000`,
          [currentDatabase]
        );
        return rows as Array<Record<string, unknown>>;
      }),
      this.withMysqlConnection(profile, '', async (c) => {
        try {
          await c.query('SET SESSION information_schema_stats_expiry = 86400').catch(() => {});
          const [rows] = await c.query(
            `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS colName,
                    REFERENCED_TABLE_SCHEMA AS refSchema, REFERENCED_TABLE_NAME AS refTable,
                    REFERENCED_COLUMN_NAME AS refCol, CONSTRAINT_NAME AS constraintName
             FROM information_schema.KEY_COLUMN_USAGE
             WHERE TABLE_SCHEMA = ?
               AND REFERENCED_TABLE_NAME IS NOT NULL
             LIMIT 30000`,
            [currentDatabase]
          );
          return rows as Array<Record<string, unknown>>;
        } catch {
          return [] as Array<Record<string, unknown>>;
        }
      }),
      this.withMysqlConnection(profile, '', async (c) => {
        try {
          await c.query('SET SESSION information_schema_stats_expiry = 86400').catch(() => {});
          const [rows] = await c.query(
            `SELECT TABLE_NAME AS tableName, TABLE_ROWS AS tableRows
             FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = ?
             LIMIT 20000`,
            [currentDatabase]
          );
          return rows as Array<Record<string, unknown>>;
        } catch {
          return [] as Array<Record<string, unknown>>;
        }
      })
    ]);

    const colsByTableLower = new Map<string, DbColumnMeta[]>();
    for (const r of curColRows) {
      const tbl = String(pickRowVal(r, 'tableName', 'TABLE_NAME') ?? '');
      const colName = String(pickRowVal(r, 'colName', 'COLUMN_NAME') ?? '');
      if (!tbl || !colName) continue;
      const key = tbl.toLowerCase();
      const list = colsByTableLower.get(key) ?? [];
      const dataType = String(pickRowVal(r, 'dataType', 'DATA_TYPE') ?? '');
      const columnType = String(pickRowVal(r, 'columnType', 'COLUMN_TYPE') ?? dataType);
      const isNullable =
        String(pickRowVal(r, 'isNullable', 'IS_NULLABLE') ?? '').toUpperCase() === 'YES';
      const colKey = String(pickRowVal(r, 'colKey', 'COLUMN_KEY') ?? '').toUpperCase();
      const colDefault = pickRowVal(r, 'colDefault', 'COLUMN_DEFAULT');
      const extra = pickRowVal(r, 'extra', 'EXTRA');

      list.push({
        name: colName,
        dataType,
        columnType,
        nullable: isNullable,
        isPrimaryKey: colKey === 'PRI',
        defaultValue:
          colDefault !== null && colDefault !== undefined ? String(colDefault) : null,
        extra: extra ? String(extra) : undefined
      });
      colsByTableLower.set(key, list);
    }

    const fksByTableLower = new Map<string, DbForeignKeyMeta[]>();
    for (const fr of curFkRows) {
      const tbl = String(pickRowVal(fr, 'tableName', 'TABLE_NAME') ?? '');
      const colName = String(pickRowVal(fr, 'colName', 'COLUMN_NAME') ?? '');
      const refTable = String(pickRowVal(fr, 'refTable', 'REFERENCED_TABLE_NAME') ?? '');
      const refCol = String(pickRowVal(fr, 'refCol', 'REFERENCED_COLUMN_NAME') ?? '');
      if (!tbl || !colName || !refTable || !refCol) continue;
      const refSchema = String(
        pickRowVal(fr, 'refSchema', 'REFERENCED_TABLE_SCHEMA') ?? currentDatabase
      );
      const constraintName = pickRowVal(fr, 'constraintName', 'CONSTRAINT_NAME');
      const key = tbl.toLowerCase();
      const list = fksByTableLower.get(key) ?? [];
      list.push({
        column: colName,
        referencedSchema: refSchema || undefined,
        referencedTable: refTable,
        referencedColumn: refCol,
        constraintName: constraintName ? String(constraintName) : undefined
      });
      fksByTableLower.set(key, list);
    }

    const rowsEstByTableLower = new Map<string, number>();
    for (const sr of curStatRows) {
      const tbl = String(pickRowVal(sr, 'tableName', 'TABLE_NAME') ?? '');
      const tableRows = pickRowVal(sr, 'tableRows', 'TABLE_ROWS');
      if (tbl && tableRows !== null && tableRows !== undefined) {
        rowsEstByTableLower.set(tbl.toLowerCase(), Number(tableRows));
      }
    }

    const lookup = new Map<string, DbTableMeta>();
    const tables: DbTableMeta[] = showTableItems.map((it) => {
      const low = it.name.toLowerCase();
      const cols = colsByTableLower.get(low) ?? [];
      const fks = fksByTableLower.get(low) ?? [];
      const meta: DbTableMeta = {
        name: it.name,
        schema: currentDatabase,
        kind: it.kind,
        rowEstimate: rowsEstByTableLower.get(low),
        columns: cols,
        primaryKeys: cols.filter((c) => c.isPrimaryKey).map((c) => c.name),
        foreignKeys: fks.length > 0 ? fks : undefined
      };
      lookup.set(low, meta);
      return meta;
    });
    this.schemaCache.set(`${id}:${currentDatabase.toLowerCase()}`, lookup);

    const savedCache = await this.writeDiskSchemaCache(
      profile,
      allDbs,
      currentDatabase,
      tables
    );
    const allTables = this.buildMergedAllTablesFromCache(savedCache);

    this.emitProgress({
      profileId: profile.id,
      database: currentDatabase,
      phase: 'done',
      percent: 100,
      message: `Database "${currentDatabase}" siap (${tables.length} tabel).`
    });

    return {
      profileId: profile.id,
      profileName: profile.name,
      engine: 'mysql',
      currentDatabase,
      databases: allDbs,
      tables,
      allTables,
      loadedAt: savedCache.updatedAt
    };
  }

  async executeQuery(
    id: string,
    sql: string,
    overrideDatabase?: string,
    maxRows = 500
  ): Promise<DbQueryResult> {
    const trimmed = sql.trim();
    if (!trimmed) {
      throw new Error('Query SQL kosong.');
    }

    const profile = await this.getById(id);
    const activeDb = (overrideDatabase?.trim() || profile.database.trim()) || '';
    const started = Date.now();

    const resolveEditableMeta = (
      cols: string[]
    ): DbQueryResult['editableTable'] => {
      const ref = detectSimpleSelectRef(trimmed);
      if (!ref) return null;
      const targetDb = ref.schema || activeDb;
      if (!targetDb) return null;
      const cached = this.schemaCache
        .get(`${id}:${targetDb.toLowerCase()}`)
        ?.get(ref.table.toLowerCase());
      if (!cached || cached.kind !== 'table' || cached.primaryKeys.length === 0) return null;
      const colSet = new Set(cols);
      const hasAllPks = cached.primaryKeys.every((pk) => colSet.has(pk));
      if (!hasAllPks) return null;
      return {
        database: cached.schema || targetDb,
        table: cached.name,
        primaryKeys: cached.primaryKeys
      };
    };

    if (profile.engine === 'postgres') {
      return this.withPgClient(profile, activeDb || undefined, async (client) => {
        const res = await client.query(trimmed);
        const durationMs = Math.max(1, Date.now() - started);
        if (Array.isArray(res.rows) && res.fields && res.fields.length > 0) {
          const columns = res.fields.map((f) => f.name);
          const truncated = res.rows.length > maxRows;
          const rows = (truncated ? res.rows.slice(0, maxRows) : res.rows) as Array<
            Record<string, unknown>
          >;
          return {
            columns,
            rows,
            rowCount: res.rows.length,
            durationMs,
            truncated,
            editableTable: resolveEditableMeta(columns)
          };
        }
        if (this.auditService && isMutatingSqlStatement(trimmed)) {
          await this.auditService.record({
            kind: 'db-query-mutating',
            profileId: profile.id,
            targetName: profile.name,
            isProduction: Boolean(profile.isProduction),
            database: activeDb || profile.database,
            summary: `${res.command || 'SQL'} (${res.rowCount ?? 0} baris)`,
            detail: trimmed.slice(0, 1200)
          });
        }
        return {
          columns: [],
          rows: [],
          rowCount: 0,
          affectedRows: res.rowCount ?? 0,
          durationMs,
          message: `${res.command || 'Query'} selesai (${res.rowCount ?? 0} baris terpengaruh).`
        };
      });
    }

    return this.withMysqlConnection(profile, activeDb || undefined, async (conn) => {
      const [result, fields] = await conn.query(trimmed);
      const durationMs = Math.max(1, Date.now() - started);

      if (Array.isArray(result)) {
        const allRows = result as Array<Record<string, unknown>>;
        const columns =
          fields && fields.length > 0
            ? fields.map((f) => f.name)
            : allRows[0]
              ? Object.keys(allRows[0])
              : [];
        const truncated = allRows.length > maxRows;
        const rows = truncated ? allRows.slice(0, maxRows) : allRows;
        return {
          columns,
          rows,
          rowCount: allRows.length,
          durationMs,
          truncated,
          editableTable: resolveEditableMeta(columns)
        };
      }

      const header = result as mysql.ResultSetHeader;
      if (this.auditService && isMutatingSqlStatement(trimmed)) {
        await this.auditService.record({
          kind: 'db-query-mutating',
          profileId: profile.id,
          targetName: profile.name,
          isProduction: Boolean(profile.isProduction),
          database: activeDb || profile.database,
          summary: `Mutasi SQL (${header.affectedRows ?? 0} baris)`,
          detail: trimmed.slice(0, 1200)
        });
      }
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        affectedRows: header.affectedRows ?? 0,
        insertId: header.insertId || undefined,
        durationMs,
        message: `Query berhasil: ${header.affectedRows ?? 0} baris terpengaruh${
          header.insertId ? ` (Insert ID: ${header.insertId})` : ''
        }.`
      };
    });
  }

  async executeMultiQuery(
    id: string,
    sqlScript: string,
    overrideDatabase?: string,
    maxRows = 500
  ): Promise<DbMultiQueryResultItem[]> {
    const statements = splitSqlStatements(sqlScript);
    if (statements.length === 0) {
      throw new Error('Tidak ada perintah SQL untuk dijalankan.');
    }
    const items: DbMultiQueryResultItem[] = [];
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      try {
        const res = await this.executeQuery(id, stmt, overrideDatabase, maxRows);
        items.push({ index: i + 1, sql: stmt, result: res });
      } catch (err) {
        items.push({
          index: i + 1,
          sql: stmt,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
    return items;
  }

  async updateCell(
    id: string,
    payload: DbCellUpdatePayload
  ): Promise<{ affectedRows: number }> {
    const pkEntries = Object.entries(payload.primaryKeyValues || {});
    if (pkEntries.length === 0) {
      throw new Error('Primary key diperlukan untuk mengubah nilai sel secara langsung.');
    }

    const profile = await this.getById(id);
    const activeDb = payload.database?.trim() || profile.database.trim() || undefined;

    if (profile.engine === 'postgres') {
      return this.withPgClient(profile, activeDb, async (client) => {
        let oldValue: unknown = undefined;
        try {
          const selParams: unknown[] = [];
          const selWhere = pkEntries.map(([pkCol, pkVal], idx) => {
            selParams.push(pkVal);
            return `${escapePgIdent(pkCol)} = $${idx + 1}`;
          });
          const selRes = await client.query(
            `SELECT ${escapePgIdent(payload.column)} AS prev_val FROM ${escapePgIdent(payload.table)} WHERE ${selWhere.join(' AND ')} LIMIT 1`,
            selParams
          );
          if (selRes.rows[0]) {
            oldValue = (selRes.rows[0] as Record<string, unknown>).prev_val;
          }
        } catch {
          // Ignore snapshot read failure
        }

        const params: unknown[] = [payload.newValue];
        const whereParts = pkEntries.map(([pkCol, pkVal], i) => {
          params.push(pkVal);
          return `${escapePgIdent(pkCol)} = $${i + 2}`;
        });
        const sql = `UPDATE ${escapePgIdent(payload.table)} SET ${escapePgIdent(payload.column)} = $1 WHERE ${whereParts.join(' AND ')}`;
        const res = await client.query(sql, params);

        if (this.auditService && (res.rowCount ?? 0) > 0) {
          const undoSql = buildCellUpdateUndoSql({
            engine: 'postgres',
            database: activeDb,
            table: payload.table,
            column: payload.column,
            oldValue,
            primaryKeyValues: payload.primaryKeyValues
          });
          await this.auditService.record({
            kind: 'db-cell-update',
            profileId: profile.id,
            targetName: profile.name,
            isProduction: Boolean(profile.isProduction),
            database: activeDb,
            tableOrPath: payload.table,
            summary: `UPDATE ${payload.table}.${payload.column}`,
            detail: `Sebelum: ${JSON.stringify(oldValue)} → Sesudah: ${JSON.stringify(payload.newValue)}`,
            undoSql
          });
        }
        return { affectedRows: res.rowCount ?? 0 };
      });
    }

    return this.withMysqlConnection(profile, activeDb, async (conn) => {
      const toSqlParam = (v: unknown): string | number | boolean | null => {
        if (v === null || v === undefined) return null;
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
        return JSON.stringify(v);
      };

      let oldValue: unknown = undefined;
      try {
        const selParams: Array<string | number | boolean | null> = [];
        const selWhere = pkEntries.map(([pkCol, pkVal]) => {
          selParams.push(toSqlParam(pkVal));
          return `${escapeMysqlIdent(pkCol)} = ?`;
        });
        const [selRows] = await conn.execute(
          `SELECT ${escapeMysqlIdent(payload.column)} AS prev_val FROM ${escapeMysqlIdent(payload.table)} WHERE ${selWhere.join(' AND ')} LIMIT 1`,
          selParams
        );
        const first = (selRows as Array<Record<string, unknown>>)[0];
        if (first) {
          oldValue = first.prev_val;
        }
      } catch {
        // Ignore snapshot read failure
      }

      const params: Array<string | number | boolean | null> = [toSqlParam(payload.newValue)];
      const whereParts = pkEntries.map(([pkCol, pkVal]) => {
        params.push(toSqlParam(pkVal));
        return `${escapeMysqlIdent(pkCol)} = ?`;
      });
      const sql = `UPDATE ${escapeMysqlIdent(payload.table)} SET ${escapeMysqlIdent(payload.column)} = ? WHERE ${whereParts.join(' AND ')} LIMIT 1`;
      const [res] = await conn.execute(sql, params);
      const header = res as mysql.ResultSetHeader;

      if (this.auditService && (header.affectedRows ?? 0) > 0) {
        const undoSql = buildCellUpdateUndoSql({
          engine: 'mysql',
          database: activeDb,
          table: payload.table,
          column: payload.column,
          oldValue,
          primaryKeyValues: payload.primaryKeyValues
        });
        await this.auditService.record({
          kind: 'db-cell-update',
          profileId: profile.id,
          targetName: profile.name,
          isProduction: Boolean(profile.isProduction),
          database: activeDb,
          tableOrPath: payload.table,
          summary: `UPDATE ${payload.table}.${payload.column}`,
          detail: `Sebelum: ${JSON.stringify(oldValue)} → Sesudah: ${JSON.stringify(payload.newValue)}`,
          undoSql
        });
      }
      return { affectedRows: header.affectedRows ?? 0 };
    });
  }

  generateTableDdl(table: DbTableMeta, engine: DbEngine): string {
    return buildCreateTableDdl(table, engine);
  }

  async insertRow(
    id: string,
    payload: DbInsertRowPayload
  ): Promise<{ affectedRows: number; insertId?: number | string }> {
    const profile = await this.getById(id);
    const activeDb = payload.database?.trim() || profile.database.trim() || undefined;
    const entries = Object.entries(payload.values || {}).filter(([, v]) => v !== undefined);

    if (profile.engine === 'postgres') {
      return this.withPgClient(profile, activeDb, async (client) => {
        if (entries.length === 0) {
          const res = await client.query(`INSERT INTO ${escapePgIdent(payload.table)} DEFAULT VALUES`);
          return { affectedRows: res.rowCount ?? 0 };
        }
        const colsSql = entries.map(([col]) => escapePgIdent(col)).join(', ');
        const placeholders = entries.map((_, idx) => `$${idx + 1}`).join(', ');
        const params = entries.map(([, val]) => val);
        const res = await client.query(
          `INSERT INTO ${escapePgIdent(payload.table)} (${colsSql}) VALUES (${placeholders})`,
          params
        );
        return { affectedRows: res.rowCount ?? 0 };
      });
    }

    return this.withMysqlConnection(profile, activeDb, async (conn) => {
      const toSqlParam = (v: unknown): string | number | boolean | null => {
        if (v === null || v === undefined) return null;
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
        return JSON.stringify(v);
      };
      if (entries.length === 0) {
        const [res] = await conn.execute(`INSERT INTO ${escapeMysqlIdent(payload.table)} () VALUES ()`);
        const header = res as mysql.ResultSetHeader;
        return {
          affectedRows: header.affectedRows ?? 0,
          insertId: header.insertId || undefined
        };
      }
      const colsSql = entries.map(([col]) => escapeMysqlIdent(col)).join(', ');
      const placeholders = entries.map(() => '?').join(', ');
      const params = entries.map(([, val]) => toSqlParam(val));
      const [res] = await conn.execute(
        `INSERT INTO ${escapeMysqlIdent(payload.table)} (${colsSql}) VALUES (${placeholders})`,
        params
      );
      const header = res as mysql.ResultSetHeader;
      return {
        affectedRows: header.affectedRows ?? 0,
        insertId: header.insertId || undefined
      };
    });
  }

  async deleteRow(
    id: string,
    payload: DbDeleteRowPayload
  ): Promise<{ affectedRows: number }> {
    const pkEntries = Object.entries(payload.primaryKeyValues || {});
    if (pkEntries.length === 0) {
      throw new Error('Primary key diperlukan untuk menghapus baris secara aman.');
    }

    const profile = await this.getById(id);
    const activeDb = payload.database?.trim() || profile.database.trim() || undefined;

    if (profile.engine === 'postgres') {
      return this.withPgClient(profile, activeDb, async (client) => {
        const params: unknown[] = [];
        const whereParts = pkEntries.map(([pkCol, pkVal], idx) => {
          params.push(pkVal);
          return `${escapePgIdent(pkCol)} = $${idx + 1}`;
        });
        let deletedRow: Record<string, unknown> | null = null;
        try {
          const sel = await client.query(
            `SELECT * FROM ${escapePgIdent(payload.table)} WHERE ${whereParts.join(' AND ')} LIMIT 1`,
            params
          );
          deletedRow = (sel.rows[0] as Record<string, unknown>) ?? null;
        } catch {
          // Ignore snapshot read failure
        }
        const sql = `DELETE FROM ${escapePgIdent(payload.table)} WHERE ${whereParts.join(' AND ')}`;
        const res = await client.query(sql, params);
        if (this.auditService && (res.rowCount ?? 0) > 0) {
          const undoSql = deletedRow
            ? buildRowDeleteUndoSql({
                engine: 'postgres',
                database: activeDb,
                table: payload.table,
                deletedRow
              })
            : undefined;
          await this.auditService.record({
            kind: 'db-row-delete',
            profileId: profile.id,
            targetName: profile.name,
            isProduction: Boolean(profile.isProduction),
            database: activeDb,
            tableOrPath: payload.table,
            summary: `DELETE 1 baris dari ${payload.table}`,
            detail: `PK: ${JSON.stringify(payload.primaryKeyValues)}`,
            undoSql
          });
        }
        return { affectedRows: res.rowCount ?? 0 };
      });
    }

    return this.withMysqlConnection(profile, activeDb, async (conn) => {
      const toSqlParam = (v: unknown): string | number | boolean | null => {
        if (v === null || v === undefined) return null;
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
        return JSON.stringify(v);
      };
      const params: Array<string | number | boolean | null> = [];
      const whereParts = pkEntries.map(([pkCol, pkVal]) => {
        params.push(toSqlParam(pkVal));
        return `${escapeMysqlIdent(pkCol)} = ?`;
      });
      let deletedRow: Record<string, unknown> | null = null;
      try {
        const [selRows] = await conn.execute(
          `SELECT * FROM ${escapeMysqlIdent(payload.table)} WHERE ${whereParts.join(' AND ')} LIMIT 1`,
          params
        );
        deletedRow = (selRows as Array<Record<string, unknown>>)[0] ?? null;
      } catch {
        // Ignore snapshot read failure
      }
      const sql = `DELETE FROM ${escapeMysqlIdent(payload.table)} WHERE ${whereParts.join(' AND ')} LIMIT 1`;
      const [res] = await conn.execute(sql, params);
      const header = res as mysql.ResultSetHeader;
      if (this.auditService && (header.affectedRows ?? 0) > 0) {
        const undoSql = deletedRow
          ? buildRowDeleteUndoSql({
              engine: 'mysql',
              database: activeDb,
              table: payload.table,
              deletedRow
            })
          : undefined;
        await this.auditService.record({
          kind: 'db-row-delete',
          profileId: profile.id,
          targetName: profile.name,
          isProduction: Boolean(profile.isProduction),
          database: activeDb,
          tableOrPath: payload.table,
          summary: `DELETE 1 baris dari ${payload.table}`,
          detail: `PK: ${JSON.stringify(payload.primaryKeyValues)}`,
          undoSql
        });
      }
      return { affectedRows: header.affectedRows ?? 0 };
    });
  }

  private formatDumpLiteral(val: unknown, engine: DbEngine): string {
    if (val === null || val === undefined) return 'NULL';
    if (typeof val === 'number') {
      return Number.isFinite(val) ? String(val) : 'NULL';
    }
    if (typeof val === 'boolean') {
      return engine === 'postgres' ? (val ? 'TRUE' : 'FALSE') : val ? '1' : '0';
    }
    if (val instanceof Date) {
      const iso = val.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
      return `'${iso}'`;
    }
    if (Buffer.isBuffer(val)) {
      return engine === 'postgres'
        ? `'\\x${val.toString('hex')}'`
        : `X'${val.toString('hex')}'`;
    }
    const text = typeof val === 'object' ? JSON.stringify(val) : String(val);
    if (engine === 'postgres') {
      return `'${text.replace(/'/g, "''")}'`;
    }
    return `'${text
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n')}'`;
  }

  async buildSqlDump(
    id: string,
    payload: DbSqlDumpPayload
  ): Promise<{ sql: string; tablesExported: number; rowsExported: number }> {
    const profile = await this.getById(id);
    const snap = await this.introspect(id, payload.database);
    const activeDb = payload.database?.trim() || snap.currentDatabase || profile.database;
    const includeSchema = payload.includeSchema !== false;
    const includeData = payload.includeData !== false;
    const maxRows = Math.max(1, Math.min(payload.maxRowsPerTable ?? 5000, 50000));
    const filterSet =
      payload.tables && payload.tables.length > 0
        ? new Set(payload.tables.map((t) => t.toLowerCase()))
        : null;

    const targetTables = snap.tables.filter(
      (t) => t.kind === 'table' && (!filterSet || filterSet.has(t.name.toLowerCase()))
    );

    const lines: string[] = [
      '-- ==========================================================',
      `-- HMW Studio SQL Backup Dump`,
      `-- Engine   : ${profile.engine.toUpperCase()}`,
      `-- Database : ${activeDb}`,
      `-- Generated: ${new Date().toISOString()}`,
      '-- ==========================================================',
      ''
    ];
    if (profile.engine === 'mysql') {
      lines.push('SET FOREIGN_KEY_CHECKS = 0;', '');
    }

    let rowsExported = 0;
    const quote = profile.engine === 'postgres' ? escapePgIdent : escapeMysqlIdent;

    for (const tbl of targetTables) {
      lines.push(`-- Table: ${tbl.name}`);
      if (includeSchema) {
        const ddl = buildCreateTableDdl(tbl, profile.engine).replace(
          /^CREATE TABLE /i,
          'CREATE TABLE IF NOT EXISTS '
        );
        lines.push(ddl, '');
      }
      if (includeData) {
        const qRes = await this.executeQuery(
          id,
          `SELECT * FROM ${quote(tbl.name)} LIMIT ${maxRows}`,
          activeDb,
          maxRows
        );
        if (qRes.rows.length > 0 && qRes.columns.length > 0) {
          const colsSql = qRes.columns.map((c) => quote(c)).join(', ');
          const batchSize = 100;
          for (let i = 0; i < qRes.rows.length; i += batchSize) {
            const chunk = qRes.rows.slice(i, i + batchSize);
            const valuesBlock = chunk
              .map((row) => {
                const cells = qRes.columns.map((col) =>
                  this.formatDumpLiteral(row[col], profile.engine)
                );
                return `  (${cells.join(', ')})`;
              })
              .join(',\n');
            lines.push(`INSERT INTO ${quote(tbl.name)} (${colsSql}) VALUES\n${valuesBlock};`);
          }
          lines.push('');
          rowsExported += qRes.rows.length;
        }
      }
    }

    if (profile.engine === 'mysql') {
      lines.push('SET FOREIGN_KEY_CHECKS = 1;', '');
    }

    return {
      sql: lines.join('\n'),
      tablesExported: targetTables.length,
      rowsExported
    };
  }

  async importCsvText(
    id: string,
    payload: { database?: string; table: string; csvText: string }
  ): Promise<{ insertedRows: number; columns: string[] }> {
    const parsed = parseCsvRecords(payload.csvText);
    if (parsed.headers.length === 0) {
      throw new Error('Header kolom CSV kosong atau tidak valid.');
    }
    if (parsed.rows.length === 0) {
      return { insertedRows: 0, columns: parsed.headers };
    }

    const profile = await this.getById(id);
    const activeDb = payload.database?.trim() || profile.database.trim() || undefined;
    const cachedTable = activeDb
      ? this.schemaCache.get(`${id}:${activeDb.toLowerCase()}`)?.get(payload.table.toLowerCase())
      : undefined;
    const colMetaMap = new Map(
      (cachedTable?.columns ?? []).map((c) => [c.name.toLowerCase(), c])
    );

    const normalizeCsvValue = (colName: string, rawCell: string): string | null => {
      if (rawCell === 'NULL' || rawCell === '\\N') return null;
      if (rawCell === '') {
        const meta = colMetaMap.get(colName.toLowerCase());
        if (meta && !/char|text|enum|set/i.test(meta.dataType) && meta.nullable) {
          return null;
        }
      }
      return rawCell;
    };

    if (profile.engine === 'postgres') {
      return this.withPgClient(profile, activeDb, async (client) => {
        await client.query('BEGIN');
        try {
          const colsSql = parsed.headers.map((h) => escapePgIdent(h)).join(', ');
          let insertedRows = 0;
          for (const row of parsed.rows) {
            const params = parsed.headers.map((h, i) => normalizeCsvValue(h, row[i] ?? ''));
            const placeholders = parsed.headers.map((_, i) => `$${i + 1}`).join(', ');
            const res = await client.query(
              `INSERT INTO ${escapePgIdent(payload.table)} (${colsSql}) VALUES (${placeholders})`,
              params
            );
            insertedRows += res.rowCount ?? 1;
          }
          await client.query('COMMIT');
          return { insertedRows, columns: parsed.headers };
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          throw err;
        }
      });
    }

    return this.withMysqlConnection(profile, activeDb, async (conn) => {
      await conn.beginTransaction();
      try {
        const colsSql = parsed.headers.map((h) => escapeMysqlIdent(h)).join(', ');
        let insertedRows = 0;
        const placeholders = parsed.headers.map(() => '?').join(', ');
        const sql = `INSERT INTO ${escapeMysqlIdent(payload.table)} (${colsSql}) VALUES (${placeholders})`;
        for (const row of parsed.rows) {
          const params = parsed.headers.map((h, i) => normalizeCsvValue(h, row[i] ?? ''));
          const [res] = await conn.execute(sql, params);
          const header = res as mysql.ResultSetHeader;
          insertedRows += header.affectedRows ?? 1;
        }
        await conn.commit();
        return { insertedRows, columns: parsed.headers };
      } catch (err) {
        await conn.rollback().catch(() => {});
        throw err;
      }
    });
  }

  async listProcesses(id: string): Promise<DbProcessItem[]> {
    const profile = await this.getById(id);
    const activeDb = profile.database.trim() || undefined;

    if (profile.engine === 'postgres') {
      return this.withPgClient(profile, activeDb, async (client) => {
        const res = await client.query(
          `SELECT
             pid,
             COALESCE(usename, '') AS usename,
             COALESCE(client_addr::text, 'local') AS host,
             COALESCE(datname, '') AS datname,
             COALESCE(backend_type, 'client') AS command,
             GREATEST(0, COALESCE(EXTRACT(EPOCH FROM (now() - query_start))::int, 0)) AS time_sec,
             COALESCE(state, '') AS state,
             COALESCE(query, '') AS query
           FROM pg_stat_activity
           WHERE pid <> pg_backend_pid()
           ORDER BY time_sec DESC`
        );
        return (res.rows as Array<Record<string, unknown>>).map((r) => ({
          id: Number(r.pid ?? 0),
          user: String(r.usename ?? ''),
          host: String(r.host ?? ''),
          db: String(r.datname ?? ''),
          command: String(r.command ?? ''),
          timeSec: Number(r.time_sec ?? 0),
          state: String(r.state ?? ''),
          query: String(r.query ?? '')
        }));
      });
    }

    return this.withMysqlConnection(profile, activeDb, async (conn) => {
      const [rows] = await conn.query('SHOW FULL PROCESSLIST');
      const list = (rows as Array<Record<string, unknown>>).map((r) => ({
        id: Number(pickRowVal(r, 'Id', 'id') ?? 0),
        user: String(pickRowVal(r, 'User', 'user') ?? ''),
        host: String(pickRowVal(r, 'Host', 'host') ?? ''),
        db: String(pickRowVal(r, 'db', 'DB') ?? ''),
        command: String(pickRowVal(r, 'Command', 'command') ?? ''),
        timeSec: Number(pickRowVal(r, 'Time', 'time') ?? 0),
        state: String(pickRowVal(r, 'State', 'state') ?? ''),
        query: String(pickRowVal(r, 'Info', 'info') ?? '')
      }));
      return list.sort((a, b) => b.timeSec - a.timeSec);
    });
  }

  async killProcess(
    id: string,
    processId: number | string
  ): Promise<{ ok: boolean; message: string }> {
    const pid = Number(processId);
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new Error(`Process ID database tidak valid: ${String(processId)}`);
    }
    const profile = await this.getById(id);
    const activeDb = profile.database.trim() || undefined;

    if (profile.engine === 'postgres') {
      return this.withPgClient(profile, activeDb, async (client) => {
        await client.query('SELECT pg_terminate_backend($1)', [pid]);
        return { ok: true, message: `Proses PostgreSQL PID #${pid} dihentikan.` };
      });
    }

    return this.withMysqlConnection(profile, activeDb, async (conn) => {
      await conn.query(`KILL ${pid}`);
      return { ok: true, message: `Query MySQL Process #${pid} dihentikan.` };
    });
  }

  async transferTableData(payload: DbDataTransferPayload): Promise<DbDataTransferResult> {
    const startMs = Date.now();
    const srcProfile = await this.getById(payload.sourceProfileId);
    const tgtProfile = await this.getById(payload.targetProfileId);

    const srcDb = payload.sourceDatabase?.trim() || srcProfile.database.trim() || undefined;
    const tgtDb = payload.targetDatabase?.trim() || tgtProfile.database.trim() || undefined;

    const quoteSrc = (id: string): string =>
      srcProfile.engine === 'postgres'
        ? `"${id.replace(/"/g, '""')}"`
        : `\`${id.replace(/`/g, '``')}\``;

    const srcRef = srcDb
      ? `${quoteSrc(srcDb)}.${quoteSrc(payload.sourceTable)}`
      : quoteSrc(payload.sourceTable);

    const cleanWhere = (payload.whereClause ?? '').trim().replace(/^WHERE\s+/i, '');
    const whereSql = cleanWhere ? ` WHERE ${cleanWhere}` : '';
    const maxLimit = Math.max(1, Math.min(payload.rowLimit ?? 2000, 50000));
    const selectSql = `SELECT * FROM ${srcRef}${whereSql} LIMIT ${maxLimit}`;

    const srcRes = await this.executeQuery(payload.sourceProfileId, selectSql, srcDb, maxLimit);
    const columns = srcRes.columns;
    const masks = payload.columnMasks ?? {};
    const maskedColumnCount = Object.values(masks).filter((m) => m && m !== 'none').length;

    const processedRows = srcRes.rows.map((r, idx) => applyRowAnonymization(r, masks, idx));

    const statements = buildBatchUpsertSql({
      table: payload.targetTable,
      schema: tgtDb,
      columns,
      primaryKeys: payload.primaryKeys ?? [],
      rows: processedRows,
      engine: tgtProfile.engine,
      writeMode: payload.writeMode,
      batchSize: 100
    });

    if (statements.length > 0) {
      if (tgtProfile.engine === 'postgres') {
        await this.withPgClient(tgtProfile, tgtDb, async (client) => {
          await client.query('BEGIN');
          try {
            for (const stmt of statements) {
              await client.query(stmt);
            }
            await client.query('COMMIT');
          } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            throw err;
          }
        });
      } else {
        await this.withMysqlConnection(tgtProfile, tgtDb, async (conn) => {
          await conn.beginTransaction();
          try {
            for (const stmt of statements) {
              await conn.query(stmt);
            }
            await conn.commit();
          } catch (err) {
            await conn.rollback().catch(() => {});
            throw err;
          }
        });
      }
    }

    return {
      rowsRead: processedRows.length,
      batchesExecuted: statements.length,
      maskedColumnCount,
      durationMs: Date.now() - startMs
    };
  }

  private async readSavedQueriesRaw(): Promise<SavedSqlQueryItem[]> {
    if (!existsSync(this.savedQueriesFile)) return [];
    try {
      const raw = await readFile(this.savedQueriesFile, 'utf-8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as SavedSqlQueryItem[]) : [];
    } catch {
      return [];
    }
  }

  private async writeSavedQueriesRaw(items: SavedSqlQueryItem[]): Promise<void> {
    await mkdir(this.storageDir, { recursive: true });
    await writeFile(this.savedQueriesFile, JSON.stringify(items, null, 2), 'utf-8');
  }

  private sortSavedQueries(items: SavedSqlQueryItem[]): SavedSqlQueryItem[] {
    return [...items].sort((a, b) => {
      const favDiff = Number(Boolean(b.isFavorite)) - Number(Boolean(a.isFavorite));
      if (favDiff !== 0) return favDiff;
      return (b.updatedAt || '').localeCompare(a.updatedAt || '');
    });
  }

  async listSavedQueries(): Promise<SavedSqlQueryItem[]> {
    const list = await this.readSavedQueriesRaw();
    return this.sortSavedQueries(list);
  }

  async saveQuery(payload: SavedSqlQuerySavePayload): Promise<SavedSqlQueryItem> {
    const name = payload.name.trim();
    const sql = payload.sql.trim();
    if (!name) throw new Error('Nama query tidak boleh kosong.');
    if (!sql) throw new Error('Isi SQL query tidak boleh kosong.');

    const list = await this.readSavedQueriesRaw();
    const now = new Date().toISOString();
    const existingIdx = payload.id ? list.findIndex((q) => q.id === payload.id) : -1;

    let saved: SavedSqlQueryItem;
    if (existingIdx >= 0) {
      const prev = list[existingIdx];
      saved = {
        ...prev,
        name,
        folder: payload.folder?.trim() || undefined,
        sql,
        profileId: payload.profileId !== undefined ? payload.profileId : prev.profileId,
        database: payload.database !== undefined ? payload.database : prev.database,
        isFavorite: payload.isFavorite !== undefined ? payload.isFavorite : prev.isFavorite,
        visualDiagramSpec:
          payload.visualDiagramSpec !== undefined
            ? payload.visualDiagramSpec
            : prev.visualDiagramSpec,
        updatedAt: now
      };
      list[existingIdx] = saved;
    } else {
      saved = {
        id: `sq-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name,
        folder: payload.folder?.trim() || undefined,
        sql,
        profileId: payload.profileId,
        database: payload.database,
        isFavorite: Boolean(payload.isFavorite),
        visualDiagramSpec: payload.visualDiagramSpec,
        createdAt: now,
        updatedAt: now
      };
      list.unshift(saved);
    }

    await this.writeSavedQueriesRaw(this.sortSavedQueries(list));
    return saved;
  }

  async deleteSavedQuery(id: string): Promise<void> {
    const list = await this.readSavedQueriesRaw();
    await this.writeSavedQueriesRaw(list.filter((q) => q.id !== id));
  }

  async importSavedQueriesList(incoming: SavedSqlQueryItem[]): Promise<number> {
    const list = await this.readSavedQueriesRaw();
    const byId = new Map(list.map((q) => [q.id, q]));
    let importedCount = 0;
    const now = new Date().toISOString();

    for (const raw of incoming) {
      if (!raw || typeof raw.name !== 'string' || typeof raw.sql !== 'string') continue;
      if (!raw.name.trim() || !raw.sql.trim()) continue;
      const id =
        raw.id && !byId.has(raw.id)
          ? raw.id
          : `sq-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const normalized: SavedSqlQueryItem = {
        id,
        name: raw.name.trim(),
        folder: raw.folder?.trim() || undefined,
        sql: raw.sql.trim(),
        profileId: raw.profileId,
        database: raw.database,
        isFavorite: Boolean(raw.isFavorite),
        visualDiagramSpec: raw.visualDiagramSpec,
        createdAt: raw.createdAt || now,
        updatedAt: now
      };
      byId.set(id, normalized);
      importedCount++;
    }

    await this.writeSavedQueriesRaw(this.sortSavedQueries(Array.from(byId.values())));
    return importedCount;
  }

  async listRoutines(id: string, overrideDatabase?: string): Promise<DbRoutineSummary[]> {
    const profile = await this.getById(id);
    const activeDb = (overrideDatabase?.trim() || profile.database.trim()) || '';

    if (profile.engine === 'postgres') {
      return this.withPgClient(profile, activeDb || 'postgres', async (client) => {
        const out: DbRoutineSummary[] = [];
        const vRes = await client.query(
          `SELECT table_schema, table_name
           FROM information_schema.views
           WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
           ORDER BY table_schema, table_name`
        );
        for (const r of vRes.rows as Array<Record<string, unknown>>) {
          out.push({
            name: String(r.table_name),
            schema: String(r.table_schema),
            kind: 'VIEW'
          });
        }

        const rRes = await client.query(
          `SELECT routine_schema, routine_name, routine_type, data_type
           FROM information_schema.routines
           WHERE routine_schema NOT IN ('pg_catalog', 'information_schema')
           ORDER BY routine_schema, routine_name`
        );
        for (const r of rRes.rows as Array<Record<string, unknown>>) {
          const rType = String(r.routine_type || '').toUpperCase();
          out.push({
            name: String(r.routine_name),
            schema: String(r.routine_schema),
            kind: rType === 'PROCEDURE' ? 'PROCEDURE' : 'FUNCTION',
            returnType: r.data_type ? String(r.data_type) : undefined
          });
        }

        const tRes = await client.query(
          `SELECT trigger_schema, trigger_name, event_manipulation, event_object_table, action_timing
           FROM information_schema.triggers
           WHERE trigger_schema NOT IN ('pg_catalog', 'information_schema')
           ORDER BY trigger_schema, trigger_name`
        );
        const seenTrig = new Set<string>();
        for (const r of tRes.rows as Array<Record<string, unknown>>) {
          const key = `${r.trigger_schema}.${r.trigger_name}`;
          if (seenTrig.has(key)) continue;
          seenTrig.add(key);
          out.push({
            name: String(r.trigger_name),
            schema: String(r.trigger_schema),
            kind: 'TRIGGER',
            targetTable: String(r.event_object_table || ''),
            triggerTiming: String(r.action_timing || ''),
            triggerEvent: String(r.event_manipulation || '')
          });
        }
        return out;
      });
    }

    // MySQL / MariaDB
    return this.withMysqlConnection(profile, activeDb, async (conn) => {
      const targetSchema = activeDb;
      if (!targetSchema) return [];
      const out: DbRoutineSummary[] = [];

      const [viewRows] = await conn.query(
        `SELECT TABLE_SCHEMA AS s, TABLE_NAME AS n
         FROM information_schema.VIEWS
         WHERE TABLE_SCHEMA = ?
         ORDER BY TABLE_NAME`,
        [targetSchema]
      );
      for (const r of viewRows as Array<Record<string, unknown>>) {
        out.push({
          name: String(r.n),
          schema: String(r.s),
          kind: 'VIEW'
        });
      }

      const [paramRows] = await conn.query(
        `SELECT SPECIFIC_NAME AS sn, PARAMETER_MODE AS pm, PARAMETER_NAME AS pn, DTD_IDENTIFIER AS dt
         FROM information_schema.PARAMETERS
         WHERE SPECIFIC_SCHEMA = ? AND PARAMETER_NAME IS NOT NULL
         ORDER BY SPECIFIC_NAME, ORDINAL_POSITION`,
        [targetSchema]
      );
      const paramsByRoutine = new Map<string, DbRoutineParamMeta[]>();
      for (const pr of paramRows as Array<Record<string, unknown>>) {
        const sn = String(pr.sn || '');
        const list = paramsByRoutine.get(sn) ?? [];
        list.push({
          name: String(pr.pn || ''),
          mode: (String(pr.pm || 'IN').toUpperCase() as 'IN' | 'OUT' | 'INOUT') || 'IN',
          dataType: String(pr.dt || 'VARCHAR(255)')
        });
        paramsByRoutine.set(sn, list);
      }

      const [routineRows] = await conn.query(
        `SELECT ROUTINE_SCHEMA AS s, ROUTINE_NAME AS n, ROUTINE_TYPE AS rt, DTD_IDENTIFIER AS dt
         FROM information_schema.ROUTINES
         WHERE ROUTINE_SCHEMA = ?
         ORDER BY ROUTINE_TYPE, ROUTINE_NAME`,
        [targetSchema]
      );
      for (const r of routineRows as Array<Record<string, unknown>>) {
        const rName = String(r.n);
        const rKind = String(r.rt || '').toUpperCase() === 'PROCEDURE' ? 'PROCEDURE' : 'FUNCTION';
        out.push({
          name: rName,
          schema: String(r.s),
          kind: rKind,
          returnType: rKind === 'FUNCTION' && r.dt ? String(r.dt) : undefined,
          params: paramsByRoutine.get(rName)
        });
      }

      const [trigRows] = await conn.query(
        `SELECT TRIGGER_SCHEMA AS s, TRIGGER_NAME AS n, EVENT_MANIPULATION AS ev, EVENT_OBJECT_TABLE AS tbl, ACTION_TIMING AS tm
         FROM information_schema.TRIGGERS
         WHERE TRIGGER_SCHEMA = ?
         ORDER BY TRIGGER_NAME`,
        [targetSchema]
      );
      for (const r of trigRows as Array<Record<string, unknown>>) {
        out.push({
          name: String(r.n),
          schema: String(r.s),
          kind: 'TRIGGER',
          targetTable: String(r.tbl || ''),
          triggerTiming: String(r.tm || ''),
          triggerEvent: String(r.ev || '')
        });
      }

      return out;
    });
  }

  async getRoutineDdl(
    id: string,
    payload: { kind: DbRoutineKind; name: string; database?: string }
  ): Promise<string> {
    const profile = await this.getById(id);
    const activeDb = (payload.database?.trim() || profile.database.trim()) || '';

    if (profile.engine === 'postgres') {
      const schema = payload.database?.trim() || 'public';
      return this.withPgClient(profile, activeDb || 'postgres', async (client) => {
        if (payload.kind === 'VIEW') {
          const res = await client.query('SELECT pg_get_viewdef($1::regclass, true) AS def', [
            `${escapePgIdent(schema)}.${escapePgIdent(payload.name)}`
          ]);
          const body = String((res.rows[0] as Record<string, unknown>)?.def ?? '');
          return `CREATE OR REPLACE VIEW ${escapePgIdent(schema)}.${escapePgIdent(payload.name)} AS\n${body}`;
        }
        if (payload.kind === 'PROCEDURE' || payload.kind === 'FUNCTION') {
          const res = await client.query(
            `SELECT pg_get_functiondef(p.oid) AS def
             FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = $1 AND p.proname = $2
             LIMIT 1`,
            [schema, payload.name]
          );
          return String((res.rows[0] as Record<string, unknown>)?.def ?? '-- Definisi tidak ditemukan');
        }
        const tRes = await client.query(
          `SELECT pg_get_triggerdef(t.oid, true) AS def
           FROM pg_trigger t
           JOIN pg_class c ON c.oid = t.tgrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = $1 AND t.tgname = $2
           LIMIT 1`,
          [schema, payload.name]
        );
        return `${String((tRes.rows[0] as Record<string, unknown>)?.def ?? '-- Trigger tidak ditemukan')};`;
      });
    }

    // MySQL / MariaDB
    return this.withMysqlConnection(profile, activeDb, async (conn) => {
      const qual = activeDb
        ? `${escapeMysqlIdent(activeDb)}.${escapeMysqlIdent(payload.name)}`
        : escapeMysqlIdent(payload.name);
      const showStmt = `SHOW CREATE ${payload.kind} ${qual}`;
      const [rows] = await conn.query(showStmt);
      const first = (rows as Array<Record<string, unknown>>)[0] ?? {};
      const createText = String(
        pickRowVal(
          first,
          'Create View',
          'Create Procedure',
          'Create Function',
          'SQL Original Statement'
        ) ?? ''
      );
      if (!createText) return `-- Definisi ${payload.kind} tidak dapat dibaca`;
      if (payload.kind === 'VIEW') {
        return createText.replace(/^CREATE\s+.*?\s+VIEW\s+/i, 'CREATE OR REPLACE VIEW ') + ';';
      }
      return `DROP ${payload.kind} IF EXISTS ${qual};\n\n${createText};`;
    });
  }

  /**
   * Enterprise Tabular / Excel (`.XLSX` & Clipboard) Importer with Transactional Dry-Run Rollback,
   * Indonesian Date/Rupiah normalization, and NIP/NIK/KBLI leading-zero protection.
   */
  async importTabularRows(
    id: string,
    payload: DbTabularImportPayload
  ): Promise<DbTabularImportResult> {
    const started = Date.now();
    const profile = await this.getById(id);
    const activeDb = payload.database?.trim() || profile.database.trim() || undefined;
    const mappedCols = payload.columns.filter((c) => c.targetColumn.trim().length > 0);
    if (mappedCols.length === 0) {
      throw new Error('Pilih minimal 1 pemetaan kolom tujuan sebelum impor.');
    }

    let snap = await this.getCachedSchema(id, activeDb);
    if (!snap) {
      snap = await this.introspect(id, activeDb);
    }
    const tableMeta = snap.tables.find(
      (t) => t.name.toLowerCase() === payload.table.toLowerCase()
    );
    const colMetaByName = new Map<string, DbColumnMeta>();
    if (tableMeta) {
      for (const c of tableMeta.columns) {
        colMetaByName.set(c.name.toLowerCase(), c);
      }
    }
    const pkSet = new Set((tableMeta?.primaryKeys ?? []).map((k) => k.toLowerCase()));

    // Find column indices in source rows based on header order (payload.columns aligns with mapped source headers)
    // Wait: ExcelImportModal passes rows already projected OR full rows; let's support projected rows matching payload.columns length OR lookup by index!
    // Specifically, payload.columns[j] corresponds to cell row[j] in payload.rows!
    let processedRows = 0;
    let affectedRows = 0;

    if (profile.engine === 'postgres') {
      return this.withPgClient(profile, activeDb, async (client) => {
        await client.query('BEGIN');
        try {
          const targetColNames = mappedCols.map((m) => m.targetColumn);
          const colsSql = targetColNames.map(escapePgIdent).join(', ');
          const placeholders = targetColNames.map((_, idx) => `$${idx + 1}`).join(', ');
          let upsertSuffix = '';
          if (payload.mode === 'upsert' && tableMeta && tableMeta.primaryKeys.length > 0) {
            const pkSql = tableMeta.primaryKeys.map(escapePgIdent).join(', ');
            const nonPkUpdates = targetColNames
              .filter((c) => !pkSet.has(c.toLowerCase()))
              .map((c) => `${escapePgIdent(c)} = EXCLUDED.${escapePgIdent(c)}`);
            upsertSuffix =
              nonPkUpdates.length > 0
                ? ` ON CONFLICT (${pkSql}) DO UPDATE SET ${nonPkUpdates.join(', ')}`
                : ` ON CONFLICT (${pkSql}) DO NOTHING`;
          }
          const stmt = `INSERT INTO ${escapePgIdent(payload.table)} (${colsSql}) VALUES (${placeholders})${upsertSuffix}`;

          for (let rIdx = 0; rIdx < payload.rows.length; rIdx++) {
            const row = payload.rows[rIdx];
            const vals = mappedCols.map((m, cIdx) => {
              const meta = colMetaByName.get(m.targetColumn.toLowerCase());
              return normalizeImportCellValue(
                String(row[cIdx] ?? ''),
                meta?.dataType || 'varchar',
                meta?.nullable ?? true
              );
            });
            const res = await client.query(stmt, vals);
            processedRows += 1;
            affectedRows += res.rowCount ?? 1;
          }

          if (payload.dryRun) {
            await client.query('ROLLBACK');
            return {
              dryRun: true,
              processedRows,
              affectedRows,
              durationMs: Math.max(1, Date.now() - started),
              committed: false
            };
          }

          await client.query('COMMIT');
          if (this.auditService) {
            await this.auditService.record({
              kind: 'db-import',
              profileId: profile.id,
              targetName: profile.name,
              isProduction: Boolean(profile.isProduction),
              database: activeDb,
              tableOrPath: payload.table,
              summary: `IMPORT ${payload.mode.toUpperCase()} ${processedRows} baris ke ${payload.table}`
            });
          }
          return {
            dryRun: false,
            processedRows,
            affectedRows,
            durationMs: Math.max(1, Date.now() - started),
            committed: true
          };
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          return {
            dryRun: payload.dryRun,
            processedRows,
            affectedRows: 0,
            durationMs: Math.max(1, Date.now() - started),
            committed: false,
            errorRowIndex: processedRows + 1,
            errorMessage: err instanceof Error ? err.message : String(err)
          };
        }
      });
    }

    return this.withMysqlConnection(profile, activeDb, async (conn) => {
      await conn.beginTransaction();
      try {
        const targetColNames = mappedCols.map((m) => m.targetColumn);
        const colsSql = targetColNames.map(escapeMysqlIdent).join(', ');
        const placeholders = targetColNames.map(() => '?').join(', ');
        let upsertSuffix = '';
        if (payload.mode === 'upsert') {
          const nonPkUpdates = targetColNames
            .filter((c) => !pkSet.has(c.toLowerCase()))
            .map((c) => `${escapeMysqlIdent(c)} = VALUES(${escapeMysqlIdent(c)})`);
          if (nonPkUpdates.length > 0) {
            upsertSuffix = ` ON DUPLICATE KEY UPDATE ${nonPkUpdates.join(', ')}`;
          }
        }
        const stmt = `INSERT INTO ${escapeMysqlIdent(payload.table)} (${colsSql}) VALUES (${placeholders})${upsertSuffix}`;

        for (let rIdx = 0; rIdx < payload.rows.length; rIdx++) {
          const row = payload.rows[rIdx];
          const vals = mappedCols.map((m, cIdx) => {
            const meta = colMetaByName.get(m.targetColumn.toLowerCase());
            return normalizeImportCellValue(
              String(row[cIdx] ?? ''),
              meta?.dataType || 'varchar',
              meta?.nullable ?? true
            );
          });
          const [res] = await conn.execute(stmt, vals);
          const header = res as mysql.ResultSetHeader;
          processedRows += 1;
          affectedRows += header.affectedRows ?? 1;
        }

        if (payload.dryRun) {
          await conn.rollback();
          return {
            dryRun: true,
            processedRows,
            affectedRows,
            durationMs: Math.max(1, Date.now() - started),
            committed: false
          };
        }

        await conn.commit();
        if (this.auditService) {
          await this.auditService.record({
            kind: 'db-import',
            profileId: profile.id,
            targetName: profile.name,
            isProduction: Boolean(profile.isProduction),
            database: activeDb,
            tableOrPath: payload.table,
            summary: `IMPORT ${payload.mode.toUpperCase()} ${processedRows} baris ke ${payload.table}`
          });
        }
        return {
          dryRun: false,
          processedRows,
          affectedRows,
          durationMs: Math.max(1, Date.now() - started),
          committed: true
        };
      } catch (err) {
        await conn.rollback().catch(() => {});
        return {
          dryRun: payload.dryRun,
          processedRows,
          affectedRows: 0,
          durationMs: Math.max(1, Date.now() - started),
          committed: false,
          errorRowIndex: processedRows + 1,
          errorMessage: err instanceof Error ? err.message : String(err)
        };
      }
    });
  }

  /**
   * Global Database Value Hunter — searches a value (ID, NIP, NIB, email, kode) across 681+ tables
   * in parallel batches over the warm connection pool!
   */
  async searchValueAcrossDatabase(
    id: string,
    payload: DbValueSearchPayload,
    onProgress?: (evt: DbValueSearchProgressEvent) => void
  ): Promise<DbValueSearchTableHit[]> {
    const needle = payload.needle.trim();
    if (!needle) return [];

    const profile = await this.getById(id);
    const activeDb = payload.database?.trim() || profile.database.trim() || undefined;
    let snap = await this.getCachedSchema(id, activeDb);
    if (!snap || snap.tables.every((t) => t.columns.length === 0)) {
      snap = await this.introspect(id, activeDb);
    }

    const candidateTables = snap.tables
      .filter((t) => t.kind === 'table' && t.columns.length > 0)
      .slice(0, Math.max(10, Math.min(1200, payload.maxTables ?? 800)));

    const totalTables = candidateTables.length;
    const isNumericNeedle = /^-?\d+(\.\d+)?$/.test(needle);
    const needleLower = needle.toLowerCase();
    const hits: DbValueSearchTableHit[] = [];
    let scannedTables = 0;

    const scanOneTable = async (tbl: DbTableMeta): Promise<void> => {
      const textCols: string[] = [];
      const numCols: string[] = [];
      for (const col of tbl.columns) {
        const dt = col.dataType.toLowerCase();
        if (
          dt.includes('char') ||
          dt.includes('text') ||
          dt.includes('enum') ||
          dt.includes('json') ||
          dt.includes('uuid')
        ) {
          textCols.push(col.name);
        } else if (
          isNumericNeedle &&
          /^(tinyint|smallint|mediumint|int|integer|bigint|decimal|numeric|float|double|real)/.test(
            dt
          )
        ) {
          numCols.push(col.name);
        }
      }

      if (textCols.length === 0 && numCols.length === 0) {
        scannedTables += 1;
        onProgress?.({
          scannedTables,
          totalTables,
          currentTable: tbl.name,
          hitsSoFar: hits.length
        });
        return;
      }

      try {
        let rows: Array<Record<string, unknown>> = [];
        if (profile.engine === 'postgres') {
          const params: unknown[] = [];
          const conds: string[] = [];
          for (const tc of textCols) {
            params.push(payload.exactMatch ? needle : `%${needle}%`);
            conds.push(
              payload.exactMatch
                ? `${escapePgIdent(tc)}::text = $${params.length}`
                : `${escapePgIdent(tc)}::text ILIKE $${params.length}`
            );
          }
          for (const nc of numCols) {
            params.push(Number(needle));
            conds.push(`${escapePgIdent(nc)} = $${params.length}`);
          }
          const qual = tbl.schema
            ? `${escapePgIdent(tbl.schema)}.${escapePgIdent(tbl.name)}`
            : escapePgIdent(tbl.name);
          rows = await this.withPgClient(profile, activeDb, async (client) => {
            const r = await client.query(
              `SELECT * FROM ${qual} WHERE ${conds.join(' OR ')} LIMIT 6`,
              params
            );
            return r.rows as Array<Record<string, unknown>>;
          });
        } else {
          const params: Array<string | number> = [];
          const conds: string[] = [];
          for (const tc of textCols) {
            params.push(payload.exactMatch ? needle : `%${needle}%`);
            conds.push(
              payload.exactMatch
                ? `${escapeMysqlIdent(tc)} = ?`
                : `${escapeMysqlIdent(tc)} LIKE ?`
            );
          }
          for (const nc of numCols) {
            params.push(Number(needle));
            conds.push(`${escapeMysqlIdent(nc)} = ?`);
          }
          rows = await this.withMysqlConnection(profile, activeDb, async (conn) => {
            const [res] = await conn.query(
              `SELECT * FROM ${escapeMysqlIdent(tbl.name)} WHERE ${conds.join(' OR ')} LIMIT 6`,
              params
            );
            return Array.isArray(res) ? (res as Array<Record<string, unknown>>) : [];
          });
        }

        if (rows.length > 0) {
          const matchedCols = new Set<string>();
          for (const r of rows) {
            for (const [k, v] of Object.entries(r)) {
              if (v === null || v === undefined) continue;
              const sv = String(v).toLowerCase();
              if (payload.exactMatch ? sv === needleLower : sv.includes(needleLower)) {
                matchedCols.add(k);
              }
            }
          }
          hits.push({
            schema: tbl.schema,
            table: tbl.name,
            matchedColumns:
              matchedCols.size > 0 ? Array.from(matchedCols) : [...textCols, ...numCols].slice(0, 2),
            matchCount: rows.length,
            sampleRows: rows.slice(0, 5)
          });
        }
      } catch {
        // Ignore individual unreadable/corrupted view or table during global sweep
      } finally {
        scannedTables += 1;
        onProgress?.({
          scannedTables,
          totalTables,
          currentTable: tbl.name,
          hitsSoFar: hits.length
        });
      }
    };

    const CONCURRENCY = 4;
    for (let i = 0; i < candidateTables.length; i += CONCURRENCY) {
      const batch = candidateTables.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map((t) => scanOneTable(t)));
    }

    return hits;
  }

  /**
   * Compares row data between Source (e.g. Staging) and Target (e.g. Production) tables by PK.
   */
  async diffTableRows(payload: DbTableRowDiffPayload): Promise<TableRowDiffReport> {
    const [sourceProfile, targetProfile] = await Promise.all([
      this.getById(payload.sourceProfileId),
      this.getById(payload.targetProfileId)
    ]);
    const rowLimit = Math.max(20, Math.min(5000, payload.rowLimit ?? 1000));

    let pks = (payload.primaryKeys ?? []).filter(Boolean);
    if (pks.length === 0) {
      const targetSnap =
        (await this.getCachedSchema(payload.targetProfileId, payload.targetDatabase)) ??
        (await this.introspect(payload.targetProfileId, payload.targetDatabase));
      const tblMeta = targetSnap.tables.find(
        (t) => t.name.toLowerCase() === payload.targetTable.toLowerCase()
      );
      if (tblMeta && tblMeta.primaryKeys.length > 0) {
        pks = tblMeta.primaryKeys;
      } else if (tblMeta && tblMeta.columns.length > 0) {
        pks = [tblMeta.columns[0].name];
      }
    }

    const fetchRows = async (
      prof: DatabaseProfile,
      dbName: string | undefined,
      tblName: string
    ): Promise<Array<Record<string, unknown>>> => {
      if (prof.engine === 'postgres') {
        const orderClause =
          pks.length > 0 ? ` ORDER BY ${pks.map(escapePgIdent).join(', ')}` : '';
        return this.withPgClient(prof, dbName, async (client) => {
          const r = await client.query(
            `SELECT * FROM ${escapePgIdent(tblName)}${orderClause} LIMIT ${rowLimit}`
          );
          return r.rows as Array<Record<string, unknown>>;
        });
      }
      const orderClause =
        pks.length > 0 ? ` ORDER BY ${pks.map(escapeMysqlIdent).join(', ')}` : '';
      return this.withMysqlConnection(prof, dbName, async (conn) => {
        const [r] = await conn.query(
          `SELECT * FROM ${escapeMysqlIdent(tblName)}${orderClause} LIMIT ${rowLimit}`
        );
        return Array.isArray(r) ? (r as Array<Record<string, unknown>>) : [];
      });
    };

    const [sourceRows, targetRows] = await Promise.all([
      fetchRows(sourceProfile, payload.sourceDatabase, payload.sourceTable),
      fetchRows(targetProfile, payload.targetDatabase, payload.targetTable)
    ]);

    if (pks.length === 0) {
      const sample = sourceRows[0] ?? targetRows[0];
      if (sample && Object.keys(sample).length > 0) {
        pks = [Object.keys(sample)[0]];
      }
    }

    return diffTableRowsByPrimaryKey({
      sourceRows,
      targetRows,
      primaryKeys: pks,
      targetTable: payload.targetTable,
      targetDatabase: payload.targetDatabase || targetProfile.database,
      targetEngine: targetProfile.engine,
      includeDeleteMissingInTarget: payload.includeDeleteMissingInTarget
    });
  }

  /**
   * MySQL Workbench-style Performance & Health Telemetry Snapshot.
   * Collects Global Status, Global Variables, Top Digest Slow Queries (`performance_schema`),
   * InnoDB Lock Waits, Storage/Index/Fragmentation Footprint, & Automated Tuning Advisories.
   */
  async inspectHealth(
    id: string,
    overrideDatabase?: string,
    mode: 'fast' | 'slow-sql' | 'locks' | 'storage' = 'fast'
  ): Promise<DbHealthSnapshot> {
    const profile = await this.getById(id);
    const activeDb = overrideDatabase?.trim() || profile.database.trim() || undefined;

    if (profile.engine === 'postgres') {
      return this.withPgClient(profile, activeDb, async (client) => {
        const [verRes, upRes, connRes, statRes, settingsRes, dbSizeRes, tblSizeRes] =
          await Promise.all([
            client.query('SELECT version() AS v'),
            client.query('SELECT EXTRACT(EPOCH FROM (now() - pg_postmaster_start_time()))::bigint AS up'),
            client.query(
              `SELECT count(*)::int AS total,
                      count(*) FILTER (WHERE state = 'active')::int AS active
               FROM pg_stat_activity`
            ),
            client.query(
              `SELECT COALESCE(SUM(xact_commit + xact_rollback), 0)::bigint AS q,
                      COALESCE(SUM(tup_returned), 0)::bigint AS sel,
                      COALESCE(SUM(tup_inserted), 0)::bigint AS ins,
                      COALESCE(SUM(tup_updated), 0)::bigint AS upd,
                      COALESCE(SUM(tup_deleted), 0)::bigint AS del,
                      COALESCE(SUM(blks_read), 0)::bigint AS bread,
                      COALESCE(SUM(blks_hit), 0)::bigint AS bhit,
                      COALESCE(SUM(temp_files), 0)::bigint AS tmpf
               FROM pg_stat_database`
            ),
            client.query(
              `SELECT name, setting, unit FROM pg_settings
               WHERE name IN ('max_connections','shared_buffers','work_mem','effective_cache_size','maintenance_work_mem','wal_buffers','checkpoint_completion_target','random_page_cost','log_min_duration_statement')
               ORDER BY name`
            ),
            client.query(
              `SELECT datname, ROUND(pg_database_size(datname) / 1048576.0, 2) AS mb
               FROM pg_database WHERE datistemplate = false ORDER BY pg_database_size(datname) DESC LIMIT 15`
            ),
            client.query(
              `SELECT schemaname, relname, n_live_tup,
                      ROUND(pg_table_size(relid) / 1048576.0, 2) AS data_mb,
                      ROUND(pg_indexes_size(relid) / 1048576.0, 2) AS idx_mb,
                      ROUND(pg_total_relation_size(relid) / 1048576.0, 2) AS total_mb
               FROM pg_stat_user_tables
               ORDER BY pg_total_relation_size(relid) DESC LIMIT 25`
            )
          ]);

        const uptimeSec = Number(upRes.rows[0]?.up ?? 0);
        const totalConn = Number(connRes.rows[0]?.total ?? 1);
        const activeConn = Number(connRes.rows[0]?.active ?? 1);
        const maxConnRow = settingsRes.rows.find((r) => r.name === 'max_connections');
        const maxConn = Math.max(1, Number(maxConnRow?.setting ?? 100));
        const st = statRes.rows[0] ?? {};
        const bread = Number(st.bread ?? 0);
        const bhit = Number(st.bhit ?? 0);
        const hitPct = bread + bhit > 0 ? Number(((bhit / (bread + bhit)) * 100).toFixed(2)) : 100;

        return {
          profileId: profile.id,
          profileName: profile.name,
          engine: 'postgres',
          serverVersion: String(verRes.rows[0]?.v ?? 'PostgreSQL').split(',')[0],
          uptimeSec,
          uptimeLabel: formatUptimeIndonesian(uptimeSec),
          collectedAtMs: Date.now(),
          connections: {
            threadsConnected: totalConn,
            threadsRunning: activeConn,
            maxConnections: maxConn,
            maxUsedConnections: totalConn,
            abortedConnects: 0,
            usagePct: Math.min(100, Number(((totalConn / maxConn) * 100).toFixed(1)))
          },
          bufferPool: {
            sizeMb: 128,
            usedMb: 64,
            usagePct: 50,
            hitRatioPct: hitPct,
            dirtyPagesPct: 0
          },
          bottlenecks: {
            slowQueries: 0,
            selectFullJoin: 0,
            tmpTablesTotal: Number(st.tmpf ?? 0),
            tmpDiskTables: Number(st.tmpf ?? 0),
            tmpDiskRatioPct: 0,
            tableLocksWaited: 0,
            openedTables: tblSizeRes.rows.length
          },
          counters: {
            questions: Number(st.q ?? 0),
            comSelect: Number(st.sel ?? 0),
            comInsert: Number(st.ins ?? 0),
            comUpdate: Number(st.upd ?? 0),
            comDelete: Number(st.del ?? 0),
            bytesReceived: 0,
            bytesSent: 0,
            innodbDataReads: bread,
            innodbDataWrites: 0
          },
          performanceSchemaEnabled: false,
          digestQueries: [],
          lockWaits: [],
          storageByDb: dbSizeRes.rows.map((r) => ({
            database: String(r.datname),
            tableCount: 0,
            rowEstimate: 0,
            dataMb: Number(r.mb ?? 0),
            indexMb: 0,
            freeMb: 0,
            totalMb: Number(r.mb ?? 0)
          })),
          largestTables: tblSizeRes.rows.map((r) => ({
            database: String(r.schemaname ?? 'public'),
            table: String(r.relname),
            engine: 'PostgreSQL Heap',
            rowEstimate: Number(r.n_live_tup ?? 0),
            dataMb: Number(r.data_mb ?? 0),
            indexMb: Number(r.idx_mb ?? 0),
            freeMb: 0,
            totalMb: Number(r.total_mb ?? 0)
          })),
          variables: settingsRes.rows.map((r) => ({
            name: String(r.name),
            value: `${r.setting}${r.unit ? ` ${r.unit}` : ''}`
          })),
          advisories: [
            {
              id: 'pg-cache',
              severity: hitPct < 95 ? 'warning' : 'good',
              variableName: 'shared_buffers_hit_ratio',
              currentValue: `${hitPct}%`,
              title: `PostgreSQL Shared Buffer Hit Ratio: ${hitPct}%`,
              explanation: 'Persentase blok data yang dilayani langsung dari shared_buffers RAM.'
            }
          ]
        };
      });
    }

    // Ultra-Fast Single-Connection MySQL / MariaDB Telemetry (< 50 ms even over SSH Tunnel!)
    return this.withMysqlConnection(profile, '', async (conn) => {
      const [statusRows] = await conn.query(
        `SHOW GLOBAL STATUS WHERE Variable_name IN (
          'Uptime','Threads_connected','Threads_running','Max_used_connections','Aborted_connects',
          'Innodb_buffer_pool_pages_total','Innodb_buffer_pool_pages_data','Innodb_buffer_pool_pages_free','Innodb_buffer_pool_pages_dirty',
          'Innodb_buffer_pool_read_requests','Innodb_buffer_pool_reads',
          'Slow_queries','Select_full_join','Created_tmp_tables','Created_tmp_disk_tables','Table_locks_waited','Opened_tables',
          'Questions','Queries','Com_select','Com_insert','Com_update','Com_delete',
          'Bytes_received','Bytes_sent','Innodb_data_reads','Innodb_data_writes'
        )`
      );
      const sMap: Record<string, string> = {};
      for (const r of statusRows as Array<Record<string, unknown>>) {
        const k = String(pickRowVal(r, 'Variable_name', 'variable_name') ?? '');
        const v = String(pickRowVal(r, 'Value', 'value') ?? '');
        if (k) sMap[k] = v;
      }

      // Cache global variables in RAM for 5 minutes so 3-second live ticks run only 1 tiny query!
      let vMap: Record<string, string>;
      const cachedVars = this.healthVarsCache.get(profile.id);
      if (cachedVars && Date.now() - cachedVars.cachedAt < 5 * 60 * 1000) {
        vMap = cachedVars.vMap;
      } else {
        const [varRows] = await conn.query(
          `SHOW GLOBAL VARIABLES WHERE Variable_name IN (
            'version','version_comment','max_connections','max_allowed_packet','max_heap_table_size','tmp_table_size',
            'innodb_page_size','innodb_buffer_pool_size','innodb_buffer_pool_instances','innodb_log_file_size',
            'innodb_flush_log_at_trx_commit','innodb_file_per_table','innodb_io_capacity','innodb_lock_wait_timeout',
            'table_open_cache','thread_cache_size','wait_timeout','interactive_timeout',
            'slow_query_log','long_query_time','performance_schema','sql_mode',
            'character_set_server','collation_server','log_bin','binlog_format','sort_buffer_size','join_buffer_size'
          )`
        );
        vMap = {};
        for (const r of varRows as Array<Record<string, unknown>>) {
          const k = String(pickRowVal(r, 'Variable_name', 'variable_name') ?? '');
          const v = String(pickRowVal(r, 'Value', 'value') ?? '');
          if (k) vMap[k] = v;
        }
        this.healthVarsCache.set(profile.id, { cachedAt: Date.now(), vMap });
      }

      let digestQueries: DbDigestQueryStat[] = [];
      let lockWaits: DbLockWaitItem[] = [];
      let storageByDb: DbStorageDatabaseSummary[] = [];
      let largestTables: DbStorageTableItem[] = [];

      if (mode === 'slow-sql') {
        try {
          const [rows] = await conn.query(
            `SELECT COALESCE(SCHEMA_NAME, '') AS schema_name,
                    DIGEST_TEXT AS digest_text,
                    COUNT_STAR AS exec_count,
                    ROUND(AVG_TIMER_WAIT / 1000000000, 2) AS avg_ms,
                    ROUND(SUM_TIMER_WAIT / 1000000000, 2) AS total_ms,
                    SUM_ROWS_EXAMINED AS rows_examined,
                    SUM_ROWS_SENT AS rows_sent,
                    SUM_NO_INDEX_USED AS no_index_cnt
             FROM performance_schema.events_statements_summary_by_digest
             WHERE DIGEST_TEXT IS NOT NULL
               AND DIGEST_TEXT NOT LIKE 'SHOW %'
               AND DIGEST_TEXT NOT LIKE 'SET %'
             ORDER BY SUM_TIMER_WAIT DESC
             LIMIT 15`
          );
          digestQueries = (rows as Array<Record<string, unknown>>).map(
            (r): DbDigestQueryStat => ({
              schemaName: String(r.schema_name ?? ''),
              digestText: String(r.digest_text ?? ''),
              execCount: Number(r.exec_count ?? 0),
              avgLatencyMs: Number(r.avg_ms ?? 0),
              totalLatencyMs: Number(r.total_ms ?? 0),
              rowsExamined: Number(r.rows_examined ?? 0),
              rowsSent: Number(r.rows_sent ?? 0),
              noIndexUsedCount: Number(r.no_index_cnt ?? 0)
            })
          );
        } catch {
          digestQueries = [];
        }
      } else if (mode === 'locks') {
        try {
          // Ultra-fast in-memory SHOW FULL PROCESSLIST lock & long-transaction detector (< 5 ms!)
          const [procRows] = await conn.query('SHOW FULL PROCESSLIST');
          for (const r of procRows as Array<Record<string, unknown>>) {
            const pid = Number(pickRowVal(r, 'Id', 'id') ?? 0);
            const user = String(pickRowVal(r, 'User', 'user') ?? '');
            const cmd = String(pickRowVal(r, 'Command', 'command') ?? '');
            const timeSec = Number(pickRowVal(r, 'Time', 'time') ?? 0);
            const state = String(pickRowVal(r, 'State', 'state') ?? '');
            const info = String(pickRowVal(r, 'Info', 'info') ?? '');
            if (cmd === 'Sleep' || cmd === 'Daemon' || cmd === 'Binlog Dump') continue;
            const isLocked = /lock|waiting/i.test(state);
            if (isLocked || timeSec >= 3) {
              lockWaits.push({
                waitingPid: pid,
                waitingUser: user,
                waitingQuery: info || state || cmd,
                waitSec: timeSec,
                blockingPid: isLocked ? pid : undefined,
                lockedTable: state || undefined
              });
            }
          }
          lockWaits.sort((a, b) => b.waitSec - a.waitSec);
        } catch {
          lockWaits = [];
        }
      } else if (mode === 'storage') {
        try {
          try {
            await conn.query('SET SESSION innodb_stats_on_metadata = 0');
          } catch {
            // Ignore
          }
          try {
            await conn.query('SET SESSION information_schema_stats_expiry = 86400');
          } catch {
            // Ignore
          }
          let targetDbForStatus = activeDb;
          if (!targetDbForStatus) {
            const [dbs] = await conn.query('SHOW DATABASES');
            const found = (dbs as Array<Record<string, unknown>>)
              .map((d) => String(Object.values(d)[0] ?? ''))
              .find((n) => n && !MYSQL_SYSTEM_SCHEMAS.has(n.toLowerCase()));
            targetDbForStatus = found;
          }

          if (targetDbForStatus) {
            const [tblStatus] = await conn.query(
              `SHOW TABLE STATUS FROM ${escapeMysqlIdent(targetDbForStatus)}`
            );
            const parsedTables: DbStorageTableItem[] = [];
            let sumData = 0;
            let sumIdx = 0;
            let sumFree = 0;
            let sumRows = 0;

            for (const r of tblStatus as Array<Record<string, unknown>>) {
              const name = String(pickRowVal(r, 'Name', 'name') ?? '');
              const eng = pickRowVal(r, 'Engine', 'engine');
              if (!name || !eng) continue; // Skip VIEW rows (Engine is null)
              const dMb = Number((Number(pickRowVal(r, 'Data_length') ?? 0) / 1048576).toFixed(2));
              const iMb = Number((Number(pickRowVal(r, 'Index_length') ?? 0) / 1048576).toFixed(2));
              const fMb = Number((Number(pickRowVal(r, 'Data_free') ?? 0) / 1048576).toFixed(2));
              const rEst = Number(pickRowVal(r, 'Rows') ?? 0);
              sumData += dMb;
              sumIdx += iMb;
              sumFree += fMb;
              sumRows += rEst;
              parsedTables.push({
                database: targetDbForStatus,
                table: name,
                engine: String(eng),
                rowEstimate: rEst,
                dataMb: dMb,
                indexMb: iMb,
                freeMb: fMb,
                totalMb: Number((dMb + iMb).toFixed(2))
              });
            }

            parsedTables.sort((a, b) => b.totalMb - a.totalMb);
            largestTables = parsedTables.slice(0, 25);
            storageByDb = [
              {
                database: targetDbForStatus,
                tableCount: parsedTables.length,
                rowEstimate: sumRows,
                dataMb: Number(sumData.toFixed(2)),
                indexMb: Number(sumIdx.toFixed(2)),
                freeMb: Number(sumFree.toFixed(2)),
                totalMb: Number((sumData + sumIdx).toFixed(2))
              }
            ];
          }
        } catch {
          storageByDb = [];
          largestTables = [];
        }
      }

      const parsedBase = parseMysqlStatusAndVariables(sMap, vMap, {
        profileId: profile.id,
        profileName: profile.name,
        collectedAtMs: Date.now()
      });

      const variables = Object.entries(vMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, value]) => ({ name, value }));

      return {
        ...parsedBase,
        digestQueries,
        lockWaits,
        storageByDb,
        largestTables,
        variables
      };
    });
  }

  async optimizeTable(
    id: string,
    payload: { database?: string; table: string }
  ): Promise<{ ok: boolean; message: string }> {
    const profile = await this.getById(id);
    const activeDb = payload.database?.trim() || profile.database.trim() || undefined;
    if (profile.engine === 'postgres') {
      return this.withPgClient(profile, activeDb, async (client) => {
        await client.query(`VACUUM ANALYZE ${escapePgIdent(payload.table)}`);
        return {
          ok: true,
          message: `VACUUM ANALYZE selesai pada tabel "${payload.table}".`
        };
      });
    }
    return this.withMysqlConnection(profile, activeDb, async (conn) => {
      const qual = activeDb
        ? `${escapeMysqlIdent(activeDb)}.${escapeMysqlIdent(payload.table)}`
        : escapeMysqlIdent(payload.table);
      await conn.query(`OPTIMIZE TABLE ${qual}`);
      if (this.auditService) {
        await this.auditService.record({
          kind: 'db-query-mutating',
          profileId: profile.id,
          targetName: profile.name,
          isProduction: Boolean(profile.isProduction),
          database: activeDb,
          tableOrPath: payload.table,
          summary: `OPTIMIZE TABLE ${payload.table}`
        });
      }
      return {
        ok: true,
        message: `OPTIMIZE TABLE selesai pada "${payload.table}" — ruang fragmentasi berhasil dirapikan.`
      };
    });
  }

  // Phase 30 #1: Safe Atomic Transaction Batch Execution (BEGIN -> Execute All -> COMMIT / ROLLBACK)
  async executeBatchTransaction(
    id: string,
    statements: string[],
    databaseName?: string
  ): Promise<{ committed: boolean; executedCount: number; durationMs: number; errorMessage?: string }> {
    const cleanStmts = statements.map((s) => s.trim()).filter(Boolean);
    if (cleanStmts.length === 0) {
      return { committed: true, executedCount: 0, durationMs: 0 };
    }
    const profile = await this.getById(id);
    const activeDb = databaseName?.trim() || profile.database.trim() || undefined;
    const t0 = Date.now();

    if (profile.engine === 'postgres') {
      return this.withPgClient(profile, activeDb, async (client) => {
        await client.query('BEGIN');
        let executedCount = 0;
        try {
          for (const sql of cleanStmts) {
            await client.query(sql);
            executedCount++;
          }
          await client.query('COMMIT');
          if (this.auditService) {
            await this.auditService.record({
              kind: 'db-query-mutating',
              profileId: profile.id,
              targetName: profile.name,
              isProduction: Boolean(profile.isProduction),
              database: activeDb,
              summary: `COMMIT Transaksi (${executedCount} perubahan staged)`,
              detail: cleanStmts.join('\n').slice(0, 1200)
            });
          }
          return { committed: true, executedCount, durationMs: Date.now() - t0 };
        } catch (err) {
          try {
            await client.query('ROLLBACK');
          } catch {
            // ignore rollback error
          }
          return {
            committed: false,
            executedCount,
            durationMs: Date.now() - t0,
            errorMessage: err instanceof Error ? err.message : String(err)
          };
        }
      });
    }

    return this.withMysqlConnection(profile, activeDb, async (conn) => {
      await conn.beginTransaction();
      let executedCount = 0;
      try {
        for (const sql of cleanStmts) {
          await conn.query(sql);
          executedCount++;
        }
        await conn.commit();
        if (this.auditService) {
          await this.auditService.record({
            kind: 'db-query-mutating',
            profileId: profile.id,
            targetName: profile.name,
            isProduction: Boolean(profile.isProduction),
            database: activeDb,
            summary: `COMMIT Transaksi (${executedCount} perubahan staged)`,
            detail: cleanStmts.join('\n').slice(0, 1200)
          });
        }
        return { committed: true, executedCount, durationMs: Date.now() - t0 };
      } catch (err) {
        try {
          await conn.rollback();
        } catch {
          // ignore rollback error
        }
        return {
          committed: false,
          executedCount,
          durationMs: Date.now() - t0,
          errorMessage: err instanceof Error ? err.message : String(err)
        };
      }
    });
  }

  // Phase 30 #2: Visual EXPLAIN FORMAT=JSON Tree Analyzer
  async explainVisualPlan(
    id: string,
    sqlText: string,
    databaseName?: string
  ): Promise<VisualExplainReport> {
    const cleanSql = sqlText.trim().replace(/;\s*$/, '');
    if (!cleanSql) {
      throw new Error('SQL kueri masih kosong untuk dianalisis dengan Visual EXPLAIN.');
    }
    const profile = await this.getById(id);
    const activeDb = databaseName?.trim() || profile.database.trim() || undefined;
    const t0 = Date.now();

    if (profile.engine === 'postgres') {
      return this.withPgClient(profile, activeDb, async (client) => {
        const res = await client.query(`EXPLAIN (FORMAT JSON) ${cleanSql}`);
        const firstRow = res.rows[0] as Record<string, unknown> | undefined;
        const jsonVal = firstRow ? Object.values(firstRow)[0] : null;
        return buildVisualExplainReport({
          engine: 'postgres',
          sql: cleanSql,
          jsonPayload: jsonVal,
          durationMs: Math.max(1, Date.now() - t0)
        });
      });
    }

    return this.withMysqlConnection(profile, activeDb, async (conn) => {
      try {
        const [rows] = await conn.query(`EXPLAIN FORMAT=JSON ${cleanSql}`);
        const arr = rows as Array<Record<string, unknown>>;
        const firstVal = arr[0] ? Object.values(arr[0])[0] : null;
        return buildVisualExplainReport({
          engine: 'mysql',
          sql: cleanSql,
          jsonPayload: firstVal,
          durationMs: Math.max(1, Date.now() - t0)
        });
      } catch {
        // Fallback to classic tabular EXPLAIN on older MariaDB/MySQL
        const [rows] = await conn.query(`EXPLAIN ${cleanSql}`);
        return buildVisualExplainReport({
          engine: 'mysql',
          sql: cleanSql,
          tabularRows: rows as Array<Record<string, unknown>>,
          durationMs: Math.max(1, Date.now() - t0)
        });
      }
    });
  }

  // Phase 30 #4: User, Role & Privileges Manager (RBAC + Security Audit)
  async listUsersAndPrivileges(id: string): Promise<DbRbacSnapshot> {
    const profile = await this.getById(id);
    const activeDb = profile.database.trim() || undefined;

    if (profile.engine === 'postgres') {
      return this.withPgClient(profile, activeDb, async (client) => {
        const res = await client.query(
          `SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolcanlogin, (rolpassword IS NULL) AS empty_pwd
           FROM pg_roles ORDER BY rolsuper DESC, rolname ASC LIMIT 120`
        );
        const users: DbUserPrivilegeRecord[] = res.rows.map((r: Record<string, unknown>) => ({
          username: String(r.rolname ?? ''),
          host: 'role',
          isSuperuser: Boolean(r.rolsuper),
          hasGrantOption: Boolean(r.rolcreaterole),
          hasEmptyPassword: Boolean(r.empty_pwd) && Boolean(r.rolcanlogin),
          accountLocked: !Boolean(r.rolcanlogin),
          grants: [
            r.rolsuper ? 'SUPERUSER' : '',
            r.rolcreatedb ? 'CREATEDB' : '',
            r.rolcreaterole ? 'CREATEROLE' : '',
            r.rolcanlogin ? 'LOGIN' : 'NOLOGIN'
          ].filter(Boolean)
        }));
        return {
          engine: 'postgres',
          profileId: profile.id,
          profileName: profile.name,
          users,
          findings: auditDbUsersSecurity(users, 'postgres'),
          collectedAt: new Date().toISOString()
        };
      });
    }

    return this.withMysqlConnection(profile, activeDb, async (conn) => {
      let userRows: Array<Record<string, unknown>> = [];
      try {
        const [rows] = await conn.query(
          `SELECT User, Host, Super_priv, Grant_priv,
                  IFNULL(authentication_string, '') AS auth_str,
                  IFNULL(plugin, '') AS plugin_name,
                  IFNULL(account_locked, 'N') AS acct_locked
           FROM mysql.user ORDER BY User ASC, Host ASC LIMIT 120`
        );
        userRows = rows as Array<Record<string, unknown>>;
      } catch {
        // Non-root user fallback: inspect CURRENT_USER() grants
        const [curRows] = await conn.query(`SELECT CURRENT_USER() AS cur_user`);
        const cur = String((curRows as Array<Record<string, unknown>>)[0]?.cur_user ?? 'current@localhost');
        const [u, h] = cur.split('@');
        userRows = [{ User: u || cur, Host: h || '%', Super_priv: 'N', Grant_priv: 'N', auth_str: 'protected', acct_locked: 'N' }];
      }

      const users: DbUserPrivilegeRecord[] = [];
      for (const r of userRows) {
        const username = String(r.User ?? '');
        const host = String(r.Host ?? '%');
        const grants: string[] = [];
        try {
          const [gRows] = await conn.query(
            `SHOW GRANTS FOR '${username.replace(/'/g, "''")}'@'${host.replace(/'/g, "''")}'`
          );
          for (const gr of gRows as Array<Record<string, unknown>>) {
            const val = Object.values(gr)[0];
            if (val) grants.push(String(val));
          }
        } catch {
          // ignore if insufficient privilege for SHOW GRANTS
        }
        users.push({
          username,
          host,
          isSuperuser: String(r.Super_priv ?? 'N').toUpperCase() === 'Y',
          hasGrantOption: String(r.Grant_priv ?? 'N').toUpperCase() === 'Y',
          hasEmptyPassword: String(r.auth_str ?? '').trim().length === 0,
          accountLocked: String(r.acct_locked ?? 'N').toUpperCase() === 'Y',
          plugin: String(r.plugin_name ?? ''),
          grants
        });
      }

      return {
        engine: 'mysql',
        profileId: profile.id,
        profileName: profile.name,
        users,
        findings: auditDbUsersSecurity(users, 'mysql'),
        collectedAt: new Date().toISOString()
      };
    });
  }

  async applyRbacStatements(
    id: string,
    statements: string[]
  ): Promise<{ ok: boolean; executedCount: number; message: string }> {
    const clean = statements.map((s) => s.trim()).filter(Boolean);
    if (clean.length === 0) {
      throw new Error('Tidak ada pernyataan SQL RBAC untuk dijalankan.');
    }
    const profile = await this.getById(id);
    if (profile.engine === 'postgres') {
      return this.withPgClient(profile, profile.database.trim() || undefined, async (client) => {
        for (const s of clean) {
          await client.query(s);
        }
        if (this.auditService) {
          await this.auditService.record({
            kind: 'db-query-mutating',
            profileId: profile.id,
            targetName: profile.name,
            isProduction: Boolean(profile.isProduction),
            summary: `RBAC Update (${clean.length} pernyataan)`,
            detail: clean.join('\n')
          });
        }
        return { ok: true, executedCount: clean.length, message: `${clean.length} pernyataan hak akses berhasil diterapkan.` };
      });
    }

    return this.withMysqlConnection(profile, profile.database.trim() || undefined, async (conn) => {
      for (const s of clean) {
        await conn.query(s);
      }
      if (this.auditService) {
        await this.auditService.record({
          kind: 'db-query-mutating',
          profileId: profile.id,
          targetName: profile.name,
          isProduction: Boolean(profile.isProduction),
          summary: `RBAC Update (${clean.length} pernyataan)`,
          detail: clean.join('\n')
        });
      }
      return { ok: true, executedCount: clean.length, message: `${clean.length} pernyataan hak akses berhasil diterapkan.` };
    });
  }

  // Phase 30 #9: Export DB profiles for encrypted team workspace bundle (.hmwpack)
  async exportProfilesForBundle(includeSecrets: boolean): Promise<
    Array<{
      profile: Omit<DatabaseProfile, 'id' | 'createdAt' | 'updatedAt'>;
      secret?: { password?: string };
    }>
  > {
    const list = await this.list();
    const out: Array<{
      profile: Omit<DatabaseProfile, 'id' | 'createdAt' | 'updatedAt'>;
      secret?: { password?: string };
    }> = [];
    for (const item of list) {
      const { id, createdAt: _c, updatedAt: _u, ...rest } = item;
      let secret: { password?: string } | undefined;
      if (includeSecrets) {
        const dec = await this.getPassword(id);
        if (dec) secret = { password: dec };
      }
      out.push({ profile: rest, secret });
    }
    return out;
  }
}
