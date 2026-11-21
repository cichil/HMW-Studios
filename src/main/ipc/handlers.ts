import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  BuildReleasePatchPayload,
  ConnectionSavePayload,
  DatabaseSavePayload,
  DbCellUpdatePayload,
  DbCsvImportPayload,
  DbDataDictionaryPayload,
  DbDataTransferPayload,
  DbDeleteRowPayload,
  DbEngine,
  DbExcelExportPayload,
  DbExcelExportResult,
  DbInsertRowPayload,
  DbRoutineKind,
  DbScheduleJobSavePayload,
  DbSqlDumpPayload,
  DbSqlDumpResult,
  DbCsvImportResult,
  DbTableMeta,
  DbTableRowDiffPayload,
  DbTabularImportPayload,
  DbValueSearchPayload,
  ExportHmwPackPayload,
  FileNode,
  GeminiChatRequest,
  GeminiConfigSavePayload,
  GeminiDocGenRequest,
  GeminiFixErrorRequest,
  GeminiInlineCompletionRequest,
  GeminiInlineTransformRequest,
  GeminiSqlAuditRequest,
  GeminiSummarizeChangesRequest,
  GeminiWisanggeniCrudRequest,
  HttpSendPayload,
  IslandActivity,
  LogSourceConfig,
  ProjectSavePayload,
  ProjectSecurityScanPayload,
  ReplaceInFilesOptions,
  RubleCommand,
  RubleSnippet,
  SavedHttpRequest,
  SavedSqlQueryItem,
  SavedSqlQuerySavePayload,
  SyncDiffItem,
  SyncMode,
  TerminalCreateOptions,
  XdebugPathMappingDto
} from '@shared/types';
import type { HttpCollectionWorkspace } from '@shared/apiCollectionEngine';
import type { SshSnippetItem } from '@shared/sshSnippetsCatalog';
import type { XdebugBreakpointItem } from '@shared/xdebugProtocol';
import {
  decryptWorkspaceBundle,
  encryptWorkspaceBundle,
  type WorkspaceBundlePayload
} from '../services/workspaceBundleCrypto';
import { XdebugService } from '../services/xdebugService';
import {
  ConnectionManager,
  FallbackAesVault,
  type SecretVaultAdapter
} from '../services/connections';
import { DatabaseService } from '../services/databaseService';
import { GeminiService } from '../services/geminiService';
import { GitService } from '../services/git';
import { HttpClientService } from '../services/httpClientService';
import { LaravelService } from '../services/laravelService';
import { LocalHistoryService } from '../services/localHistory';
import { LogMonitorService } from '../services/logMonitorService';
import { PhpLanguageService } from '../services/phpService';
import { PreviewServerService } from '../services/previewServer';
import { ProjectManager } from '../services/projects';
import { RubleManager } from '../services/rubles';
import { SynchronizerEngine } from '../services/synchronizer';
import { TerminalManager } from '../services/terminal';
import { WisanggeniService } from '../services/wisanggeniService';
import { WorkspaceService } from '../services/workspace';
import {
  buildMultiSheetXlsxBuffer,
  buildXlsxBuffer,
  parseXlsxBuffer
} from '../services/xlsxBuilder';
import { AuditTrailService } from '../services/auditTrailService';
import { DbSchedulerService } from '../services/dbSchedulerService';
import {
  createReleasePatchZipBuffer,
  scanModifiedFilesSince
} from '../services/releasePatchBuilder';
import {
  buildDataDictionaryHtml,
  buildDataDictionarySheets
} from '@shared/dataDictionaryGenerator';
import { scanSourceFilesForSecurityAndHealth } from '@shared/projectSecurityScanner';

class ElectronDpapiVault implements SecretVaultAdapter {
  private readonly fallback = new FallbackAesVault();

  encrypt(plainText: string): string {
    if (safeStorage.isEncryptionAvailable()) {
      const buf = safeStorage.encryptString(plainText);
      return `dpapi:${buf.toString('base64')}`;
    }
    return this.fallback.encrypt(plainText);
  }

  decrypt(cipherPayload: string): string {
    if (cipherPayload.startsWith('dpapi:') && safeStorage.isEncryptionAvailable()) {
      const buf = Buffer.from(cipherPayload.slice('dpapi:'.length), 'base64');
      return safeStorage.decryptString(buf);
    }
    return this.fallback.decrypt(cipherPayload);
  }
}

export interface RegisteredBackendServices {
  workspace: WorkspaceService;
  projects: ProjectManager;
  connections: ConnectionManager;
  database: DatabaseService;
  logMonitor: LogMonitorService;
  httpClient: HttpClientService;
  synchronizer: SynchronizerEngine;
  terminal: TerminalManager;
  rubles: RubleManager;
  git: GitService;
  preview: PreviewServerService;
  php: PhpLanguageService;
  wisanggeni: WisanggeniService;
  laravel: LaravelService;
  history: LocalHistoryService;
  gemini: GeminiService;
  dispose: () => Promise<void>;
}

function makeLocalHistoryKey(filePath: string): string {
  return `local:${filePath.replace(/\\/g, '/').toLowerCase()}`;
}

function makeRemoteHistoryKey(id: string, remoteRelativePath: string): string {
  const clean = remoteRelativePath.replace(/^[/\\]+/, '').replace(/\\/g, '/');
  return `remote:${id}:${clean}`;
}

function broadcast(channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}

