import { createServer as createHttpServer } from 'node:http';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { inflateRawSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ConnectionManager,
  FallbackAesVault,
  parsePosixServerHealthOutput
} from '../src/main/services/connections';
import {
  buildMultiSheetXlsxBuffer,
  buildXlsxBuffer,
  parseCsvRecords,
  parseXlsxBuffer
} from '../src/main/services/xlsxBuilder';
import { AuditTrailService } from '../src/main/services/auditTrailService';
import { buildSshConnectConfig } from '../src/main/services/sftpDriver';
import {
  buildCellUpdateUndoSql,
  buildRowDeleteUndoSql,
  isMutatingSqlStatement,
  splitSqlStatements
} from '../src/shared/sqlUndoBuilder';
import {
  normalizeImportCellValue,
  parseClipboardTabularText
} from '../src/shared/xlsxReader';
import {
  buildDataDictionaryHtml,
  buildDataDictionarySheets
} from '../src/shared/dataDictionaryGenerator';
import { scanSourceFilesForSecurityAndHealth } from '../src/shared/projectSecurityScanner';
import { diffTableRowsByPrimaryKey } from '../src/shared/dbRowDiffEngine';
import {
  computeMysqlRateDelta,
  formatUptimeIndonesian,
  parseMysqlStatusAndVariables,
  type DbHealthSnapshot
} from '../src/shared/mysqlHealthAnalyzer';
import {
  buildPendingMutationsBatch,
  isWriteSqlBlockedInReadOnly
} from '../src/shared/dbSafeTransaction';
import { buildVisualExplainReport } from '../src/shared/mysqlExplainVisualizer';
import {
  buildFkLookupSql,
  resolveForeignKeyTargetForColumn
} from '../src/shared/dbForeignKeyLookup';
import {
  auditDbUsersSecurity,
  buildRbacGrantSqlStatements
} from '../src/shared/dbRbacAnalyzer';
import {
  buildDbgpCommand,
  dbgpUriToLocalFilePath,
  extractDbgpPacketsFromBuffer,
  localFilePathToDbgpUri,
  parseDbgpXml
} from '../src/shared/xdebugProtocol';
import {
  extractJsonPathValue,
  extractSessionCookieFromHeaders,
  generateHttpClientSnippet,
  importOpenApiOrPostmanJson,
  resolveEnvTemplateString
} from '../src/shared/apiCollectionEngine';
import {
  applyHunkLeftToRight,
  applyHunkRightToLeft,
  computeHunkDiff
} from '../src/shared/hunkDiffEngine';
import {
  buildServiceControlCommand,
  detectDangerousSshCommand
} from '../src/shared/sshSnippetsCatalog';
import {
  decryptWorkspaceBundle,
  encryptWorkspaceBundle
} from '../src/main/services/workspaceBundleCrypto';
import { extractPhpHttpEndpointSpec, parseCurlCommand } from '../src/shared/httpEndpointExtractor';
import { findModuleCompanions, inspectPhpFileDependencies } from '../src/shared/moduleCompanion';
import { analyzeDangerousSql } from '../src/shared/sqlSafetyGuard';
import { analyzePhpVariableIssues } from '../src/shared/phpVariableAnalyzer';
import {
  DatabaseService,
  buildCreateTableDdl,
  detectSimpleSelectRef,
  detectSimpleSelectTable
} from '../src/main/services/databaseService';
import {
  applySqlInlineParams,
  classifyReferenceLineKind,
  detectPhpSqlContext,
  detectPhpSqlSecurityRisks,
  extractFallbackSqlEntities,
  extractPhpEmbeddedSqlStatements,
  extractReferencedSqlTables,
  extractSqlInlineParams,
  substituteSqlTestParams,
  validateSqlAgainstSchema
} from '../src/shared/sqlSchemaAnalyzer';
import {
  buildErDiagramGraph,
  diffDatabaseSchemas
} from '../src/shared/dbSchemaTools';
import {
  buildJoinQueryOutputs,
  buildJoinSpecFromSelectedTables,
  compileWhereRulesToSql,
  detectAmbiguousJoinColumns,
  detectAmbiguousJoinDiagnosticsInSource,
  inferSmartJoinBetweenTables,
  learnJoinEdgesFromSources,
  suggestJoinCandidatesForQuery,
  suggestOnConditionsForLastJoin
} from '../src/shared/sqlJoinHelper';
import {
  buildAmbientWebExtraLibDts,
  detectLanguageFromPathAndContent,
  detectWebSubContext
} from '../src/shared/webAssetAnalyzer';
import {
  buildIslandDbTablesFromSchema,
  buildIslandSymbolsFromCatalogs,
  parseIslandSearchQuery,
  rankIslandSearchResults
} from '../src/shared/islandSearchEngine';
import {
  compileTableDesignerSql,
  createBlankTableDraft,
  createDraftFromExistingTable
} from '../src/shared/tableDesignerCompiler';
import {
  applyRowAnonymization,
  buildBatchUpsertSql,
  detectSensitiveColumnMasks
} from '../src/shared/dbDataSyncEngine';
import {
  analyzePreSaveHazards,
  stripAutoRemovableDebugTraps
} from '../src/shared/saveGuardAnalyzer';
import {
  buildExtractedFunctionCode,
  buildExtractedIncludeResult,
  previewSmartSymbolRename
} from '../src/shared/smartRefactorEngine';
import { generatePhpReportBundle } from '../src/shared/phpReportGenerator';
import {
  aggregateChartSeries,
  buildPivotMatrix,
  inferBestChartAxes
} from '../src/shared/queryVisualizerEngine';
import { analyzeQueryIndexRecommendations } from '../src/shared/sqlIndexAdvisor';
import { buildSeedSqlStatements } from '../src/shared/dbSmartSeederEngine';
import {
  createReleasePatchZipBuffer,
  scanModifiedFilesSince
} from '../src/main/services/releasePatchBuilder';
import { DbSchedulerService } from '../src/main/services/dbSchedulerService';
import { HttpClientService } from '../src/main/services/httpClientService';
import { LocalFolderTransferDriver } from '../src/main/services/localSyncDriver';
import { LogMonitorService, parseLogLines } from '../src/main/services/logMonitorService';
import type { RemoteTransferDriver } from '../src/main/services/transferTypes';
import type { ConnectionProfile } from '../src/shared/types';
import {
  applyLineRangePatches,
  extractFocusedErrorWindow,
  GeminiService,
  normalizeGeminiModel,
  parseStructuredJson,
  redactSecretsFromContext,
  stripMarkdownCodeFence
} from '../src/main/services/geminiService';
import { GitService } from '../src/main/services/git';
import { IgnoreFilter } from '../src/main/services/ignoreFilter';
import {
  LaravelService,
  extractSafeEnvKeyNames
} from '../src/main/services/laravelService';
import { LocalHistoryService } from '../src/main/services/localHistory';
import { PhpLanguageService } from '../src/main/services/phpService';
import { PreviewServerService } from '../src/main/services/previewServer';
import { ProjectManager, dedupeSavedProjectTabs } from '../src/main/services/projects';
import { RubleManager } from '../src/main/services/rubles';
import { SynchronizerEngine } from '../src/main/services/synchronizer';
import {
  WisanggeniService,
  parseWisanggeniSqlDump
} from '../src/main/services/wisanggeniService';
import { WorkspaceService } from '../src/main/services/workspace';
import { formatCodeByLanguage } from '../src/shared/codeFormatter';
import { extractCodeOutline } from '../src/shared/codeOutline';

