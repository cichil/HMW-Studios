import { readdir, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import type {
  SyncAction,
  SyncDiffItem,
  SyncExecutionResult,
  SyncItemStatus,
  SyncMode,
  SyncPlan,
  TransferLogEntry
} from '@shared/types';
import type { ConnectionManager } from './connections';
import { IgnoreFilter } from './ignoreFilter';

interface LocalEntryMeta {
  relativePath: string;
  fullPath: string;
  size: number;
  mtimeMs: number;
}

const MTIME_TOLERANCE_MS = 2500;

export class SynchronizerEngine {
  private readonly connectionManager: ConnectionManager;
  private readonly listeners = new Set<(entry: TransferLogEntry) => void>();

  constructor(connectionManager: ConnectionManager) {
    this.connectionManager = connectionManager;
  }

  onTransferLog(listener: (entry: TransferLogEntry) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitLog(entry: Omit<TransferLogEntry, 'id' | 'timestamp'>): void {
    const full: TransferLogEntry = {
      ...entry,
      id: `xfer-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString()
    };
    for (const fn of this.listeners) {
      fn(full);
    }
  }

  private async scanLocalFiles(
    workspacePath: string,
    ignoreFilter: IgnoreFilter
  ): Promise<{ files: Map<string, LocalEntryMeta>; ignoredCount: number }> {
    const resolvedRoot = resolve(workspacePath);
    const files = new Map<string, LocalEntryMeta>();
    let ignoredCount = 0;

    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const d of entries) {
        const fullPath = join(dir, d.name);
        const relPath = relative(resolvedRoot, fullPath).replace(/\\/g, '/');
        if (ignoreFilter.isIgnored(relPath)) {
          ignoredCount += 1;
          continue;
        }
        if (d.isDirectory()) {
          await walk(fullPath);
        } else if (d.isFile()) {
          try {
            const st = await stat(fullPath);
            files.set(relPath, {
              relativePath: relPath,
              fullPath,
              size: st.size,
              mtimeMs: st.mtimeMs
            });
          } catch {
            continue;
          }
        }
      }
    };

    await walk(resolvedRoot);
    return { files, ignoredCount };
  }

  private defaultActionFor(status: SyncItemStatus, mode: SyncMode): SyncAction {
    if (status === 'identical' || status === 'conflict') return 'skip';
    if (mode === 'push') {
      return status === 'upload-new' || status === 'upload-modified' ? 'upload' : 'skip';
    }
    if (mode === 'pull') {
      return status === 'download-new' || status === 'download-modified' ? 'download' : 'skip';
    }
    // bidirectional
    if (status === 'upload-new' || status === 'upload-modified') return 'upload';
    if (status === 'download-new' || status === 'download-modified') return 'download';
    return 'skip';
  }

  async compare(
    connectionId: string,
    workspacePath: string,
    mode: SyncMode
  ): Promise<SyncPlan> {
    const resolvedWorkspace = resolve(workspacePath);
    return this.connectionManager.withDriver(connectionId, async (driver, profile) => {
      const ignoreFilter = IgnoreFilter.fromWorkspace(resolvedWorkspace, profile.ignorePatterns);
      const [localScan, remoteScan] = await Promise.all([
        this.scanLocalFiles(resolvedWorkspace, ignoreFilter),
        driver.listRecursive(ignoreFilter, { requireRootExists: mode === 'pull' })
      ]);

      const remoteMap = new Map(
        remoteScan.entries.map((entry) => [entry.relativePath, entry])
      );
      const allKeys = new Set<string>([
        ...localScan.files.keys(),
        ...remoteMap.keys()
      ]);

      const items: SyncDiffItem[] = [];
      let identicalCount = 0;

      for (const relPath of Array.from(allKeys).sort()) {
        const local = localScan.files.get(relPath);
        const remote = remoteMap.get(relPath);

        if (local && !remote) {
          const status: SyncItemStatus = 'upload-new';
          items.push({
            relativePath: relPath,
            status,
            action: this.defaultActionFor(status, mode),
            localSize: local.size,
            localMtimeMs: local.mtimeMs
          });
        } else if (!local && remote) {
          const status: SyncItemStatus = 'download-new';
          items.push({
            relativePath: relPath,
            status,
            action: this.defaultActionFor(status, mode),
            remoteSize: remote.size,
            remoteMtimeMs: remote.mtimeMs
          });
        } else if (local && remote) {
          const timeDiff = local.mtimeMs - remote.mtimeMs;
          const sameSize = local.size === remote.size;
          const withinTimeTolerance = Math.abs(timeDiff) <= MTIME_TOLERANCE_MS;

          if (sameSize && withinTimeTolerance) {
            identicalCount += 1;
            continue;
          }

          let status: SyncItemStatus;
          if (!sameSize && withinTimeTolerance) {
            status = 'conflict';
          } else if (timeDiff > MTIME_TOLERANCE_MS) {
            status = 'upload-modified';
          } else if (timeDiff < -MTIME_TOLERANCE_MS) {
            status = 'download-modified';
          } else {
            status = 'conflict';
          }

          items.push({
            relativePath: relPath,
            status,
            action: this.defaultActionFor(status, mode),
            localSize: local.size,
            localMtimeMs: local.mtimeMs,
            remoteSize: remote.size,
            remoteMtimeMs: remote.mtimeMs
          });
        }
      }

      return {
        connectionId: profile.id,
        connectionName: profile.name,
        workspacePath: resolvedWorkspace,
        remoteRootPath: profile.remotePath,
        mode,
        generatedAt: new Date().toISOString(),
        items,
        identicalCount,
        ignoredCount: localScan.ignoredCount + remoteScan.ignoredCount
      };
    });
  }

  async execute(
    connectionId: string,
    workspacePath: string,
    items: SyncDiffItem[]
  ): Promise<SyncExecutionResult> {
    const started = Date.now();
    const resolvedWorkspace = resolve(workspacePath);

    let uploaded = 0;
    let downloaded = 0;
    let skipped = 0;
    let failed = 0;
    const errors: Array<{ relativePath: string; error: string }> = [];

    await this.connectionManager.withDriver(connectionId, async (driver, profile) => {
      for (const item of items) {
        if (item.action === 'skip') {
          skipped += 1;
          continue;
        }

        const localFile = resolve(resolvedWorkspace, item.relativePath);
        try {
          if (item.action === 'upload') {
            this.emitLog({
              connectionId: profile.id,
              connectionName: profile.name,
              direction: 'upload',
              relativePath: item.relativePath,
              status: 'running',
              message: `Mengunggah ${item.relativePath}...`
            });
            await driver.uploadFile(localFile, item.relativePath);
            uploaded += 1;
            this.emitLog({
              connectionId: profile.id,
              connectionName: profile.name,
              direction: 'upload',
              relativePath: item.relativePath,
              status: 'success',
              message: `Terunggah ke ${profile.name}`
            });
          } else if (item.action === 'download') {
            this.emitLog({
              connectionId: profile.id,
              connectionName: profile.name,
              direction: 'download',
              relativePath: item.relativePath,
              status: 'running',
              message: `Mengunduh ${item.relativePath}...`
            });
            await driver.downloadFile(item.relativePath, localFile);
            downloaded += 1;
            this.emitLog({
              connectionId: profile.id,
              connectionName: profile.name,
              direction: 'download',
              relativePath: item.relativePath,
              status: 'success',
              message: `Terunduh dari ${profile.name}`
            });
          }
        } catch (err) {
          failed += 1;
          const msg = err instanceof Error ? err.message : String(err);
          errors.push({ relativePath: item.relativePath, error: msg });
          this.emitLog({
            connectionId: profile.id,
            connectionName: profile.name,
            direction: 'error',
            relativePath: item.relativePath,
            status: 'error',
            message: `Gagal sinkronisasi ${item.relativePath}: ${msg}`
          });
        }
      }
    });

    return {
      uploaded,
      downloaded,
      skipped,
      failed,
      errors,
      durationMs: Date.now() - started
    };
  }

  async autoSyncSavedFile(workspacePath: string, savedFilePath: string): Promise<void> {
    const resolvedWorkspace = resolve(workspacePath);
    const resolvedFile = resolve(savedFilePath);
    if (!resolvedFile.startsWith(resolvedWorkspace)) return;

    const relPath = relative(resolvedWorkspace, resolvedFile).replace(/\\/g, '/');
    if (!relPath || relPath.startsWith('..')) return;

    const profiles = await this.connectionManager.list();
    const activeAutoSync = profiles.filter((p) => p.keepSynchronized);
    if (activeAutoSync.length === 0) return;

    for (const profile of activeAutoSync) {
      const ignoreFilter = IgnoreFilter.fromWorkspace(resolvedWorkspace, profile.ignorePatterns);
      if (ignoreFilter.isIgnored(relPath)) continue;

      try {
        await this.connectionManager.uploadSingleFile(profile.id, resolvedWorkspace, relPath);
        this.emitLog({
          connectionId: profile.id,
          connectionName: profile.name,
          direction: 'upload',
          relativePath: relPath,
          status: 'success',
          message: `[Keep-Synchronized] Otomatis terunggah ke ${profile.name}`
        });
      } catch (err) {
        this.emitLog({
          connectionId: profile.id,
          connectionName: profile.name,
          direction: 'error',
          relativePath: relPath,
          status: 'error',
          message: `[Keep-Synchronized] Gagal unggah ke ${profile.name}: ${
            err instanceof Error ? err.message : String(err)
          }`
        });
      }
    }
  }
}