function emitIslandActivity(
  payload: Omit<IslandActivity, 'id' | 'timestamp'> & { id?: string }
): void {
  const activity: IslandActivity = {
    id: payload.id ?? `isl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
    ...payload
  };
  broadcast('island:activity', activity);
}

/**
 * Migrasikan koneksi server & snippet yang sebelumnya disimpan di Aptana Studio 4
 * agar pengguna HMW Studio langsung mendapati profil server SFTP/FTPS mereka tetap utuh.
 */
function migrateLegacyAptanaUserData(targetDir: string): void {
  try {
    mkdirSync(targetDir, { recursive: true });
    const appDataRoot = app.getPath('appData');
    const legacyDirs = [
      join(appDataRoot, 'new-aptana-studio', 'aptana-studio-4-data'),
      join(appDataRoot, 'Aptana Studio 4', 'aptana-studio-4-data')
    ];

    const filesToMigrate = [
      'connections.json',
      'connections.vault.json',
      'rubles.custom.json'
    ];

    for (const legacyDir of legacyDirs) {
      if (!existsSync(legacyDir)) continue;
      for (const fileName of filesToMigrate) {
        const src = join(legacyDir, fileName);
        const dst = join(targetDir, fileName);
        if (existsSync(src) && !existsSync(dst)) {
          copyFileSync(src, dst);
        }
      }
    }
  } catch {
    // Abaikan jika folder lama tidak ada
  }
}

export function registerIpcHandlers(): RegisteredBackendServices {
  const userDataDir = join(app.getPath('userData'), 'hmw-studio-data');
  migrateLegacyAptanaUserData(userDataDir);

  const workspace = new WorkspaceService();
  const projects = new ProjectManager(userDataDir);
  const connections = new ConnectionManager(userDataDir, new ElectronDpapiVault());
  const synchronizer = new SynchronizerEngine(connections);
  const terminal = new TerminalManager(connections);
  const rubles = new RubleManager(userDataDir);
  const git = new GitService();
  const preview = new PreviewServerService();
  const php = new PhpLanguageService();
  const wisanggeni = new WisanggeniService();
  const laravel = new LaravelService();
  const history = new LocalHistoryService(userDataDir);
  const gemini = new GeminiService(userDataDir, new ElectronDpapiVault());
  const auditTrail = new AuditTrailService(userDataDir);
  const database = new DatabaseService(userDataDir, new ElectronDpapiVault(), connections);
  database.setAuditService(auditTrail);
  database.setProgressListener((evt) => broadcast('db:progress', evt));
  database.setPartialSchemaListener((snap) => broadcast('db:partialSchema', snap));
  const dbScheduler = new DbSchedulerService(userDataDir, database, emitIslandActivity);
  dbScheduler.start();
  const logMonitor = new LogMonitorService(connections);
  const httpClient = new HttpClientService(userDataDir);
  const xdebug = new XdebugService();
  xdebug.onEvent((evt) => broadcast('xdebug:event', evt));

  let activeWorkspacePath: string | null = null;

  logMonitor.onEntries((entries) => broadcast('logs:entries', entries));
  logMonitor.onStatus((st) => broadcast('logs:status', st));
  logMonitor.onFatalAlert((entry, source) => {
    const srcName = source.kind === 'remote' ? 'REMOTE LOG' : 'LOCAL LOG';
    emitIslandActivity({
      id: `srv-log-${Date.now()}`,
      tone: 'error',
      badge: srcName,
      title:
        entry.level === 'fatal'
          ? 'PHP Fatal / Parse Error baru terdeteksi!'
          : 'Error baru tercatat di Log Server',
      subtitle: entry.message.slice(0, 120),
      busy: false,
      actionLabel: 'Buka Log',
      actionType: 'open-logs'
    });
  });

  synchronizer.onTransferLog((entry) => {
    broadcast('sync:transferLog', entry);
    if (entry.status === 'error') {
      emitIslandActivity({
        id: `xfer-err-${entry.connectionId}`,
        tone: 'error',
        badge: 'SFTP ERROR',
        title: `Gagal sinkron ke [${entry.connectionName}]`,
        subtitle: entry.message,
        busy: false,
        actionLabel: 'Edit Server',
        actionType: 'edit-connection'
      });
    }
  });
  terminal.onData((payload) => broadcast('terminal:data', payload));
  terminal.onExit((payload) => broadcast('terminal:exit', payload));
  preview.onReload(() => broadcast('preview:reload'));

  ipcMain.handle('system:getInfo', () => ({
    appName: 'HMW Studio',
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    platform: process.platform,
    arch: process.arch
  }));

  // Workspace handlers
  ipcMain.handle('workspace:selectFolder', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const res = await dialog.showOpenDialog(win, {
      title: 'Buka Folder Proyek Lokal — HMW Studio',
      properties: ['openDirectory', 'createDirectory']
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0];
  });

  ipcMain.handle('workspace:openFolder', async (_e, folderPath: string) => {
    activeWorkspacePath = folderPath;
    await workspace.watch(folderPath, (ev) => broadcast('workspace:changed', ev));
    return workspace.listTree(folderPath);
  });

  ipcMain.handle('workspace:closeFolder', async () => {
    activeWorkspacePath = null;
    await workspace.stopWatching();
  });

  ipcMain.handle('workspace:createSampleProject', async (_e, targetDir?: string) => {
    const dest =
      targetDir ?? join(app.getPath('documents'), 'HMWStudioProjects', 'demo-web-app');
    const createdPath = await workspace.createSampleProject(dest);
    activeWorkspacePath = createdPath;
    await workspace.watch(createdPath, (ev) => broadcast('workspace:changed', ev));
    return createdPath;
  });

  ipcMain.handle('workspace:listTree', (_e, folderPath: string) =>
    workspace.listTree(folderPath)
  );
  ipcMain.handle('workspace:readFile', async (_e, filePath: string) => {
    const res = await workspace.readFile(filePath);
    if (!res.isBinary) {
      const name = filePath.split(/[/\\]/).pop() || filePath;
      void history
        .record({
          fileKey: makeLocalHistoryKey(filePath),
          label: 'Versi Awal Saat Dibuka',
          sourceKind: 'local',
          displayPath: filePath,
          relativePath: name,
          content: res.content
        })
        .catch(() => {});
    }
    return res;
  });
  ipcMain.handle('workspace:writeFile', async (_e, filePath: string, content: string) => {
    const saved = await workspace.writeFile(filePath, content);
    const name = filePath.split(/[/\\]/).pop() || filePath;
    void history
      .record({
        fileKey: makeLocalHistoryKey(filePath),
        label: 'Disimpan di Lokal',
        sourceKind: 'local',
        displayPath: filePath,
        relativePath: name,
        content
      })
      .catch(() => {});
    preview.notifyFileSaved();
    if (activeWorkspacePath) {
      void synchronizer.autoSyncSavedFile(activeWorkspacePath, filePath);
    }
    return saved;
  });
  ipcMain.handle(
    'workspace:createEntry',
    (_e, targetPath: string, isDirectory: boolean, initialContent?: string) =>
      workspace.createEntry(targetPath, isDirectory, initialContent)
  );
  ipcMain.handle('workspace:renameEntry', (_e, oldPath: string, newPath: string) =>
    workspace.renameEntry(oldPath, newPath)
  );
  ipcMain.handle('workspace:deleteEntry', (_e, targetPath: string) =>
    workspace.deleteEntry(targetPath)
  );
  ipcMain.handle(
    'workspace:copyOrMoveEntry',
    (_e, sourcePath: string, targetDirPath: string, mode: 'copy' | 'cut') =>
      workspace.copyOrMoveEntry(sourcePath, targetDirPath, mode)
  );
  ipcMain.handle(
    'workspace:searchInFiles',
    (_e, folderPath: string, query: string, caseSensitive?: boolean) =>
      workspace.searchInFiles(folderPath, query, caseSensitive)
  );
  ipcMain.handle(
    'workspace:replaceInFiles',
    async (
      _e,
      folderPath: string,
      query: string,
      replacement: string,
      options?: ReplaceInFilesOptions
    ) => {
      const res = await workspace.replaceInFiles(
        folderPath,
        query,
        replacement,
        options,
        async (fullPath, relPath, originalContent) => {
          await history.record({
            fileKey: makeLocalHistoryKey(fullPath),
            label: `Backup Sebelum Global Replace ("${query.slice(0, 24)}")`,
            sourceKind: 'local',
            displayPath: fullPath,
            relativePath: relPath,
            content: originalContent
          });
        }
      );
      if (res.filesModified > 0) {
        preview.notifyFileSaved();
        if (activeWorkspacePath) {
          for (const rel of res.modifiedRelPaths) {
            void synchronizer.autoSyncSavedFile(activeWorkspacePath, join(folderPath, rel));
          }
        }
        emitIslandActivity({
          id: `replace-local-${Date.now()}`,
          tone: 'success',
          badge: 'REPLACE',
          title: `${res.occurrencesReplaced} teks diganti di ${res.filesModified} file lokal`,
          subtitle: `"${query.slice(0, 24)}" → "${replacement.slice(0, 24)}"`,
          busy: false
        });
      }
      return res;
    }
  );
  ipcMain.handle('workspace:scanTodos', (_e, folderPath: string) =>
    workspace.scanTodos(folderPath)
  );
  ipcMain.handle('workspace:scanJoinEdges', (_e, folderPath: string) =>
    workspace.scanJoinEdges(folderPath)
  );
  ipcMain.handle('workspace:scanWebAssets', (_e, folderPath: string) =>
    workspace.scanWebAssets(folderPath)
  );

  // Saved Projects & .hmwproj handlers
  ipcMain.handle('projects:list', () => projects.list());
  ipcMain.handle('projects:save', (_e, payload: ProjectSavePayload) => projects.save(payload));
  ipcMain.handle('projects:remove', (_e, id: string) => projects.remove(id));
  ipcMain.handle('projects:touchOpened', (_e, id: string) => projects.touchOpened(id));
  ipcMain.handle('projects:exportToFile', async (_e, payload: ProjectSavePayload) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const safeFileName =
      (payload.name || 'proyek-hmw')
        .replace(/[<>:"/\\|?*]+/g, '-')
        .trim() || 'proyek-hmw';

    const defaultPath = payload.projectFilePath
      ? payload.projectFilePath
      : join(
          payload.workspacePath || app.getPath('documents'),
          `${safeFileName}.hmwproj`
        );

    const res = await dialog.showSaveDialog(win, {
      title: 'Simpan File Proyek — HMW Studio',
      defaultPath,
      filters: [
        { name: 'HMW Studio Project (*.hmwproj)', extensions: ['hmwproj'] },
        { name: 'JSON File (*.json)', extensions: ['json'] }
      ]
    });
    if (res.canceled || !res.filePath) return null;
    return projects.exportToFile(res.filePath, payload);
  });

  ipcMain.handle('projects:openFromFile', async (_e, filePath?: string) => {
    let targetPath = filePath;
    if (!targetPath) {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const res = await dialog.showOpenDialog(win, {
        title: 'Buka File Proyek (.hmwproj) — HMW Studio',
        properties: ['openFile'],
        filters: [
          { name: 'HMW Studio Project (*.hmwproj)', extensions: ['hmwproj', 'json'] }
        ]
      });
      if (res.canceled || res.filePaths.length === 0) return null;
      targetPath = res.filePaths[0];
    }
    return projects.openFromFile(targetPath);
  });

  // Connections handlers
  ipcMain.handle('connections:list', () => connections.list());
  ipcMain.handle('connections:save', (_e, payload: ConnectionSavePayload) =>
    connections.save(payload)
  );
  ipcMain.handle('connections:remove', (_e, id: string) => connections.remove(id));
  ipcMain.handle('connections:test', async (_e, id: string) => {
    const res = await connections.testConnection(id);
    emitIslandActivity({
      id: `conn-test-${id}`,
      tone: res.ok ? 'success' : 'error',
      badge: res.ok ? 'TERHUBUNG' : 'GAGAL KONEK',
      title: res.ok ? res.message : 'Tes koneksi server gagal',
      subtitle: res.ok ? `${res.latencyMs}ms` : res.message,
      busy: false,
      actionLabel: res.ok ? undefined : 'Edit Server',
      actionType: res.ok ? undefined : 'edit-connection'
    });
    return res;
  });
  ipcMain.handle(
    'connections:listRemoteDir',
    async (_e, id: string, remoteSubPath?: string) => {
      try {
        return await connections.listRemoteDir(id, remoteSubPath);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        emitIslandActivity({
          id: `conn-list-err-${id}`,
          tone: 'error',
          badge: 'SFTP PUTUS',
          title: 'Server remote tidak terhubung',
          subtitle: msg,
          busy: false,
          actionLabel: 'Edit Server',
          actionType: 'edit-connection'
        });
        throw err;
      }
    }
  );
  ipcMain.handle(
    'connections:readRemoteFile',
    async (_e, id: string, remoteRelativePath: string) => {
      const content = await connections.readRemoteFile(id, remoteRelativePath);
      const cleanRel = remoteRelativePath.replace(/^[/\\]+/, '').replace(/\\/g, '/');
      void connections
        .getById(id)
        .then((profile) =>
          history.record({
            fileKey: makeRemoteHistoryKey(id, cleanRel),
            label: `Versi Awal dari ${profile.name}`,
            sourceKind: 'remote',
            displayPath: `${profile.name}:${cleanRel}`,
            connectionId: id,
            relativePath: cleanRel,
            content
          })
        )
        .catch(() => {});
      return content;
    }
  );
  ipcMain.handle(
    'connections:writeRemoteFile',
    async (_e, id: string, remoteRelativePath: string, content: string) => {
      const cleanRel = remoteRelativePath.replace(/^[/\\]+/, '').replace(/\\/g, '/');
      const shortFile = cleanRel.split('/').pop() || cleanRel;
      const t0 = Date.now();
      emitIslandActivity({
        id: `xfer-save-${id}-${shortFile}`,
        tone: 'sync',
        badge: 'REMOTE',
        title: `Mengunggah ${shortFile}...`,
        subtitle: cleanRel,
        busy: true
      });
      try {
        const profile = await connections.writeRemoteFile(id, remoteRelativePath, content);
        const elapsedMs = Math.max(1, Date.now() - t0);
        void auditTrail
          .record({
            kind: 'sftp-deploy',
            profileId: profile.id,
            targetName: profile.name,
            isProduction: Boolean(profile.isProduction),
            tableOrPath: cleanRel,
            summary: `Unggah ${cleanRel} ke ${profile.name}`,
            detail: `${content.length.toLocaleString('id-ID')} karakter (${elapsedMs}ms)`
          })
          .catch(() => {});
        void history
          .record({
            fileKey: makeRemoteHistoryKey(id, cleanRel),
            label: `Disimpan ke ${profile.name}`,
            sourceKind: 'remote',
            displayPath: `${profile.name}:${cleanRel}`,
            connectionId: id,
            relativePath: cleanRel,
            content
          })
          .catch(() => {});
        broadcast('sync:transferLog', {
          id: `xfer-${Date.now()}`,
          timestamp: new Date().toISOString(),
          connectionId: profile.id,
          connectionName: profile.name,
          direction: 'upload',
          relativePath: remoteRelativePath,
          status: 'success',
          message: `[Remote Save] Tersimpan langsung ke ${profile.name}: ${remoteRelativePath} (${elapsedMs}ms)`
        });
        emitIslandActivity({
          id: `xfer-save-${id}-${shortFile}`,
          tone: 'success',
          badge: profile.protocol.toUpperCase(),
          title: `Tersimpan ke [${profile.name}] ${shortFile}`,
          subtitle: `${elapsedMs}ms • Sinkron langsung`,
          busy: false,
          durationMs: elapsedMs,
          actionLabel: 'Riwayat',
          actionType: 'open-transfers'
        });
      } catch (err) {
        emitIslandActivity({
          id: `xfer-save-${id}-${shortFile}`,
          tone: 'error',
          badge: 'REMOTE ERROR',
          title: `Gagal unggah ${shortFile}`,
          subtitle: err instanceof Error ? err.message : String(err),
          busy: false,
          actionLabel: 'Riwayat',
          actionType: 'open-transfers'
        });
        throw err;
      }
    }
  );
  ipcMain.handle(
    'connections:createRemoteEntry',
    async (
      _e,
      id: string,
      remoteRelativePath: string,
      isDirectory: boolean,
      initialContent?: string
    ) => {
      const profile = await connections.createRemoteEntry(
        id,
        remoteRelativePath,
        isDirectory,
        initialContent ?? ''
      );
      broadcast('sync:transferLog', {
        id: `xfer-${Date.now()}`,
        timestamp: new Date().toISOString(),
        connectionId: profile.id,
        connectionName: profile.name,
        direction: 'info',
        relativePath: remoteRelativePath,
        status: 'success',
        message: `[Remote Create] ${isDirectory ? 'Folder' : 'File'} dibuat di ${profile.name}: ${remoteRelativePath}`
      });
    }
  );
  ipcMain.handle(
    'connections:renameRemoteEntry',
    async (_e, id: string, oldRelativePath: string, newRelativePath: string) => {
      const profile = await connections.renameRemoteEntry(
        id,
        oldRelativePath,
        newRelativePath
      );
      broadcast('sync:transferLog', {
        id: `xfer-${Date.now()}`,
        timestamp: new Date().toISOString(),
        connectionId: profile.id,
        connectionName: profile.name,
        direction: 'info',
        relativePath: newRelativePath,
        status: 'success',
        message: `[Remote Rename] ${profile.name}: ${oldRelativePath} → ${newRelativePath}`
      });
    }
  );
  ipcMain.handle(
    'connections:deleteRemoteEntry',
    async (_e, id: string, remoteRelativePath: string, isDirectory: boolean) => {
      const profile = await connections.deleteRemoteEntry(
        id,
        remoteRelativePath,
        isDirectory
      );
      broadcast('sync:transferLog', {
        id: `xfer-${Date.now()}`,
        timestamp: new Date().toISOString(),
        connectionId: profile.id,
        connectionName: profile.name,
        direction: 'info',
        relativePath: remoteRelativePath,
        status: 'success',
        message: `[Remote Delete] ${isDirectory ? 'Folder' : 'File'} dihapus di ${profile.name}: ${remoteRelativePath}`
      });
    }
  );
  ipcMain.handle(
    'connections:chmodRemoteEntry',
    async (_e, id: string, remoteRelativePath: string, modeOctal: string) => {
      const cleanMode = modeOctal.replace(/[^0-7]/g, '') || '644';
      const profile = await connections.chmodRemoteEntry(id, remoteRelativePath, cleanMode);
      broadcast('sync:transferLog', {
        id: `xfer-${Date.now()}`,
        timestamp: new Date().toISOString(),
        connectionId: profile.id,
        connectionName: profile.name,
        direction: 'info',
        relativePath: remoteRelativePath,
        status: 'success',
        message: `[Remote CHMOD ${cleanMode}] ${profile.name}: ${remoteRelativePath}`
      });
    }
  );
  ipcMain.handle(
    'connections:uploadMultiplePaths',
    async (_e, id: string, localPaths: string[], targetRemoteSubPath: string) => {
      const res = await connections.uploadMultiplePaths(
        id,
        localPaths,
        targetRemoteSubPath,
        (relPath) => {
          broadcast('sync:transferLog', {
            id: `xfer-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            timestamp: new Date().toISOString(),
            connectionId: id,
            connectionName: 'Remote Upload',
            direction: 'upload',
            relativePath: relPath,
            status: 'success',
            message: `[Drag & Drop Upload] Terunggah: ${relPath}`
          });
        }
      );
      broadcast('sync:transferLog', {
        id: `xfer-${Date.now()}`,
        timestamp: new Date().toISOString(),
        connectionId: res.profile.id,
        connectionName: res.profile.name,
        direction: res.errors.length > 0 ? 'error' : 'upload',
        relativePath: targetRemoteSubPath || '/',
        status: res.errors.length > 0 ? 'error' : 'success',
        message: `[Drag & Drop Upload] ${res.uploaded} file terunggah ke ${res.profile.name}${
          res.errors.length > 0 ? ` (${res.errors.length} gagal)` : ''
        }`
      });
      return { uploaded: res.uploaded, errors: res.errors };
    }
  );
  ipcMain.handle(
    'connections:searchRemoteFiles',
    (_e, id: string, remoteSubPath: string, query: string, caseSensitive?: boolean) =>
      connections.searchRemoteFiles(id, remoteSubPath, query, caseSensitive)
  );
  ipcMain.handle(
    'connections:listRemoteFilesIndex',
    (_e, id: string, remoteSubPath?: string, maxFiles?: number) =>
      connections.listRemoteFilesIndex(id, remoteSubPath ?? '', maxFiles ?? 50000)
  );
  ipcMain.handle(
    'connections:scanRemoteWorkspaceSymbols',
    (_e, id: string, remoteSubPath?: string, maxFiles?: number) =>
      connections.scanRemoteWorkspaceSymbols(id, remoteSubPath ?? '', maxFiles ?? 220)
  );
  ipcMain.handle('connections:getCachedRemoteIndex', (_e, id: string) =>
    connections.getCachedRemoteIndex(id)
  );
  ipcMain.handle(
    'connections:uploadSingleFile',
    (_e, id: string, workspacePath: string, relativePath: string) =>
      connections.uploadSingleFile(id, workspacePath, relativePath)
  );
  ipcMain.handle(
    'connections:downloadSingleFile',
    (_e, id: string, workspacePath: string, relativePath: string) =>
      connections.downloadSingleFile(id, workspacePath, relativePath)
  );
  ipcMain.handle(
    'connections:downloadEntryToLocalDir',
    async (
      _e,
      id: string,
      remoteRelativePath: string,
      isDirectory: boolean,
      targetLocalDir: string,
      deleteSourceAfter?: boolean
    ) => {
      const res = await connections.downloadEntryToLocalDir(
        id,
        remoteRelativePath,
        isDirectory,
        targetLocalDir,
        deleteSourceAfter
      );
      broadcast('sync:transferLog', {
        id: `xfer-${Date.now()}`,
        timestamp: new Date().toISOString(),
        connectionId: id,
        connectionName: 'Remote Paste',
        direction: 'download',
        relativePath: remoteRelativePath,
        status: 'success',
        message: `[Paste Remote → Lokal] ${res.downloaded} file diunduh ke ${res.localDestPath}`
      });
      return res;
    }
  );
  ipcMain.handle(
    'connections:copyOrMoveRemoteEntry',
    async (
      _e,
      sourceId: string,
      sourceRelativePath: string,
      isDirectory: boolean,
      destId: string,
      targetRemoteSubPath: string,
      mode: 'copy' | 'cut'
    ) => {
      const res = await connections.copyOrMoveRemoteEntry(
        sourceId,
        sourceRelativePath,
        isDirectory,
        destId,
        targetRemoteSubPath,
        mode
      );
      broadcast('sync:transferLog', {
        id: `xfer-${Date.now()}`,
        timestamp: new Date().toISOString(),
        connectionId: destId,
        connectionName: 'Remote Clipboard',
        direction: 'info',
        relativePath: res.destRelativePath,
        status: 'success',
        message: `[Remote ${mode === 'cut' ? 'Cut/Move' : 'Copy'}] ${sourceRelativePath} → ${res.destRelativePath}`
      });
      return res;
    }
  );
  ipcMain.handle(
    'connections:replaceInRemoteFiles',
    async (
      _e,
      id: string,
      remoteSubPath: string,
      query: string,
      replacement: string,
      options?: ReplaceInFilesOptions
    ) => {
      const t0 = Date.now();
      emitIslandActivity({
        id: `replace-remote-${id}`,
        tone: 'sync',
        badge: 'REMOTE REPLACE',
        title: `Mengganti teks di server remote...`,
        subtitle: `"${query.slice(0, 24)}" → "${replacement.slice(0, 24)}"`,
        busy: true
      });
      try {
        const res = await connections.replaceInRemoteFiles(
          id,
          remoteSubPath,
          query,
          replacement,
          options,
          async (relPath, originalContent, profile) => {
            await history.record({
              fileKey: makeRemoteHistoryKey(id, relPath),
              label: `Backup Sebelum Remote Replace di ${profile.name}`,
              sourceKind: 'remote',
              displayPath: `${profile.name}:${relPath}`,
              connectionId: id,
              relativePath: relPath,
              content: originalContent
            });
          }
        );
        const elapsedMs = Math.max(1, Date.now() - t0);
        broadcast('sync:transferLog', {
          id: `xfer-${Date.now()}`,
          timestamp: new Date().toISOString(),
          connectionId: id,
          connectionName: 'Remote Replace',
          direction: 'upload',
          relativePath: remoteSubPath || '/',
          status: 'success',
          message: `[Global Replace Remote] ${res.occurrencesReplaced} teks diganti di ${res.filesModified} file (${elapsedMs}ms)`
        });
        emitIslandActivity({
          id: `replace-remote-${id}`,
          tone: 'success',
          badge: 'REMOTE REPLACE',
          title: `${res.occurrencesReplaced} teks diganti di ${res.filesModified} file remote`,
          subtitle: `${elapsedMs}ms • Backup riwayat tersimpan`,
          busy: false,
          actionLabel: 'Riwayat',
          actionType: 'open-transfers'
        });
        return res;
      } catch (err) {
        emitIslandActivity({
          id: `replace-remote-${id}`,
          tone: 'error',
          badge: 'REPLACE GAGAL',
          title: 'Global Replace di server remote gagal',
          subtitle: err instanceof Error ? err.message : String(err),
          busy: false
        });
        throw err;
      }
    }
  );
  ipcMain.handle('connections:poolStats', () => connections.poolStats());
  ipcMain.handle('connections:disconnectPool', (_e, id?: string) =>
    connections.disconnectPool(id)
  );
  ipcMain.handle(
    'connections:broadcastWriteFile',
    async (_e, connectionIds: string[], remoteRelativePath: string, content: string) => {
      const cleanRel = remoteRelativePath.replace(/^[/\\]+/, '').replace(/\\/g, '/');
      const shortFile = cleanRel.split('/').pop() || cleanRel;
      emitIslandActivity({
        id: `broadcast-${shortFile}`,
        tone: 'sync',
        badge: 'MULTI-DEPLOY',
        title: `Mengunggah ${shortFile} ke ${connectionIds.length} server...`,
        subtitle: cleanRel,
        busy: true
      });
      const res = await connections.broadcastWriteFile(connectionIds, cleanRel, content);
      for (const s of res.succeeded) {
        void auditTrail
          .record({
            kind: 'sftp-deploy',
            profileId: s.connectionId,
            targetName: s.connectionName,
            isProduction: false,
            tableOrPath: cleanRel,
            summary: `[Multi-Deploy] ${cleanRel} → ${s.connectionName}`,
            detail: `${s.durationMs}ms`
          })
          .catch(() => {});
        void history
          .record({
            fileKey: makeRemoteHistoryKey(s.connectionId, cleanRel),
            label: `[Multi-Deploy] Disimpan ke ${s.connectionName}`,
            sourceKind: 'remote',
            displayPath: `${s.connectionName}:${cleanRel}`,
            connectionId: s.connectionId,
            relativePath: cleanRel,
            content
          })
          .catch(() => {});
        broadcast('sync:transferLog', {
          id: `xfer-${Date.now()}-${s.connectionId}`,
          timestamp: new Date().toISOString(),
          connectionId: s.connectionId,
          connectionName: s.connectionName,
          direction: 'upload',
          relativePath: cleanRel,
          status: 'success',
          message: `[Multi-Deploy] Tersimpan ke ${s.connectionName}: ${cleanRel} (${s.durationMs}ms)`
        });
      }
      for (const f of res.failed) {
        broadcast('sync:transferLog', {
          id: `xfer-err-${Date.now()}-${f.connectionId}`,
          timestamp: new Date().toISOString(),
          connectionId: f.connectionId,
          connectionName: f.connectionName,
          direction: 'upload',
          relativePath: cleanRel,
          status: 'error',
          message: `[Multi-Deploy Gagal] ${f.connectionName}: ${f.error}`
        });
      }
      emitIslandActivity({
        id: `broadcast-${shortFile}`,
        tone: res.failed.length === 0 ? 'success' : 'warning',
        badge: 'MULTI-DEPLOY',
        title: `Multi-Deploy ${shortFile}: ${res.succeeded.length}/${res.totalTargets} sukses`,
        subtitle:
          res.failed.length === 0
            ? res.succeeded.map((s) => s.connectionName).join(', ')
            : `${res.failed.length} gagal (${res.failed[0]?.connectionName})`,
        busy: false,
        actionLabel: 'Riwayat',
        actionType: 'open-transfers'
      });
      return res;
    }
  );
  ipcMain.handle('connections:inspectServerHealth', (_e, id: string) =>
    connections.inspectServerHealth(id)
  );

  // Synchronizer handlers
  ipcMain.handle(
    'sync:compare',
    async (_e, connectionId: string, workspacePath: string, mode: SyncMode) => {
      const t0 = Date.now();
      emitIslandActivity({
        id: `sync-compare-${connectionId}`,
        tone: 'sync',
        badge: 'SYNC SCAN',
        title: 'Menghubungi server & memindai file...',
        subtitle: `Mode ${mode.toUpperCase()}`,
        busy: true
      });
      try {
        const plan = await synchronizer.compare(connectionId, workspacePath, mode);
        const elapsedMs = Math.max(1, Date.now() - t0);
        emitIslandActivity({
          id: `sync-compare-${connectionId}`,
          tone: 'success',
          badge: 'SYNC SIAP',
          title:
            plan.items.length === 0
              ? `Terhubung ke [${plan.connectionName}] • 100% sinkron`
              : `[${plan.connectionName}] • ${plan.items.length} perbedaan ditemukan`,
          subtitle: `${elapsedMs}ms`,
          busy: false,
          durationMs: elapsedMs
        });
        return plan;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        emitIslandActivity({
          id: `sync-compare-${connectionId}`,
          tone: 'error',
          badge: 'SFTP ERROR',
          title: 'Gagal terhubung ke server saat sinkronisasi',
          subtitle: msg,
          busy: false,
          actionLabel: 'Edit Server',
          actionType: 'edit-connection'
        });
        throw err;
      }
    }
  );
  ipcMain.handle(
    'sync:execute',
    async (_e, connectionId: string, workspacePath: string, items: SyncDiffItem[]) => {
      const t0 = Date.now();
      emitIslandActivity({
        id: 'sync-batch-exec',
        tone: 'sync',
        badge: 'SYNC',
        title: `Sinkronisasi ${items.length} file berjalan...`,
        subtitle: 'Transfer dua arah aktif',
        busy: true
      });
      try {
        const res = await synchronizer.execute(connectionId, workspacePath, items);
        const elapsedMs = Math.max(1, Date.now() - t0);
        emitIslandActivity({
          id: 'sync-batch-exec',
          tone: 'success',
          badge: 'SYNC',
          title: `Sinkronisasi ${items.length} file selesai`,
          subtitle: `${elapsedMs}ms`,
          busy: false,
          durationMs: elapsedMs,
          actionLabel: 'Riwayat',
          actionType: 'open-transfers'
        });
        return res;
      } catch (err) {
        emitIslandActivity({
          id: 'sync-batch-exec',
          tone: 'error',
          badge: 'SYNC GAGAL',
          title: 'Sinkronisasi terhenti',
          subtitle: err instanceof Error ? err.message : String(err),
          busy: false
        });
        throw err;
      }
    }
  );

  // Terminal handlers
  ipcMain.handle('terminal:create', (_e, options: TerminalCreateOptions) =>
    terminal.create(options)
  );
  ipcMain.handle('terminal:write', (_e, id: string, data: string) => {
    terminal.write(id, data);
  });
  ipcMain.handle('terminal:resize', (_e, id: string, cols: number, rows: number) => {
    terminal.resize(id, cols, rows);
  });
  ipcMain.handle('terminal:close', (_e, id: string) => {
    terminal.close(id);
  });
  ipcMain.handle('terminal:runCommand', async (_e, commandLine: string, cwd: string) => {
    const shortCmd =
      commandLine.length > 44 ? `${commandLine.slice(0, 41)}...` : commandLine;
    const t0 = Date.now();
    const actId = `cmd-${t0}`;
    emitIslandActivity({
      id: actId,
      tone: 'command',
      badge: 'CLI',
      title: `Menjalankan ${shortCmd}`,
      subtitle: cwd,
      busy: true
    });
    const res = await terminal.runCommand(commandLine, cwd);
    const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
    emitIslandActivity({
      id: actId,
      tone: res.code === 0 ? 'success' : 'error',
      badge: 'CLI',
      title:
        res.code === 0
          ? `Selesai: ${shortCmd}`
          : `Gagal (Kode ${res.code}): ${shortCmd}`,
      subtitle: `${elapsedSec}d`,
      busy: false,
      actionLabel: 'Output',
      actionType: 'open-output'
    });
    return res;
  });

  // Rubles 2.0 handlers
  ipcMain.handle('rubles:list', () => rubles.list());
  ipcMain.handle(
    'rubles:saveSnippet',
    (_e, snippet: Omit<RubleSnippet, 'id'> & { id?: string }) =>
      rubles.saveSnippet(snippet)
  );
  ipcMain.handle('rubles:deleteSnippet', (_e, snippetId: string) =>
    rubles.deleteSnippet(snippetId)
  );
  ipcMain.handle(
    'rubles:saveCommand',
    (_e, cmd: Omit<RubleCommand, 'id'> & { id?: string }) => rubles.saveCommand(cmd)
  );
  ipcMain.handle('rubles:deleteCommand', (_e, commandId: string) =>
    rubles.deleteCommand(commandId)
  );

  // Git handlers
  ipcMain.handle('git:status', (_e, workspacePath: string) => git.status(workspacePath));
  ipcMain.handle('git:init', (_e, workspacePath: string) => git.init(workspacePath));
  ipcMain.handle('git:stage', (_e, workspacePath: string, paths: string[]) =>
    git.stage(workspacePath, paths)
  );
  ipcMain.handle('git:unstage', (_e, workspacePath: string, paths: string[]) =>
    git.unstage(workspacePath, paths)
  );
  ipcMain.handle('git:commit', (_e, workspacePath: string, message: string) =>
    git.commit(workspacePath, message)
  );
  ipcMain.handle(
    'git:checkout',
    (_e, workspacePath: string, branch: string, createNew?: boolean) =>
      git.checkout(workspacePath, branch, createNew)
  );
  ipcMain.handle('git:pull', (_e, workspacePath: string) => git.pull(workspacePath));
  ipcMain.handle('git:push', (_e, workspacePath: string) => git.push(workspacePath));
  ipcMain.handle('git:fileDiff', (_e, workspacePath: string, relativePath: string) =>
    git.fileDiff(workspacePath, relativePath)
  );
  ipcMain.handle(
    'git:blameLine',
    (_e, workspacePath: string, relativePath: string, line: number) =>
      git.blameLine(workspacePath, relativePath, line)
  );

  // Preview server handlers
  ipcMain.handle('preview:start', (_e, workspacePath: string) =>
    preview.start(workspacePath)
  );
  ipcMain.handle('preview:stop', () => preview.stop());
  ipcMain.handle('preview:status', () => preview.getStatus());

  // PHP IntelliSense, Wisanggeni & Laravel Framework Catalog & Live Syntax Diagnostics handlers
  ipcMain.handle('php:getCatalog', () => php.getCatalog());
  ipcMain.handle('php:lint', (_e, code: string) => php.lint(code));
  ipcMain.handle('php:autoFixLocal', (_e, code: string) => php.autoFixSyntaxLocal(code));
  ipcMain.handle('php:runSnippet', (_e, code: string, cwd?: string) =>
    php.runSnippet(code, cwd ?? activeWorkspacePath ?? undefined)
  );
  ipcMain.handle('php:scanWorkspace', (_e, workspacePath: string) =>
    php.scanWorkspace(workspacePath)
  );
  ipcMain.handle(
    'php:getWisanggeniCatalog',
    (_e, forceRefresh?: boolean, customPathOrUrl?: string) =>
      wisanggeni.getCatalog(forceRefresh, customPathOrUrl)
  );
  ipcMain.handle('php:getLaravelCatalog', (_e, workspacePath?: string | null) =>
    laravel.getCatalog(workspacePath ?? activeWorkspacePath)
  );

  // Local History / Auto-Backup Timeline handlers
  ipcMain.handle('history:list', (_e, fileKey: string) => history.list(fileKey));
  ipcMain.handle('history:getContent', (_e, snapshotId: string) =>
    history.getContent(snapshotId)
  );
  ipcMain.handle(
    'history:record',
    (
      _e,
      payload: {
        fileKey: string;
        label: string;
        sourceKind: 'local' | 'remote';
        displayPath: string;
        connectionId?: string;
        relativePath: string;
        content: string;
      }
    ) => history.record(payload)
  );
  ipcMain.handle('history:clear', (_e, fileKey: string) => history.clear(fileKey));

  const runAiWithIsland = async <T>(
    busyTitle: string,
    doneTitle: string,
    task: () => Promise<T>
  ): Promise<T> => {
    const t0 = Date.now();
    const actId = `ai-${t0}`;
    const cfg = await gemini.getConfig();
    const modelLabel = cfg.model;
    emitIslandActivity({
      id: actId,
      tone: 'ai',
      badge: 'GEMINI AI',
      title: busyTitle,
      subtitle: modelLabel,
      busy: true
    });
    try {
      const out = await task();
      const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
      emitIslandActivity({
        id: actId,
        tone: 'success',
        badge: 'GEMINI AI',
        title: doneTitle,
        subtitle: `${elapsedSec}d • ${modelLabel}`,
        busy: false,
        actionLabel: 'AI Studio',
        actionType: 'open-ai'
      });
      return out;
    } catch (err) {
      emitIslandActivity({
        id: actId,
        tone: 'error',
        badge: 'GEMINI AI',
        title: 'Permintaan Gemini AI gagal',
        subtitle: err instanceof Error ? err.message : String(err),
        busy: false,
        actionLabel: 'Pengaturan',
        actionType: 'open-ai'
      });
      throw err;
    }
  };

  // Google Gemini AI Studio handlers (Interactions API + Encrypted Vault)
  ipcMain.handle('ai:getConfig', () => gemini.getConfig());
  ipcMain.handle('ai:saveConfig', (_e, payload: GeminiConfigSavePayload) =>
    gemini.saveConfig(payload)
  );
  ipcMain.handle('ai:testConnection', () =>
    runAiWithIsland('Menguji koneksi Google Gemini...', 'Koneksi Gemini AI aktif', () =>
      gemini.testConnection()
    )
  );
  ipcMain.handle('ai:chat', (_e, req: GeminiChatRequest) =>
    runAiWithIsland('Gemini sedang menyusun jawaban...', 'Jawaban Gemini AI siap', () =>
      gemini.chat(req)
    )
  );
  ipcMain.handle('ai:generateWisanggeniCrud', (_e, req: GeminiWisanggeniCrudRequest) =>
    runAiWithIsland(
      `Menyusun modul CRUD "${req.moduleTitle}"...`,
      `Modul CRUD "${req.moduleTitle}" siap`,
      () => gemini.generateWisanggeniCrud(req)
    )
  );
  ipcMain.handle('ai:inlineTransform', (_e, req: GeminiInlineTransformRequest) =>
    runAiWithIsland(
      `Transformasi AI pada ${req.fileName || 'kode'}...`,
      'Transformasi kode AI selesai',
      () => gemini.inlineTransform(req)
    )
  );
  ipcMain.handle('ai:fixError', (_e, req: GeminiFixErrorRequest) =>
    runAiWithIsland(
      `Menganalisis & memperbaiki error ${req.fileName || 'PHP'}...`,
      'Perbaikan error AI siap ditinjau',
      () => gemini.fixError(req)
    )
  );
  ipcMain.handle('ai:sqlAndSecurityAudit', (_e, req: GeminiSqlAuditRequest) =>
    runAiWithIsland(
      `Mengaudit keamanan & query SQL (${req.fileName || 'aktif'})...`,
      'Audit Keamanan & SQL selesai',
      () => gemini.sqlAndSecurityAudit(req)
    )
  );
  ipcMain.handle('ai:generateDocs', (_e, req: GeminiDocGenRequest) =>
    runAiWithIsland(
      `Menghasilkan dokumentasi ${req.fileName || 'kode'}...`,
      'Dokumentasi kode siap diterapkan',
      () => gemini.generateDocs(req)
    )
  );
  ipcMain.handle('ai:inlineCompletion', (_e, req: GeminiInlineCompletionRequest) =>
    gemini.inlineCompletion(req)
  );
  ipcMain.handle('ai:summarizeChanges', (_e, req: GeminiSummarizeChangesRequest) =>
    runAiWithIsland(
      'Merangkum perubahan kode dengan AI...',
      'Ringkasan perubahan AI siap',
      () => gemini.summarizeChanges(req)
    )
  );

  // Database Explorer & SQL Query Runner handlers
  ipcMain.handle('db:list', () => database.list());
  ipcMain.handle('db:save', (_e, payload: DatabaseSavePayload) => database.save(payload));
  ipcMain.handle('db:remove', (_e, id: string) => database.remove(id));
  ipcMain.handle('db:test', async (_e, id: string) => {
    const res = await database.testConnection(id);
    emitIslandActivity({
      id: `db-test-${id}`,
      tone: res.ok ? 'success' : 'error',
      badge: res.ok ? 'DB KONEK' : 'DB GAGAL',
      title: res.ok ? res.message : 'Gagal terhubung ke Database',
      subtitle: res.ok ? `${res.latencyMs}ms` : res.message,
      busy: false,
      actionLabel: 'Database',
      actionType: 'open-db'
    });
    return res;
  });
  ipcMain.handle('db:getCachedSchema', (_e, id: string, dbName?: string) =>
    database.getCachedSchema(id, dbName)
  );
  ipcMain.handle(
    'db:introspect',
    async (_e, id: string, dbName?: string, forceFull?: boolean) => {
      emitIslandActivity({
        id: `db-schema-${id}`,
        tone: 'sync',
        badge: 'DB LOAD',
        title: dbName ? `Memuat database "${dbName}"...` : 'Menghubungkan & memuat skema database...',
        subtitle: 'Membaca daftar tabel, kolom, & relasi Foreign Key',
        busy: true
      });
      try {
        const snap = await database.introspect(id, dbName, Boolean(forceFull));
        emitIslandActivity({
          id: `db-schema-${id}`,
          tone: 'success',
          badge: snap.engine.toUpperCase(),
          title: `[${snap.profileName}] • ${snap.tables.length} tabel dimuat`,
          subtitle: `Database: ${snap.currentDatabase || '-'} (${(snap.allTables ?? snap.tables).length} total)`,
          busy: false
        });
        return snap;
      } catch (err) {
        emitIslandActivity({
          id: `db-schema-${id}`,
          tone: 'error',
          badge: 'DB ERROR',
          title: 'Gagal memuat skema database',
          subtitle: err instanceof Error ? err.message : String(err),
          busy: false,
          actionLabel: 'Database',
          actionType: 'open-db'
        });
        throw err;
      }
    }
  );
  ipcMain.handle(
    'db:query',
    async (_e, id: string, sql: string, dbName?: string, maxRows?: number) => {
      try {
        return await database.executeQuery(id, sql, dbName, maxRows);
      } catch (err) {
        emitIslandActivity({
          id: `db-q-err-${Date.now()}`,
          tone: 'error',
          badge: 'SQL ERROR',
          title: 'Eksekusi Query SQL gagal',
          subtitle: err instanceof Error ? err.message : String(err),
          busy: false,
          actionLabel: 'Database',
          actionType: 'open-db'
        });
        throw err;
      }
    }
  );
  ipcMain.handle('db:updateCell', (_e, id: string, payload: DbCellUpdatePayload) =>
    database.updateCell(id, payload)
  );
  ipcMain.handle('db:insertRow', (_e, id: string, payload: DbInsertRowPayload) =>
    database.insertRow(id, payload)
  );
  ipcMain.handle('db:deleteRow', (_e, id: string, payload: DbDeleteRowPayload) =>
    database.deleteRow(id, payload)
  );
  ipcMain.handle(
    'db:exportExcel',
    async (_e, payload: DbExcelExportPayload): Promise<DbExcelExportResult> => {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const safeBase =
        (payload.defaultFileName || 'data-export')
          .replace(/\.xlsx$/i, '')
          .replace(/[<>:"/\\|?*]+/g, '_')
          .trim() || 'data-export';
      const defaultPath = join(
        activeWorkspacePath || app.getPath('documents'),
        `${safeBase}.xlsx`
      );
      const saveRes = await dialog.showSaveDialog(win, {
        title: 'Export Data ke Microsoft Excel (.xlsx) — HMW Studio',
        defaultPath,
        filters: [{ name: 'Microsoft Excel Workbook (*.xlsx)', extensions: ['xlsx'] }]
      });
      if (saveRes.canceled || !saveRes.filePath) {
        return { canceled: true, rowCount: 0 };
      }
      const xlsxBuf = buildXlsxBuffer({
        sheetName: payload.sheetName || safeBase,
        columns: payload.columns,
        rows: payload.rows
      });
      await writeFile(saveRes.filePath, xlsxBuf);
      if (payload.openAfterSave) {
        void shell.openPath(saveRes.filePath).catch(() => {});
      }
      emitIslandActivity({
        id: `xlsx-exp-${Date.now()}`,
        tone: 'success',
        badge: 'EXCEL .XLSX',
        title: `Export Excel selesai (${payload.rows.length} baris)`,
        subtitle: saveRes.filePath,
        busy: false
      });
      return {
        canceled: false,
        filePath: saveRes.filePath,
        rowCount: payload.rows.length,
        byteSize: xlsxBuf.length
      };
    }
  );
  ipcMain.handle(
    'db:exportSqlDump',
    async (_e, id: string, payload: DbSqlDumpPayload): Promise<DbSqlDumpResult> => {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const prof = await database.getById(id);
      const dbName = payload.database || prof.database || 'database';
      const tblSuffix =
        payload.tables && payload.tables.length === 1 ? `_${payload.tables[0]}` : '';
      const stamp = new Date().toISOString().slice(0, 10);
      const safeName = `${dbName}${tblSuffix}_backup_${stamp}`.replace(
        /[<>:"/\\|?*]+/g,
        '_'
      );
      const saveRes = await dialog.showSaveDialog(win, {
        title: 'Simpan Backup SQL Dump (.sql) — HMW Studio',
        defaultPath: join(activeWorkspacePath || app.getPath('documents'), `${safeName}.sql`),
        filters: [{ name: 'SQL Backup Dump (*.sql)', extensions: ['sql'] }]
      });
      if (saveRes.canceled || !saveRes.filePath) {
        return { canceled: true, tablesExported: 0, rowsExported: 0 };
      }
      const dump = await database.buildSqlDump(id, payload);
      await writeFile(saveRes.filePath, dump.sql, 'utf-8');
      emitIslandActivity({
        id: `sql-dump-${Date.now()}`,
        tone: 'success',
        badge: 'SQL BACKUP',
        title: `Backup .SQL selesai (${dump.tablesExported} tabel • ${dump.rowsExported} baris)`,
        subtitle: saveRes.filePath,
        busy: false
      });
      return {
        canceled: false,
        filePath: saveRes.filePath,
        tablesExported: dump.tablesExported,
        rowsExported: dump.rowsExported,
        sqlPreview: dump.sql.slice(0, 1200)
      };
    }
  );
  ipcMain.handle(
    'db:importCsv',
    async (_e, id: string, payload: DbCsvImportPayload): Promise<DbCsvImportResult> => {
      let csvText = payload.csvText;
      let sourcePath: string | undefined;
      if (!csvText) {
        const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
        const openRes = await dialog.showOpenDialog(win, {
          title: `Import CSV ke Tabel "${payload.table}" — HMW Studio`,
          properties: ['openFile'],
          filters: [
            { name: 'CSV File (*.csv)', extensions: ['csv', 'txt'] },
            { name: 'Semua File (*.*)', extensions: ['*'] }
          ]
        });
        if (openRes.canceled || openRes.filePaths.length === 0) {
          return { canceled: true, insertedRows: 0, columns: [] };
        }
        sourcePath = openRes.filePaths[0];
        csvText = await readFile(sourcePath, 'utf-8');
      }
      const imported = await database.importCsvText(id, {
        database: payload.database,
        table: payload.table,
        csvText
      });
      emitIslandActivity({
        id: `csv-imp-${Date.now()}`,
        tone: 'success',
        badge: 'CSV IMPORT',
        title: `${imported.insertedRows} baris diimpor ke ${payload.table}`,
        subtitle: sourcePath || `${imported.columns.length} kolom`,
        busy: false
      });
      return {
        canceled: false,
        insertedRows: imported.insertedRows,
        columns: imported.columns,
        sourcePath
      };
    }
  );
  ipcMain.handle('db:listProcesses', (_e, id: string) => database.listProcesses(id));
  ipcMain.handle('db:killProcess', (_e, id: string, processId: number | string) =>
    database.killProcess(id, processId)
  );
  ipcMain.handle(
    'db:inspectHealth',
    (
      _e,
      id: string,
      databaseName?: string,
      mode?: 'fast' | 'slow-sql' | 'locks' | 'storage'
    ) => database.inspectHealth(id, databaseName, mode)
  );
  ipcMain.handle(
    'db:optimizeTable',
    (_e, id: string, payload: { database?: string; table: string }) =>
      database.optimizeTable(id, payload)
  );
  ipcMain.handle('db:generateTableDdl', (_e, table: DbTableMeta, engine: DbEngine) =>
    database.generateTableDdl(table, engine)
  );
  ipcMain.handle('db:transferTableData', async (_e, payload: DbDataTransferPayload) => {
    const res = await database.transferTableData(payload);
    emitIslandActivity({
      id: `db-xfer-${Date.now()}`,
      tone: 'success',
      badge: 'DB SYNC',
      title: `${res.rowsRead} baris disinkronkan → ${payload.targetTable}`,
      subtitle: `${res.durationMs}ms${res.maskedColumnCount > 0 ? ` • ${res.maskedColumnCount} kolom disamarkan` : ''}`,
      busy: false,
      actionLabel: 'Database',
      actionType: 'open-db'
    });
    return res;
  });
  ipcMain.handle('db:listSavedQueries', () => database.listSavedQueries());
  ipcMain.handle('db:saveQuery', (_e, payload: SavedSqlQuerySavePayload) =>
    database.saveQuery(payload)
  );
  ipcMain.handle('db:deleteSavedQuery', (_e, id: string) => database.deleteSavedQuery(id));
  ipcMain.handle('db:exportSavedQueries', async () => {
    const items = await database.listSavedQueries();
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const saveRes = await dialog.showSaveDialog(win, {
      title: 'Ekspor Pustaka Query Tersimpan — HMW Studio',
      defaultPath: `hmw-saved-queries-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'HMW Saved Queries (*.json)', extensions: ['json'] }]
    });
    if (saveRes.canceled || !saveRes.filePath) {
      return { canceled: true, count: 0 };
    }
    await writeFile(saveRes.filePath, JSON.stringify(items, null, 2), 'utf-8');
    return { canceled: false, filePath: saveRes.filePath, count: items.length };
  });
  ipcMain.handle('db:importSavedQueries', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const openRes = await dialog.showOpenDialog(win, {
      title: 'Impor Pustaka Query Tersimpan — HMW Studio',
      properties: ['openFile'],
      filters: [{ name: 'HMW Saved Queries (*.json)', extensions: ['json'] }]
    });
    if (openRes.canceled || openRes.filePaths.length === 0) {
      return { canceled: true, importedCount: 0, items: [] };
    }
    const raw = await readFile(openRes.filePaths[0], 'utf-8');
    const parsed = JSON.parse(raw);
    const arr = Array.isArray(parsed) ? (parsed as SavedSqlQueryItem[]) : [];
    const importedCount = await database.importSavedQueriesList(arr);
    const items = await database.listSavedQueries();
    return { canceled: false, importedCount, items };
  });
  ipcMain.handle('db:listRoutines', (_e, id: string, databaseName?: string) =>
    database.listRoutines(id, databaseName)
  );
  ipcMain.handle(
    'db:getRoutineDdl',
    (_e, id: string, payload: { kind: DbRoutineKind; name: string; database?: string }) =>
      database.getRoutineDdl(id, payload)
  );
  ipcMain.handle('db:listSchedules', () => dbScheduler.list());
  ipcMain.handle('db:saveSchedule', (_e, payload: DbScheduleJobSavePayload) =>
    dbScheduler.save(payload)
  );
  ipcMain.handle('db:deleteSchedule', (_e, id: string) => dbScheduler.remove(id));
  ipcMain.handle('db:runScheduleNow', (_e, id: string) => dbScheduler.executeJob(id));

  // Phase 27 Enterprise Database, Audit & Security Handlers
  ipcMain.handle(
    'db:queryMulti',
    (_e, id: string, sqlScript: string, databaseName?: string, maxRows?: number) =>
      database.executeMultiQuery(id, sqlScript, databaseName, maxRows)
  );
  ipcMain.handle('db:openXlsxWorkbook', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const openRes = await dialog.showOpenDialog(win, {
      title: 'Pilih File Microsoft Excel (.xlsx) — HMW Studio',
      properties: ['openFile'],
      filters: [{ name: 'Excel Workbook (*.xlsx)', extensions: ['xlsx'] }]
    });
    if (openRes.canceled || openRes.filePaths.length === 0) {
      return { canceled: true };
    }
    const filePath = openRes.filePaths[0];
    const buf = await readFile(filePath);
    const workbook = parseXlsxBuffer(buf, filePath);
    return { canceled: false, workbook };
  });
  ipcMain.handle(
    'db:importTabular',
    async (_e, id: string, payload: DbTabularImportPayload) => {
      const res = await database.importTabularRows(id, payload);
      if (!res.errorMessage) {
        emitIslandActivity({
          id: `xlsx-imp-${Date.now()}`,
          tone: res.dryRun ? 'sync' : 'success',
          badge: res.dryRun ? 'DRY-RUN OK' : 'EXCEL IMPORT',
          title: res.dryRun
            ? `Uji Dry-Run lulus: ${res.processedRows} baris valid (Rollback aman)`
            : `${res.processedRows} baris berhasil diimpor ke ${payload.table}`,
          subtitle: `${res.durationMs}ms • Mode ${payload.mode.toUpperCase()}`,
          busy: false
        });
      }
      return res;
    }
  );
  ipcMain.handle(
    'db:searchValueAcrossDb',
    (_e, id: string, payload: DbValueSearchPayload) =>
      database.searchValueAcrossDatabase(id, payload, (evt) => {
        broadcast('db:valueSearchProgress', evt);
      })
  );
  ipcMain.handle(
    'db:exportDataDictionary',
    async (_e, id: string, payload: DbDataDictionaryPayload) => {
      let snap = await database.getCachedSchema(id, payload.database);
      if (!snap || snap.tables.every((t) => t.columns.length === 0)) {
        snap = await database.introspect(id, payload.database);
      }
      const dbSlug = (snap.currentDatabase || snap.profileName || 'database').replace(
        /[^a-zA-Z0-9_-]/g,
        '_'
      );
      const dateSlug = new Date().toISOString().slice(0, 10);
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];

      if (payload.format === 'xlsx') {
        const saveRes = await dialog.showSaveDialog(win, {
          title: 'Simpan Kamus Data Multi-Sheet (.xlsx) — HMW Studio',
          defaultPath: `Kamus-Data-${dbSlug}-${dateSlug}.xlsx`,
          filters: [{ name: 'Excel Workbook (*.xlsx)', extensions: ['xlsx'] }]
        });
        if (saveRes.canceled || !saveRes.filePath) {
          return { canceled: true, tableCount: 0, columnCount: 0 };
        }
        const sheets = buildDataDictionarySheets(snap);
        const buf = buildMultiSheetXlsxBuffer(sheets);
        await writeFile(saveRes.filePath, buf);
        const colCount = snap.tables.reduce((s, t) => s + t.columns.length, 0);
        void shell.showItemInFolder(saveRes.filePath);
        return {
          canceled: false,
          filePath: saveRes.filePath,
          tableCount: snap.tables.length,
          columnCount: colCount
        };
      }

      const saveRes = await dialog.showSaveDialog(win, {
        title: 'Simpan Kamus Data Siap Cetak / PDF (.html) — HMW Studio',
        defaultPath: `Kamus-Data-${dbSlug}-${dateSlug}.html`,
        filters: [{ name: 'HTML Document (*.html)', extensions: ['html'] }]
      });
      if (saveRes.canceled || !saveRes.filePath) {
        return { canceled: true, tableCount: 0, columnCount: 0 };
      }
      const html = buildDataDictionaryHtml(snap, {
        organizationName: payload.organizationName,
        projectTitle: payload.projectTitle
      });
      await writeFile(saveRes.filePath, html, 'utf-8');
      const colCount = snap.tables.reduce((s, t) => s + t.columns.length, 0);
      void shell.openPath(saveRes.filePath);
      return {
        canceled: false,
        filePath: saveRes.filePath,
        tableCount: snap.tables.length,
        columnCount: colCount
      };
    }
  );
  ipcMain.handle('db:diffTableRows', (_e, payload: DbTableRowDiffPayload) =>
    database.diffTableRows(payload)
  );

  ipcMain.handle('audit:list', (_e, limit?: number) => auditTrail.list(limit));
  ipcMain.handle('audit:clear', () => auditTrail.clear());
  ipcMain.handle('audit:exportJson', async () => {
    const items = await auditTrail.list(1000);
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const saveRes = await dialog.showSaveDialog(win, {
      title: 'Ekspor Enterprise Audit Log (.json) — HMW Studio',
      defaultPath: `hmw-audit-log-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON (*.json)', extensions: ['json'] }]
    });
    if (saveRes.canceled || !saveRes.filePath) {
      return { canceled: true };
    }
    await writeFile(saveRes.filePath, JSON.stringify(items, null, 2), 'utf-8');
    return { canceled: false, filePath: saveRes.filePath };
  });

  ipcMain.handle('security:scanProject', async (_e, payload: ProjectSecurityScanPayload) => {
    const maxFiles = Math.max(20, Math.min(500, payload.maxFiles ?? 300));
    if (payload.scope === 'remote') {
      if (!payload.connectionId) {
        throw new Error('Pilih koneksi SFTP/FTP terlebih dahulu untuk memindai server remote.');
      }
      return connections.scanRemoteSecurityBatch(payload.connectionId, maxFiles);
    }

    const rootDir = payload.workspacePath || activeWorkspacePath;
    if (!rootDir) {
      throw new Error('Buka folder proyek lokal terlebih dahulu atau pilih mode Remote SFTP.');
    }
    const tree = await workspace.listTree(rootDir, 7);
    const skipSet = new Set(['vendor', 'node_modules', 'cache', 'storage', 'dist', 'out', 'release']);
    const scanExts = new Set(['.php', '.phtml', '.inc', '.js', '.ts', '.env']);
    const knownRelPaths: string[] = [];
    const candidateNodes: FileNode[] = [];

    const walkNodes = (nodes: FileNode[]): void => {
      for (const n of nodes) {
        if (n.isDirectory) {
          if (skipSet.has(n.name.toLowerCase())) continue;
          if (n.children) walkNodes(n.children);
        } else {
          knownRelPaths.push(n.relativePath);
          const low = n.name.toLowerCase();
          if (low.endsWith('.min.js')) continue;
          const ext = low === '.env' ? '.env' : n.extension.toLowerCase();
          if (scanExts.has(ext) && n.size <= 250 * 1024) {
            candidateNodes.push(n);
          }
        }
      }
    };
    walkNodes(tree);

    const files: Array<{ relPath: string; content: string }> = [];
    for (const node of candidateNodes.slice(0, maxFiles)) {
      try {
        const raw = await readFile(node.path, 'utf-8');
        files.push({ relPath: node.relativePath, content: raw });
      } catch {
        // Skip unreadable
      }
    }
    return scanSourceFilesForSecurityAndHealth({ files, knownRelPaths });
  });

  ipcMain.handle('patch:scanModified', async (_e, workspacePath: string, sinceHours: number) => {
    const cutoff = Date.now() - Math.max(0.5, sinceHours) * 3600_000;
    const files = await scanModifiedFilesSince(workspacePath, cutoff);
    return files.map((f) => ({
      relativePath: f.relativePath,
      sizeBytes: f.sizeBytes,
      mtimeMs: f.mtimeMs,
      reason: f.reason
    }));
  });
  ipcMain.handle('patch:buildZip', async (_e, payload: BuildReleasePatchPayload) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const dateSlug = new Date().toISOString().slice(0, 10);
    const saveRes = await dialog.showSaveDialog(win, {
      title: 'Simpan Paket Rilis / Patch (.zip) — HMW Studio',
      defaultPath: `patch-rilis-${dateSlug}.zip`,
      filters: [{ name: 'ZIP Archive (*.zip)', extensions: ['zip'] }]
    });
    if (saveRes.canceled || !saveRes.filePath) {
      return { canceled: true, fileCount: 0 };
    }
    const built = await createReleasePatchZipBuffer(payload);
    await writeFile(saveRes.filePath, built.buffer);
    emitIslandActivity({
      id: `patch-zip-${Date.now()}`,
      tone: 'success',
      badge: 'PATCH ZIP',
      title: `Paket Rilis dibuat (${built.fileCount} file)`,
      subtitle: saveRes.filePath,
      busy: false
    });
    return {
      canceled: false,
      filePath: saveRes.filePath,
      fileCount: built.fileCount,
      byteSize: built.buffer.length
    };
  });

  // Live Remote & Local Error Log Monitor handlers
  ipcMain.handle('logs:start', (_e, config: LogSourceConfig) => logMonitor.start(config));
  ipcMain.handle('logs:stop', () => logMonitor.stop());
  ipcMain.handle('logs:status', () => logMonitor.getStatus());
  ipcMain.handle(
    'logs:autoDetectPaths',
    (_e, connectionId?: string | null, workspacePath?: string | null) =>
      logMonitor.autoDetectPaths(connectionId, workspacePath ?? activeWorkspacePath)
  );
  ipcMain.handle('logs:readSnapshot', (_e, config: LogSourceConfig) =>
    logMonitor.readSnapshot(config)
  );

  // Built-in HTTP / AJAX Request Tester handlers
  ipcMain.handle('http:listSaved', () => httpClient.listSaved());
  ipcMain.handle(
    'http:saveRequest',
    (_e, payload: Omit<SavedHttpRequest, 'id' | 'updatedAt'> & { id?: string }) =>
      httpClient.saveRequest(payload)
  );
  ipcMain.handle('http:deleteSaved', (_e, id: string) => httpClient.deleteSaved(id));
  ipcMain.handle('http:getWorkspace', () => httpClient.getWorkspace());
  ipcMain.handle('http:saveWorkspace', (_e, ws: HttpCollectionWorkspace) =>
    httpClient.saveWorkspace(ws)
  );
  ipcMain.handle('http:send', async (_e, payload: HttpSendPayload) => {
    const res = await httpClient.send(payload);
    emitIslandActivity({
      id: `http-req-${Date.now()}`,
      tone: res.ok ? 'success' : 'warning',
      badge: `${payload.method} ${res.status}`,
      title: `${res.status} ${res.statusText || (res.ok ? 'OK' : 'HTTP Error')}`,
      subtitle: `${res.durationMs}ms • ${(res.sizeBytes / 1024).toFixed(1)} KB`,
      busy: false,
      actionLabel: 'HTTP Client',
      actionType: 'open-http'
    });
    return res;
  });

  // Phase 30 Enterprise Handlers: Safe Transaction, Visual EXPLAIN, RBAC, Multi-SSH Snippets, Xdebug DBGp, & .hmwpack Bundle
  ipcMain.handle(
    'db:executeBatchTx',
    (_e, id: string, statements: string[], databaseName?: string) =>
      database.executeBatchTransaction(id, statements, databaseName)
  );
  ipcMain.handle('db:explainVisual', (_e, id: string, sql: string, databaseName?: string) =>
    database.explainVisualPlan(id, sql, databaseName)
  );
  ipcMain.handle('db:listUsersRbac', (_e, id: string) => database.listUsersAndPrivileges(id));
  ipcMain.handle('db:applyRbacSql', (_e, id: string, statements: string[]) =>
    database.applyRbacStatements(id, statements)
  );

  ipcMain.handle('connections:listSshSnippets', () => connections.listSshSnippets());
  ipcMain.handle(
    'connections:saveSshSnippet',
    (_e, payload: Omit<SshSnippetItem, 'id' | 'builtIn'> & { id?: string }) =>
      connections.saveSshSnippet(payload)
  );
  ipcMain.handle('connections:deleteSshSnippet', (_e, id: string) =>
    connections.deleteSshSnippet(id)
  );
  ipcMain.handle('connections:runSshSnippetMulti', (_e, connectionIds: string[], command: string) =>
    connections.runSshSnippetMulti(connectionIds, command)
  );

  ipcMain.handle('xdebug:getState', () => xdebug.getState());
  ipcMain.handle('xdebug:start', (_e, port?: number, pathMapping?: XdebugPathMappingDto) =>
    xdebug.start(port, pathMapping)
  );
  ipcMain.handle('xdebug:stop', () => xdebug.stop());
  ipcMain.handle('xdebug:setPathMapping', (_e, mapping: XdebugPathMappingDto) =>
    xdebug.setPathMapping(mapping)
  );
  ipcMain.handle('xdebug:syncBreakpoints', (_e, items: XdebugBreakpointItem[]) =>
    xdebug.syncBreakpoints(items)
  );
  ipcMain.handle('xdebug:continueRun', () => xdebug.continueRun());
  ipcMain.handle('xdebug:stepOver', () => xdebug.stepOver());
  ipcMain.handle('xdebug:stepInto', () => xdebug.stepInto());
  ipcMain.handle('xdebug:stepOut', () => xdebug.stepOut());
  ipcMain.handle('xdebug:stopSession', () => xdebug.stopSession());
  ipcMain.handle('xdebug:evalExpression', (_e, expr: string) => xdebug.evalExpression(expr));

  ipcMain.handle('bundle:exportHmwPack', async (_e, payload: ExportHmwPackPayload) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const dateSlug = new Date().toISOString().slice(0, 10);
    const saveRes = await dialog.showSaveDialog(win, {
      title: 'Ekspor Paket Tim Terenkripsi (.hmwpack) — HMW Studio',
      defaultPath: `hmw-team-bundle-${dateSlug}.hmwpack`,
      filters: [{ name: 'HMW Team Bundle (*.hmwpack)', extensions: ['hmwpack'] }]
    });
    if (saveRes.canceled || !saveRes.filePath) {
      return { canceled: true };
    }

    const bundle: WorkspaceBundlePayload = {
      format: 'hmw-studio-team-bundle',
      version: 1,
      exportedAt: new Date().toISOString(),
      includesSecrets: Boolean(payload.includeSecrets)
    };
    if (payload.includeConnections) {
      bundle.connections = await connections.exportConnectionsForBundle(Boolean(payload.includeSecrets));
    }
    if (payload.includeDbProfiles) {
      bundle.dbProfiles = await database.exportProfilesForBundle(Boolean(payload.includeSecrets));
    }
    if (payload.includeSavedQueries) {
      bundle.savedQueries = await database.listSavedQueries();
    }
    if (payload.includeHttpCollections) {
      bundle.httpWorkspace = await httpClient.getWorkspace();
    }
    if (payload.includeSshSnippets) {
      const allSnips = await connections.listSshSnippets();
      bundle.sshSnippets = allSnips.filter((s) => !s.builtIn);
    }

    const encrypted = encryptWorkspaceBundle(bundle, payload.passphrase);
    await writeFile(saveRes.filePath, encrypted, 'utf-8');
    return {
      canceled: false,
      filePath: saveRes.filePath,
      counts: {
        connections: bundle.connections?.length ?? 0,
        dbProfiles: bundle.dbProfiles?.length ?? 0,
        savedQueries: bundle.savedQueries?.length ?? 0,
        httpRequests: bundle.httpWorkspace?.requests.length ?? 0,
        sshSnippets: bundle.sshSnippets?.length ?? 0
      }
    };
  });

  ipcMain.handle('bundle:importHmwPack', async (_e, passphrase: string) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const openRes = await dialog.showOpenDialog(win, {
      title: 'Impor Paket Tim Terenkripsi (.hmwpack) — HMW Studio',
      properties: ['openFile'],
      filters: [{ name: 'HMW Team Bundle (*.hmwpack)', extensions: ['hmwpack'] }]
    });
    if (openRes.canceled || openRes.filePaths.length === 0) {
      return { canceled: true };
    }
    const filePath = openRes.filePaths[0];
    const raw = await readFile(filePath, 'utf-8');
    const bundle = decryptWorkspaceBundle(raw, passphrase);

    const counts = {
      connections: 0,
      dbProfiles: 0,
      savedQueries: 0,
      httpRequests: 0,
      sshSnippets: 0
    };

    if (bundle.connections && bundle.connections.length > 0) {
      const existing = await connections.list();
      for (const item of bundle.connections) {
        const dup = existing.find(
          (e) =>
            e.name.toLowerCase() === item.profile.name.toLowerCase() &&
            e.host.toLowerCase() === item.profile.host.toLowerCase()
        );
        if (!dup) {
          await connections.save({
            profile: item.profile,
            password: item.secret?.password,
            passphrase: item.secret?.passphrase
          });
          counts.connections++;
        }
      }
    }

    if (bundle.dbProfiles && bundle.dbProfiles.length > 0) {
      const existing = await database.list();
      for (const item of bundle.dbProfiles) {
        const dup = existing.find(
          (e) =>
            e.name.toLowerCase() === item.profile.name.toLowerCase() &&
            e.host.toLowerCase() === item.profile.host.toLowerCase() &&
            e.database.toLowerCase() === item.profile.database.toLowerCase()
        );
        if (!dup) {
          await database.save({
            profile: item.profile,
            password: item.secret?.password
          });
          counts.dbProfiles++;
        }
      }
    }

    if (bundle.savedQueries && bundle.savedQueries.length > 0) {
      const existing = await database.listSavedQueries();
      const existingNames = new Set(existing.map((q) => q.name.toLowerCase()));
      for (const q of bundle.savedQueries) {
        if (!existingNames.has(q.name.toLowerCase())) {
          await database.saveQuery({
            name: q.name,
            folder: q.folder,
            sql: q.sql,
            database: q.database,
            isFavorite: q.isFavorite,
            visualDiagramSpec: q.visualDiagramSpec
          });
          counts.savedQueries++;
        }
      }
    }

    if (bundle.httpWorkspace) {
      const cur = await httpClient.getWorkspace();
      const existingReqNames = new Set(cur.requests.map((r) => `${r.method}:${r.url}:${r.name}`.toLowerCase()));
      for (const r of bundle.httpWorkspace.requests) {
        const key = `${r.method}:${r.url}:${r.name}`.toLowerCase();
        if (!existingReqNames.has(key)) {
          cur.requests.push({ ...r, id: `http-imp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` });
          counts.httpRequests++;
        }
      }
      for (const f of bundle.httpWorkspace.folders) {
        if (!cur.folders.includes(f)) cur.folders.push(f);
      }
      await httpClient.saveWorkspace(cur);
    }

    if (bundle.sshSnippets && bundle.sshSnippets.length > 0) {
      const cur = await connections.listSshSnippets();
      const existingNames = new Set(cur.map((s) => s.name.toLowerCase()));
      for (const s of bundle.sshSnippets) {
        if (!existingNames.has(s.name.toLowerCase())) {
          await connections.saveSshSnippet({
            name: s.name,
            category: s.category,
            command: s.command,
            description: s.description,
            dangerous: s.dangerous
          });
          counts.sshSnippets++;
        }
      }
    }

    return {
      canceled: false,
      filePath,
      imported: counts
    };
  });

  return {
    workspace,
    projects,
    connections,
    database,
    logMonitor,
    httpClient,
    synchronizer,
    terminal,
    rubles,
    git,
    preview,
    php,
    wisanggeni,
    laravel,
    history,
    gemini,
    dispose: async () => {
      await xdebug.stop();
      dbScheduler.stop();
      logMonitor.stop();
      terminal.closeAll();
      await database.dispose();
      await connections.disposeAll();
      await workspace.stopWatching();
      await preview.stop();
    }
  };
}