describe('Aptana Studio 4 Modern Services Suite', () => {
  let tempRoot = '';

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'aptana4-test-'));
  });

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('IgnoreFilter menghormati pola default dan file .aptanaignore', async () => {
    await writeFile(join(tempRoot, '.aptanaignore'), 'secret-config.json\nbuild/**\n*.tmp\n');
    const filter = IgnoreFilter.fromWorkspace(tempRoot);

    expect(filter.isIgnored('.git/HEAD')).toBe(true);
    expect(filter.isIgnored('node_modules/react/index.js')).toBe(true);
    expect(filter.isIgnored('secret-config.json')).toBe(true);
    expect(filter.isIgnored('cache/data.tmp')).toBe(true);
    expect(filter.isIgnored('src/index.html')).toBe(false);
  });

  it('ConnectionManager mengenkripsi password dan tidak pernah menyimpannya sebagai plaintext', async () => {
    const storageDir = join(tempRoot, 'userdata');
    const manager = new ConnectionManager(storageDir, new FallbackAesVault('unit-test-seed'));

    const saved = await manager.save({
      profile: {
        name: 'Staging SFTP',
        protocol: 'sftp',
        host: '10.0.0.15',
        port: 22,
        username: 'deploy',
        remotePath: '/srv/www',
        authType: 'password',
        keepSynchronized: true,
        ignorePatterns: ['.git', 'node_modules']
      },
      password: 'SuperSecretPassword!2026'
    });

    expect(saved.hasSavedSecret).toBe(true);

    const rawProfilesJson = await readFile(join(storageDir, 'connections.json'), 'utf-8');
    const rawVaultJson = await readFile(join(storageDir, 'connections.vault.json'), 'utf-8');
    expect(rawProfilesJson).not.toContain('SuperSecretPassword!2026');
    expect(rawVaultJson).not.toContain('SuperSecretPassword!2026');

    const decrypted = await manager.getSecrets(saved.id);
    expect(decrypted.password).toBe('SuperSecretPassword!2026');
  });

  it('SynchronizerEngine melakukan diff dua arah dan eksekusi Keep-Synchronized dengan akurat', async () => {
    const localDir = join(tempRoot, 'local-ws');
    const remoteDir = join(tempRoot, 'remote-target');
    const storageDir = join(tempRoot, 'userdata');

    const ws = new WorkspaceService();
    await ws.createEntry(join(localDir, 'index.html'), false, '<h1>Local v1</h1>');
    await ws.createEntry(join(localDir, 'node_modules', 'pkg.js'), false, 'ignored');
    await ws.createEntry(join(remoteDir, 'remote-only.css'), false, 'body { color: orange; }');

    const connMgr = new ConnectionManager(storageDir, new FallbackAesVault('sync-seed'));
    const conn = await connMgr.save({
      profile: {
        name: 'Local Staging Target',
        protocol: 'local',
        host: 'localhost',
        port: 0,
        username: 'local',
        remotePath: remoteDir,
        authType: 'none',
        keepSynchronized: true,
        ignorePatterns: ['.git', 'node_modules', '*.log']
      }
    });

    const sync = new SynchronizerEngine(connMgr);
    const plan = await sync.compare(conn.id, localDir, 'bidirectional');

    expect(plan.ignoredCount).toBeGreaterThanOrEqual(1);
    const indexItem = plan.items.find((i) => i.relativePath === 'index.html');
    const remoteItem = plan.items.find((i) => i.relativePath === 'remote-only.css');

    expect(indexItem?.status).toBe('upload-new');
    expect(indexItem?.action).toBe('upload');
    expect(remoteItem?.status).toBe('download-new');
    expect(remoteItem?.action).toBe('download');

    const execRes = await sync.execute(conn.id, localDir, plan.items);
    expect(execRes.uploaded).toBe(1);
    expect(execRes.downloaded).toBe(1);
    expect(execRes.failed).toBe(0);

    // Pastikan setelah sinkronisasi semua file identik
    const planAfter = await sync.compare(conn.id, localDir, 'bidirectional');
    expect(planAfter.items.length).toBe(0);
    expect(planAfter.identicalCount).toBe(2);

    // Uji deteksi modifikasi lebih baru & Keep-Synchronized (Auto-Upload on Save)
    const futureDate = new Date(Date.now() + 10000);
    const updatedFile = join(localDir, 'index.html');
    await writeFile(updatedFile, '<h1>Updated via Keep-Synchronized</h1>', 'utf-8');
    await utimes(updatedFile, futureDate, futureDate);

    await sync.autoSyncSavedFile(localDir, updatedFile);
    const remoteSyncedContent = await readFile(join(remoteDir, 'index.html'), 'utf-8');
    expect(remoteSyncedContent).toBe('<h1>Updated via Keep-Synchronized</h1>');

    // Uji Direct Remote File Editing (buka dari Remote Browser -> edit -> Ctrl+S simpan ke server)
    await connMgr.writeRemoteFile(conn.id, 'api/rekomendasi.php', '<?php echo "Edited directly!";');
    const directReadBack = await connMgr.readRemoteFile(conn.id, 'api/rekomendasi.php');
    expect(directReadBack).toBe('<?php echo "Edited directly!";');

    // Uji Buat Folder Baru, Buat File Baru, Rename, dan Delete langsung di Remote Server
    await connMgr.createRemoteEntry(conn.id, 'modul_baru/sub', true);
    await connMgr.createRemoteEntry(
      conn.id,
      'modul_baru/sub/proses.php',
      false,
      '<?php echo "File Baru";'
    );

    // Pastikan proteksi anti-timpa bekerja saat membuat file dengan nama yang sudah ada
    await expect(
      connMgr.createRemoteEntry(conn.id, 'modul_baru/sub/proses.php', false, 'timpa')
    ).rejects.toThrow();

    const subEntries = await connMgr.listRemoteDir(conn.id, 'modul_baru/sub');
    expect(subEntries.some((e) => e.name === 'proses.php' && !e.isDirectory)).toBe(true);

    // Rename file remote
    await connMgr.renameRemoteEntry(
      conn.id,
      'modul_baru/sub/proses.php',
      'modul_baru/sub/proses_final.php'
    );
    const renamedContent = await connMgr.readRemoteFile(conn.id, 'modul_baru/sub/proses_final.php');
    expect(renamedContent).toBe('<?php echo "File Baru";');

    // Hapus folder remote beserta isinya
    await connMgr.deleteRemoteEntry(conn.id, 'modul_baru', true);
    const rootRemoteEntries = await connMgr.listRemoteDir(conn.id, '');
    expect(rootRemoteEntries.some((e) => e.name === 'modul_baru')).toBe(false);
  });

  it('RubleManager memuat bundel bawaan serta menyimpan/menghapus snippet dan command kustom', async () => {
    const rubles = new RubleManager(join(tempRoot, 'rubles-store'));
    const initial = await rubles.list();
    expect(initial.some((b) => b.id === 'ruble-html-modern')).toBe(true);

    const afterAdd = await rubles.saveSnippet({
      trigger: 'hero-custom',
      name: 'Custom Hero Block',
      scope: 'html',
      description: 'Test snippet',
      body: '<div class="custom-hero">$0</div>'
    });

    const customBundle = afterAdd.find((b) => !b.builtIn);
    expect(customBundle?.snippets).toHaveLength(1);
    expect(customBundle?.snippets[0].trigger).toBe('hero-custom');

    const afterDelete = await rubles.deleteSnippet(customBundle!.snippets[0].id);
    expect(afterDelete.find((b) => !b.builtIn)?.snippets).toHaveLength(0);
  });

  it('ProjectManager menyimpan, memuat ulang, serta mengekspor/membuka file .hmwproj dengan utuh', async () => {
    const storageDir = join(tempRoot, 'hmw-userdata');
    const projects = new ProjectManager(storageDir);

    const saved = await projects.save({
      name: 'Aplikasi Rekomendasi Aju',
      notes: 'Server Produksi PHP',
      workspacePath: 'D:/Web/rekomendasi',
      connectionId: 'conn-prod-1',
      remoteSubPath: 'public_html/rekomendasi',
      openTabs: [
        {
          kind: 'remote',
          filePath: 'Produksi:public_html/rekomendasi/index.php',
          relativePath: 'public_html/rekomendasi/index.php',
          remoteConnectionId: 'conn-prod-1'
        }
      ],
      activeTabKey: 'remote:conn-prod-1:public_html/rekomendasi/index.php'
    });

    expect(saved.id).toMatch(/^proj-/);
    const listed = await projects.list();
    expect(listed).toHaveLength(1);
    expect(listed[0].name).toBe('Aplikasi Rekomendasi Aju');
    expect(listed[0].remoteSubPath).toBe('public_html/rekomendasi');
    expect(listed[0].openTabs).toHaveLength(1);

    // Ekspor ke file .hmwproj dan buka kembali pada instance ProjectManager baru
    const exportedFile = join(tempRoot, 'RekomendasiAju.hmwproj');
    await projects.exportToFile(exportedFile, {
      id: saved.id,
      name: saved.name,
      notes: saved.notes,
      workspacePath: saved.workspacePath,
      connectionId: saved.connectionId,
      remoteSubPath: saved.remoteSubPath,
      openTabs: saved.openTabs,
      activeTabKey: saved.activeTabKey
    });

    const freshManager = new ProjectManager(join(tempRoot, 'other-pc-userdata'));
    const reopened = await freshManager.openFromFile(exportedFile);
    expect(reopened.name).toBe('Aplikasi Rekomendasi Aju');
    expect(reopened.connectionId).toBe('conn-prod-1');
    expect(reopened.openTabs[0]?.relativePath).toBe('public_html/rekomendasi/index.php');

    await freshManager.remove(reopened.id);
    expect(await freshManager.list()).toHaveLength(0);
  });

  it('PhpLanguageService melakukan ekstraksi simbol proyek, katalog PHP, dan validasi sintaks php -l', async () => {
    const phpDir = join(tempRoot, 'php-app');
    const ws = new WorkspaceService();
    await ws.createEntry(
      join(phpDir, 'helper.php'),
      false,
      `<?php
class RekomendasiService {
  public int $total = 0;
  public function cekPosisi(array $rekom): bool {
    return $rekom["id_rekomendasi_aju"] > 0 && $rekom["ssm"] == 1;
  }
}

function formatNomorAju(string $nomor, int $tahun = 2026): string {
  return $nomor . "/" . $tahun;
}
`
    );

    const phpSvc = new PhpLanguageService();
    const scanned = await phpSvc.scanWorkspace(phpDir);
    expect(scanned.functions.some((f) => f.name === 'formatNomorAju')).toBe(true);
    expect(scanned.classes.some((c) => c.name === 'RekomendasiService')).toBe(true);
    expect(scanned.arrayKeys).toContain('id_rekomendasi_aju');
    expect(scanned.arrayKeys).toContain('ssm');

    const catalog = await phpSvc.getCatalog();
    if (catalog.available) {
      expect(catalog.functions.length).toBeGreaterThan(500);
      expect(catalog.functions.some((f) => f.name === 'substr')).toBe(true);

      const validLint = await phpSvc.lint('<?php $x = 10 + 20; echo $x;');
      expect(validLint.diagnostics).toHaveLength(0);

      const brokenLint = await phpSvc.lint('<?php\n$x = 10\necho $x;');
      expect(brokenLint.diagnostics.length).toBeGreaterThan(0);
      expect(brokenLint.diagnostics[0].severity).toBe('error');
    }
  });

  it('WorkspaceService, PreviewServerService, dan GitService bekerja secara end-to-end', async () => {
    const projectDir = join(tempRoot, 'sample-web');
    const ws = new WorkspaceService();
    await ws.createSampleProject(projectDir);

    const matches = await ws.searchInFiles(projectDir, 'HMW Studio');
    expect(matches.length).toBeGreaterThan(0);

    // Uji Live Web Preview HTTP Server + injeksi SSE reload script
    const preview = new PreviewServerService();
    const state = await preview.start(projectDir);
    expect(state.running).toBe(true);

    const response = await fetch(`${state.url}index.html`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('__aptana_live_reload');
    await preview.stop();

    // Uji GitService init -> stage -> commit -> fileDiff
    const gitSvc = new GitService();
    const initSt = await gitSvc.init(projectDir);
    expect(initSt.isRepo).toBe(true);
    expect(initSt.changes.length).toBeGreaterThan(0);

    // Set identitas git lokal sementara di repo uji agar commit tidak bergantung global git config
    const { simpleGit } = await import('simple-git');
    const rawGit = simpleGit(projectDir);
    await rawGit.addConfig('user.name', 'Aptana Test');
    await rawGit.addConfig('user.email', 'test@aptana.local');

    await gitSvc.stage(projectDir, ['index.html']);
    const afterCommit = await gitSvc.commit(projectDir, 'Initial commit from Aptana Studio 4');
    expect(afterCommit.recentCommits[0]?.message).toBe('Initial commit from Aptana Studio 4');

    await ws.writeFile(join(projectDir, 'index.html'), '<!DOCTYPE html><h1>Changed!</h1>');
    const diff = await gitSvc.fileDiff(projectDir, 'index.html');
    expect(diff.original).toContain('Selamat Datang di Workspace Modern');
    expect(diff.modified).toContain('<h1>Changed!</h1>');
  });

  it('LocalHistoryService menyimpan timeline backup otomatis, deduplikasi SHA-256, dan memulihkan isi untuk Rollback', async () => {
    const history = new LocalHistoryService(join(tempRoot, 'userdata'));
    const fileKey = 'remote:conn-1:public_html/rekomendasi.php';

    const snap1 = await history.record({
      fileKey,
      label: 'Versi Awal dari Server',
      sourceKind: 'remote',
      displayPath: 'Prod:public_html/rekomendasi.php',
      connectionId: 'conn-1',
      relativePath: 'public_html/rekomendasi.php',
      content: '<?php echo "v1";'
    });
    expect(snap1).not.toBeNull();

    // Simpan isi identik berturut-turut -> tidak boleh membuat duplikat baru
    const snapDup = await history.record({
      fileKey,
      label: 'Disimpan ke Server',
      sourceKind: 'remote',
      displayPath: 'Prod:public_html/rekomendasi.php',
      connectionId: 'conn-1',
      relativePath: 'public_html/rekomendasi.php',
      content: '<?php echo "v1";'
    });
    expect(snapDup?.id).toBe(snap1?.id);

    // Simpan versi perubahan baru
    await new Promise((r) => setTimeout(r, 15));
    const snap2 = await history.record({
      fileKey,
      label: 'Disimpan ke Server',
      sourceKind: 'remote',
      displayPath: 'Prod:public_html/rekomendasi.php',
      connectionId: 'conn-1',
      relativePath: 'public_html/rekomendasi.php',
      content: '<?php echo "v2-updated";'
    });
    expect(snap2?.id).not.toBe(snap1?.id);

    const timeline = await history.list(fileKey);
    expect(timeline).toHaveLength(2);
    expect(timeline[0].id).toBe(snap2?.id);
    expect(timeline[1].id).toBe(snap1?.id);

    // Pastikan isi versi awal utuh 100% saat ditarik untuk Rollback
    const rollbackContent = await history.getContent(snap1!.id);
    expect(rollbackContent).toBe('<?php echo "v1";');

    await history.clear(fileKey);
    expect(await history.list(fileKey)).toHaveLength(0);
  });

  it('ConnectionManager mendukung Drag-and-Drop Multi-Upload (file & folder), Remote Search in Files, dan CHMOD', async () => {
    const dropSourceDir = join(tempRoot, 'explorer-drop');
    const remoteDir = join(tempRoot, 'remote-srv');
    const storageDir = join(tempRoot, 'userdata');

    const ws = new WorkspaceService();
    await ws.createEntry(
      join(dropSourceDir, 'single.php'),
      false,
      '<?php\n$posisi = "Perush - Kirim Data";\n'
    );
    await ws.createEntry(
      join(dropSourceDir, 'modul_aju', 'detail.php'),
      false,
      '<?php\n// Query rekomendasi\n$sql = "SELECT * FROM rekomendasi WHERE id_rekomendasi_aju = 10";\n'
    );

    const connMgr = new ConnectionManager(storageDir, new FallbackAesVault('remote-ops-seed'));
    const conn = await connMgr.save({
      profile: {
        name: 'Server Uji Remote',
        protocol: 'local',
        host: 'localhost',
        port: 0,
        username: 'admin',
        remotePath: remoteDir,
        authType: 'none',
        keepSynchronized: false,
        ignorePatterns: ['.git', 'node_modules']
      }
    });

    // 1. Uji Drag & Drop upload gabungan file dan folder bersarang ke subfolder remote
    const uploadRes = await connMgr.uploadMultiplePaths(
      conn.id,
      [join(dropSourceDir, 'single.php'), join(dropSourceDir, 'modul_aju')],
      'public_html'
    );
    expect(uploadRes.uploaded).toBe(2);
    expect(uploadRes.errors).toHaveLength(0);

    // 2. Uji Remote Find in Files langsung di server
    const remoteMatches = await connMgr.searchRemoteFiles(
      conn.id,
      'public_html',
      'id_rekomendasi_aju',
      false
    );
    expect(remoteMatches).toHaveLength(1);
    expect(remoteMatches[0].relativePath).toBe('public_html/modul_aju/detail.php');
    expect(remoteMatches[0].line).toBe(3);

    // 3. Uji CHMOD pada file remote
    await connMgr.chmodRemoteEntry(conn.id, 'public_html/single.php', '755');
    const remoteList = await connMgr.listRemoteDir(conn.id, 'public_html');
    expect(remoteList.some((e) => e.name === 'single.php')).toBe(true);
  });

  it('formatCodeByLanguage & extractCodeOutline merapikan PHP/SQL/JSON tanpa merusak string SQL multi-baris', () => {
    const messyPhp = `<?php
class PengajuanController {
public string $kode = 'AJU';
public function cekData($rekom){
$q = "SELECT * FROM tb_posisi
      WHERE id_rekomendasi_aju=" . $rekom["id"] . "
        AND posisi='Perush - Kirim Data'";
if ($rekom["ssm"]==1){
return true;
} else {
return false;
}
}
}
`;
    const formattedPhp = formatCodeByLanguage(messyPhp, 'php');
    // Pastikan blok class & method terindentasi rapi 4 spasi
    expect(formattedPhp).toContain('    public function cekData($rekom){');
    expect(formattedPhp).toContain('        if ($rekom["ssm"]==1){');
    expect(formattedPhp).toContain('            return true;');
    // Pastikan baris di dalam string SQL multi-baris tetap murni dan tidak rusak!
    expect(formattedPhp).toContain("      WHERE id_rekomendasi_aju=\" . $rekom[\"id\"] . \"");
    expect(formattedPhp).toContain("        AND posisi='Perush - Kirim Data'\";");

    // Uji SQL formatter menjaga isi literal tetap utuh dan meng-uppercase keyword SQL
    const formattedSql = formatCodeByLanguage(
      "select id, posisi from tb_posisi where posisi = 'select tetap kecil' order by tgl_posisi desc",
      'sql'
    );
    expect(formattedSql).toContain('SELECT id, posisi FROM tb_posisi');
    expect(formattedSql).toContain("'select tetap kecil'");

    // Uji Code Outline mengekstrak class, property, dan method beserta nomor baris akurat
    const outline = extractCodeOutline(formattedPhp, 'php');
    expect(outline.some((o) => o.kind === 'class' && o.name === 'PengajuanController')).toBe(true);
    expect(outline.some((o) => o.kind === 'property' && o.name === '$kode')).toBe(true);
    expect(outline.some((o) => o.kind === 'method' && o.name.startsWith('cekData('))).toBe(true);
  });

  it('WisanggeniService memindai class PHP 4/5 (var $prop & bare function), dokumentasi SQL, dan Ruble wis-* secara aman', async () => {
    const fakeWsg = join(tempRoot, 'wisanggeni');
    const ws = new WorkspaceService();

    // 1. Buat class gaya Wisanggeni (if (!class_exists) + var $prop + bare function)
    await ws.createEntry(
      join(fakeWsg, 'classes', 'TTabel.class.php'),
      false,
      `<?php
if (!class_exists('TTabel')) {
class TTabel {
  var $recordCount; // jumlah total baris hasil loadData
  var $judul_tabel;
  function __construct($title = '') {
    $this->judul_tabel = $title;
  }
  function TTabel($title = '') {
    $this->__construct($title);
  }
  function setJudul($ar_isi) {}
  function setCustomWisanggeniTest($kolom, $aktif = 1) {}
}
}
`
    );

    // File backup bertanggal & connect_db.php HARUS dilewati secara otomatis demi akurasi & keamanan
    await ws.createEntry(
      join(fakeWsg, 'classes', 'TTabel_20200507.class.php'),
      false,
      '<?php class ClassBackupLama { function janganMasuk() {} }'
    );
    await ws.createEntry(
      join(fakeWsg, 'connect_db.php'),
      false,
      '<?php function rahasiaConnectDb() {}'
    );
    await ws.createEntry(
      join(fakeWsg, 'main_lib.php'),
      false,
      '<?php function helperLokalWisanggeni($nip, $format = 0) { return $nip; }'
    );
    await ws.createEntry(
      join(fakeWsg, 'dokumentasi', 'wisanggeni_docs_schema.sql'),
      false,
      `INSERT INTO wisanggeni_docs (type, name, class_name, syntax, description, example) VALUES
('method', 'setCustomWisanggeniTest', 'TTabel', 'setCustomWisanggeniTest(string $kolom, int $aktif = 1)', 'Mengatur kolom uji dengan kutip \\'aman\\'.', '$tbl->setCustomWisanggeniTest("nama");'),
('function', 'helperLokalWisanggeni', NULL, 'helperLokalWisanggeni(string $nip, int $format = 0)', 'Mengambil info pegawai uji.', '$info = helperLokalWisanggeni("199001");');`
    );

    const parsedRows = parseWisanggeniSqlDump(
      await readFile(join(fakeWsg, 'dokumentasi', 'wisanggeni_docs_schema.sql'), 'utf-8')
    );
    expect(parsedRows).toHaveLength(2);
    expect(parsedRows[0].description).toContain("'aman'");

    const wsgSvc = new WisanggeniService();
    const catalog = await wsgSvc.getCatalog(true, fakeWsg);

    expect(catalog.available).toBe(true);
    expect(catalog.globalVarTypes.$page).toBe('TPage');
    expect(catalog.globalVarTypes.$query).toBe('TQuery');

    // Pastikan connect_db.php & file backup bertanggal TIDAK pernah dipindai
    expect(catalog.functions.some((f) => f.name === 'rahasiaConnectDb')).toBe(false);
    expect(catalog.classes.some((c) => c.name === 'ClassBackupLama')).toBe(false);

    // Pastikan TTabel memiliki var $recordCount (beserta komentar inline), method custom, & constructorParams
    const tTabel = catalog.classes.find((c) => c.name === 'TTabel');
    expect(tTabel).toBeDefined();
    expect(tTabel?.constructorParams?.length).toBeGreaterThanOrEqual(1);
    const propRec = tTabel?.members.find((m) => m.kind === 'property' && m.name === 'recordCount');
    expect(propRec).toBeDefined();
    expect(propRec?.doc).toContain('jumlah total baris');

    const customMethod = tTabel?.members.find((m) => m.name === 'setCustomWisanggeniTest');
    expect(customMethod).toBeDefined();
    expect(customMethod?.doc).toContain("kutip 'aman'");

    // Pastikan helper global Wisanggeni & Ruble wis-* tersedia lengkap
    expect(catalog.functions.some((f) => f.name === 'getGET')).toBe(true);
    expect(catalog.functions.some((f) => f.name === 'helperLokalWisanggeni')).toBe(true);

    const rubles = new RubleManager(join(tempRoot, 'ruble-wsg'));
    const allBundles = await rubles.list();
    const wsgBundle = allBundles.find((b) => b.id === 'ruble-wisanggeni-framework');
    expect(wsgBundle).toBeDefined();
    expect(wsgBundle?.snippets.some((s) => s.trigger === 'wis-tabel')).toBe(true);
    expect(wsgBundle?.snippets.some((s) => s.trigger === 'wis-form')).toBe(true);
    expect(wsgBundle?.snippets.some((s) => s.trigger === 'wis-save')).toBe(true);

    // Jika C:\xampp3\htdocs\intranew8\wisanggeni tersedia di mesin lokal, verifikasi auto-scan riilnya
    if (existsSync('C:\\xampp3\\htdocs\\intranew8\\wisanggeni')) {
      const realSvc = new WisanggeniService();
      const realCat = await realSvc.getCatalog(true);
      expect(realCat.rootPath).toBe('C:\\xampp3\\htdocs\\intranew8\\wisanggeni');
      expect(realCat.stats.classCount).toBeGreaterThan(30);
      expect(realCat.stats.methodCount).toBeGreaterThan(150);
      expect(realCat.stats.functionCount).toBeGreaterThan(100);
      console.info('[Wisanggeni Auto-Scan Stats]', JSON.stringify(realCat.stats));
    }
  });

  it('ProjectManager mencegah dan membersihkan tab ganda (duplicate tabs) pada penyimpanan & pembacaan proyek', async () => {
    const storageDir = join(tempRoot, 'dedupe-userdata');
    const projects = new ProjectManager(storageDir);

    const saved = await projects.save({
      name: 'Intranew8 Remote',
      workspacePath: null,
      connectionId: 'conn-intra',
      remoteSubPath: 'hmw',
      openTabs: [
        {
          kind: 'remote',
          filePath: 'Intranew8:hmw/index.php',
          relativePath: 'hmw/index.php',
          remoteConnectionId: 'conn-intra'
        },
        {
          kind: 'remote',
          filePath: 'Intranew8:/hmw/index.php',
          relativePath: '/hmw\\index.php',
          remoteConnectionId: 'conn-intra'
        },
        {
          kind: 'remote',
          filePath: 'Intranew8:hmw/jenis_komoditi.php',
          relativePath: 'hmw/jenis_komoditi.php',
          remoteConnectionId: 'conn-intra'
        },
        {
          kind: 'remote',
          filePath: 'Intranew8:hmw/jenis_komoditi.php',
          relativePath: 'hmw/jenis_komoditi.php',
          remoteConnectionId: 'conn-intra'
        },
        {
          kind: 'local',
          filePath: 'D:\\Web\\app.php',
          relativePath: 'app.php'
        },
        {
          kind: 'local',
          filePath: 'd:/web/app.php',
          relativePath: 'app.php'
        }
      ]
    });

    expect(saved.openTabs).toHaveLength(3);
    expect(dedupeSavedProjectTabs(saved.openTabs)).toHaveLength(3);

    // Simulasikan file projects.json lama yang sudah terlanjur menyimpan tab ganda di disk
    await writeFile(
      join(storageDir, 'projects.json'),
      JSON.stringify([
        {
          ...saved,
          openTabs: [...saved.openTabs, ...saved.openTabs]
        }
      ]),
      'utf-8'
    );

    const reloaded = await projects.list();
    expect(reloaded[0].openTabs).toHaveLength(3);
  });

  it('GeminiService mengenkripsi API Key, menormalisasi model terkini, dan menyensor kredensial sensitif', async () => {
    const storageDir = join(tempRoot, 'gemini-vault-test');
    const gemini = new GeminiService(storageDir, new FallbackAesVault('gemini-test-seed'));

    const savedCfg = await gemini.saveConfig({
      apiKey: 'AIzaSyTestSecretKeyForUnitTesting7890',
      model: 'gemini-4-argon',
      ghostTextEnabled: true
    });

    expect(savedCfg.hasApiKey).toBe(true);
    expect(savedCfg.apiKeySource).toBe('vault');
    expect(savedCfg.maskedKey).toBe('AIza••••••••7890');
    expect(savedCfg.model).toBe('gemini-4-argon');
    expect(savedCfg.ghostTextEnabled).toBe(true);

    // Pastikan plaintext API Key TIDAK pernah muncul di file gemini.config.json
    const rawJson = await readFile(join(storageDir, 'gemini.config.json'), 'utf-8');
    expect(rawJson).not.toContain('AIzaSyTestSecretKeyForUnitTesting7890');

    // Pastikan model usang dinormalisasi otomatis ke gemini-4-hydrogen
    expect(normalizeGeminiModel('gemini-2.0-flash')).toBe('gemini-4-hydrogen');
    expect(normalizeGeminiModel('gemini-4-carbon')).toBe('gemini-4-carbon');

    // Pastikan connect_db.php dan variabel password PHP disensor 100% sebelum dikirim ke AI
    expect(redactSecretsFromContext('<?php $pw = "rahasia";', 'wisanggeni/connect_db.php')).toContain(
      'disensor otomatis'
    );
    const phpWithPw = `<?php
$my_password = 'SuperDatabasePassword99!';
define('DB_PASSWORD', 'ProdSecret88');
$judul = 'Master Jenis Komoditi';
`;
    const redacted = redactSecretsFromContext(phpWithPw, 'hmw/jenis_komoditi.php');
    expect(redacted).not.toContain('SuperDatabasePassword99!');
    expect(redacted).not.toContain('ProdSecret88');
    expect(redacted).toContain('[REDACTED_SECRET]');
    expect(redacted).toContain('Master Jenis Komoditi');

    // Uji penguraian JSON terstruktur & pembersih code fence
    const parsed = parseStructuredJson<{ fixedCode: string; explanation: string }>(
      '```json\n{"fixedCode":"<?php echo 1;","explanation":"Titik koma ditambahkan"}\n```'
    );
    expect(parsed.fixedCode).toBe('<?php echo 1;');
    expect(stripMarkdownCodeFence('```php\n<?php\necho "Halo";\n```')).toBe('<?php\necho "Halo";');
  });

  it('ConnectionManager mengedit profil koneksi secara in-place tanpa membuat duplikat & mempertahankan password terenkripsi', async () => {
    const storageDir = join(tempRoot, 'conn-edit-userdata');
    const connMgr = new ConnectionManager(storageDir, new FallbackAesVault('conn-edit-seed'));

    const created = await connMgr.save({
      profile: {
        name: 'Intranew8',
        protocol: 'sftp',
        host: '10.10.1.5',
        port: 22,
        username: 'deploy',
        remotePath: '/var/www/intranew8',
        authType: 'password',
        keepSynchronized: false,
        ignorePatterns: ['.git', 'node_modules']
      },
      password: 'PasswordAsliServer123!'
    });

    expect(created.hasSavedSecret).toBe(true);

    // Edit nama, host, remotePath, & keepSynchronized menggunakan ID yang sama TANPA mengisi ulang password
    const edited = await connMgr.save({
      profile: {
        id: created.id,
        name: 'Intranew8 Produksi',
        protocol: 'sftp',
        host: '10.10.1.99',
        port: 2222,
        username: 'deploy_prod',
        remotePath: '/var/www/intranew8_v2',
        authType: 'password',
        keepSynchronized: true,
        ignorePatterns: ['.git', 'node_modules', '*.bak']
      }
    });

    expect(edited.id).toBe(created.id);
    expect(edited.name).toBe('Intranew8 Produksi');
    expect(edited.host).toBe('10.10.1.99');
    expect(edited.port).toBe(2222);
    expect(edited.keepSynchronized).toBe(true);
    expect(edited.hasSavedSecret).toBe(true);

    // Pastikan TIDAK ada duplikat profil koneksi di daftar
    const all = await connMgr.list();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('Intranew8 Produksi');

    // Pastikan password terenkripsi di Vault tetap utuh saat tidak diubah
    const secrets = await connMgr.getSecrets(created.id);
    expect(secrets.password).toBe('PasswordAsliServer123!');

    // Hapus koneksi dan pastikan profil serta secret bersih
    await connMgr.remove(created.id);
    expect(await connMgr.list()).toHaveLength(0);
    expect(await connMgr.getSecrets(created.id)).toEqual({});
  });

  it('LaravelService menyediakan katalog Facade/Eloquent/Blade bawaan & memindai Route, Blade View, Model, Config, serta kunci .env tanpa membocorkan secret', async () => {
    const lv = new LaravelService();

    // 1. Katalog Core tanpa workspace lokal (berguna saat edit file remote SFTP)
    const coreOnly = await lv.getCatalog(null);
    expect(coreOnly.isLaravelProject).toBe(false);
    expect(coreOnly.classes.some((c) => c.name === 'Route')).toBe(true);
    expect(coreOnly.classes.some((c) => c.name === 'EloquentBuilder')).toBe(true);
    expect(coreOnly.classes.some((c) => c.name === 'Blueprint')).toBe(true);
    expect(coreOnly.functions.some((f) => f.name === 'route')).toBe(true);
    expect(coreOnly.functions.some((f) => f.name === 'collect')).toBe(true);
    expect(coreOnly.bladeDirectives.some((d) => d.name === '@foreach')).toBe(true);
    expect(coreOnly.validationRules.some((r) => r.name === 'unique:')).toBe(true);

    // 2. Buat struktur proyek Laravel 11 simulasi
    const lvRoot = join(tempRoot, 'sample-laravel');
    const ws = new WorkspaceService();
    await ws.createEntry(join(lvRoot, 'artisan'), false, '#!/usr/bin/env php\n<?php\n');
    await ws.createEntry(
      join(lvRoot, 'composer.json'),
      false,
      JSON.stringify({ require: { php: '^8.2', 'laravel/framework': '^11.30' } }, null, 2)
    );
    await ws.createEntry(
      join(lvRoot, 'routes', 'web.php'),
      false,
      `<?php
use App\\Http\\Controllers\\InvoiceController;
use Illuminate\\Support\\Facades\\Route;

Route::get('/dashboard', [DashboardController::class, 'index'])->name('dashboard');
Route::name('admin.')->prefix('admin')->group(function () {
    Route::get('/reports', [ReportController::class, 'index'])->name('reports.index');
    Route::resource('invoices', InvoiceController::class);
});
`
    );
    await ws.createEntry(
      join(lvRoot, 'resources', 'views', 'layouts', 'app.blade.php'),
      false,
      '<html><body>@yield("content")</body></html>'
    );
    await ws.createEntry(
      join(lvRoot, 'resources', 'views', 'invoices', 'index.blade.php'),
      false,
      '@extends("layouts.app")'
    );
    await ws.createEntry(
      join(lvRoot, 'config', 'services.php'),
      false,
      `<?php
return [
    'midtrans' => [
        'merchant_id' => env('MIDTRANS_MERCHANT_ID'),
        'is_production' => false,
    ],
];
`
    );
    await ws.createEntry(
      join(lvRoot, '.env'),
      false,
      'APP_KEY=base64:SUPER_SECRET_PRIVATE_KEY_DO_NOT_LEAK\nMIDTRANS_MERCHANT_ID=G999888777\n'
    );
    await ws.createEntry(
      join(lvRoot, 'app', 'Models', 'Invoice.php'),
      false,
      `<?php
namespace App\\Models;
use Illuminate\\Database\\Eloquent\\Model;

class Invoice extends Model
{
    protected $fillable = ['invoice_number', 'total_amount', 'paid_at'];

    protected function casts(): array
    {
        return [
            'paid_at' => 'datetime',
            'total_amount' => 'float',
        ];
    }

    public function scopeUnpaid($query)
    {
        return $query->whereNull('paid_at');
    }

    public function customer()
    {
        return $this->belongsTo(Customer::class);
    }
}
`
    );

    const scanned = await lv.getCatalog(lvRoot);
    expect(scanned.isLaravelProject).toBe(true);
    expect(scanned.laravelVersion).toBe('^11.30');

    // Named routes & Route::resource expansion inside named group
    const routeNames = scanned.routes.map((r) => r.name);
    expect(routeNames).toContain('dashboard');
    expect(routeNames).toContain('admin.reports.index');
    expect(routeNames).toContain('admin.invoices.index');
    expect(routeNames).toContain('admin.invoices.store');
    expect(routeNames).toContain('admin.invoices.destroy');

    // Blade views dot-notation
    const viewNames = scanned.views.map((v) => v.name);
    expect(viewNames).toContain('layouts.app');
    expect(viewNames).toContain('invoices.index');

    // Config dot-keys (2-level nested)
    const cfgKeys = scanned.configKeys.map((c) => c.key);
    expect(cfgKeys).toContain('services.midtrans');
    expect(cfgKeys).toContain('services.midtrans.merchant_id');

    // Eloquent Model columns, cast types, scopeUnpaid -> unpaid(), and relationship
    const invoiceModel = scanned.classes.find((c) => c.name === 'Invoice');
    expect(invoiceModel).toBeDefined();
    expect(
      invoiceModel!.members.some((m) => m.kind === 'property' && m.name === 'invoice_number')
    ).toBe(true);
    expect(
      invoiceModel!.members.some(
        (m) => m.kind === 'property' && m.name === 'paid_at' && m.type === 'Carbon'
      )
    ).toBe(true);
    expect(
      invoiceModel!.members.some(
        (m) => m.kind === 'method' && m.isStatic && m.name === 'unpaid'
      )
    ).toBe(true);
    expect(
      invoiceModel!.members.some(
        (m) => m.kind === 'property' && m.name === 'customer' && m.type === 'Customer'
      )
    ).toBe(true);

    // Keamanan .env: Nama key wajib ada, tetapi nilai rahasia TIDAK BOLEH pernah ikut tersimpan
    expect(scanned.envKeys).toContain('MIDTRANS_MERCHANT_ID');
    const serialized = JSON.stringify(scanned);
    expect(serialized).not.toContain('SUPER_SECRET_PRIVATE_KEY_DO_NOT_LEAK');
    expect(serialized).not.toContain('G999888777');
    expect(extractSafeEnvKeyNames('SECRET_TOKEN=xyz123\n#COMMENT=1')).toEqual(['SECRET_TOKEN']);
  });

  it('SynchronizerEngine & SftpTransferDriver wajib melempar error jelas saat SFTP tidak terhubung (bukan mengembalikan sinkron palsu)', async () => {
    const localDir = join(tempRoot, 'local-offline');
    const storageDir = join(tempRoot, 'userdata-offline');
    const ws = new WorkspaceService();
    await ws.createEntry(join(localDir, 'index.php'), false, '<?php echo 1;');

    const connMgr = new ConnectionManager(storageDir, new FallbackAesVault('offline-seed'));
    const offlineConn = await connMgr.save({
      profile: {
        name: 'Intranew8 Offline',
        protocol: 'sftp',
        host: '127.0.0.1',
        port: 59997,
        username: 'root',
        remotePath: '/var/www/html/intranew8',
        authType: 'password',
        keepSynchronized: false,
        ignorePatterns: ['.git']
      },
      password: 'invalid'
    });

    const sync = new SynchronizerEngine(connMgr);
    await expect(sync.compare(offlineConn.id, localDir, 'pull')).rejects.toThrow(
      /Tidak dapat terhubung ke SFTP "Intranew8 Offline" \(127\.0\.0\.1:59997\)/
    );
    await expect(connMgr.listRemoteDir(offlineConn.id, '')).rejects.toThrow(
      /Tidak dapat terhubung ke SFTP "Intranew8 Offline" \(127\.0\.0\.1:59997\)/
    );
  });

  it('Cut/Copy/Paste (Ctrl+X / Ctrl+C / Ctrl+V) mendukung 4 arah penuh: Lokal↔Lokal, Remote↔Remote, Lokal→Remote, dan Remote→Lokal', async () => {
    const localRoot = join(tempRoot, 'clip-local');
    const remoteTarget = join(tempRoot, 'clip-remote-server');
    const storageDir = join(tempRoot, 'userdata-clip');

    const ws = new WorkspaceService();
    await ws.createEntry(join(localRoot, 'modul.php'), false, '<?php echo "hmw";');
    await ws.createEntry(join(localRoot, 'sub'), true);

    // 1. Lokal -> Lokal: Copy di folder sama menghasilkan _copy, lalu Cut pindah ke sub/
    const dup = await ws.copyOrMoveEntry(join(localRoot, 'modul.php'), localRoot, 'copy');
    expect(dup.destinationPath.endsWith('modul_copy.php')).toBe(true);
    const moved = await ws.copyOrMoveEntry(dup.destinationPath, join(localRoot, 'sub'), 'cut');
    expect(moved.destinationPath.replace(/\\/g, '/')).toContain('/sub/modul_copy.php');
    const subRead = await ws.readFile(moved.destinationPath);
    expect(subRead.content).toBe('<?php echo "hmw";');

    // Siapkan target server remote (driver local target memiliki kontrak penuh RemoteTransferDriver)
    await ws.createEntry(remoteTarget, true);
    const connMgr = new ConnectionManager(storageDir, new FallbackAesVault('clip-seed'));
    const srv = await connMgr.save({
      profile: {
        name: 'Server Clipboard',
        protocol: 'local',
        host: '',
        port: 0,
        username: '',
        remotePath: remoteTarget,
        authType: 'password',
        keepSynchronized: false,
        ignorePatterns: ['.git']
      }
    });

    // 2. Lokal -> Remote (Paste folder sub beserta isinya ke server)
    const up = await connMgr.uploadMultiplePaths(srv.id, [join(localRoot, 'sub')], '');
    expect(up.errors).toEqual([]);
    expect(up.uploaded).toBe(1);

    // 3. Remote -> Remote: Copy file di folder sama (_copy) dan Cut pindah ke folder arsip
    await connMgr.createRemoteEntry(srv.id, 'arsip', true);
    const remCopy = await connMgr.copyOrMoveRemoteEntry(
      srv.id,
      'sub/modul_copy.php',
      false,
      srv.id,
      'sub',
      'copy'
    );
    expect(remCopy.destRelativePath).toBe('sub/modul_copy_copy.php');

    const remMove = await connMgr.copyOrMoveRemoteEntry(
      srv.id,
      remCopy.destRelativePath,
      false,
      srv.id,
      'arsip',
      'cut'
    );
    expect(remMove.destRelativePath).toBe('arsip/modul_copy_copy.php');
    expect(await connMgr.readRemoteFile(srv.id, 'arsip/modul_copy_copy.php')).toBe(
      '<?php echo "hmw";'
    );

    // 4. Remote -> Lokal (Cut dari server ke folder lokal unduhan)
    const dlDir = join(localRoot, 'unduhan');
    const dl = await connMgr.downloadEntryToLocalDir(srv.id, 'arsip', true, dlDir, true);
    expect(dl.downloaded).toBe(1);
    const dlFile = await ws.readFile(join(dlDir, 'arsip', 'modul_copy_copy.php'));
    expect(dlFile.content).toBe('<?php echo "hmw";');
    const rootAfterCut = await connMgr.listRemoteDir(srv.id, '');
    expect(rootAfterCut.some((e) => e.name === 'arsip')).toBe(false);
    await connMgr.disposeAll();
  });

  it('ConnectionManager Persistent Pool menjaga koneksi tetap hidup (< 50ms), auto-reconnect saat socket terputus, dan replaceInRemoteFiles aman untuk variabel PHP $', async () => {
    const remoteDir = join(tempRoot, 'pool-srv');
    const storageDir = join(tempRoot, 'pool-userdata');
    const ws = new WorkspaceService();
    await ws.createEntry(
      join(remoteDir, 'pegawai_save.php'),
      false,
      '<?php\n$lama = $_POST["nip"];\necho $lama;\n'
    );

    let connectCount = 0;
    let simulateNextDrop = false;

    const customFactory = (profile: ConnectionProfile): RemoteTransferDriver => {
      const inner = new LocalFolderTransferDriver(profile);
      let alive = false;
      return {
        async connect() {
          connectCount += 1;
          await inner.connect();
          alive = true;
        },
        async disconnect() {
          alive = false;
          await inner.disconnect();
        },
        isAlive() {
          return alive;
        },
        listDirectory: (sub) => inner.listDirectory(sub),
        listRecursive: (f) => inner.listRecursive(f),
        async readFileText(rel) {
          if (simulateNextDrop) {
            simulateNextDrop = false;
            alive = false;
            const err = new Error('read ECONNRESET') as NodeJS.ErrnoException;
            err.code = 'ECONNRESET';
            throw err;
          }
          return inner.readFileText(rel);
        },
        writeFileText: (rel, txt) => inner.writeFileText(rel, txt),
        uploadFile: (l, r) => inner.uploadFile(l, r),
        downloadFile: (r, l) => inner.downloadFile(r, l),
        createEntry: (r, isDir, init) => inner.createEntry(r, isDir, init),
        deleteEntry: (r, isDir) => inner.deleteEntry(r, isDir),
        renameEntry: (o, n) => inner.renameEntry(o, n),
        chmodEntry: (r, m) => inner.chmodEntry(r, m),
        checkAbsoluteOrRelExists: (t) => inner.checkAbsoluteOrRelExists(t),
        readTailText: (t, b) => inner.readTailText(t, b)
      };
    };

    const mgr = new ConnectionManager(storageDir, new FallbackAesVault('pool-seed'), customFactory);
    const prof = await mgr.save({
      profile: {
        name: 'Pooled Server',
        protocol: 'local',
        host: '',
        port: 0,
        username: '',
        remotePath: remoteDir,
        authType: 'password',
        keepSynchronized: false,
        ignorePatterns: ['.git']
      }
    });

    // 3 operasi beruntun hanya melakukan connect() 1 kali berkat Persistent Pool!
    await mgr.listRemoteDir(prof.id, '');
    await mgr.readRemoteFile(prof.id, 'pegawai_save.php');
    await mgr.listRemoteDir(prof.id, '');
    expect(connectCount).toBe(1);
    const stats = mgr.poolStats();
    expect(stats).toHaveLength(1);
    expect(stats[0].operationsCount).toBe(3);

    // Simulasi socket mati (ECONNRESET) -> pool otomatis reconnect 1x tanpa melempar error ke user!
    simulateNextDrop = true;
    const contentAfterDrop = await mgr.readRemoteFile(prof.id, 'pegawai_save.php');
    expect(contentAfterDrop).toContain('$lama');
    expect(connectCount).toBe(2);

    // Global Replace di Remote SFTP dengan karakter literal $ PHP ($pegawai_baru) + auto-backup hook
    const backups: string[] = [];
    const repRes = await mgr.replaceInRemoteFiles(
      prof.id,
      '',
      '$lama',
      '$pegawai_baru',
      { caseSensitive: true },
      async (rel, orig) => {
        backups.push(`${rel}:${orig.length}`);
      }
    );
    expect(repRes.filesModified).toBe(1);
    expect(repRes.occurrencesReplaced).toBe(2);
    expect(backups).toHaveLength(1);
    const updatedRemote = await mgr.readRemoteFile(prof.id, 'pegawai_save.php');
    expect(updatedRemote).toContain('$pegawai_baru = $_POST["nip"];');
    expect(updatedRemote).toContain('echo $pegawai_baru;');

    await mgr.disposeAll();
  });

  it('WorkspaceService mendukung Global Search & Replace ($ literal PHP) dan pemindaian TODO / FIXME proyek', async () => {
    const wsDir = join(tempRoot, 'replace-todo-ws');
    const ws = new WorkspaceService();
    await ws.createEntry(
      join(wsDir, 'modul_idx.php'),
      false,
      `<?php
// TODO: Tambahkan filter unit kerja
$kode_lama = "01";
// FIXME: Sanitasi parameter id dengan decid()
echo $kode_lama;
`
    );

    const todos = await ws.scanTodos(wsDir);
    expect(todos).toHaveLength(2);
    expect(todos[0].tag).toBe('TODO');
    expect(todos[0].line).toBe(2);
    expect(todos[1].tag).toBe('FIXME');
    expect(todos[1].line).toBe(4);

    let backedUpBefore = '';
    const rep = await ws.replaceInFiles(
      wsDir,
      '$kode_lama',
      "$kode_baru['$' + 1]",
      { caseSensitive: true },
      async (_fp, _rel, orig) => {
        backedUpBefore = orig;
      }
    );
    expect(rep.filesModified).toBe(1);
    expect(rep.occurrencesReplaced).toBe(2);
    expect(backedUpBefore).toContain('$kode_lama = "01";');

    const after = await ws.readFile(join(wsDir, 'modul_idx.php'));
    expect(after.content).toContain("$kode_baru['$' + 1] = \"01\";");
  });

  it('LogMonitorService mem-parsing log Apache/PHP/Laravel (file & nomor baris) dan melakukan live delta tailing', async () => {
    const sampleLogs = [
      '[Sun Nov 15 19:20:01.100 2026] [php:error] [pid 120] PHP Fatal error:  Uncaught Error: Call to undefined function decid_x() in /var/www/html/sipegi/pegawai_save.php on line 48',
      '[2026-11-15 19:21:10] local.ERROR: SQLSTATE[42S02]: Base table not found {"exception":"[object] (PDOException at /var/www/laravel/app/Http/Controllers/PegawaiController.php:93)',
      '#0 /var/www/laravel/vendor/framework.php(12): run()'
    ].join('\n');

    const parsed = parseLogLines(sampleLogs);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].level).toBe('fatal');
    expect(parsed[0].filePath).toBe('/var/www/html/sipegi/pegawai_save.php');
    expect(parsed[0].line).toBe(48);
    expect(parsed[1].level).toBe('error');
    expect(parsed[1].filePath).toBe(
      '/var/www/laravel/app/Http/Controllers/PegawaiController.php'
    );
    expect(parsed[1].line).toBe(93);

    // Uji live delta tailing lokal + fatal alert hook
    const logPath = join(tempRoot, 'error.log');
    await writeFile(logPath, '[19:00:00] Server ready\n', 'utf-8');

    const mgr = new ConnectionManager(join(tempRoot, 'log-userdata'), new FallbackAesVault('l'));
    const monitor = new LogMonitorService(mgr);

    const streamed: string[] = [];
    let fatalTriggered = 0;
    monitor.onEntries((items) => {
      for (const it of items) streamed.push(`${it.level}:${it.line ?? 0}`);
    });
    monitor.onFatalAlert(() => {
      fatalTriggered += 1;
    });

    await monitor.start({ kind: 'local', filePath: logPath, pollIntervalMs: 1000 });
    await writeFile(
      logPath,
      '[19:00:00] Server ready\n[19:00:02] PHP Fatal error: Syntax error in D:\\Projects\\app\\test.php on line 17\n',
      'utf-8'
    );

    await new Promise((r) => setTimeout(r, 1250));
    await monitor.stop();
    await mgr.disposeAll();

    expect(streamed).toContain('fatal:17');
    expect(fatalTriggered).toBe(1);
  });

  it('HttpClientService mengirim POST form-urlencoded + Cookie PHPSESSID dan menyimpan koleksi endpoint', async () => {
    const httpSvc = new HttpClientService(join(tempRoot, 'http-userdata'));

    let receivedCookie = '';
    let receivedBody = '';

    const srv = createHttpServer((req, res) => {
      receivedCookie = req.headers.cookie ?? '';
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        receivedBody = Buffer.concat(chunks).toString('utf-8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', method: req.method }));
      });
    });

    await new Promise<void>((resolveListen) => srv.listen(0, '127.0.0.1', resolveListen));
    const addr = srv.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    try {
      const res = await httpSvc.send({
        method: 'POST',
        url: `http://127.0.0.1:${port}/pegawai_save.php`,
        cookieSession: 'sesi_intranet_12345',
        bodyMode: 'urlencoded',
        formFields: [
          { key: 'act', value: 'save', enabled: true },
          { key: 'nip', value: '19900101', enabled: true }
        ]
      });

      expect(res.ok).toBe(true);
      expect(res.status).toBe(200);
      expect(res.isJson).toBe(true);
      expect(receivedCookie).toBe('PHPSESSID=sesi_intranet_12345');
      expect(receivedBody).toBe('act=save&nip=19900101');

      const saved = await httpSvc.saveRequest({
        name: 'Simpan Pegawai',
        method: 'POST',
        url: `http://127.0.0.1:${port}/pegawai_save.php`,
        bodyMode: 'urlencoded'
      });
      expect((await httpSvc.listSaved()).some((r) => r.id === saved.id)).toBe(true);
    } finally {
      await new Promise<void>((resolveClose) => srv.close(() => resolveClose()));
    }
  });

  it('DatabaseService mengenkripsi kredensial vault, mendeteksi tabel SELECT editable, dan membangun DDL CREATE TABLE', async () => {
    const dbDir = join(tempRoot, 'db-userdata');
    const dbSvc = new DatabaseService(dbDir, new FallbackAesVault('db-seed'));

    const saved = await dbSvc.save({
      profile: {
        name: 'DB Sipegi Intranet',
        engine: 'mysql',
        host: '127.0.0.1',
        port: 3306,
        username: 'hmw_admin',
        database: 'sipegi'
      },
      password: 'RahasiaDbPassword99!'
    });
    expect(saved.hasSavedSecret).toBe(true);

    const rawVault = await readFile(join(dbDir, 'databases.vault.json'), 'utf-8');
    expect(rawVault).not.toContain('RahasiaDbPassword99!');

    expect(detectSimpleSelectTable('SELECT * FROM `mst_pegawai` WHERE aktif = 1 LIMIT 50;')).toBe(
      'mst_pegawai'
    );
    expect(
      detectSimpleSelectTable('SELECT a.id FROM pegawai a INNER JOIN unit b ON a.kd = b.kd')
    ).toBeNull();

    const ddl = buildCreateTableDdl(
      {
        name: 'mst_pegawai',
        kind: 'table',
        primaryKeys: ['id_pegawai'],
        columns: [
          {
            name: 'id_pegawai',
            dataType: 'int',
            columnType: 'int(11)',
            nullable: false,
            isPrimaryKey: true,
            extra: 'auto_increment'
          },
          {
            name: 'nip',
            dataType: 'varchar',
            columnType: 'varchar(25)',
            nullable: false,
            isPrimaryKey: false
          }
        ]
      },
      'mysql'
    );
    expect(ddl).toContain('CREATE TABLE `mst_pegawai`');
    expect(ddl).toContain('PRIMARY KEY (`id_pegawai`)');

    expect(detectSimpleSelectRef('SELECT * FROM sipegi.mst_unitkerja LIMIT 20')).toEqual({
      schema: 'sipegi',
      table: 'mst_unitkerja'
    });
  });

  it('SQL Schema Analyzer mendeteksi database lintas-skema, query PHP multi-baris ber-concatenation, dan mengekstrak field fallback', () => {
    const multiLinePhpBeforeCursor = `<?php
function ListUnitKerja() {
  $spt_unt = mysql("select kd_unitkerja,kd_jenis_kantor,
  if(length(nama)>80,singkatan,nama) as nama,
  left(kd_tamat_eselon,1) as kd_tamat_eselon
  from sipegi.mst_unitkerja u
  where kd_unitkerja like '".substr($kd_unitkerja, 0, 4)."%' and aktif=1 and kd_`;

    const lastLine = multiLinePhpBeforeCursor.split('\n').pop()!;
    const ctx = detectPhpSqlContext(multiLinePhpBeforeCursor, lastLine);
    expect(ctx).not.toBeNull();
    expect(ctx?.mode).toBe('sql');
    expect(ctx?.activeSqlText).toContain('from sipegi.mst_unitkerja u');

    const refs = extractReferencedSqlTables(ctx!.activeSqlText);
    expect(refs.fullKeysLower.has('sipegi.mst_unitkerja')).toBe(true);
    expect(refs.aliasToRef.get('u')?.schemaLower).toBe('sipegi');
    expect(refs.aliasToRef.get('u')?.tableLower).toBe('mst_unitkerja');

    // Saat kursor mengetik variabel PHP `$kd_`, biarkan PHP Variable IntelliSense yang menangani
    const phpVarLine = `  where nip='$kd_`;
    expect(detectPhpSqlContext(`${multiLinePhpBeforeCursor}");\n$q = "where nip='$kd_`, phpVarLine)).toBeNull();

    // Builder tabel Laravel / Wisanggeni
    const tblBuilderCtx = detectPhpSqlContext(`<?php\nDB::table('sipegi.mst_`, `DB::table('sipegi.mst_`);
    expect(tblBuilderCtx?.mode).toBe('table-only');

    // Ekstraksi fallback otomatis dari kode PHP/SQL saat offline atau lintas server remote SFTP
    const fullPhpSample = `${multiLinePhpBeforeCursor}jenis_jabatan='1' order by kd_unitkerja");
  while ($spt = mysql_fetch_array($spt_unt)) {
    echo $spt['kd_unitkerja'] . $spt['singkatan_unit'];
  }`;
    const fallback = extractFallbackSqlEntities([fullPhpSample]);
    expect(fallback.databases).toContain('sipegi');
    const unitTbl = fallback.tables.find(
      (t) => t.schema === 'sipegi' && t.name === 'mst_unitkerja'
    );
    expect(unitTbl).toBeDefined();
    const colNames = unitTbl!.columns.map((c) => c.name);
    expect(colNames).toContain('kd_unitkerja');
    expect(colNames).toContain('kd_jenis_kantor');
    expect(colNames).toContain('aktif');
    expect(colNames).toContain('singkatan_unit');
  });

  it('Inline SQL CodeLens mengekstrak query PHP multi-baris beserta parameter $_SESSION/$var & mensubstitusi nilai uji aman', () => {
    const phpCode = `<?php
function ListPegawai() {
  $spt_unt = mysql("select kd_unitkerja, nama
  from sipegi.mst_unitkerja
  where nip='" . $_SESSION['_nip'] . "' and aktif=" . intval($status));
}
`;
    const stmts = extractPhpEmbeddedSqlStatements(phpCode);
    expect(stmts).toHaveLength(1);
    expect(stmts[0].params).toHaveLength(2);
    expect(stmts[0].params[0].expr).toContain("$_SESSION['_nip']");
    expect(stmts[0].primaryTable).toEqual({ schema: 'sipegi', table: 'mst_unitkerja' });

    const runnableSql = substituteSqlTestParams(stmts[0].sqlTemplate, stmts[0].params, {
      [stmts[0].params[0].key]: "19850101'2010",
      [stmts[0].params[1].key]: '1'
    });
    expect(runnableSql).toContain("where nip='19850101''2010'");
    expect(runnableSql).toContain('and aktif=1');
  });

  it('Real-Time SQL Schema Validator mendeteksi typo tabel, typo kolom, & tabel lintas-DB beserta Quick Fix (Ctrl+.)', () => {
    const mockSnapshot = {
      profileId: 'db-1',
      profileName: 'Intranet MySQL',
      engine: 'mysql' as const,
      currentDatabase: 'sipegi',
      databases: ['sipegi', 'simpel'],
      loadedAt: new Date().toISOString(),
      tables: [
        {
          schema: 'sipegi',
          name: 'mst_unitkerja',
          kind: 'table' as const,
          primaryKeys: ['kd_unitkerja'],
          columns: [
            { name: 'kd_unitkerja', dataType: 'varchar', columnType: 'varchar(10)', nullable: false, isPrimaryKey: true },
            { name: 'nama_unit', dataType: 'varchar', columnType: 'varchar(120)', nullable: false, isPrimaryKey: false }
          ]
        }
      ],
      allTables: [
        {
          schema: 'sipegi',
          name: 'mst_unitkerja',
          kind: 'table' as const,
          primaryKeys: ['kd_unitkerja'],
          columns: [
            { name: 'kd_unitkerja', dataType: 'varchar', columnType: 'varchar(10)', nullable: false, isPrimaryKey: true },
            { name: 'nama_unit', dataType: 'varchar', columnType: 'varchar(120)', nullable: false, isPrimaryKey: false }
          ]
        },
        {
          schema: 'simpel',
          name: 'rekomendasi',
          kind: 'table' as const,
          primaryKeys: ['id_rekomendasi'],
          columns: [
            { name: 'id_rekomendasi', dataType: 'int', columnType: 'int(11)', nullable: false, isPrimaryKey: true }
          ]
        }
      ]
    };

    // 1. Cross-DB table detection (`SELECT * FROM rekomendasi` when active DB is `sipegi` and table lives in `simpel`)
    const crossDbDiags = validateSqlAgainstSchema('SELECT * FROM rekomendasi', 'sql', mockSnapshot);
    expect(crossDbDiags.length).toBeGreaterThanOrEqual(1);
    expect(
      crossDbDiags.some((d) =>
        d.quickFixes.some((qf) => qf.replacement === 'simpel.rekomendasi')
      )
    ).toBe(true);

    // 2. Table typo + Column typo inside multi-line PHP SQL
    const typoPhp = `<?php\n$q = mysql("SELECT kd_unitkrja FROM sipegi.mst_unitkrja");`;
    const typoDiags = validateSqlAgainstSchema(typoPhp, 'php', mockSnapshot);
    expect(
      typoDiags.some((d) => d.quickFixes.some((qf) => qf.replacement === 'mst_unitkerja'))
    ).toBe(true);

    const colTypoPhp = `<?php\n$q = mysql("SELECT kd_unitkrja FROM sipegi.mst_unitkerja");`;
    const colDiags = validateSqlAgainstSchema(colTypoPhp, 'php', mockSnapshot);
    expect(
      colDiags.some((d) => d.quickFixes.some((qf) => qf.replacement === 'kd_unitkerja'))
    ).toBe(true);
  });

  it('SQL Injection Detector & Reference Classifier membedakan input mentah vs aman serta mengklasifikasikan jenis pemakaian', () => {
    const unsafeAndSafePhp = `<?php
$a = mysql("SELECT * FROM mst_pegawai WHERE id='" . $_GET['id'] . "'");
$b = mysql("SELECT * FROM mst_pegawai WHERE id=" . intval($_GET['id']));
$c = mysql("SELECT * FROM mst_pegawai WHERE nip='" . mysql_real_escape_string($_POST['nip']) . "'");
`;
    const risks = detectPhpSqlSecurityRisks(unsafeAndSafePhp);
    expect(risks).toHaveLength(1);
    expect(risks[0].rawExpr).toContain("$_GET['id']");
    expect(risks[0].quickFixes.length).toBeGreaterThanOrEqual(2);

    expect(classifyReferenceLineKind('$q = mysql("SELECT * FROM mst_unitkerja");', 'mst_unitkerja')).toBe('SELECT');
    expect(classifyReferenceLineKind('$q = mysql("UPDATE mst_unitkerja SET aktif=1");', 'mst_unitkerja')).toBe('UPDATE');
    expect(classifyReferenceLineKind('function ListUnitKerja($kode) {', 'ListUnitKerja')).toBe('DEF');
    expect(classifyReferenceLineKind('$html = ListUnitKerja($kd);', 'ListUnitKerja')).toBe('CALL');
  });

  it('Visual ER Diagram & 2-DB Schema Diff mendeteksi relasi FK/implisit serta men-generate migrasi CREATE & ALTER TABLE', () => {
    const sourceTables = [
      {
        schema: 'sipegi',
        name: 'mst_unitkerja',
        kind: 'table' as const,
        primaryKeys: ['kd_unitkerja'],
        columns: [
          { name: 'kd_unitkerja', dataType: 'varchar', columnType: 'varchar(10)', nullable: false, isPrimaryKey: true },
          { name: 'nama_unit', dataType: 'varchar', columnType: 'varchar(150)', nullable: false, isPrimaryKey: false }
        ]
      },
      {
        schema: 'sipegi',
        name: 'mst_pegawai',
        kind: 'table' as const,
        primaryKeys: ['nip'],
        columns: [
          { name: 'nip', dataType: 'varchar', columnType: 'varchar(20)', nullable: false, isPrimaryKey: true },
          { name: 'kd_unitkerja', dataType: 'varchar', columnType: 'varchar(10)', nullable: true, isPrimaryKey: false },
          { name: 'email_dinas', dataType: 'varchar', columnType: 'varchar(120)', nullable: true, isPrimaryKey: false }
        ]
      },
      {
        schema: 'sipegi',
        name: 'log_presensi',
        kind: 'table' as const,
        primaryKeys: ['id_log'],
        columns: [
          { name: 'id_log', dataType: 'bigint', columnType: 'bigint(20)', nullable: false, isPrimaryKey: true, extra: 'auto_increment' },
          { name: 'nip', dataType: 'varchar', columnType: 'varchar(20)', nullable: false, isPrimaryKey: false }
        ],
        foreignKeys: [
          {
            constraintName: 'fk_log_nip',
            column: 'nip',
            referencedTable: 'mst_pegawai',
            referencedColumn: 'nip'
          }
        ]
      }
    ];

    const er = buildErDiagramGraph(sourceTables, { includeImplicit: true });
    expect(er.nodes).toHaveLength(3);
    // Explicit FK (log_presensi.nip -> mst_pegawai.nip) + Implicit FK (mst_pegawai.kd_unitkerja -> mst_unitkerja.kd_unitkerja)
    expect(er.relations.some((e) => e.kind === 'explicit-fk' && e.fromTable === 'log_presensi')).toBe(true);
    expect(er.relations.some((e) => e.kind === 'implicit-key' && e.fromColumn === 'kd_unitkerja')).toBe(true);

    const targetTables = [
      {
        schema: 'sipegi_prod',
        name: 'mst_unitkerja',
        kind: 'table' as const,
        primaryKeys: ['kd_unitkerja'],
        columns: [
          { name: 'kd_unitkerja', dataType: 'varchar', columnType: 'varchar(10)', nullable: false, isPrimaryKey: true },
          { name: 'nama_unit', dataType: 'varchar', columnType: 'varchar(80)', nullable: false, isPrimaryKey: false }
        ]
      },
      {
        schema: 'sipegi_prod',
        name: 'mst_pegawai',
        kind: 'table' as const,
        primaryKeys: ['nip'],
        columns: [
          { name: 'nip', dataType: 'varchar', columnType: 'varchar(20)', nullable: false, isPrimaryKey: true },
          { name: 'kd_unitkerja', dataType: 'varchar', columnType: 'varchar(10)', nullable: true, isPrimaryKey: false }
        ]
      }
    ];

    const diff = diffDatabaseSchemas('Dev (sipegi)', sourceTables, 'Prod (sipegi_prod)', targetTables, 'mysql');
    expect(diff.missingTablesInTarget).toContain('log_presensi');
    expect(
      diff.columnDiffs.some(
        (d) => d.table === 'mst_pegawai' && d.column === 'email_dinas' && d.kind === 'missing-in-target'
      )
    ).toBe(true);
    expect(
      diff.columnDiffs.some(
        (d) => d.table === 'mst_unitkerja' && d.column === 'nama_unit' && d.kind === 'type-mismatch'
      )
    ).toBe(true);
    expect(diff.migrationSql).toContain('CREATE TABLE `log_presensi`');
    expect(diff.migrationSql).toContain('ADD COLUMN `email_dinas`');
    expect(diff.migrationSql).toContain('MODIFY COLUMN `nama_unit` varchar(150)');
  });

  it('ConnectionManager.listRemoteFilesIndex mengindeks file remote secara kilat & PhpLanguageService.runSnippet berjalan aman', async () => {
    const storageDir = join(tempRoot, 'remote-idx-store');
    const simulatedRemoteDir = join(tempRoot, 'remote-idx-target');
    const ws = new WorkspaceService();
    await ws.createEntry(join(simulatedRemoteDir, 'modul', 'pegawai', 'pegawai_idx.php'), false, '<?php echo 1;');
    await ws.createEntry(join(simulatedRemoteDir, 'vendor', 'autoload.php'), false, '<?php // ignored');

    const connMgr = new ConnectionManager(storageDir, new FallbackAesVault('idx-seed'));
    const prof = await connMgr.save({
      profile: {
        name: 'LocalMirrorRemote',
        protocol: 'local',
        host: 'localhost',
        port: 0,
        username: '',
        remotePath: simulatedRemoteDir,
        authType: 'password',
        keepSynchronized: false,
        ignorePatterns: ['.git', 'vendor']
      }
    });

    const indexed = await connMgr.listRemoteFilesIndex(prof.id, '', 500);
    expect(indexed.map((f) => f.relativePath)).toContain('modul/pegawai/pegawai_idx.php');
    expect(indexed.some((f) => f.relativePath.includes('vendor/'))).toBe(false);

    const phpSvc = new PhpLanguageService();
    const res = await phpSvc.runSnippet('echo 21 * 2;');
    if (res.available) {
      expect(res.exitCode).toBe(0);
      expect(res.stdout.trim()).toBe('42');
    } else {
      expect(res.stderr.length).toBeGreaterThan(0);
    }
  });

  it('buildXlsxBuffer membuat file Excel .xlsx OOXML asli tanpa merusak NIP 18-digit / kode 0-depan & parseCsvRecords mendukung BOM + semicolon', () => {
    const xlsxBuf = buildXlsxBuffer({
      sheetName: 'Daftar Pegawai 2026',
      columns: ['nip', 'kd_unitkerja', 'nama', 'tunjangan'],
      rows: [
        {
          nip: '198501012010011001',
          kd_unitkerja: '020100',
          nama: 'Budi & Santoso',
          tunjangan: 1250000
        }
      ]
    });

    // Valid PKZIP local header signature PK\x03\x04
    expect(xlsxBuf.readUInt32LE(0)).toBe(0x04034b50);

    // Unpack local ZIP entries and inspect xl/worksheets/sheet1.xml
    const entries = new Map<string, string>();
    let offset = 0;
    while (offset + 30 <= xlsxBuf.length && xlsxBuf.readUInt32LE(offset) === 0x04034b50) {
      const compSize = xlsxBuf.readUInt32LE(offset + 18);
      const nameLen = xlsxBuf.readUInt16LE(offset + 26);
      const extraLen = xlsxBuf.readUInt16LE(offset + 28);
      const fileName = xlsxBuf.subarray(offset + 30, offset + 30 + nameLen).toString('utf-8');
      const dataStart = offset + 30 + nameLen + extraLen;
      const compressed = xlsxBuf.subarray(dataStart, dataStart + compSize);
      const xml = inflateRawSync(compressed).toString('utf-8');
      entries.set(fileName, xml);
      offset = dataStart + compSize;
    }

    expect(entries.has('[Content_Types].xml')).toBe(true);
    expect(entries.has('xl/workbook.xml')).toBe(true);
    const sheetXml = entries.get('xl/worksheets/sheet1.xml') ?? '';
    expect(sheetXml).toContain('t="inlineStr"><is><t>198501012010011001</t></is>');
    expect(sheetXml).toContain('t="inlineStr"><is><t>020100</t></is>');
    expect(sheetXml).toContain('<t>Budi &amp; Santoso</t>');
    expect(sheetXml).toContain('<v>1250000</v>');

    // Regional semicolon CSV with UTF-8 BOM & quoted multiline field
    const csvSample =
      '\uFEFFnip;kd_unitkerja;catatan\r\n198501012010011001;020100;"Baris 1\nBaris ""2"""\r\n';
    const parsedCsv = parseCsvRecords(csvSample);
    expect(parsedCsv.delimiter).toBe(';');
    expect(parsedCsv.headers).toEqual(['nip', 'kd_unitkerja', 'catatan']);
    expect(parsedCsv.rows).toHaveLength(1);
    expect(parsedCsv.rows[0]).toEqual(['198501012010011001', '020100', 'Baris 1\nBaris "2"']);
  });

  it('extractPhpHttpEndpointSpec mengekstrak field $_POST/$_GET/Laravel & parseCurlCommand mengurai Copy as cURL Chrome DevTools', () => {
    const phpSave = `<?php
      $nip = $_POST['nip'];
      $kd = $_POST["kd_unitkerja"];
      $act = $_GET['act'];
      $validated = $request->validate([
        'email_dinas' => 'required|email'
      ]);
      $catatan = $request->input('catatan');
    ?>`;

    const spec = extractPhpHttpEndpointSpec(
      phpSave,
      'modul/pegawai/pegawai_save.php',
      'http://localhost:8080'
    );
    expect(spec.method).toBe('POST');
    expect(spec.suggestedUrl).toBe('http://localhost:8080/modul/pegawai/pegawai_save.php?act=');
    const postFieldKeys = spec.formFields.map((f) => f.key);
    expect(postFieldKeys).toContain('nip');
    expect(postFieldKeys).toContain('kd_unitkerja');
    expect(postFieldKeys).toContain('email_dinas');
    expect(postFieldKeys).toContain('catatan');

    const curlCmd = `curl 'https://simpeg.instansi.go.id/modul/pegawai/pegawai_save.php' \\
      -H 'Content-Type: application/x-www-form-urlencoded' \\
      -H 'Cookie: PHPSESSID=xyz987session; theme=dark' \\
      -H 'X-Requested-With: XMLHttpRequest' \\
      --data-raw 'nip=19850101&kd_unitkerja=020100'`;

    const parsedCurl = parseCurlCommand(curlCmd);
    expect(parsedCurl).not.toBeNull();
    expect(parsedCurl?.method).toBe('POST');
    expect(parsedCurl?.suggestedUrl).toBe(
      'https://simpeg.instansi.go.id/modul/pegawai/pegawai_save.php'
    );
    expect(parsedCurl?.cookieSession).toContain('PHPSESSID=xyz987session');
    expect(parsedCurl?.bodyMode).toBe('urlencoded');
    expect(parsedCurl?.formFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'nip', value: '19850101' }),
        expect.objectContaining({ key: 'kd_unitkerja', value: '020100' })
      ])
    );
  });

  it('findModuleCompanions memasangkan modul Wisanggeni/Laravel & inspectPhpFileDependencies memetakan alur tabel dan include', () => {
    const candidates = [
      { source: 'remote' as const, name: 'pegawai_idx.php', relativePath: 'modul/pegawai/pegawai_idx.php' },
      { source: 'remote' as const, name: 'pegawai_form.php', relativePath: 'modul/pegawai/pegawai_form.php' },
      { source: 'remote' as const, name: 'pegawai_save.php', relativePath: 'modul/pegawai/pegawai_save.php' },
      { source: 'remote' as const, name: 'pegawai_excel.php', relativePath: 'modul/pegawai/pegawai_excel.php' },
      { source: 'remote' as const, name: 'cuti_idx.php', relativePath: 'modul/cuti/cuti_idx.php' }
    ];

    const companions = findModuleCompanions('modul/pegawai/pegawai_form.php', 'remote', candidates);
    expect(companions.map((c) => c.name)).toEqual([
      'pegawai_idx.php',
      'pegawai_form.php',
      'pegawai_save.php',
      'pegawai_excel.php'
    ]);
    expect(companions.find((c) => c.name === 'pegawai_form.php')?.isCurrent).toBe(true);

    const lvCandidates = [
      { source: 'local' as const, name: 'PegawaiController.php', relativePath: 'app/Http/Controllers/PegawaiController.php' },
      { source: 'local' as const, name: 'Pegawai.php', relativePath: 'app/Models/Pegawai.php' },
      { source: 'local' as const, name: 'StorePegawaiRequest.php', relativePath: 'app/Http/Requests/StorePegawaiRequest.php' }
    ];
    const lvCompanions = findModuleCompanions(
      'app/Http/Controllers/PegawaiController.php',
      'local',
      lvCandidates
    );
    expect(lvCompanions.map((c) => c.name)).toContain('Pegawai.php');
    expect(lvCompanions.map((c) => c.name)).toContain('StorePegawaiRequest.php');

    const depCode = `<?php
      require_once 'includes/connect_db.php';
      function simpanPegawai($nip) {
        $q1 = mysql_query("SELECT nama FROM sipegi.mst_pegawai WHERE nip='$nip'");
        mysql_query("UPDATE sipegi.trx_jabatan SET aktif=1 WHERE nip='$nip'");
      }
      $id = $_POST['nip'];
    ?>`;
    const deps = inspectPhpFileDependencies(depCode);
    expect(deps.includes).toContain('includes/connect_db.php');
    expect(deps.readTables).toContain('sipegi.mst_pegawai');
    expect(deps.writeTables).toContain('sipegi.trx_jabatan');
    expect(deps.declaredSymbols).toContain('simpanPegawai()');
    expect(deps.inputsUsed).toContain("$_POST['nip']");
  });

  it('analyzeDangerousSql mencegat DELETE/UPDATE tanpa WHERE, DROP/TRUNCATE, serta penulisan ke DB Produksi', () => {
    const noWhereDel = analyzeDangerousSql('DELETE FROM mst_pegawai;', false);
    expect(noWhereDel.hazardous).toBe(true);
    expect(noWhereDel.level).toBe('critical');
    expect(noWhereDel.kind).toBe('delete-without-where');

    const safeDevDel = analyzeDangerousSql("DELETE FROM mst_pegawai WHERE nip = '1985';", false);
    expect(safeDevDel.hazardous).toBe(false);

    const prodDelWithWhere = analyzeDangerousSql("DELETE FROM mst_pegawai WHERE nip = '1985';", true);
    expect(prodDelWithWhere.hazardous).toBe(true);
    expect(prodDelWithWhere.level).toBe('high');
    expect(prodDelWithWhere.kind).toBe('production-write');

    const dropTbl = analyzeDangerousSql('DROP TABLE IF EXISTS tmp_rekap;', false);
    expect(dropTbl.hazardous).toBe(true);
    expect(dropTbl.level).toBe('critical');
  });

  it('analyzePhpVariableIssues mendeteksi variabel belum didefinisikan & salah ketik di fungsi PHP beserta Quick Fix tanpa false-positive', () => {
    const phpCode = `<?php
      $kd_unitkerja = '020100';
      function cetakUnit($nip) {
        global $db_conn;
        if (isset($opsional)) {
          echo $opsional;
        }
        $nama_lengkap = $_SESSION['nama'];
        echo $kd_unitkrja;
        return $nama_lengkap;
      }
    ?>`;

    const issues = analyzePhpVariableIssues(phpCode);
    expect(issues).toHaveLength(1);
    expect(issues[0].variableName).toBe('$kd_unitkrja');
    expect(issues[0].quickFixes.some((qf) => qf.replacement === '$kd_unitkerja')).toBe(true);
  });

  it('ConnectionManager.broadcastWriteFile menyebarkan file ke banyak server, parsePosixServerHealthOutput membaca metrik SSH, & GitService.blameLine bekerja akurat', async () => {
    const storageDir = join(tempRoot, 'multi-deploy-store');
    const srvA = join(tempRoot, 'server-a');
    const srvB = join(tempRoot, 'server-b');
    const ws = new WorkspaceService();
    await ws.createEntry(join(srvA, 'readme.txt'), false, 'init');
    await ws.createEntry(join(srvB, 'readme.txt'), false, 'init');

    const connMgr = new ConnectionManager(storageDir, new FallbackAesVault('broadcast-seed'));
    const profA = await connMgr.save({
      profile: {
        name: 'Server Produksi A',
        protocol: 'local',
        host: '10.0.0.1',
        port: 0,
        username: '',
        remotePath: srvA,
        authType: 'password',
        keepSynchronized: false,
        ignorePatterns: ['.git'],
        isProduction: true
      }
    });
    const profB = await connMgr.save({
      profile: {
        name: 'Server Backup B',
        protocol: 'local',
        host: '10.0.0.2',
        port: 0,
        username: '',
        remotePath: srvB,
        authType: 'password',
        keepSynchronized: false,
        ignorePatterns: ['.git']
      }
    });

    expect(profA.isProduction).toBe(true);

    const deployRes = await connMgr.broadcastWriteFile(
      [profA.id, profB.id],
      'modul/rekap/rekap_excel.php',
      '<?php echo "deployed"; ?>'
    );
    expect(deployRes.totalTargets).toBe(2);
    expect(deployRes.succeeded).toHaveLength(2);
    expect(deployRes.failed).toHaveLength(0);
    expect(await readFile(join(srvA, 'modul', 'rekap', 'rekap_excel.php'), 'utf-8')).toContain('deployed');
    expect(await readFile(join(srvB, 'modul', 'rekap', 'rekap_excel.php'), 'utf-8')).toContain('deployed');

    const mockSshOut = [
      '===HOST===',
      'simpeg-prod-01',
      '===OS===',
      'Ubuntu 24.04.1 LTS',
      '===UPTIME===',
      ' 03:15:00 up 42 days,  5:12,  2 users,  load average: 0.45, 0.38, 0.31',
      '===CORES===',
      '8',
      '===MEM===',
      '               total        used        free      shared  buff/cache   available',
      'Mem:           16000        6200        4800         300        5000        9600',
      '===DISK===',
      'Filesystem     Size  Used Avail Use% Mounted on',
      '/dev/sda1      200G  184G   16G  92% /',
      'tmpfs          8.0G     0  8.0G   0% /dev/shm',
      '===SERVICES===',
      'nginx|active|systemd',
      'mysql|active|systemd',
      'redis-server|inactive|none',
      '===CRON===',
      '0 2 * * * /usr/bin/php /var/www/html/cron_backup.php',
      '===END==='
    ].join('\n');

    const snap = parsePosixServerHealthOutput(mockSshOut, {
      connectionId: profA.id,
      connectionName: profA.name,
      latencyMs: 18
    });
    expect(snap.hostname).toBe('simpeg-prod-01');
    expect(snap.cpuCores).toBe(8);
    expect(snap.memTotalMb).toBe(16000);
    expect(snap.memAvailableMb).toBe(9600);
    expect(snap.disks).toHaveLength(1);
    expect(snap.disks[0].usePercent).toBe(92);
    expect(snap.services.find((s) => s.name === 'nginx')?.active).toBe(true);
    expect(snap.crontabText).toContain('cron_backup.php');

    // Verify GitService.blameLine on a real temporary Git repository
    const execFileAsync = promisify(execFile);
    const gitRepoDir = join(tempRoot, 'blame-repo');
    await ws.createEntry(join(gitRepoDir, 'pegawai.php'), false, '<?php\n$nip = "1985";\n');
    try {
      await execFileAsync('git', ['init'], { cwd: gitRepoDir });
      await execFileAsync('git', ['config', 'user.name', 'Herman Dev'], { cwd: gitRepoDir });
      await execFileAsync('git', ['config', 'user.email', 'herman@example.com'], { cwd: gitRepoDir });
      await execFileAsync('git', ['add', 'pegawai.php'], { cwd: gitRepoDir });
      await execFileAsync('git', ['commit', '-m', 'Inisialisasi modul pegawai'], { cwd: gitRepoDir });

      const gitSvc = new GitService();
      const blame = await gitSvc.blameLine(gitRepoDir, 'pegawai.php', 2);
      expect(blame).not.toBeNull();
      expect(blame?.author).toBe('Herman Dev');
      expect(blame?.summary).toBe('Inisialisasi modul pegawai');
    } catch {
      // Skip only if git binary is unavailable in environment
    }
  });

  it('Codebase JOIN Learner (learnJoinEdgesFromSources & WorkspaceService.scanJoinEdges) mempelajari pola JOIN PHP klasik, lintas-DB, dan Laravel', async () => {
    const wsDir = join(tempRoot, 'join-learner-ws');
    const ws = new WorkspaceService();

    await ws.createEntry(
      join(wsDir, 'rekomendasi_idx.php'),
      false,
      `<?php
$q1 = mysql_query("SELECT p.nip, p.nama, r.nomor_surat
  FROM sipegi.mst_pegawai p
  LEFT JOIN simpel.rekomendasi r ON r.nip_pemohon = p.nip
  LEFT JOIN sipegi.mst_unitkerja u ON u.kd_unitkerja = p.kd_unitkerja
  WHERE p.aktif = 1");
$q2 = mysql("SELECT p.nip FROM sipegi.mst_pegawai p INNER JOIN simpel.rekomendasi r ON r.nip_pemohon = p.nip");
`
    );

    await ws.createEntry(
      join(wsDir, 'PegawaiController.php'),
      false,
      `<?php
$rows = DB::table('sipegi.mst_pegawai as p')
  ->leftJoin('sipegi.mst_golongan as g', 'g.kd_gol', '=', 'p.golongan_akhir')
  ->select('p.nip', 'g.pangkat')
  ->get();
`
    );

    const scanned = await ws.scanJoinEdges(wsDir);
    expect(scanned.length).toBeGreaterThanOrEqual(3);

    const nipEdge = scanned.find(
      (e) =>
        (e.leftColumn === 'nip_pemohon' && e.rightColumn === 'nip') ||
        (e.leftColumn === 'nip' && e.rightColumn === 'nip_pemohon')
    );
    expect(nipEdge).toBeDefined();
    expect(nipEdge?.frequency).toBe(2);

    const laravelEdge = scanned.find(
      (e) =>
        (e.leftColumn === 'kd_gol' && e.rightColumn === 'golongan_akhir') ||
        (e.leftColumn === 'golongan_akhir' && e.rightColumn === 'kd_gol')
    );
    expect(laravelEdge).toBeDefined();
  });

  it('Smart JOIN Auto-Complete menyarankan JOIN ... ON ... lintas-database, memprioritaskan pola kode & FK, dan menolak kolom generik (id=id / nama=nama)', () => {
    const sampleTables = [
      {
        schema: 'sipegi',
        name: 'mst_pegawai',
        kind: 'table' as const,
        primaryKeys: ['id'],
        columns: [
          { name: 'id', dataType: 'int', columnType: 'int(11)', nullable: false, isPrimaryKey: true },
          { name: 'nip', dataType: 'varchar', columnType: 'varchar(20)', nullable: false, isPrimaryKey: false },
          { name: 'nama', dataType: 'varchar', columnType: 'varchar(120)', nullable: false, isPrimaryKey: false },
          { name: 'kd_unitkerja', dataType: 'varchar', columnType: 'varchar(10)', nullable: false, isPrimaryKey: false }
        ]
      },
      {
        schema: 'sipegi',
        name: 'mst_unitkerja',
        kind: 'table' as const,
        primaryKeys: ['kd_unitkerja'],
        columns: [
          { name: 'kd_unitkerja', dataType: 'varchar', columnType: 'varchar(10)', nullable: false, isPrimaryKey: true },
          { name: 'nama', dataType: 'varchar', columnType: 'varchar(120)', nullable: false, isPrimaryKey: false }
        ]
      },
      {
        schema: 'simpel',
        name: 'rekomendasi',
        kind: 'table' as const,
        primaryKeys: ['id'],
        columns: [
          { name: 'id', dataType: 'int', columnType: 'int(11)', nullable: false, isPrimaryKey: true },
          { name: 'nip_pemohon', dataType: 'varchar', columnType: 'varchar(20)', nullable: false, isPrimaryKey: false },
          { name: 'nama', dataType: 'varchar', columnType: 'varchar(120)', nullable: false, isPrimaryKey: false }
        ]
      },
      {
        schema: 'sipegi',
        name: 'berita_unrelated',
        kind: 'table' as const,
        primaryKeys: ['id'],
        columns: [
          { name: 'id', dataType: 'int', columnType: 'int(11)', nullable: false, isPrimaryKey: true },
          { name: 'nama', dataType: 'varchar', columnType: 'varchar(120)', nullable: false, isPrimaryKey: false }
        ]
      }
    ];

    const learned = learnJoinEdgesFromSources([
      `SELECT * FROM sipegi.mst_pegawai p LEFT JOIN simpel.rekomendasi r ON r.nip_pemohon = p.nip;`
    ]);

    const refsBeforeJoin = extractReferencedSqlTables('SELECT * FROM mst_pegawai p').refs;
    const candidates = suggestJoinCandidatesForQuery({
      existingRefs: refsBeforeJoin,
      allTables: sampleTables,
      activeDatabase: 'sipegi',
      learnedEdges: learned
    });

    // 1. Learned edge (`simpel.rekomendasi r ON r.nip_pemohon = p.nip`) ranked #1 with cross-DB prefix
    expect(candidates[0].targetTable).toBe('rekomendasi');
    expect(candidates[0].reason).toBe('learned-code');
    expect(candidates[0].fullJoinTail).toBe('simpel.rekomendasi r ON r.nip_pemohon = p.nip');

    // 2. Key match (`mst_unitkerja u ON u.kd_unitkerja = p.kd_unitkerja`) suggested cleanly without redundant `sipegi.` prefix
    const unitCand = candidates.find((c) => c.targetTable === 'mst_unitkerja');
    expect(unitCand).toBeDefined();
    expect(unitCand?.fullJoinTail).toBe('mst_unitkerja u ON u.kd_unitkerja = p.kd_unitkerja');

    // 3. Unrelated table sharing only generic `id` and `nama` MUST NOT be suggested!
    expect(candidates.some((c) => c.targetTable === 'berita_unrelated')).toBe(false);

    // 4. `ON ` condition suggestions after typing `SELECT * FROM mst_pegawai p LEFT JOIN mst_unitkerja u ON `
    const refsAtOn = extractReferencedSqlTables(
      'SELECT * FROM mst_pegawai p LEFT JOIN mst_unitkerja u'
    ).refs;
    const onCands = suggestOnConditionsForLastJoin({
      existingRefs: refsAtOn,
      allTables: sampleTables,
      activeDatabase: 'sipegi'
    });
    expect(onCands[0]?.onExpression).toBe('u.kd_unitkerja = p.kd_unitkerja');
  });

  it('Visual JOIN Query Builder & ER Multi-Table Join Chainer menghasilkan alias anti-bentrok serta kode SQL, PHP, Wisanggeni & Laravel', () => {
    const sampleTables = [
      {
        schema: 'sipegi',
        name: 'mst_pegawai',
        kind: 'table' as const,
        primaryKeys: ['nip'],
        columns: [
          { name: 'nip', dataType: 'varchar', columnType: 'varchar(20)', nullable: false, isPrimaryKey: true },
          { name: 'nama', dataType: 'varchar', columnType: 'varchar(120)', nullable: false, isPrimaryKey: false },
          { name: 'kd_unitkerja', dataType: 'varchar', columnType: 'varchar(10)', nullable: false, isPrimaryKey: false }
        ]
      },
      {
        schema: 'sipegi',
        name: 'mst_unitkerja',
        kind: 'table' as const,
        primaryKeys: ['kd_unitkerja'],
        columns: [
          { name: 'kd_unitkerja', dataType: 'varchar', columnType: 'varchar(10)', nullable: false, isPrimaryKey: true },
          { name: 'nama', dataType: 'varchar', columnType: 'varchar(120)', nullable: false, isPrimaryKey: false }
        ]
      },
      {
        schema: 'simpel',
        name: 'rekomendasi',
        kind: 'table' as const,
        primaryKeys: ['id_rekom'],
        columns: [
          { name: 'id_rekom', dataType: 'int', columnType: 'int(11)', nullable: false, isPrimaryKey: true },
          { name: 'nip', dataType: 'varchar', columnType: 'varchar(20)', nullable: false, isPrimaryKey: false },
          { name: 'nomor_surat', dataType: 'varchar', columnType: 'varchar(60)', nullable: false, isPrimaryKey: false }
        ]
      }
    ];

    // Auto-chain 3 tables clicked in ER Diagram
    const spec = buildJoinSpecFromSelectedTables(
      [
        { schema: 'sipegi', name: 'mst_pegawai' },
        { schema: 'sipegi', name: 'mst_unitkerja' },
        { schema: 'simpel', name: 'rekomendasi' }
      ],
      sampleTables,
      'sipegi'
    );

    expect(spec.baseAlias).toBe('p');
    expect(spec.joins).toHaveLength(2);

    // Select colliding `nama` from both `mst_pegawai` (`p`) and `mst_unitkerja` (`u`), plus `r.nomor_surat`
    spec.selectedColumns = [
      { tableAlias: 'p', columnName: 'nip' },
      { tableAlias: 'p', columnName: 'nama' },
      { tableAlias: 'u', columnName: 'nama' },
      { tableAlias: 'r', columnName: 'nomor_surat' }
    ];
    spec.whereClause = 'p.nip IS NOT NULL';

    const out = buildJoinQueryOutputs(spec, sampleTables);

    // Anti-collision alias: `u.nama AS unitkerja_nama`
    expect(out.sql).toContain('u.nama AS unitkerja_nama');
    expect(out.sql).toContain('LEFT JOIN mst_unitkerja u ON u.kd_unitkerja = p.kd_unitkerja');
    expect(out.sql).toContain('LEFT JOIN simpel.rekomendasi r ON r.nip = p.nip');
    expect(out.phpMysql).toContain('mysqli_query');
    expect(out.phpWisanggeni).toContain('$query->dosql');
    expect(out.laravelQueryBuilder).toContain("DB::table('mst_pegawai as p')");
    expect(out.laravelQueryBuilder).toContain("->leftJoin('simpel.rekomendasi as r'");
  });

  it('Ambiguous JOIN Column Linter mendeteksi kolom tanpa prefix tabel di .sql & PHP multi-baris beserta Quick Fix (Ctrl+.)', () => {
    const sampleTables = [
      {
        schema: 'sipegi',
        name: 'mst_pegawai',
        kind: 'table' as const,
        primaryKeys: ['nip'],
        columns: [
          { name: 'nip', dataType: 'varchar', columnType: 'varchar(20)', nullable: false, isPrimaryKey: true },
          { name: 'nama', dataType: 'varchar', columnType: 'varchar(120)', nullable: false, isPrimaryKey: false },
          { name: 'kd_unitkerja', dataType: 'varchar', columnType: 'varchar(10)', nullable: false, isPrimaryKey: false },
          { name: 'aktif', dataType: 'tinyint', columnType: 'tinyint(1)', nullable: false, isPrimaryKey: false }
        ]
      },
      {
        schema: 'sipegi',
        name: 'mst_unitkerja',
        kind: 'table' as const,
        primaryKeys: ['kd_unitkerja'],
        columns: [
          { name: 'kd_unitkerja', dataType: 'varchar', columnType: 'varchar(10)', nullable: false, isPrimaryKey: true },
          { name: 'nama', dataType: 'varchar', columnType: 'varchar(120)', nullable: false, isPrimaryKey: false },
          { name: 'singkatan', dataType: 'varchar', columnType: 'varchar(50)', nullable: false, isPrimaryKey: false },
          { name: 'aktif', dataType: 'tinyint', columnType: 'tinyint(1)', nullable: false, isPrimaryKey: false }
        ]
      }
    ];

    // 1. Raw SQL: `nama` and `aktif` are ambiguous; `nip` and `singkatan` are unique; `p.kd_unitkerja` is already qualified
    const rawSql = `SELECT nip, nama, singkatan FROM mst_pegawai p LEFT JOIN mst_unitkerja u ON u.kd_unitkerja = p.kd_unitkerja WHERE aktif = 1`;
    const sqlDiags = detectAmbiguousJoinColumns(rawSql, sampleTables, 'sipegi');
    expect(sqlDiags.map((d) => d.column)).toEqual(['nama', 'aktif']);
    expect(sqlDiags[0].quickFixes.map((qf) => qf.replacement)).toEqual(['p.nama', 'u.nama']);

    // 2. Qualified + `AS nama` + `ORDER BY nama` + `USING (kd_unitkerja)` must produce ZERO false positives
    const cleanSql = `SELECT p.nama AS nama, u.singkatan FROM mst_pegawai p LEFT JOIN mst_unitkerja u USING (kd_unitkerja) WHERE p.aktif = 1 ORDER BY nama`;
    expect(detectAmbiguousJoinColumns(cleanSql, sampleTables, 'sipegi')).toHaveLength(0);

    // 3. Embedded multi-line PHP SQL: maps diagnostic exact line & column onto PHP file!
    const phpSource = `<?php
$q = mysql_query("SELECT p.nip, nama
  FROM sipegi.mst_pegawai p
  LEFT JOIN sipegi.mst_unitkerja u ON u.kd_unitkerja = p.kd_unitkerja
  WHERE p.nip = '" . $nip . "' AND aktif = 1");
`;
    const phpDiags = detectAmbiguousJoinDiagnosticsInSource(phpSource, 'php', sampleTables, 'sipegi');
    expect(phpDiags).toHaveLength(2);
    expect(phpDiags[0].line).toBe(2);
    expect(phpDiags[0].quickFixes.some((q) => q.replacement === 'p.nama')).toBe(true);
    expect(phpDiags[1].line).toBe(5);
    expect(phpDiags[1].quickFixes.some((q) => q.replacement === 'p.aktif')).toBe(true);
  });

  it('Navicat-Style Visual Query Builder mendukung Auto-Link tabel kanvas, composite ON, fungsi COUNT/SUM, kriteria WHERE visual, GROUP BY, HAVING & OFFSET', () => {
    const sampleTables = [
      {
        schema: 'sipegi',
        name: 'mst_pegawai',
        kind: 'table' as const,
        primaryKeys: ['nip'],
        columns: [
          { name: 'nip', dataType: 'varchar', columnType: 'varchar(20)', nullable: false, isPrimaryKey: true },
          { name: 'nama', dataType: 'varchar', columnType: 'varchar(120)', nullable: false, isPrimaryKey: false },
          { name: 'kd_unitkerja', dataType: 'varchar', columnType: 'varchar(10)', nullable: false, isPrimaryKey: false },
          { name: 'aktif', dataType: 'tinyint', columnType: 'tinyint(1)', nullable: false, isPrimaryKey: false }
        ]
      },
      {
        schema: 'sipegi',
        name: 'mst_unitkerja',
        kind: 'table' as const,
        primaryKeys: ['kd_unitkerja'],
        columns: [
          { name: 'kd_unitkerja', dataType: 'varchar', columnType: 'varchar(10)', nullable: false, isPrimaryKey: true },
          { name: 'nama', dataType: 'varchar', columnType: 'varchar(120)', nullable: false, isPrimaryKey: false }
        ]
      }
    ];

    const autoLink = inferSmartJoinBetweenTables({
      existingTables: [{ schema: 'sipegi', name: 'mst_pegawai', alias: 'p' }],
      targetTable: { schema: 'sipegi', name: 'mst_unitkerja' },
      allTables: sampleTables,
      activeDatabase: 'sipegi'
    });
    expect(autoLink).not.toBeNull();
    expect(autoLink?.sourceAlias).toBe('p');
    expect(autoLink?.sourceColumn).toBe('kd_unitkerja');
    expect(autoLink?.targetColumn).toBe('kd_unitkerja');

    const whereSql = compileWhereRulesToSql(
      [
        { id: 'w1', conjunction: 'AND', columnRef: 'p.aktif', operator: '=', value: '1' },
        { id: 'w2', conjunction: 'AND', columnRef: 'u.nama', operator: 'LIKE_CONTAINS', value: 'Dinas' },
        { id: 'w3', conjunction: 'OR', columnRef: 'p.nip', operator: '=', value: '$nip' }
      ],
      'p.kd_unitkerja IS NOT NULL'
    );
    expect(whereSql).toBe(
      "p.aktif = 1 AND u.nama LIKE '%Dinas%' OR p.nip = '$nip' AND (p.kd_unitkerja IS NOT NULL)"
    );

    const out = buildJoinQueryOutputs(
      {
        baseSchema: 'sipegi',
        baseTable: 'mst_pegawai',
        baseAlias: 'p',
        distinct: true,
        joins: [
          {
            id: 'j1',
            joinType: 'INNER JOIN',
            targetSchema: 'sipegi',
            targetTable: 'mst_unitkerja',
            alias: 'u',
            leftRef: 'p.kd_unitkerja',
            operator: '=',
            rightColumn: 'kd_unitkerja',
            extraConditions: [{ leftRef: 'p.aktif', operator: '=', rightColumn: 'aktif' }]
          }
        ],
        selectedColumns: [
          { tableAlias: 'u', columnName: 'nama', outputAlias: 'nama_unit' },
          { tableAlias: 'p', columnName: 'nip', aggregate: 'COUNT', outputAlias: 'total_pegawai' }
        ],
        whereRules: [{ id: 'w1', conjunction: 'AND', columnRef: 'p.aktif', operator: '=', value: '1' }],
        groupByColumns: ['u.nama'],
        havingClause: 'COUNT(p.nip) >= 5',
        orderByRules: [{ id: 'o1', columnRef: 'total_pegawai', direction: 'DESC' }],
        limit: 50,
        offset: 10,
        activeDatabase: 'sipegi'
      },
      sampleTables
    );

    expect(out.sql).toContain('SELECT DISTINCT');
    expect(out.sql).toContain('u.nama AS nama_unit');
    expect(out.sql).toContain('COUNT(p.nip) AS total_pegawai');
    expect(out.sql).toContain(
      'INNER JOIN mst_unitkerja u ON u.kd_unitkerja = p.kd_unitkerja AND u.aktif = p.aktif'
    );
    expect(out.sql).toContain('WHERE p.aktif = 1');
    expect(out.sql).toContain('GROUP BY u.nama');
    expect(out.sql).toContain('HAVING COUNT(p.nip) >= 5');
    expect(out.sql).toContain('ORDER BY total_pegawai DESC');
    expect(out.sql).toContain('LIMIT 50 OFFSET 10');
    expect(out.laravelQueryBuilder).toContain('function ($join)');
    expect(out.laravelQueryBuilder).toContain("DB::raw('COUNT(p.nip) AS total_pegawai')");
  });

  it('Web Asset Analyzer mengenali bahasa JS/CSS/LESS/PHP (termasuk sniffing isi) dan membedakan zona <script>, <style>, style="", class="", onclick="" & tag PHP', () => {
    expect(detectLanguageFromPathAndContent('assets/js/pegawai.cjs')).toBe('javascript');
    expect(detectLanguageFromPathAndContent('assets/css/tema.less')).toBe('less');
    expect(detectLanguageFromPathAndContent('modul/helper.inc')).toBe('php');
    expect(
      detectLanguageFromPathAndContent('tanpa_ekstensi', "document.addEventListener('DOMContentLoaded', () => {});")
    ).toBe('javascript');
    expect(
      detectLanguageFromPathAndContent('tanpa_ekstensi_css', ':root {\n  --utama: #0ea5e9;\n}')
    ).toBe('css');

    // 1. Inside `<script>` in `.php` -> `'js'`
    const phpScript = `<?php $judul = 'Pegawai'; ?>\n<div id="form_pegawai"></div>\n<script>\n  const x = 1;\n  $.`;
    expect(detectWebSubContext(phpScript, '  $.', 'php').region).toBe('js');

    // 2. Inside `<?= ... ?>` embedded INSIDE `<script>` -> `'php'` (preserves PHP IntelliSense!)
    const phpInsideScript = `<script>\n  const nip = "<?= $pegawai->`;
    expect(detectWebSubContext(phpInsideScript, '  const nip = "<?= $pegawai->', 'php').region).toBe('php');

    // 3. DOM `#id` and `.class` selector detection inside `<script>` and `.js`
    const jqIdPrefix = `<script>\n  $('#kd_unit`;
    expect(detectWebSubContext(jqIdPrefix, "  $('#kd_unit", 'php')).toEqual({
      region: 'dom-selector',
      selectorKind: 'id',
      typedPrefix: 'kd_unit'
    });

    // 4. Inside `<style>` property vs value in `.php`
    const phpStyleVal = `<style>\n  .kartu {\n    display: fl`;
    expect(detectWebSubContext(phpStyleVal, '    display: fl', 'php')).toEqual({
      region: 'css-block',
      cssSubKind: 'value',
      activeCssProperty: 'display',
      typedPrefix: 'fl'
    });

    // 5. Inline `style="..."`, `class="..."`, `onclick="..."`, and `<script src="...">`
    expect(
      detectWebSubContext('<div style="justify-content: sp', '<div style="justify-content: sp', 'php')
    ).toEqual({
      region: 'css-inline',
      cssSubKind: 'value',
      activeCssProperty: 'justify-content',
      typedPrefix: 'sp'
    });
    expect(
      detectWebSubContext('<div class="btn btn-pr', '<div class="btn btn-pr', 'php')
    ).toEqual({
      region: 'html-class',
      typedPrefix: 'btn-pr'
    });
    expect(
      detectWebSubContext('<button onclick="simpan(', '<button onclick="simpan(', 'php').region
    ).toBe('js-inline');
    expect(
      detectWebSubContext('<script src="assets/js/', '<script src="assets/js/', 'php')
    ).toEqual({
      region: 'asset-path',
      assetKind: 'js',
      typedPrefix: 'assets/js/'
    });
  });

  it('WorkspaceService.scanWebAssets mengekstrak fungsi/class JS, class/variabel CSS, & HTML #id lintas proyek serta membangun deklarasi ambient .d.ts', async () => {
    const webWs = join(tempRoot, 'web-intellisense-ws');
    const ws = new WorkspaceService();

    await ws.createEntry(
      join(webWs, 'assets/js/pegawai_helper.js'),
      false,
      `/** Menyimpan data pegawai via AJAX */
async function simpanPegawai(nip, kdUnit) {
  return fetch('/save');
}
const formatRupiah = (nominal) => nominal.toLocaleString('id-ID');
class ModalPegawai {
  bukaDetail(nip) {}
}
`
    );

    await ws.createEntry(
      join(webWs, 'assets/css/utama.css'),
      false,
      `:root {
  --warna-aksen: #0ea5e9;
}
.kartu-pegawai, .kotak-filter {
  display: flex;
  gap: 12px;
  border-color: #0ea5e9;
}
`
    );

    await ws.createEntry(
      join(webWs, 'modul/pegawai_form.php'),
      false,
      `<?php $id = 1; ?>
<form id="form_pegawai">
  <select id="kd_unitkerja" class="form-select kartu-pegawai"></select>
</form>
<style>
  .label-wajib { color: #ef4444; font-weight: 700; }
</style>
<script>
  function resetFormPegawai() {
    $('#form_pegawai')[0].reset();
  }
</script>
`
    );

    const catalog = await ws.scanWebAssets(webWs);
    expect(catalog.jsFiles).toContain('assets/js/pegawai_helper.js');
    expect(catalog.cssFiles).toContain('assets/css/utama.css');

    const fnNames = catalog.jsFunctions.map((f) => f.name);
    expect(fnNames).toContain('simpanPegawai');
    expect(fnNames).toContain('formatRupiah');
    expect(fnNames).toContain('resetFormPegawai');
    expect(catalog.jsClasses.some((c) => c.name === 'ModalPegawai')).toBe(true);

    const kartuCls = catalog.cssClasses.find((c) => c.name === 'kartu-pegawai');
    expect(kartuCls).toBeDefined();
    expect(kartuCls?.fromStylesheet).toBe(true);
    expect(kartuCls?.declarationsPreview).toContain('display: flex');
    expect(catalog.cssClasses.some((c) => c.name === 'label-wajib')).toBe(true);
    expect(catalog.cssVariables.some((v) => v.name === '--warna-aksen')).toBe(true);
    expect(catalog.htmlIds.map((h) => h.id)).toEqual(
      expect.arrayContaining(['form_pegawai', 'kd_unitkerja'])
    );

    const dts = buildAmbientWebExtraLibDts(catalog);
    expect(dts).toContain('declare const $: JQueryStatic;');
    expect(dts).toContain('declare function simpanPegawai(nip?: any, kdUnit?: any): Promise<any>;');
    expect(dts).toContain('declare class ModalPegawai');
  });

  it('ConnectionManager.scanRemoteWorkspaceSymbols mengindeks fungsi PHP, fungsi/class JS, class/variabel CSS, HTML #id, & relasi JOIN langsung dari Server Remote', async () => {
    const remoteRoot = join(tempRoot, 'mock-intranew8-server');
    const ws = new WorkspaceService();

    await ws.createEntry(
      join(remoteRoot, 'js/app_remote.js'),
      false,
      `async function muatDataRemote(nip) {
  return fetch('/api/pegawai?nip=' + nip);
}
`
    );
    await ws.createEntry(
      join(remoteRoot, 'css/intranew.css'),
      false,
      `:root { --hijau-intranew: #10b981; }
.badge-intranew { background: #10b981; color: #fff; }
`
    );
    await ws.createEntry(
      join(remoteRoot, 'sipegi/pegawai_idx.php'),
      false,
      `<?php
function ambilDaftarPegawai($kdUnit) {
  $q = mysql_query("SELECT p.nip, u.nama FROM sipegi.mst_pegawai p LEFT JOIN sipegi.mst_unitkerja u ON u.kd_unitkerja = p.kd_unitkerja");
  $row = ['nip_pegawai' => '1985'];
  return $row['nip_pegawai'];
}
?>
<div id="tabel_pegawai_remote" class="badge-intranew"></div>
`
    );

    const mgr = new ConnectionManager(
      join(tempRoot, 'remote-intel-vault'),
      new FallbackAesVault('ri-seed'),
      (prof) => new LocalFolderTransferDriver(prof)
    );

    const savedConn = await mgr.save({
      profile: {
        name: 'Intranew8',
        protocol: 'sftp',
        host: '10.10.8.8',
        port: 22,
        username: 'dev',
        remotePath: remoteRoot,
        authType: 'password',
        keepSynchronized: false,
        ignorePatterns: []
      },
      password: 'secret'
    });

    const intel = await mgr.scanRemoteWorkspaceSymbols(savedConn.id);
    expect(intel.scannedFiles).toBe(3);
    expect(intel.phpSymbols.functions.some((f) => f.name === 'ambilDaftarPegawai')).toBe(true);
    expect(intel.phpSymbols.functions[0].filePath).toBe(
      `remote://${savedConn.id}/sipegi/pegawai_idx.php`
    );
    expect(intel.phpSymbols.arrayKeys).toContain('nip_pegawai');
    expect(intel.webCatalog.jsFunctions.some((f) => f.name === 'muatDataRemote')).toBe(true);
    expect(intel.webCatalog.cssClasses.some((c) => c.name === 'badge-intranew')).toBe(true);
    expect(intel.webCatalog.cssVariables.some((v) => v.name === '--hijau-intranew')).toBe(true);
    expect(intel.webCatalog.htmlIds.some((h) => h.id === 'tabel_pegawai_remote')).toBe(true);
    expect(intel.joinEdges.some((e) => e.leftColumn === 'kd_unitkerja')).toBe(true);

    await mgr.disposeAll();
  });

  it('Phase 20: Island Search Engine mengurutkan file Remote & Lokal di atas vendor/.min.js serta menyatukan Simbol PHP/JS/CSS, Tabel DB, & lompat :baris', () => {
    // 1. Query parser checks (:baris, file:baris, @simbol, .class vs .php, #tabel, >command)
    expect(parseIslandSearchQuery(':128')).toMatchObject({
      isPureLineJump: true,
      lineJump: 128,
      cleanQuery: ''
    });
    expect(parseIslandSearchQuery('siswa_save.php:45')).toMatchObject({
      isPureLineJump: false,
      lineJump: 45,
      cleanQuery: 'siswa_save.php',
      prefixHint: null
    });
    expect(parseIslandSearchQuery('.php')).toMatchObject({
      prefixHint: null,
      cleanQuery: '.php'
    });
    expect(parseIslandSearchQuery('.badge-intranew')).toMatchObject({
      prefixHint: 'css',
      cleanQuery: '.badge-intranew'
    });
    expect(parseIslandSearchQuery('@ambilDaftarPegawai')).toMatchObject({
      prefixHint: 'symbol',
      cleanQuery: 'ambilDaftarPegawai'
    });
    expect(parseIslandSearchQuery('#mst_pegawai')).toMatchObject({
      prefixHint: 'table',
      cleanQuery: 'mst_pegawai'
    });

    // 2. Anti-vendor & unified ranking
    const files = [
      {
        key: 'local:vendor-min',
        source: 'local' as const,
        name: 'index.global.min.js',
        relativePath: '_adit/calendar/lama/vendor/packages/daygrid/index.global.min.js',
        localPath: 'D:/proj/_adit/calendar/lama/vendor/packages/daygrid/index.global.min.js'
      },
      {
        key: 'remote:c1:sipegi/index.php',
        source: 'remote' as const,
        name: 'index.php',
        relativePath: 'sipegi/index.php',
        connectionId: 'c1',
        connectionName: 'Intranew8'
      },
      {
        key: 'local:app-js',
        source: 'local' as const,
        name: 'index_dashboard.js',
        relativePath: 'assets/js/index_dashboard.js',
        localPath: 'D:/proj/assets/js/index_dashboard.js'
      }
    ];

    const symbols = buildIslandSymbolsFromCatalogs({
      remoteConnectionId: 'c1',
      remoteConnectionName: 'Intranew8',
      remotePhp: {
        functions: [
          {
            name: 'simpanPegawaiBaru',
            params: [{ name: '$nip' }],
            relativePath: 'sipegi/pegawai_save.php',
            line: 34
          }
        ],
        classes: [],
        arrayKeys: []
      },
      remoteWeb: {
        jsFunctions: [
          {
            name: 'muatIndexPegawai',
            params: ['hal'],
            kind: 'function',
            relativePath: 'js/pegawai.js',
            line: 12
          }
        ],
        jsClasses: [],
        cssClasses: [
          {
            name: 'kartu-pegawai',
            fromStylesheet: true,
            declarationsPreview: 'border-radius: 8px;',
            relativePath: 'css/style.css',
            line: 50
          }
        ],
        cssVariables: [],
        htmlIds: [],
        jsFiles: [],
        cssFiles: []
      }
    });

    const dbTables = buildIslandDbTablesFromSchema({
      profileId: 'db1',
      profileName: 'Sipegi DB',
      currentDatabase: 'sipegi',
      databases: ['sipegi'],
      engine: 'mysql',
      loadedAt: new Date().toISOString(),
      tables: [
        {
          name: 'mst_pegawai',
          schema: 'sipegi',
          kind: 'table',
          columns: [
            {
              name: 'nip',
              dataType: 'varchar',
              columnType: 'varchar(20)',
              nullable: false,
              isPrimaryKey: true
            }
          ],
          primaryKeys: ['nip']
        }
      ]
    });

    // Searching "index" must place real server/app files ABOVE vendor/index.global.min.js
    const rankedIndex = rankIslandSearchResults({
      rawQuery: 'index',
      mode: 'all',
      scope: 'all',
      files,
      symbols,
      dbTables,
      activeRemoteSubPath: 'sipegi'
    });
    expect(rankedIndex[0].file?.relativePath).toBe('sipegi/index.php');
    const vendorPos = rankedIndex.findIndex((r) =>
      r.subtitle.includes('vendor/packages/daygrid')
    );
    expect(vendorPos).toBe(rankedIndex.length - 1);

    // Scope filter 'remote' only returns remote items
    const remoteOnly = rankIslandSearchResults({
      rawQuery: 'pegawai',
      mode: 'all',
      scope: 'remote',
      files,
      symbols,
      dbTables
    });
    expect(remoteOnly.some((r) => r.category === 'symbol' && r.source === 'remote')).toBe(true);
    expect(remoteOnly.every((r) => r.source !== 'local')).toBe(true);

    // Unified query "pegawai" in 'all' mode surfaces PHP fn, JS fn, CSS class, AND DB table
    const unifiedPegawai = rankIslandSearchResults({
      rawQuery: 'pegawai',
      mode: 'all',
      scope: 'all',
      files,
      symbols,
      dbTables
    });
    const categories = new Set(unifiedPegawai.map((r) => r.category));
    expect(categories.has('symbol')).toBe(true);
    expect(categories.has('db-table')).toBe(true);
  });

  it('Phase 21A: Visual Table Designer (CREATE/ALTER MySQL & Postgres) & DB Data Sync + Smart Anonymizer bekerja akurat', () => {
    // 1. CREATE TABLE compilation
    const blank = createBlankTableDraft('mysql', 'sipegi');
    blank.tableName = 'mst_jabatan';
    blank.indexes.push({
      uid: 'idx1',
      name: 'idx_jabatan_nama',
      unique: true,
      columns: ['nama']
    });
    const compiledCreate = compileTableDesignerSql(blank);
    expect(compiledCreate.statements).toHaveLength(1);
    expect(compiledCreate.fullSql).toContain('CREATE TABLE `sipegi`.`mst_jabatan`');
    expect(compiledCreate.fullSql).toContain('AUTO_INCREMENT');
    expect(compiledCreate.fullSql).toContain('UNIQUE KEY `idx_jabatan_nama` (`nama`)');

    // 2. ALTER TABLE diff compilation (rename column + add column + drop column)
    const alterDraft = createDraftFromExistingTable(
      {
        name: 'mst_pegawai',
        schema: 'sipegi',
        kind: 'table',
        primaryKeys: ['nip'],
        columns: [
          {
            name: 'nip',
            dataType: 'varchar',
            columnType: 'varchar(20)',
            nullable: false,
            isPrimaryKey: true
          },
          {
            name: 'nm_lama',
            dataType: 'varchar',
            columnType: 'varchar(60)',
            nullable: true,
            isPrimaryKey: false
          },
          {
            name: 'kolom_usang',
            dataType: 'int',
            columnType: 'int(11)',
            nullable: true,
            isPrimaryKey: false
          }
        ]
      },
      'mysql',
      'sipegi'
    );
    alterDraft.columns[1].name = 'nama_lengkap';
    alterDraft.columns[1].lengthOrValues = '150';
    // Drop kolom_usang
    alterDraft.columns = alterDraft.columns.filter((c) => c.name !== 'kolom_usang');
    alterDraft.deletedColumns.push('kolom_usang');
    // Add email column
    alterDraft.columns.push({
      uid: 'new-col',
      name: 'email_dinas',
      dataType: 'VARCHAR',
      lengthOrValues: '120',
      nullable: true,
      isPrimaryKey: false,
      autoIncrement: false,
      defaultValue: '',
      comment: 'Email resmi'
    });

    const compiledAlter = compileTableDesignerSql(alterDraft);
    expect(compiledAlter.hasDestructiveChanges).toBe(true);
    expect(compiledAlter.fullSql).toContain('DROP COLUMN `kolom_usang`');
    expect(compiledAlter.fullSql).toContain(
      'CHANGE COLUMN `nm_lama` `nama_lengkap` VARCHAR(150) NULL'
    );
    expect(compiledAlter.fullSql).toContain(
      "ADD COLUMN `email_dinas` VARCHAR(120) NULL COMMENT 'Email resmi' AFTER `nama_lengkap`"
    );

    // 3. Smart Anonymizer + Batch Upsert SQL (MySQL & PostgreSQL)
    const masks = detectSensitiveColumnMasks(['nip', 'password', 'nik', 'no_hp', 'email', 'nama']);
    expect(masks.password).toBe('bcrypt-dummy');
    expect(masks.nik).toBe('masked-digits');
    expect(masks.no_hp).toBe('masked-phone');
    expect(masks.email).toBe('masked-email');
    expect(masks.nama).toBe('none');

    const maskedRow = applyRowAnonymization(
      {
        nip: '19850101',
        password: 'rahasia_asli_plaintext',
        nik: '3374010101850001',
        no_hp: '081399887766',
        email: 'budi.asli@dinas.go.id',
        nama: 'Budi'
      },
      masks,
      0
    );
    expect(maskedRow.password).toBe(
      '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi'
    );
    expect(maskedRow.email).toBe('pengguna_1@simulasi.local');
    expect(maskedRow.nik).not.toBe('3374010101850001');
    expect(maskedRow.nama).toBe('Budi');

    const mysqlUpsert = buildBatchUpsertSql({
      table: 'mst_pegawai',
      schema: 'sipegi',
      columns: ['nip', 'nama'],
      primaryKeys: ['nip'],
      rows: [{ nip: '19850101', nama: "Jum'at" }],
      engine: 'mysql',
      writeMode: 'upsert'
    });
    expect(mysqlUpsert[0]).toContain('ON DUPLICATE KEY UPDATE `nama` = VALUES(`nama`)');
    expect(mysqlUpsert[0]).toContain("'Jum''at'");

    const pgUpsert = buildBatchUpsertSql({
      table: 'mst_pegawai',
      schema: 'public',
      columns: ['nip', 'nama'],
      primaryKeys: ['nip'],
      rows: [{ nip: '19850101', nama: 'Budi' }],
      engine: 'postgres',
      writeMode: 'upsert'
    });
    expect(pgUpsert[0]).toContain('ON CONFLICT ("nip") DO UPDATE SET "nama" = EXCLUDED."nama"');
  });

  it('Phase 21B: Pre-Save SFTP Guard, Smart Rename/Extract Refactor, Pin Favorit Island, & PHP Report Generator bekerja end-to-end', () => {
    // 1. Pre-Save SFTP Guard: catches var_dump + debugger + merge conflict + broken <script>, ignores `or die(...)`
    const prevPhp = `<?php\n$q = mysql_query($sql) or die(mysql_error());\n?>\n`;
    const editedPhp = `<?php\n$q = mysql_query($sql) or die(mysql_error());\nvar_dump($_POST); die();\n?>\n<script>\nfunction cek() {\n  debugger;\n  <?php if ($ok) { ?>\n  console.log(1);\n  <?php } ?>\n</script>\n`;

    const guardRes = analyzePreSaveHazards({
      content: editedPhp,
      previousSavedContent: prevPhp,
      language: 'php',
      fileName: 'pegawai_save.php',
      isProduction: true
    });
    expect(guardRes.hasHazards).toBe(true);
    expect(guardRes.hasAutoRemovable).toBe(true);
    // Should NOT flag `mysql_query($sql) or die(...)` on line 2!
    expect(guardRes.items.some((i) => i.line === 2)).toBe(false);
    // Should flag var_dump, debugger, and unclosed <script> function brace!
    expect(guardRes.items.some((i) => i.kind === 'php-debug-trap')).toBe(true);
    expect(guardRes.items.some((i) => i.kind === 'js-debug-trap')).toBe(true);
    expect(guardRes.items.some((i) => i.kind === 'script-brace-mismatch')).toBe(true);

    const cleanedCode = stripAutoRemovableDebugTraps(editedPhp, guardRes.items);
    expect(cleanedCode).not.toContain('var_dump($_POST)');
    expect(cleanedCode).not.toContain('debugger;');
    expect(cleanedCode).toContain('mysql_query($sql) or die');

    // 2. Smart Rename (word-boundary safe!) & Extract Function / Include
    const renamePlan = previewSmartSymbolRename({
      oldSymbol: '$gaji',
      newSymbol: '$gajiPokok',
      files: [
        {
          fileKey: 'local:hitung.php',
          displayPath: 'hitung.php',
          content: '<?php\n$gaji = 5000000;\n$gaji_tunjangan = $gaji + 1000000;\n'
        }
      ]
    });
    expect(renamePlan.totalOccurrences).toBe(2);
    expect(renamePlan.files[0].newContent).toContain('$gajiPokok = 5000000;');
    expect(renamePlan.files[0].newContent).toContain('$gaji_tunjangan = $gajiPokok + 1000000;');

    const extractedFn = buildExtractedFunctionCode({
      selectedCode: '$total = $pokok + $tunjangan - $_POST["potongan"];',
      functionName: 'hitungGajiBersih',
      language: 'php'
    });
    expect(extractedFn.callReplacement).toBe(
      '$total = hitungGajiBersih($total, $pokok, $tunjangan);'
    );
    expect(extractedFn.extractedDeclaration).toContain('return $total;');

    const bladeInc = buildExtractedIncludeResult({
      selectedCode: '<div class="alert">{{ $pesan }}</div>',
      targetFileName: 'partials/notif_alert.blade.php',
      isBlade: true
    });
    expect(bladeInc.includeStatement).toBe("@include('partials.notif_alert')");

    // 3. Pinned Favorite Files boost in Dynamic Island Search
    const rankedWithPin = rankIslandSearchResults({
      rawQuery: '',
      mode: 'files',
      scope: 'all',
      pinnedFileKeys: new Set(['remote:c1:config/fungsi_umum.php']),
      files: [
        {
          key: 'remote:c1:index.php',
          source: 'remote',
          name: 'index.php',
          relativePath: 'index.php',
          connectionId: 'c1',
          connectionName: 'Intranew8'
        },
        {
          key: 'remote:c1:config/fungsi_umum.php',
          source: 'remote',
          name: 'fungsi_umum.php',
          relativePath: 'config/fungsi_umum.php',
          connectionId: 'c1',
          connectionName: 'Intranew8'
        }
      ]
    });
    expect(rankedWithPin[0].file?.name).toBe('fungsi_umum.php');
    expect(rankedWithPin[0].badge).toContain('★');

    // 4. Instant PHP Data Report Generator (*_cetak.php & *_excel.php)
    const reportBundle = generatePhpReportBundle({
      moduleSlug: 'rekap_gaji',
      reportTitle: 'Laporan Rekapitulasi Gaji Pegawai',
      subtitleOrInstansi: 'BKD Pemerintah Provinsi',
      sqlQuery: 'SELECT p.nip, p.nama, p.kd_unitkerja, p.total_gaji FROM mst_pegawai p',
      columns: ['nip', 'nama', 'kd_unitkerja', 'total_gaji'],
      flavor: 'wisanggeni'
    });
    expect(reportBundle.cetakFileName).toBe('rekap_gaji_cetak.php');
    expect(reportBundle.excelFileName).toBe('rekap_gaji_excel.php');
    expect(reportBundle.excelContent).toContain('application/vnd.ms-excel');
    expect(reportBundle.excelContent).toContain('mso-number-format: "\\@"');
    expect(reportBundle.cetakContent).toContain("$totals['total_gaji'] +=");
    expect(reportBundle.cetakContent).toContain('TOTAL');
  });

  it('Phase 22: Pustaka Query Tersimpan (SQL & Diagram Visual 2D) tersimpan permanen di DatabaseService & muncul di Dynamic Island Search', async () => {
    const dbSvc = new DatabaseService(join(tempRoot, 'saved-queries-store'), new FallbackAesVault('sq'));

    const q1 = await dbSvc.saveQuery({
      name: 'Daftar Pegawai Aktif',
      folder: 'Kepegawaian',
      sql: "SELECT nip, nama FROM mst_pegawai WHERE status = 'A'",
      database: 'sipegi',
      isFavorite: false
    });

    const q2 = await dbSvc.saveQuery({
      name: 'Rekap Unit Kerja Visual',
      folder: 'Kepegawaian',
      sql: 'SELECT u.nm_unitkerja, COUNT(p.nip) AS jml FROM mst_unitkerja u LEFT JOIN mst_pegawai p ON p.kd_unitkerja = u.kd_unitkerja GROUP BY u.nm_unitkerja',
      database: 'sipegi',
      isFavorite: true,
      visualDiagramSpec: {
        nodes: [
          { id: 'n1', schema: 'sipegi', name: 'mst_unitkerja', alias: 'u', x: 40, y: 40 },
          { id: 'n2', schema: 'sipegi', name: 'mst_pegawai', alias: 'p', x: 340, y: 40 }
        ],
        links: [
          {
            id: 'l1',
            fromNodeId: 'n1',
            fromColumn: 'kd_unitkerja',
            toNodeId: 'n2',
            toColumn: 'kd_unitkerja',
            joinType: 'LEFT JOIN',
            operator: '='
          }
        ],
        selectedCols: [
          { id: 'c1', tableAlias: 'u', columnName: 'nm_unitkerja' },
          { id: 'c2', tableAlias: 'p', columnName: 'nip', aggregate: 'COUNT', outputAlias: 'jml' }
        ],
        groupByColumns: ['u.nm_unitkerja'],
        limit: 100
      }
    });

    const listed = await dbSvc.listSavedQueries();
    expect(listed).toHaveLength(2);
    // Favorite query must rank first!
    expect(listed[0].id).toBe(q2.id);
    expect(listed[0].visualDiagramSpec?.nodes).toHaveLength(2);

    // Updating name without passing visualDiagramSpec preserves existing visualDiagramSpec
    await dbSvc.saveQuery({
      id: q2.id,
      name: 'Rekap Unit Kerja Visual v2',
      folder: 'Kepegawaian',
      sql: q2.sql
    });
    const afterUpdate = await dbSvc.listSavedQueries();
    expect(afterUpdate[0].name).toBe('Rekap Unit Kerja Visual v2');
    expect(afterUpdate[0].visualDiagramSpec?.links).toHaveLength(1);

    // Searchable inside Dynamic Island Omnibox
    const islandHits = rankIslandSearchResults({
      rawQuery: 'rekap unit',
      mode: 'all',
      scope: 'all',
      files: [],
      savedQueries: afterUpdate
    });
    expect(islandHits).toHaveLength(1);
    expect(islandHits[0].category).toBe('saved-query');
    expect(islandHits[0].badge).toContain('Visual Query');

    await dbSvc.deleteSavedQuery(q1.id);
    expect(await dbSvc.listSavedQueries()).toHaveLength(1);
  });

  it('Phase 23A: Grafik & Pivot Engine, Missing Index Advisor (EXPLAIN), & Smart Data Seeder Indonesia bekerja akurat', () => {
    // 1. Chart & Pivot Engine
    const rows = [
      { nip: '198501012010011001', unit: 'SDM', jenis: 'PNS', gaji: 5000000 },
      { nip: '198601012010011002', unit: 'SDM', jenis: 'PPPK', gaji: 4000000 },
      { nip: '198701012010011003', unit: 'TI', jenis: 'PNS', gaji: 6500000 }
    ];
    const axes = inferBestChartAxes(['nip', 'unit', 'jenis', 'gaji'], rows);
    // Must NOT pick `nip` as numeric metric! Should pick `gaji` with `SUM`
    expect(axes.valueCol).toBe('gaji');
    expect(axes.aggFunc).toBe('SUM');

    const series = aggregateChartSeries({
      rows,
      categoryCol: 'unit',
      valueCol: 'gaji',
      aggFunc: 'SUM'
    });
    expect(series.totalValue).toBe(15500000);
    expect(series.points[0]).toMatchObject({ label: 'SDM', value: 9000000 });

    const pivot = buildPivotMatrix({
      rows,
      rowCol: 'unit',
      colCol: 'jenis',
      valueCol: 'gaji',
      aggFunc: 'SUM'
    });
    expect(pivot.cells['SDM']['PNS']).toBe(5000000);
    expect(pivot.rowTotals['SDM']).toBe(9000000);
    expect(pivot.grandTotal).toBe(15500000);

    // 2. Missing Index Advisor
    const recs = analyzeQueryIndexRecommendations({
      sql: "SELECT p.nip, u.nm_unit FROM mst_pegawai p LEFT JOIN mst_unitkerja u ON u.kd_unit = p.kd_unit WHERE p.status_aktif = 'Y'",
      engine: 'mysql',
      defaultSchema: 'sipegi',
      tables: [
        {
          name: 'mst_pegawai',
          schema: 'sipegi',
          kind: 'table',
          rowEstimate: 8500,
          primaryKeys: ['nip'],
          columns: [
            { name: 'nip', dataType: 'varchar', columnType: 'varchar(20)', nullable: false, isPrimaryKey: true },
            { name: 'kd_unit', dataType: 'varchar', columnType: 'varchar(10)', nullable: true, isPrimaryKey: false },
            { name: 'status_aktif', dataType: 'char', columnType: 'char(1)', nullable: false, isPrimaryKey: false }
          ]
        },
        {
          name: 'mst_unitkerja',
          schema: 'sipegi',
          kind: 'table',
          primaryKeys: ['kd_unit'],
          columns: [
            { name: 'kd_unit', dataType: 'varchar', columnType: 'varchar(10)', nullable: false, isPrimaryKey: true },
            { name: 'nm_unit', dataType: 'varchar', columnType: 'varchar(100)', nullable: false, isPrimaryKey: false }
          ]
        }
      ],
      explainRows: [{ table: 'p', type: 'ALL', key: null, rows: 8500 }]
    });
    // Should recommend composite index on mst_pegawai(kd_unit, status_aktif), NOT on mst_unitkerja(kd_unit) because kd_unit is PK there!
    expect(recs).toHaveLength(1);
    expect(recs[0].table).toBe('mst_pegawai');
    expect(recs[0].severity).toBe('high');
    expect(recs[0].createIndexSql).toContain(
      'CREATE INDEX `idx_mst_pegawai_kd_unit_status_aktif` ON `sipegi`.`mst_pegawai` (`kd_unit`, `status_aktif`);'
    );

    // 3. Smart Indonesian Data Seeder
    const seeded = buildSeedSqlStatements({
      engine: 'mysql',
      schema: 'sipegi',
      rowCount: 5,
      foreignKeyPools: { kd_unitkerja: ['010100', '020100'] },
      table: {
        name: 'mst_pegawai',
        kind: 'table',
        primaryKeys: ['id'],
        columns: [
          {
            name: 'id',
            dataType: 'int',
            columnType: 'int(11)',
            nullable: false,
            isPrimaryKey: true,
            extra: 'auto_increment'
          },
          { name: 'nip', dataType: 'varchar', columnType: 'varchar(18)', nullable: false, isPrimaryKey: false },
          { name: 'nik', dataType: 'varchar', columnType: 'varchar(16)', nullable: false, isPrimaryKey: false },
          { name: 'nama_lengkap', dataType: 'varchar', columnType: 'varchar(100)', nullable: false, isPrimaryKey: false },
          { name: 'kd_unitkerja', dataType: 'varchar', columnType: 'varchar(10)', nullable: false, isPrimaryKey: false },
          { name: 'total_gaji', dataType: 'decimal', columnType: 'decimal(15,2)', nullable: false, isPrimaryKey: false }
        ]
      }
    });
    // Skips auto_increment `id`
    expect(seeded.columns).not.toContain('id');
    expect(seeded.rows).toHaveLength(5);
    expect(String(seeded.rows[0].nip)).toHaveLength(18);
    expect(String(seeded.rows[0].nik)).toHaveLength(16);
    expect(['010100', '020100']).toContain(seeded.rows[0].kd_unitkerja);
  });

  it('Phase 23B: Pembuat Paket Rilis Patch (.ZIP) & Penjadwal Otomatis Backup/Export bekerja end-to-end', async () => {
    // 1. Release Patch .ZIP Builder
    const patchWs = join(tempRoot, 'patch-ws');
    await mkdir(join(patchWs, 'modul', 'absensi'), { recursive: true });
    await writeFile(join(patchWs, 'modul', 'absensi', 'absen_save.php'), '<?php echo "patch ok"; ?>', 'utf-8');

    const modified = await scanModifiedFilesSince(patchWs, Date.now() - 60_000);
    expect(modified.map((m) => m.relativePath)).toContain('modul/absensi/absen_save.php');

    const patchZip = await createReleasePatchZipBuffer({
      workspacePath: patchWs,
      relativePaths: ['modul/absensi/absen_save.php'],
      releaseTitle: 'Rilis Perbaikan Absensi',
      migrationSql: 'ALTER TABLE absensi ADD COLUMN ket VARCHAR(100);'
    });
    expect(patchZip.fileCount).toBe(3); // code + sql + CATATAN_RILIS.txt
    expect(patchZip.buffer.readUInt32LE(0)).toBe(0x04034b50); // Valid PKZIP header

    // Unpack local entries from patchZip.buffer
    const unpackedNames: string[] = [];
    let offset = 0;
    while (offset + 30 <= patchZip.buffer.length && patchZip.buffer.readUInt32LE(offset) === 0x04034b50) {
      const compSize = patchZip.buffer.readUInt32LE(offset + 18);
      const nameLen = patchZip.buffer.readUInt16LE(offset + 26);
      const extraLen = patchZip.buffer.readUInt16LE(offset + 28);
      const name = patchZip.buffer.subarray(offset + 30, offset + 30 + nameLen).toString('utf-8');
      const dataStart = offset + 30 + nameLen + extraLen;
      const body = inflateRawSync(patchZip.buffer.subarray(dataStart, dataStart + compSize)).toString('utf-8');
      unpackedNames.push(name);
      if (name === 'CATATAN_RILIS.txt') {
        expect(body).toContain('Rilis Perbaikan Absensi');
      }
      offset = dataStart + compSize;
    }
    expect(unpackedNames).toEqual([
      'modul/absensi/absen_save.php',
      '_sql_migrasi/migrasi_patch.sql',
      'CATATAN_RILIS.txt'
    ]);

    // 2. DB Scheduler due-check & persistence
    const dbSvc = new DatabaseService(join(tempRoot, 'sched-db'), new FallbackAesVault('sch'));
    const schedSvc = new DbSchedulerService(join(tempRoot, 'sched-db'), dbSvc);
    const savedJob = await schedSvc.save({
      name: 'Backup Sore',
      kind: 'sql-backup',
      profileId: 'p1',
      database: 'sipegi',
      scheduleType: 'daily',
      dailyTimeHHMM: '08:00',
      outputDir: join(tempRoot, 'backups'),
      enabled: true
    });

    const morningBefore = new Date(2026, 10, 16, 7, 30, 0);
    const morningAfter = new Date(2026, 10, 16, 8, 15, 0);
    expect(DbSchedulerService.isJobDue(savedJob, morningBefore)).toBe(false);
    expect(DbSchedulerService.isJobDue(savedJob, morningAfter)).toBe(true);
    // Once ran today, must not run again on the same day!
    expect(
      DbSchedulerService.isJobDue(
        { ...savedJob, lastRunAt: new Date(2026, 10, 16, 8, 5, 0).toISOString() },
        morningAfter
      )
    ).toBe(false);

    await schedSvc.remove(savedJob.id);
    expect(await schedSvc.list()).toHaveLength(0);
  });

  it('Phase 24: DatabaseService memancarkan progres real-time saat introspect database dimulai', async () => {
    const dbSvc = new DatabaseService(join(tempRoot, 'prog-db'), new FallbackAesVault('prg'));
    const prof = await dbSvc.save({
      profile: {
        name: 'Intranew8 Uji',
        engine: 'mysql',
        host: '127.0.0.1',
        port: 1, // unreachable port -> fast ECONNREFUSED after emitting connecting progress!
        username: 'root',
        database: 'data_perwakilan_ri',
        ssl: false
      },
      password: 'secret'
    });

    const events: Array<{ phase: string; percent: number; database?: string; message: string }> = [];
    dbSvc.setProgressListener((evt) => {
      events.push({
        phase: evt.phase,
        percent: evt.percent,
        database: evt.database,
        message: evt.message
      });
    });

    await expect(dbSvc.introspect(prof.id, 'data_perwakilan_ri')).rejects.toThrow();

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].phase).toBe('connecting');
    expect(events[0].database).toBe('data_perwakilan_ri');
    expect(events[0].percent).toBeGreaterThan(0);
    expect(events[0].message).toContain('Intranew8 Uji');
    await dbSvc.dispose();
  });

  it('Phase 26: Local Disk Schema Cache (< 10ms instant load) & seluruh Modal bebas dari backdrop-close serta memiliki tombol Keluar', async () => {
    // 1. Verify Local Disk Schema Cache (Stale-While-Revalidate)
    const cacheDir = join(tempRoot, 'fast-db');
    const dbSvc = new DatabaseService(cacheDir, new FallbackAesVault('fast'));
    const prof = await dbSvc.save({
      profile: {
        name: 'Production SIINAS',
        engine: 'mysql',
        host: '127.0.0.1',
        port: 3306,
        username: 'root',
        database: 'siinas',
        ssl: false
      },
      password: 'secret'
    });

    const schemaCacheFolder = join(cacheDir, 'schema-cache');
    await mkdir(schemaCacheFolder, { recursive: true });
    const safeId = prof.id.replace(/[^A-Za-z0-9_-]/g, '_');
    await writeFile(
      join(schemaCacheFolder, `${safeId}.json`),
      JSON.stringify({
        profileId: prof.id,
        profileName: prof.name,
        engine: 'mysql',
        databases: ['siinas', 'data_perwakilan_ri'],
        lastActiveDatabase: 'siinas',
        tablesByDb: {
          siinas: [
            {
              name: 'admin',
              schema: 'siinas',
              kind: 'table',
              columns: [
                {
                  name: 'id_admin',
                  dataType: 'smallint',
                  columnType: 'smallint(6)',
                  nullable: false,
                  isPrimaryKey: true
                }
              ],
              primaryKeys: ['id_admin']
            }
          ],
          data_perwakilan_ri: [
            {
              name: 'kebijakan',
              schema: 'data_perwakilan_ri',
              kind: 'table',
              columns: [
                {
                  name: 'id_kebijakan',
                  dataType: 'int',
                  columnType: 'int(11)',
                  nullable: false,
                  isPrimaryKey: true
                }
              ],
              primaryKeys: ['id_kebijakan']
            }
          ]
        },
        updatedAt: '2026-11-20T10:00:00.000Z'
      }),
      'utf-8'
    );

    const t0 = Date.now();
    const cachedSiinas = await dbSvc.getCachedSchema(prof.id, 'siinas');
    const elapsedMs = Date.now() - t0;
    expect(elapsedMs).toBeLessThan(150);
    expect(cachedSiinas).not.toBeNull();
    expect(cachedSiinas?.currentDatabase).toBe('siinas');
    expect(cachedSiinas?.tables).toHaveLength(1);
    expect(cachedSiinas?.tables[0].name).toBe('admin');
    expect(cachedSiinas?.allTables).toHaveLength(2);

    const cachedPerwakilan = await dbSvc.getCachedSchema(prof.id, 'data_perwakilan_ri');
    expect(cachedPerwakilan?.currentDatabase).toBe('data_perwakilan_ri');
    expect(cachedPerwakilan?.tables[0].name).toBe('kebijakan');

    await dbSvc.remove(prof.id);
    expect(await dbSvc.getCachedSchema(prof.id)).toBeNull();
    await dbSvc.dispose();

    // 2. Verify every single Modal component has `btn-modal-exit` ("Keluar") & NO backdrop click-to-close!
    const modalFiles = [
      'ConnectionModal.tsx',
      'DatabaseSidebar.tsx',
      'DbArchitectModal.tsx',
      'DbRoutinesModal.tsx',
      'DbSchedulerModal.tsx',
      'DbSeederModal.tsx',
      'PhpScratchpadModal.tsx',
      'PreSaveGuardModal.tsx',
      'ProjectModal.tsx',
      'QuickPaletteModal.tsx',
      'ReleasePatchModal.tsx',
      'ReportGeneratorModal.tsx',
      'ServerMonitorModal.tsx',
      'SmartRefactorModal.tsx',
      'SynchronizerModal.tsx',
      'TableDesignerModal.tsx',
      'EnterpriseAuditModal.tsx',
      'ExcelImportModal.tsx',
      'DbGlobalSearchModal.tsx',
      'EnterpriseScannerModal.tsx',
      'DbRbacModal.tsx'
    ];

    for (const fileName of modalFiles) {
      const src = await readFile(
        join(process.cwd(), 'src', 'renderer', 'src', 'components', fileName),
        'utf-8'
      );
      const exitMatches = src.match(/className="btn-modal-exit"/g) ?? [];
      const headerMatches = src.match(/className="modal-header"/g) ?? [];
      const backdropTags = src.match(/<div[^>]*className="modal-backdrop"[^>]*>/g) ?? [];

      expect(exitMatches.length, `${fileName} wajib memiliki tombol keluar .btn-modal-exit`).toBeGreaterThan(0);
      expect(
        headerMatches.length,
        `${fileName} wajib memakai .modal-header konsisten untuk setiap modal`
      ).toBe(backdropTags.length);
      expect(
        exitMatches.length,
        `${fileName} wajib memiliki tepat 1 .btn-modal-exit di pojok kanan atas setiap .modal-header`
      ).toBe(headerMatches.length);

      // Pastikan .btn-modal-exit adalah elemen penutup langsung dari <div className="modal-header"> (pojok kanan atas, tidak pernah terbungkus flexWrap)
      const headerBlocks =
        src.match(/<div className="modal-header"[\s\S]*?className="btn-modal-exit"[\s\S]*?<\/button>/g) ?? [];
      expect(
        headerBlocks.length,
        `${fileName}: .btn-modal-exit harus berada di dalam .modal-header pojok kanan atas`
      ).toBe(headerMatches.length);
      for (const block of headerBlocks) {
        const afterLastButtonGroup = block.slice(block.lastIndexOf('<button'));
        expect(afterLastButtonGroup).toContain('btn-modal-exit');
      }

      expect(backdropTags.length).toBeGreaterThan(0);
      for (const tag of backdropTags) {
        expect(tag, `${fileName} tidak boleh menutup modal saat klik di luar`).not.toContain(
          'onClick'
        );
      }
    }
  });

  it('Phase 27A: OpenSSH Zlib compression + Remote Index Persistent Disk Cache (< 10ms) berfungsi akurat', async () => {
    const sshCfg = await buildSshConnectConfig(
      {
        id: 'ssh-1',
        name: 'Prod SFTP',
        protocol: 'sftp',
        host: '10.10.1.5',
        port: 22,
        username: 'deploy',
        remotePath: '/var/www/html',
        authType: 'password',
        keepSynchronized: false,
        ignorePatterns: [],
        createdAt: '2026-11-20T00:00:00Z',
        updatedAt: '2026-11-20T00:00:00Z'
      },
      { password: 'secret' }
    );
    expect(sshCfg.algorithms?.compress).toContain('zlib@openssh.com');

    const storageDir = join(tempRoot, 'remote-cache-store');
    const mockSrv = join(tempRoot, 'mock-sftp-root');
    await mkdir(join(mockSrv, 'modul', 'pegawai'), { recursive: true });
    await writeFile(
      join(mockSrv, 'modul', 'pegawai', 'pegawai_list.php'),
      '<?php function tampilPegawai($id) { return $id; } ?>',
      'utf-8'
    );

    const connMgr = new ConnectionManager(storageDir, new FallbackAesVault('p27-seed'));
    const prof = await connMgr.save({
      profile: {
        name: 'Mock Local SFTP',
        protocol: 'local',
        host: '127.0.0.1',
        port: 0,
        username: '',
        remotePath: mockSrv,
        authType: 'none',
        keepSynchronized: false,
        ignorePatterns: []
      }
    });

    const files = await connMgr.listRemoteFilesIndex(prof.id);
    expect(files.some((f) => f.relativePath === 'modul/pegawai/pegawai_list.php')).toBe(true);

    const intel = await connMgr.scanRemoteWorkspaceSymbols(prof.id);
    expect(intel.phpSymbols.functions.some((fn) => fn.name === 'tampilPegawai')).toBe(true);

    const cached = await connMgr.getCachedRemoteIndex(prof.id);
    expect(cached).not.toBeNull();
    expect(cached?.files.length).toBeGreaterThan(0);
    expect(cached?.intel?.phpSymbols.functions.some((fn) => fn.name === 'tampilPegawai')).toBe(
      true
    );

    await connMgr.remove(prof.id);
    expect(await connMgr.getCachedRemoteIndex(prof.id)).toBeNull();
  });

  it('Phase 27B (B1 & B6): AuditTrailService, SQL Undo Builder, Multi-Statement Splitter & Table Row Data Diff bekerja presisi', async () => {
    const undoUpdate = buildCellUpdateUndoSql({
      engine: 'mysql',
      database: 'siinas',
      table: 'mst_perusahaan',
      column: 'nama_perusahaan',
      oldValue: "PT Maju's Jaya",
      primaryKeyValues: { id_perusahaan: 42 }
    });
    expect(undoUpdate).toBe(
      "UPDATE `siinas`.`mst_perusahaan` SET `nama_perusahaan` = 'PT Maju''s Jaya' WHERE `id_perusahaan` = 42;"
    );

    const undoDelete = buildRowDeleteUndoSql({
      engine: 'postgres',
      table: 'mst_pegawai',
      deletedRow: { nip: '198504122010011009', aktif: true }
    });
    expect(undoDelete).toBe(
      `INSERT INTO "mst_pegawai" ("nip", "aktif") VALUES ('198504122010011009', TRUE);`
    );

    expect(isMutatingSqlStatement('SELECT * FROM admin')).toBe(false);
    expect(isMutatingSqlStatement('UPDATE admin SET status = 1 WHERE id_admin = 2')).toBe(true);

    const multi = splitSqlStatements(
      `SELECT 'a;b' AS txt; -- komentar ; diabaikan\nSELECT /* blok ; */ 2 AS dua;   `
    );
    expect(multi).toHaveLength(2);
    expect(multi[0]).toContain("'a;b'");
    expect(multi[1]).toContain('2 AS dua');

    const auditSvc = new AuditTrailService(join(tempRoot, 'audit-test'));
    await auditSvc.record({
      kind: 'db-cell-update',
      targetName: 'Prod MySQL',
      isProduction: true,
      database: 'siinas',
      tableOrPath: 'admin',
      summary: 'UPDATE admin.status',
      undoSql: undoUpdate
    });
    const list = await auditSvc.list();
    expect(list).toHaveLength(1);
    expect(list[0].isProduction).toBe(true);
    expect(list[0].undoSql).toBe(undoUpdate);

    const rowDiff = diffTableRowsByPrimaryKey({
      sourceRows: [
        { kd_kbli: '01111', uraian: 'Pertanian Jagung Baru' },
        { kd_kbli: '01112', uraian: 'Pertanian Gandum' }
      ],
      targetRows: [
        { kd_kbli: '01111', uraian: 'Pertanian Jagung Lama' },
        { kd_kbli: '99999', uraian: 'Usang' }
      ],
      primaryKeys: ['kd_kbli'],
      targetTable: 'mst_kbli',
      targetDatabase: 'siinas',
      targetEngine: 'mysql',
      includeDeleteMissingInTarget: true
    });
    expect(rowDiff.onlyInSource).toHaveLength(1);
    expect(rowDiff.modified).toHaveLength(1);
    expect(rowDiff.onlyInTarget).toHaveLength(1);
    expect(rowDiff.syncSql).toContain("INSERT INTO `siinas`.`mst_kbli`");
    expect(rowDiff.syncSql).toContain("UPDATE `siinas`.`mst_kbli` SET `uraian` = 'Pertanian Jagung Baru'");
    expect(rowDiff.syncSql).toContain("DELETE FROM `siinas`.`mst_kbli` WHERE `kd_kbli` = '99999'");
  });

  it('Phase 27B (B2, B4, B5): Multi-Sheet .XLSX Reader/Writer, Normalisasi NIP/Tanggal Indonesia, Kamus Data SPBE, & Enterprise Security Scanner bekerja akurat', () => {
    // 1. Multi-sheet XLSX round-trip + leading zero preservation
    const wbBuf = buildMultiSheetXlsxBuffer([
      {
        sheetName: 'Pegawai',
        columns: ['nip', 'kbli', 'tgl_masuk', 'gaji'],
        rows: [
          {
            nip: '198504122010011009',
            kbli: '01111',
            tgl_masuk: '16 November 2026',
            gaji: 'Rp 8.500.000'
          }
        ]
      },
      {
        sheetName: 'Unit',
        columns: ['kd_unit', 'nama_unit'],
        rows: [{ kd_unit: '0201', nama_unit: 'Pusdatin' }]
      }
    ]);
    const parsedWb = parseXlsxBuffer(wbBuf, 'pegawai.xlsx');
    expect(parsedWb.sheets).toHaveLength(2);
    expect(parsedWb.sheets[0].name).toBe('Pegawai');
    expect(parsedWb.sheets[0].rows[0][0]).toBe('198504122010011009');
    expect(parsedWb.sheets[0].rows[0][1]).toBe('01111');
    expect(parsedWb.sheets[1].rows[0][0]).toBe('0201');

    expect(normalizeImportCellValue('01111', 'varchar', false)).toBe('01111');
    expect(normalizeImportCellValue('16 November 2026', 'date', true)).toBe('2026-11-16');
    expect(normalizeImportCellValue('Rp 8.500.000', 'bigint', false)).toBe(8500000);

    const clip = parseClipboardTabularText('nip\tnama\n19900101\tSiti Aminah\n');
    expect(clip.headers).toEqual(['nip', 'nama']);
    expect(clip.rows[0]).toEqual(['19900101', 'Siti Aminah']);

    // 2. Data Dictionary (Kamus Data SPBE / BAST)
    const mockSnap = {
      profileId: 'p1',
      profileName: 'SIINas Prod',
      engine: 'mysql' as const,
      currentDatabase: 'siinas',
      databases: ['siinas'],
      loadedAt: '2026-11-20T10:00:00Z',
      tables: [
        {
          name: 'perusahaan',
          schema: 'siinas',
          kind: 'table' as const,
          columns: [
            {
              name: 'id_perusahaan',
              dataType: 'int',
              columnType: 'int(11)',
              nullable: false,
              isPrimaryKey: true
            }
          ],
          primaryKeys: ['id_perusahaan']
        }
      ]
    };
    const dictSheets = buildDataDictionarySheets(mockSnap);
    expect(dictSheets).toHaveLength(3);
    const dictHtml = buildDataDictionaryHtml(mockSnap, { organizationName: 'Kemenperin' });
    expect(dictHtml).toContain('Kemenperin');
    expect(dictHtml).toContain('id_perusahaan');

    // 3. Offline SAST Security, PHP 8 & Broken-Include Scanner
    const secReport = scanSourceFilesForSecurityAndHealth({
      knownRelPaths: ['modul/user/simpan.php', 'config/koneksi.php'],
      files: [
        {
          relPath: 'modul/user/simpan.php',
          content: [
            '<?php',
            "require_once 'config/tidak_ada.php';",
            '$q = mysqli_query($conn, "SELECT * FROM users WHERE username = \'" . $_POST[\'u\'] . "\'");',
            'echo $_GET["pesan"];',
            'if (get_magic_quotes_gpc()) {}',
            '?>'
          ].join('\n')
        }
      ]
    });
    expect(secReport.counts.critical).toBeGreaterThanOrEqual(1);
    expect(secReport.findings.some((f) => f.category === 'sql-injection')).toBe(true);
    expect(secReport.findings.some((f) => f.category === 'broken-include')).toBe(true);
    expect(secReport.findings.some((f) => f.category === 'xss')).toBe(true);
    expect(secReport.findings.some((f) => f.category === 'php8-compat')).toBe(true);
  });

  it('Phase 28: MySQL Workbench Health Analyzer menghitung Buffer Pool Hit Ratio, QPS Delta, Traffic KB/s, & Tuning Advisor my.cnf secara presisi', () => {
    expect(formatUptimeIndonesian(90120)).toBe('1 hari 1 jam 2 mnt');

    const base1 = parseMysqlStatusAndVariables(
      {
        Uptime: '90120',
        Threads_connected: '135',
        Threads_running: '6',
        Max_used_connections: '142',
        Innodb_buffer_pool_pages_total: '8192',
        Innodb_buffer_pool_pages_data: '7800',
        Innodb_buffer_pool_pages_dirty: '120',
        Innodb_buffer_pool_read_requests: '100000',
        Innodb_buffer_pool_reads: '500',
        Slow_queries: '14',
        Select_full_join: '310',
        Created_tmp_tables: '1000',
        Created_tmp_disk_tables: '420',
        Questions: '50000',
        Com_select: '40000',
        Com_insert: '5000',
        Com_update: '4000',
        Com_delete: '1000',
        Bytes_received: '1024000',
        Bytes_sent: '4096000',
        Innodb_data_reads: '2000',
        Innodb_data_writes: '900'
      },
      {
        version: '8.0.39',
        version_comment: 'MySQL Community Server - GPL',
        max_connections: '150',
        innodb_page_size: '16384',
        innodb_buffer_pool_size: String(128 * 1024 * 1024),
        tmp_table_size: String(16 * 1024 * 1024),
        max_allowed_packet: String(4 * 1024 * 1024),
        slow_query_log: 'OFF',
        performance_schema: 'ON'
      },
      { profileId: 'db-1', profileName: 'SIINas Prod', collectedAtMs: 10000 }
    );

    expect(base1.bufferPool.hitRatioPct).toBe(99.5);
    expect(base1.bufferPool.sizeMb).toBe(128);
    expect(base1.connections.usagePct).toBe(90);
    expect(base1.performanceSchemaEnabled).toBe(true);
    expect(base1.advisories.some((a) => a.id === 'bp-small')).toBe(true);
    expect(base1.advisories.some((a) => a.id === 'full-join')).toBe(true);
    expect(base1.advisories.some((a) => a.id === 'tmp-disk')).toBe(true);
    expect(base1.advisories.some((a) => a.id === 'max-conn')).toBe(true);
    expect(base1.advisories.some((a) => a.id === 'max-packet')).toBe(true);

    const snap1: DbHealthSnapshot = {
      ...base1,
      digestQueries: [],
      lockWaits: [],
      storageByDb: [],
      largestTables: [],
      variables: []
    };
    const snap2: DbHealthSnapshot = {
      ...snap1,
      collectedAtMs: 12000, // +2 seconds
      counters: {
        ...snap1.counters,
        questions: 50240, // +240 -> 120 QPS
        comSelect: 40200, // +200 -> 100/s
        comInsert: 5030,
        comUpdate: 4010, // writes +40 -> 20/s
        bytesReceived: 1024000 + 20480, // +20 KB -> 10 KB/s
        bytesSent: 4096000 + 102400, // +100 KB -> 50 KB/s
        innodbDataReads: 2020,
        innodbDataWrites: 910
      }
    };

    const delta = computeMysqlRateDelta(snap1, snap2);
    expect(delta).not.toBeNull();
    expect(delta?.qps).toBe(120);
    expect(delta?.selectPerSec).toBe(100);
    expect(delta?.writePerSec).toBe(20);
    expect(delta?.netInKbps).toBe(10);
    expect(delta?.netOutKbps).toBe(50);
  });

  it('Phase 30A (#1-#4): Safe Transaction Read-Only/Staging, Visual EXPLAIN Tree, FK Jump-to-Row, & RBAC Security Audit bekerja akurat', () => {
    // #1 Safe Transaction & Read-Only Lock
    expect(isWriteSqlBlockedInReadOnly('SELECT * FROM rekomendasi LIMIT 10').blocked).toBe(false);
    expect(isWriteSqlBlockedInReadOnly('UPDATE rekomendasi SET status=1').blocked).toBe(true);
    expect(isWriteSqlBlockedInReadOnly('WITH x AS (SELECT 1) DELETE FROM rekomendasi').blocked).toBe(true);

    const txBatch = buildPendingMutationsBatch(
      [
        {
          id: 'm1',
          kind: 'update',
          table: 'rekomendasi',
          database: 'e_licensing',
          column: 'status',
          oldValue: 0,
          newValue: 1,
          primaryKeyValues: { id_rekomendasi: 17 },
          rowKey: '{"id_rekomendasi":17}'
        },
        {
          id: 'm2',
          kind: 'delete',
          table: 'rekomendasi',
          database: 'e_licensing',
          primaryKeyValues: { id_rekomendasi: 18 },
          rowKey: '{"id_rekomendasi":18}'
        }
      ],
      'mysql'
    );
    expect(txBatch.statements).toHaveLength(2);
    expect(txBatch.previewSql).toContain('START TRANSACTION;');
    expect(txBatch.previewSql).toContain('UPDATE `e_licensing`.`rekomendasi` SET `status` = 1 WHERE `id_rekomendasi` = 17 LIMIT 1;');
    expect(txBatch.previewSql).toContain('COMMIT;');

    // #2 Visual EXPLAIN Tree
    const explain = buildVisualExplainReport({
      engine: 'mysql',
      sql: 'SELECT * FROM rekomendasi ORDER BY tanggal DESC',
      durationMs: 14,
      jsonPayload: {
        query_block: {
          select_id: 1,
          cost_info: { query_cost: '425.50' },
          ordering_operation: {
            using_filesort: true,
            table: {
              table_name: 'rekomendasi',
              access_type: 'ALL',
              rows_examined_per_scan: 4200,
              filtered: '100.00',
              cost_info: { prefix_cost: '425.50' }
            }
          }
        }
      }
    });
    expect(explain.hasFullTableScan).toBe(true);
    expect(explain.hasFilesort).toBe(true);
    expect(explain.healthScore).toBeLessThan(60);
    expect(explain.root.children[0].table).toBe('rekomendasi');

    // #3 Foreign-Key Jump-to-Row Resolver (Explicit & Implicit Indonesian Convention)
    const allTables = [
      {
        name: 'rekomendasi',
        schema: 'e_licensing',
        kind: 'table' as const,
        primaryKeys: ['id_rekomendasi'],
        columns: [
          { name: 'id_rekomendasi', dataType: 'int', columnType: 'int(11)', nullable: false, isPrimaryKey: true },
          { name: 'id_perusahaan', dataType: 'int', columnType: 'int(11)', nullable: false, isPrimaryKey: false }
        ]
      },
      {
        name: 'mst_perusahaan',
        schema: 'e_licensing',
        kind: 'table' as const,
        primaryKeys: ['id_perusahaan'],
        columns: [
          { name: 'id_perusahaan', dataType: 'int', columnType: 'int(11)', nullable: false, isPrimaryKey: true }
        ]
      }
    ];
    const fk = resolveForeignKeyTargetForColumn({
      sourceTable: allTables[0],
      columnName: 'id_perusahaan',
      allTables,
      currentDatabase: 'e_licensing'
    });
    expect(fk).not.toBeNull();
    expect(fk?.targetTable).toBe('mst_perusahaan');
    expect(buildFkLookupSql(fk!, 42, 'mysql')).toBe(
      'SELECT * FROM `e_licensing`.`mst_perusahaan` WHERE `id_perusahaan` = 42 LIMIT 20;'
    );

    // #4 RBAC User & Security Audit
    const findings = auditDbUsersSecurity(
      [
        {
          username: 'root',
          host: '%',
          isSuperuser: true,
          hasGrantOption: true,
          hasEmptyPassword: true,
          accountLocked: false,
          grants: []
        }
      ],
      'mysql'
    );
    expect(findings.some((f) => f.severity === 'critical' && f.title.includes('root@%'))).toBe(true);
    expect(findings.some((f) => f.title.includes('tidak memiliki password'))).toBe(true);

    const grantSqls = buildRbacGrantSqlStatements(
      {
        username: 'auditor_spbe',
        host: '10.1.0.%',
        password: 'Str0ng!Password',
        database: 'e_licensing',
        table: '*',
        privileges: ['SELECT'],
        createUserIfNotExists: true
      },
      'mysql'
    );
    expect(grantSqls[0]).toContain("CREATE USER IF NOT EXISTS 'auditor_spbe'@'10.1.0.%'");
    expect(grantSqls[1]).toContain("GRANT SELECT ON `e_licensing`.* TO 'auditor_spbe'@'10.1.0.%';");
    expect(grantSqls[2]).toBe('FLUSH PRIVILEGES;');
  });

  it('Phase 30B (#5-#6): Xdebug DBGp Protocol Parser & API Collections / Auto-Capture / OpenAPI+Postman Importer bekerja presisi', () => {
    // #5 Xdebug DBGp Protocol Framing & Parsing
    const initXml =
      '<?xml version="1.0" encoding="iso-8859-1"?><init fileuri="file:///var/www/html/index.php" language="PHP" idekey="HMWSTUDIO"><engine version="3.3.1">Xdebug</engine></init>';
    const rawFramed = Buffer.concat([
      Buffer.from(`${Buffer.byteLength(initXml, 'utf-8')}\0${initXml}\0`, 'utf-8')
    ]);
    const { packets, remainder } = extractDbgpPacketsFromBuffer(rawFramed);
    expect(packets).toHaveLength(1);
    expect(remainder.length).toBe(0);
    const parsedInit = parseDbgpXml(packets[0]);
    expect(parsedInit.kind).toBe('init');
    expect(parsedInit.init?.engineVersion).toBe('3.3.1');

    const ctxXml = `<response command="context_get" transaction_id="5"><property name="$nip" fullname="$nip" type="string" encoding="base64">${Buffer.from('198504122010011009').toString('base64')}</property></response>`;
    const parsedCtx = parseDbgpXml(ctxXml);
    expect(parsedCtx.properties?.[0].name).toBe('$nip');
    expect(parsedCtx.properties?.[0].value).toBe('198504122010011009');

    expect(buildDbgpCommand('step_over', 7)).toBe('step_over -i 7\0');
    const mappedUri = localFilePathToDbgpUri('D:\\Projects\\app\\index.php', {
      localRoot: 'D:/Projects/app',
      remoteRoot: '/var/www/html'
    });
    expect(mappedUri).toBe('file:///var/www/html/index.php');
    expect(
      dbgpUriToLocalFilePath(mappedUri, {
        localRoot: 'D:/Projects/app',
        remoteRoot: '/var/www/html'
      })
    ).toBe('D:/Projects/app/index.php');

    // #6 API Collections, Env Resolution, Auto-Capture & OpenAPI/Postman Importer
    expect(
      resolveEnvTemplateString('{{base_url}}/api/v1/login?k={{api_key}}', {
        base_url: 'https://siinas.kemenperin.go.id',
        api_key: 'abc123'
      })
    ).toBe('https://siinas.kemenperin.go.id/api/v1/login?k=abc123');
    expect(
      extractJsonPathValue('{"data":{"access_token":"jwt-xyz-999"}}', 'data.access_token')
    ).toBe('jwt-xyz-999');
    expect(
      extractSessionCookieFromHeaders({
        'set-cookie': 'PHPSESSID=sess998877; path=/; HttpOnly'
      })
    ).toBe('PHPSESSID=sess998877');

    const oa = importOpenApiOrPostmanJson(
      JSON.stringify({
        openapi: '3.0.1',
        info: { title: 'SIINas API' },
        servers: [{ url: 'https://siinas.local/api' }],
        paths: {
          '/perusahaan': {
            get: { summary: 'List Perusahaan', tags: ['Perusahaan'] },
            post: { summary: 'Simpan Perusahaan', tags: ['Perusahaan'] }
          }
        }
      })
    );
    expect(oa.sourceFormat).toBe('openapi-3');
    expect(oa.requests).toHaveLength(2);

    const phpSnippet = generateHttpClientSnippet(
      {
        method: 'POST',
        url: 'https://siinas.local/api/login',
        bodyMode: 'json',
        rawBody: '{"user":"admin"}'
      },
      'php-curl'
    );
    expect(phpSnippet).toContain('curl_init');
    expect(phpSnippet).toContain('CURLOPT_POSTFIELDS');
  });

  it('Phase 30C (#7-#9): Hunk-Level Selective Merge, Multi-SSH Snippets Guard, & AES-256-GCM .hmwpack Bundle bekerja akurat', () => {
    // #7 Hunk-Level Merge (Local <-> Remote)
    const leftDoc = ['line1', 'line2-local', 'line3', 'line4', 'line5', 'line6', 'line7-local'].join('\n');
    const rightDoc = ['line1', 'line2-remote', 'line3', 'line4', 'line5', 'line6', 'line7-remote'].join('\n');
    const diff = computeHunkDiff(leftDoc, rightDoc, 1);
    expect(diff.identical).toBe(false);
    expect(diff.hunks).toHaveLength(2);

    // Push ONLY hunk #1 from Local -> Remote (hunk #2 on Remote stays intact!)
    const pushedRemote = applyHunkLeftToRight(leftDoc, rightDoc, diff.hunks[0]);
    expect(pushedRemote).toContain('line2-local');
    expect(pushedRemote).toContain('line7-remote');

    // Pull ONLY hunk #2 from Remote -> Local (hunk #1 on Local stays intact!)
    const pulledLocal = applyHunkRightToLeft(leftDoc, rightDoc, diff.hunks[1]);
    expect(pulledLocal).toContain('line2-local');
    expect(pulledLocal).toContain('line7-remote');

    // #8 SSH Snippets & Service Control Guard
    expect(detectDangerousSshCommand('systemctl reload php8.2-fpm').dangerous).toBe(true);
    expect(detectDangerousSshCommand('df -h').dangerous).toBe(false);
    expect(buildServiceControlCommand('nginx', 'reload')).toContain('systemctl reload nginx');

    // #9 Encrypted Team Workspace Bundle (.hmwpack AES-256-GCM)
    const encrypted = encryptWorkspaceBundle(
      {
        format: 'hmw-studio-team-bundle',
        version: 1,
        exportedAt: '2026-11-21T00:00:00Z',
        includesSecrets: false,
        connections: [],
        dbProfiles: [],
        savedQueries: []
      },
      'TimSIINas2026!'
    );
    expect(encrypted).toContain('HMWPACK1');
    expect(encrypted).toContain('aes-256-gcm');

    const decrypted = decryptWorkspaceBundle(encrypted, 'TimSIINas2026!');
    expect(decrypted.format).toBe('hmw-studio-team-bundle');
    expect(() => decryptWorkspaceBundle(encrypted, 'password-salah')).toThrow(/Passphrase salah/i);
  });

  it('SQL Runner Inline Parameter Engine mendeteksi {$id}, {{id}}, :id, ${id}, & $id serta mensubstitusi dengan aman', () => {
    const sql1 = "SELECT * FROM rekomendasi WHERE id_rekomendasi='{$id}';";
    const params1 = extractSqlInlineParams(sql1);
    expect(params1).toHaveLength(1);
    expect(params1[0].key).toBe('id');
    expect(params1[0].surroundedByQuotes).toBe(true);

    const missing = applySqlInlineParams(sql1, params1, {});
    expect(missing.missingKeys).toEqual(['id']);

    const applied1 = applySqlInlineParams(sql1, params1, { id: '17' });
    expect(applied1.missingKeys).toEqual([]);
    expect(applied1.sql).toBe("SELECT * FROM rekomendasi WHERE id_rekomendasi='17';");

    // Multiple styles + ignoring time literals (`12:30:00`) and Postgres `::text`
    const sql2 =
      "SELECT nama::text FROM pegawai WHERE id = :id_pegawai AND nip = {{nip}} AND jam > '12:30:00'";
    const params2 = extractSqlInlineParams(sql2);
    expect(params2.map((p) => p.key)).toEqual(['id_pegawai', 'nip']);
    const applied2 = applySqlInlineParams(sql2, params2, {
      id_pegawai: '42',
      nip: "1985'01"
    });
    expect(applied2.sql).toBe(
      "SELECT nama::text FROM pegawai WHERE id = 42 AND nip = '1985''01' AND jam > '12:30:00'"
    );
  });

  it('Non-Intrusive Suggestion Guard: tidak memicu popup pada spasi & menjaga Enter tidak membajak ketikan', async () => {
    const phpIntelSrc = await readFile(
      join(process.cwd(), 'src', 'renderer', 'src', 'languages', 'phpIntelliSense.ts'),
      'utf8'
    );
    const webIntelSrc = await readFile(
      join(process.cwd(), 'src', 'renderer', 'src', 'languages', 'webIntelliSense.ts'),
      'utf8'
    );
    const monacoSetupSrc = await readFile(
      join(process.cwd(), 'src', 'renderer', 'src', 'themes', 'monacoSetup.ts'),
      'utf8'
    );

    // Trigger character arrays must NOT contain space `' '` so normal typing never explodes popups
    const triggerLines = [...phpIntelSrc.matchAll(/triggerCharacters:\s*\[[^\]]+\]/g)].map(
      (m) => m[0]
    );
    expect(triggerLines.length).toBeGreaterThanOrEqual(2);
    for (const line of triggerLines) {
      expect(line).not.toContain("' '");
    }
    const webTriggerLines = [...webIntelSrc.matchAll(/triggerCharacters:\s*\[[^\]]+\]/g)].map(
      (m) => m[0]
    );
    expect(webTriggerLines.length).toBeGreaterThanOrEqual(1);
    for (const line of webTriggerLines) {
      expect(line).not.toContain("' '");
    }

    // Default 'calm' suggest options must disable Enter-hijack and commit-character hijack
    expect(monacoSetupSrc).toContain("acceptSuggestionOnEnter: 'off'");
    expect(monacoSetupSrc).toContain('acceptSuggestionOnCommitCharacter: false');
    expect(monacoSetupSrc).toContain('quickSuggestionsDelay: 320');
  });

  it('GeminiService Fast Surgical Fix mengekstrak jendela error fokus & menerapkan line-range patch tanpa memotong file besar', () => {
    const bigLines: string[] = [];
    for (let i = 1; i <= 300; i++) {
      bigLines.push(i === 180 ? '$x = sprintf("096510%", $v;' : `// baris ${i}`);
    }
    const crlfCode = bigLines.join('\r\n');
    const win = extractFocusedErrorWindow(
      crlfCode,
      'Baris 180: syntax error, unexpected string "096510%", expecting ")"',
      25
    );
    expect(win).not.toBeNull();
    expect(win?.startLine).toBe(155);
    expect(win?.endLine).toBe(205);
    expect(win?.errorLines).toEqual([180]);
    expect(win?.numberedSnippet).toContain('180 |>>> $x = sprintf("096510%", $v;');

    const patched = applyLineRangePatches(crlfCode, [
      { startLine: 180, endLine: 180, replacement: '$x = sprintf("096510%%", $v);' }
    ]);
    const outLines = patched.split('\r\n');
    expect(outLines).toHaveLength(300);
    expect(outLines[0]).toBe('// baris 1');
    expect(outLines[179]).toBe('$x = sprintf("096510%%", $v);');
    expect(outLines[299]).toBe('// baris 300');
  });

  it('PhpLanguageService.autoFixSyntaxLocal memperbaiki error sintaks PHP secara offline (<1 detik) & lolos php -l', async () => {
    const phpSvc = new PhpLanguageService();
    const probe = await phpSvc.lint('<?php echo 1;');
    if (!probe.available) {
      return;
    }

    // 1. Kasus screenshot user: kutip ganda bertabrakan / lupa koma/titik sebelum string "096510%"
    const brokenSqlQuote = '<?php\n$q = sprintf("SELECT * FROM tbl WHERE kd LIKE "096510%"");\n';
    const fix1 = await phpSvc.autoFixSyntaxLocal(brokenSqlQuote);
    expect(fix1.fixed).toBe(true);
    expect(fix1.fixedCode).toBeTruthy();
    const check1 = await phpSvc.lint(fix1.fixedCode!);
    expect(check1.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);

    // 2. Kasus missing comma in function call: unexpected string "096510%", expecting ")"
    const brokenArgComma = '<?php\n$ok = strpos($kd "096510%");\n';
    const fix2 = await phpSvc.autoFixSyntaxLocal(brokenArgComma);
    expect(fix2.fixed).toBe(true);
    const check2 = await phpSvc.lint(fix2.fixedCode!);
    expect(check2.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);

    // 3. Kasus 2 error berantai sekaligus (lupa titik koma + lupa kurung kurawal tutup `}`)
    const brokenMulti = '<?php\nfunction tes() {\n  $a = 10\n  return $a + 1;\n';
    const fix3 = await phpSvc.autoFixSyntaxLocal(brokenMulti);
    expect(fix3.fixed).toBe(true);
    expect(fix3.appliedFixes.length).toBeGreaterThanOrEqual(2);
    const check3 = await phpSvc.lint(fix3.fixedCode!);
    expect(check3.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);

    // 4. Kasus array `=` alih-alih `=>`
    const brokenArr = "<?php\n$row = ['kd' = '096510'];\n";
    const fix4 = await phpSvc.autoFixSyntaxLocal(brokenArr);
    expect(fix4.fixed).toBe(true);
    const check4 = await phpSvc.lint(fix4.fixedCode!);
    expect(check4.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);

    // 5. Kasus nyata screenshot user: kelebihan kutip ganda `""` di akhir baris sambungan SQL multi-baris
    const brokenMultilineSql = `<?php
$sql ="select * from keluhan
where kd_aplikasi='$_GET[app]' and not isnull(tgl_tanggapan) ".
($_GET["what"] ? "and (uraian like '%".$_GET["what"]."%' or ".
"tanggapan like '%".$_GET["what"]."%')" : "").""
order by tgl_input desc";

$tabel->loadData($sql);
`;
    const fix5 = await phpSvc.autoFixSyntaxLocal(brokenMultilineSql);
    expect(fix5.fixed).toBe(true);
    expect(fix5.fixedCode).toContain(')."');
    const check5 = await phpSvc.lint(fix5.fixedCode!);
    expect(check5.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);

    // 6. Kasus lupa operator `.` di akhir baris sambungan string SQL multi-baris
    const brokenMissingDot = `<?php
$sql = "select * from keluhan "
"where id = 1";
`;
    const fix6 = await phpSvc.autoFixSyntaxLocal(brokenMissingDot);
    expect(fix6.fixed).toBe(true);
    const check6 = await phpSvc.lint(fix6.fixedCode!);
    expect(check6.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
  });
});
