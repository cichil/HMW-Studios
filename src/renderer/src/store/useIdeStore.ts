import { create } from 'zustand';
import type {
  AppUpdateStateDto,
  ConnectionProfile,
  DatabaseProfile,
  DbEngine,
  DbIntrospectProgressEvent,
  DbSchemaSnapshot,
  DbTableMeta,
  DesktopIslandMode,
  FileNode,
  GeminiConfigSavePayload,
  GeminiConfigSummary,
  GitStatusSummary,
  IslandActionType,
  IslandActivity,
  IslandTone,
  LogMonitorStatus,
  ParsedLogEntry,
  PhpLintDiagnostic,
  PhpWorkspaceSymbols,
  PinnedFileEntry,
  PreviewServerState,
  ProjectSavePayload,
  RemoteConnectionStatus,
  RemoteEntry,
  RemoteFileIndexItem,
  RemoteWorkspaceIntelPayload,
  RubleBundle,
  SavedProject,
  SavedProjectTab,
  SavedSqlQueryItem,
  SavedSqlQuerySavePayload,
  SavedTabSession,
  SqlExecutionHistoryItem,
  ThemeId,
  TransferLogEntry,
  WebSymbolCatalog,
  XdebugEventDto,
  XdebugSessionStateDto
} from '@shared/types';
import type { XdebugBreakpointItem } from '@shared/xdebugProtocol';
import type {
  IslandSearchScope,
  IslandSearchTabMode
} from '@shared/islandSearchEngine';
import {
  analyzePreSaveHazards,
  stripAutoRemovableDebugTraps,
  type SaveHazardItem
} from '@shared/saveGuardAnalyzer';
import type { SqlTemplateParam } from '@shared/sqlSchemaAnalyzer';
import {
  extractPhpHttpEndpointSpec,
  type ExtractedEndpointDraft
} from '@shared/httpEndpointExtractor';
import {
  findModuleCompanions,
  type CompanionCandidateFile
} from '@shared/moduleCompanion';
import {
  applyMonacoTheme,
  detectLanguageFromPath,
  registerRubleSnippetsInMonaco,
  setGhostTextEnabledFlag,
  type EditorSuggestMode
} from '../themes/monacoSetup';
import { formatCodeByLanguage } from '../languages/codeFormatter';
import {
  hydrateDatabaseSchemaCatalog,
  hydrateLaravelCatalog,
  hydratePhpRuntimeCatalog,
  hydratePhpWorkspaceSymbols,
  hydrateRemoteLearnedJoinEdges,
  hydrateRemotePhpWorkspaceSymbols,
  hydrateWisanggeniCatalog,
  hydrateWorkspaceLearnedJoinEdges,
  resolvePhpNavigationTarget,
  setOpenPhpBuffersProvider,
  setSqlCodeLensActionHandler
} from '../languages/phpIntelliSense';
import {
  hydrateRemoteIndexedAssetPaths,
  hydrateRemoteWebCatalog,
  hydrateWorkspaceWebCatalog,
  resolveWebNavigationTarget,
  scheduleAmbientExtraLibSync,
  setOpenWebBuffersProvider
} from '../languages/webIntelliSense';

export interface CodeBookmark {
  id: string;
  fileKey: string;
  sourceKind: 'local' | 'remote';
  filePath: string;
  relativePath: string;
  connectionId?: string;
  line: number;
  label: string;
  createdAt: string;
}

export interface PendingSqlCodeLensRequest {
  mode: 'run' | 'explain' | 'structure';
  sqlTemplate: string;
  params: SqlTemplateParam[];
  primaryTable?: { schema?: string; table: string } | null;
  sourceTitle?: string;
  token: number;
}

export interface EditorTab {
  id: string;
  kind: 'code' | 'diff';
  title: string;
  filePath: string;
  relativePath: string;
  language: string;
  content: string;
  savedContent: string;
  originalContent?: string;
  diffLabel?: string;
  applyTargetTabId?: string;
  remoteConnectionId?: string;
  remoteConnectionName?: string;
  cursorLine: number;
  cursorCol: number;
  jumpToken?: number;
}

export function normalizeRemoteRelPath(relPath: string): string {
  return (relPath ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

export function normalizeLocalFileKey(filePath: string): string {
  return `local:${(filePath ?? '').replace(/\\/g, '/').toLowerCase()}`;
}

export function getCanonicalTabKey(tab: EditorTab): string {
  if (tab.kind === 'diff') {
    return `diff:${tab.id}`;
  }
  if (tab.remoteConnectionId) {
    return `remote:${tab.remoteConnectionId}:${normalizeRemoteRelPath(tab.relativePath)}`;
  }
  return normalizeLocalFileKey(tab.filePath);
}

export function dedupeEditorTabs(tabs: EditorTab[]): EditorTab[] {
  const indexByKey = new Map<string, number>();
  const out: EditorTab[] = [];
  for (const tab of tabs) {
    const key = getCanonicalTabKey(tab);
    const existingIdx = indexByKey.get(key);
    if (existingIdx === undefined) {
      indexByKey.set(key, out.length);
      out.push(tab);
    } else {
      const prev = out[existingIdx];
      const prevDirty = prev.content !== prev.savedContent;
      const nextDirty = tab.content !== tab.savedContent;
      if (!prevDirty && nextDirty) {
        out[existingIdx] = { ...prev, content: tab.content };
      }
    }
  }
  return out;
}

export function getTabHistoryKey(tab: EditorTab | undefined | null): string | null {
  if (!tab || tab.kind !== 'code') return null;
  if (tab.remoteConnectionId) {
    const cleanRel = normalizeRemoteRelPath(tab.relativePath);
    return `remote:${tab.remoteConnectionId}:${cleanRel}`;
  }
  return normalizeLocalFileKey(tab.filePath);
}

export type SidebarSection =
  | 'explorer'
  | 'search'
  | 'outline'
  | 'history'
  | 'git'
  | 'database'
  | 'http'
  | 'rubles'
  | 'ai'
  | 'connections';
export type GeminiSubTab = 'chat' | 'crud' | 'sql-audit' | 'docs' | 'settings';
export type BottomTabId = 'terminal' | 'transfers' | 'logs' | 'xdebug' | 'output';

const LS_THEME = 'hmw.theme';
const LS_SUGGEST_MODE = 'hmw.suggestMode';
const LS_LEGACY_THEME = 'aptana4.theme';

function readInitialSuggestMode(): EditorSuggestMode {
  try {
    const raw = localStorage.getItem(LS_SUGGEST_MODE);
    if (raw === 'calm' || raw === 'manual' || raw === 'full') return raw;
  } catch {
    // ignore
  }
  return 'calm';
}
const LS_DESKTOP_ISLAND = 'hmw.desktopIslandMode';
const LS_BOOKMARKS = 'hmw.bookmarks';
const LS_PINNED_FILES = 'hmw.pinnedFiles';
const LS_TAB_SESSIONS = 'hmw.tabSessions';
const LS_SQL_QUERY_HISTORY = 'hmw.sqlQueryHistory';
const LS_LAST_DB_PROFILE = 'hmw.lastDbProfileId';

function readInitialSqlQueryHistory(): SqlExecutionHistoryItem[] {
  try {
    const raw = localStorage.getItem(LS_SQL_QUERY_HISTORY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SqlExecutionHistoryItem[]) : [];
  } catch {
    return [];
  }
}
const LS_LAST_DB_ACTIVE_MAP = 'hmw.lastDbActiveMap';

function readInitialPinnedFiles(): PinnedFileEntry[] {
  try {
    const raw = localStorage.getItem(LS_PINNED_FILES);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PinnedFileEntry[]) : [];
  } catch {
    return [];
  }
}

function readInitialTabSessions(): SavedTabSession[] {
  try {
    const raw = localStorage.getItem(LS_TAB_SESSIONS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedTabSession[]) : [];
  } catch {
    return [];
  }
}

export function getRememberedDatabaseForProfile(profileId: string): string | undefined {
  if (!profileId) return undefined;
  try {
    const raw = localStorage.getItem(LS_LAST_DB_ACTIVE_MAP);
    if (!raw) return undefined;
    const map = JSON.parse(raw) as Record<string, string>;
    const val = map[profileId]?.trim();
    return val || undefined;
  } catch {
    return undefined;
  }
}

function rememberDatabaseForProfile(profileId: string, databaseName: string): void {
  if (!profileId || !databaseName.trim()) return;
  try {
    const raw = localStorage.getItem(LS_LAST_DB_ACTIVE_MAP);
    const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    map[profileId] = databaseName.trim();
    localStorage.setItem(LS_LAST_DB_ACTIVE_MAP, JSON.stringify(map));
  } catch {
    // Ignore storage errors
  }
}
const LS_LAST_PROJECT_ID = 'hmw.lastProjectId';
const LS_LAST_WORKSPACE = 'hmw.lastWorkspace';
const LS_LEGACY_WORKSPACE = 'aptana4.lastWorkspace';
const LS_LAST_CONN = 'hmw.lastConnectionId';
const LS_LEGACY_CONN = 'aptana4.lastConnectionId';

function buildTabRestoreKey(
  tab: Pick<SavedProjectTab, 'kind' | 'filePath' | 'relativePath' | 'remoteConnectionId'>
): string {
  return tab.kind === 'remote'
    ? `remote:${tab.remoteConnectionId ?? ''}:${normalizeRemoteRelPath(tab.relativePath)}`
    : normalizeLocalFileKey(tab.filePath);
}

interface IdeState {
  splashVisible: boolean;
  theme: ThemeId;
  suggestMode: EditorSuggestMode;
  systemVersionLabel: string;
  wisanggeniSummary: {
    available: boolean;
    classCount: number;
    methodCount: number;
    functionCount: number;
    apiSynced: boolean;
    rootPath: string | null;
  } | null;
  laravelSummary: {
    isLaravelProject: boolean;
    laravelVersion: string | null;
    classCount: number;
    helperCount: number;
    directiveCount: number;
    routeCount: number;
    viewCount: number;
    modelCount: number;
    configKeyCount: number;
  } | null;

  projects: SavedProject[];
  activeProjectId: string | null;
  projectModalOpen: boolean;

  workspacePath: string | null;
  fileTree: FileNode[];
  expandedDirs: Record<string, boolean>;

  tabs: EditorTab[];
  activeTabId: string | null;
  splitEditorOpen: boolean;
  secondaryTabId: string | null;
  focusedPane: 'primary' | 'secondary';
  historyRefreshTick: number;

  activeSidebar: SidebarSection;
  bottomPanelOpen: boolean;
  activeBottomTab: BottomTabId;

  connections: ConnectionProfile[];
  selectedConnectionId: string | null;
  remoteSubPath: string;
  remoteEntries: RemoteEntry[];
  remoteLoading: boolean;
  remoteConnectionStatus: RemoteConnectionStatus;
  remoteConnectionError: string | null;
  transferLogs: TransferLogEntry[];

  rubleBundles: RubleBundle[];
  commandOutputLines: string[];

  gitStatus: GitStatusSummary | null;

  previewOpen: boolean;
  previewState: PreviewServerState;
  previewSubPath: string;
  previewViewport: 'desktop' | 'tablet' | 'mobile';
  previewReloadTick: number;

  connectionModalOpen: boolean;
  editingConnection: ConnectionProfile | null;
  syncModalOpen: boolean;
  paletteMode: 'closed' | 'files' | 'commands';

  geminiConfig: GeminiConfigSummary | null;
  geminiSubTab: GeminiSubTab;
  inlineAiBarOpen: boolean;
  selectedEditorText: string;
  phpDiagnosticsByTab: Record<string, PhpLintDiagnostic[]>;

  toast: string | null;
  desktopIslandMode: DesktopIslandMode;
  islandActivity: IslandActivity | null;
  islandHistory: IslandActivity[];
  islandExpanded: boolean;
  islandSearchRequest: {
    query?: string;
    mode?: IslandSearchTabMode;
    scope?: IslandSearchScope;
    token: number;
  } | null;
  localPhpSymbols: PhpWorkspaceSymbols | null;
  localWebCatalog: WebSymbolCatalog | null;
  remoteIntelByConn: Record<string, RemoteWorkspaceIntelPayload>;

  bookmarks: CodeBookmark[];
  dbProfiles: DatabaseProfile[];
  selectedDbProfileId: string | null;
  dbSchema: DbSchemaSnapshot | null;
  dbSchemaLoading: boolean;
  dbSchemaLoadingMessage: string | null;
  dbSchemaLoadingPercent: number;
  dbSchemaLoadingTargetDb: string | null;
  dbSchemaError: string | null;
  pendingCrudFromDb: { tableName: string; ddl: string } | null;
  pendingSqlCodeLens: PendingSqlCodeLensRequest | null;
  dbArchitectTab: 'closed' | 'er' | 'join' | 'diff' | 'sync' | 'rowdiff';
  tableDesignerTarget: {
    mode: 'create' | 'alter';
    table?: DbTableMeta;
    schema?: string;
  } | null;
  pendingJoinSeedTables: Array<{ schema?: string; name: string }> | null;
  phpScratchpadOpen: boolean;
  phpScratchpadCode: string;
  pendingSymbolSearch: { symbol: string; scopeHint?: 'local' | 'remote'; token: number } | null;
  remoteFilesIndexByConn: Record<string, RemoteFileIndexItem[]>;
  remoteIndexLoading: boolean;
  remoteIntelSummaryByConn: Record<
    string,
    {
      scannedFiles: number;
      phpFnCount: number;
      jsFnCount: number;
      cssClassCount: number;
    }
  >;
  remoteIntelLoading: boolean;
  serverMonitorOpen: boolean;
  serverMonitorInitialTab: 'mysql-dashboard' | 'health' | 'processlist' | 'crontab';
  pendingHttpEndpointDraft: (ExtractedEndpointDraft & { token: number }) | null;
  pendingSaveGuard: {
    tabId: string;
    tabTitle: string;
    connectionName: string;
    isProduction: boolean;
    contentToSave: string;
    hazards: SaveHazardItem[];
    hasAutoRemovable: boolean;
  } | null;
  smartRefactorRequest: {
    mode: 'rename' | 'extract';
    initialSymbol?: string;
    selectedCode?: string;
    selectionRange?: {
      startLineNumber: number;
      startColumn: number;
      endLineNumber: number;
      endColumn: number;
    };
    tabId: string;
  } | null;
  pinnedFiles: PinnedFileEntry[];
  savedTabSessions: SavedTabSession[];
  savedSqlQueries: SavedSqlQueryItem[];
  sqlQueryHistory: SqlExecutionHistoryItem[];
  pendingVisualSavedQuery: SavedSqlQueryItem | null;
  reportGeneratorDraft: {
    sqlQuery: string;
    columns?: string[];
    suggestedTitle?: string;
    suggestedSlug?: string;
  } | null;
  dbRoutinesModalOpen: boolean;
  dbSeederModalOpen: boolean;
  dbSeederTargetTable: DbTableMeta | null;
  releasePatchModalOpen: boolean;
  dbSchedulerModalOpen: boolean;
  auditModalOpen: boolean;
  excelImportModalOpen: boolean;
  excelImportTargetTable: string | null;
  dbGlobalSearchModalOpen: boolean;
  securityScannerModalOpen: boolean;
  dbRbacModalOpen: boolean;
  docsModalOpen: boolean;
  xdebugState: XdebugSessionStateDto;
  xdebugBreakpoints: XdebugBreakpointItem[];
  xdebugLogs: string[];
  xdebugEvalHistory: Array<{ expr: string; result: string; ts: string }>;

  serverLogEntries: ParsedLogEntry[];
  logMonitorStatus: LogMonitorStatus;
  appUpdateState: AppUpdateStateDto;
  updateBannerDismissed: boolean;

  dismissSplash: () => void;
  setTheme: (theme: ThemeId) => void;
  setSuggestMode: (mode: EditorSuggestMode) => void;
  cycleSuggestMode: () => void;
  showToast: (msg: string) => void;
  setDesktopIslandMode: (mode: DesktopIslandMode) => void;
  setIslandExpanded: (expanded: boolean) => void;
  openIslandSearch: (opts?: {
    query?: string;
    mode?: IslandSearchTabMode;
    scope?: IslandSearchScope;
  }) => void;
  consumeIslandSearchRequest: () => {
    query?: string;
    mode?: IslandSearchTabMode;
    scope?: IslandSearchScope;
  } | null;
  pushIslandActivity: (
    payload: Omit<IslandActivity, 'id' | 'timestamp'> & {
      id?: string;
      autoExpireMs?: number;
    }
  ) => void;
  clearIslandActivity: () => void;
  runIslandAction: (
    actionType: IslandActionType,
    opts?: { tabId?: string; line?: number }
  ) => void;
  initApp: () => Promise<void>;
  refreshWisanggeniIntelliSense: (silent?: boolean) => Promise<void>;
  refreshLaravelIntelliSense: (silent?: boolean, customWs?: string | null) => Promise<void>;

  refreshGeminiConfig: () => Promise<void>;
  saveGeminiConfig: (payload: GeminiConfigSavePayload) => Promise<GeminiConfigSummary>;
  setGeminiSubTab: (sub: GeminiSubTab) => void;
  setInlineAiBarOpen: (open: boolean) => void;
  setSelectedEditorText: (text: string) => void;
  setTabPhpDiagnostics: (tabId: string, diagnostics: PhpLintDiagnostic[]) => void;
  applyAiCodeToTab: (
    tabId: string,
    newContent: string,
    reasonLabel: string,
    previewDiffFirst?: boolean
  ) => Promise<void>;

  setProjectModalOpen: (open: boolean) => void;
  refreshProjects: () => Promise<void>;
  saveCurrentProject: (opts?: {
    id?: string;
    name?: string;
    notes?: string;
    exportFile?: boolean;
  }) => Promise<SavedProject | null>;
  quickSaveActiveProject: () => Promise<void>;
  openSavedProject: (projectId: string) => Promise<void>;
  openProjectFromFile: () => Promise<void>;
  deleteSavedProject: (projectId: string) => Promise<void>;
  closeCurrentProject: () => Promise<void>;

  openWorkspaceFolder: (folderPath?: string) => Promise<void>;
  createAndOpenDemoProject: () => Promise<void>;
  refreshTree: () => Promise<void>;
  toggleDirExpanded: (dirPath: string) => void;

  openFileInTab: (filePath: string, relativePath?: string, jumpLine?: number) => Promise<void>;
  openRemoteFileInTab: (
    connectionId: string,
    remoteRelativePath: string,
    jumpLine?: number
  ) => Promise<void>;
  jumpToTabLine: (tabId: string, line: number) => void;
  toggleSplitEditor: (preferredRightTabId?: string) => void;
  closeSplitEditor: () => void;
  setSecondaryTab: (tabId: string) => void;
  setFocusedPane: (pane: 'primary' | 'secondary') => void;
  formatTabContent: (tabId?: string) => void;
  restoreTabFromHistory: (
    tabId: string,
    restoredContent: string,
    timestampLabel: string
  ) => void;
  openDiffTab: (opts: {
    id: string;
    title: string;
    filePath: string;
    relativePath: string;
    originalContent: string;
    modifiedContent: string;
    diffLabel: string;
    applyTargetTabId?: string;
    remoteConnectionId?: string;
    remoteConnectionName?: string;
  }) => void;
  updateTabContent: (tabId: string, content: string) => void;
  updateTabCursor: (tabId: string, line: number, col: number) => void;
  saveTab: (tabId: string, bypassGuard?: boolean) => Promise<void>;
  saveActiveTab: () => Promise<void>;
  saveAllTabs: () => Promise<void>;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  insertTextIntoActiveTab: (snippetText: string) => void;
  syncRenamedRemoteTabs: (
    connectionId: string,
    oldRelativePath: string,
    newRelativePath: string
  ) => void;
  closeDeletedRemoteTabs: (connectionId: string, deletedRelativePath: string) => void;

  setActiveSidebar: (section: SidebarSection) => void;
  setBottomPanel: (open: boolean, tab?: BottomTabId) => void;

  refreshConnections: () => Promise<void>;
  selectConnection: (id: string | null) => Promise<void>;
  browseRemoteDir: (subPath?: string) => Promise<void>;
  setRemoteConnectionStatus: (
    status: RemoteConnectionStatus,
    errorMessage?: string | null
  ) => void;
  openConnectionModal: (conn?: ConnectionProfile | null) => void;
  closeConnectionModal: () => void;
  setSyncModalOpen: (open: boolean) => void;
  pushTransferLog: (entry: TransferLogEntry) => void;

  refreshRubles: () => Promise<void>;
  executeRubleCommand: (name: string, commandLine: string) => Promise<void>;

  refreshGit: () => Promise<void>;

  togglePreviewPane: () => Promise<void>;
  setPreviewSubPath: (subPath: string) => void;
  setPreviewViewport: (vp: 'desktop' | 'tablet' | 'mobile') => void;
  bumpPreviewReload: () => void;

  setPaletteMode: (mode: 'closed' | 'files' | 'commands') => void;

  toggleBookmarkAtLine: (tabId: string, line: number, lineText?: string) => void;
  removeBookmark: (bookmarkId: string) => void;
  clearBookmarks: () => void;
  jumpToBookmark: (bm: CodeBookmark) => Promise<void>;
  jumpToNextBookmark: () => Promise<void>;

  refreshDbProfiles: () => Promise<void>;
  setSelectedDbProfileId: (id: string | null) => void;
  setDbSchema: (schema: DbSchemaSnapshot | null) => void;
  setDbLoadingProgress: (evt: DbIntrospectProgressEvent) => void;
  applyPartialDbSchema: (partialSnap: DbSchemaSnapshot) => void;
  loadDbSchema: (
    profileId?: string,
    databaseName?: string,
    forceFull?: boolean
  ) => Promise<DbSchemaSnapshot | null>;
  triggerWisanggeniCrudFromTable: (table: DbTableMeta, engine: DbEngine) => Promise<void>;
  consumePendingCrudFromDb: () => { tableName: string; ddl: string } | null;
  triggerSqlCodeLensAction: (req: Omit<PendingSqlCodeLensRequest, 'token'>) => void;
  consumePendingSqlCodeLens: () => PendingSqlCodeLensRequest | null;
  setDbArchitectTab: (tab: 'closed' | 'er' | 'join' | 'diff' | 'sync' | 'rowdiff') => void;
  openTableDesigner: (opts: {
    mode: 'create' | 'alter';
    table?: DbTableMeta;
    schema?: string;
  }) => void;
  closeTableDesigner: () => void;
  openVisualJoinBuilder: (seedTables?: Array<{ schema?: string; name: string }>) => void;
  consumePendingJoinSeedTables: () => Array<{ schema?: string; name: string }> | null;
  openPhpScratchpad: (initialCode?: string) => void;
  setPhpScratchpadOpen: (open: boolean) => void;
  setPhpScratchpadCode: (code: string) => void;
  findReferencesForSymbol: (symbol: string, scopeHint?: 'local' | 'remote') => void;
  consumePendingSymbolSearch: () => { symbol: string; scopeHint?: 'local' | 'remote' } | null;
  refreshRemoteFilesIndex: (connectionId?: string, force?: boolean) => Promise<void>;
  refreshRemoteWorkspaceIntel: (connectionId?: string, force?: boolean) => Promise<void>;
  compareTabWithCounterpart: (tabId?: string) => Promise<void>;
  setServerMonitorOpen: (
    open: boolean,
    initialTab?: 'mysql-dashboard' | 'health' | 'processlist' | 'crontab'
  ) => void;
  sendTabToHttpTester: (tabId?: string) => void;
  consumePendingHttpEndpointDraft: () => ExtractedEndpointDraft | null;
  switchModuleCompanion: () => Promise<void>;
  dismissSaveGuard: () => void;
  confirmSaveGuardForce: () => Promise<void>;
  cleanAndSaveGuard: () => Promise<void>;
  openSmartRefactor: (req: NonNullable<IdeState['smartRefactorRequest']>) => void;
  closeSmartRefactor: () => void;
  togglePinFile: (entry: Omit<PinnedFileEntry, 'pinnedAt'>) => void;
  togglePinActiveTab: (tabId?: string) => void;
  saveCurrentTabsAsSession: (name: string) => void;
  restoreTabSession: (sessionId: string, closeCurrentFirst?: boolean) => Promise<void>;
  deleteTabSession: (sessionId: string) => void;
  openReportGenerator: (draft: NonNullable<IdeState['reportGeneratorDraft']>) => void;
  closeReportGenerator: () => void;
  refreshSavedQueries: () => Promise<void>;
  saveSqlQueryItem: (payload: SavedSqlQuerySavePayload) => Promise<SavedSqlQueryItem>;
  deleteSavedSqlQueryItem: (id: string) => Promise<void>;
  toggleFavoriteSavedQuery: (id: string) => Promise<void>;
  exportSavedSqlQueries: () => Promise<void>;
  importSavedSqlQueries: () => Promise<void>;
  recordSqlExecutionHistory: (
    entry: Omit<SqlExecutionHistoryItem, 'id' | 'executedAt'>
  ) => void;
  clearSqlExecutionHistory: () => void;
  openSavedQueryInVisualBuilder: (item: SavedSqlQueryItem) => void;
  consumePendingVisualSavedQuery: () => SavedSqlQueryItem | null;
  setDbRoutinesModalOpen: (open: boolean) => void;
  openDbSeeder: (table?: DbTableMeta) => void;
  closeDbSeeder: () => void;
  setReleasePatchModalOpen: (open: boolean) => void;
  setDbSchedulerModalOpen: (open: boolean) => void;
  setAuditModalOpen: (open: boolean) => void;
  openExcelImportModal: (targetTable?: string) => void;
  closeExcelImportModal: () => void;
  setDbGlobalSearchModalOpen: (open: boolean) => void;
  setSecurityScannerModalOpen: (open: boolean) => void;
  setDbRbacModalOpen: (open: boolean) => void;
  setDocsModalOpen: (open: boolean) => void;
  setAppUpdateState: (state: AppUpdateStateDto) => void;
  dismissUpdateBanner: () => void;
  checkForAppUpdates: (silent?: boolean) => Promise<AppUpdateStateDto | null>;
  downloadAppUpdate: () => Promise<void>;
  installAppUpdate: () => Promise<void>;
  openAppReleasePage: () => Promise<void>;
  handleXdebugEvent: (evt: XdebugEventDto) => void;
  toggleXdebugBreakpoint: (filePath: string, line: number) => void;
  clearXdebugBreakpoints: () => void;
  clearXdebugLogs: () => void;

  pushServerLogEntries: (entries: ParsedLogEntry[]) => void;
  clearServerLogEntries: () => void;
  setLogMonitorStatus: (status: LogMonitorStatus) => void;
  openLogEntryLocation: (entry: ParsedLogEntry) => Promise<void>;

  navigatePhpDefinition: (
    tabId: string,
    lineContent: string,
    column: number,
    wordAtCursor: string | null
  ) => Promise<boolean>;
  setActiveTabLanguage: (language: string) => void;
  reloadOpenTabsAfterReplace: (
    sourceKind: 'local' | 'remote',
    modifiedRelPaths: string[],
    connectionId?: string
  ) => Promise<void>;
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;
let islandExpireTimer: ReturnType<typeof setTimeout> | null = null;
let appInitPromise: Promise<void> | null = null;
let latestDbLoadSeq = 0;
const inFlightTabOpens = new Map<string, Promise<void>>();
const inFlightTabSaves = new Set<string>();
const liveTabBufferReaders = new Map<string, () => string>();

export function registerLiveTabBufferReader(
  pane: 'primary' | 'secondary' | 'diff',
  tabId: string,
  reader: () => string
): () => void {
  const key = `${pane}:${tabId}`;
  liveTabBufferReaders.set(key, reader);
  return () => {
    if (liveTabBufferReaders.get(key) === reader) {
      liveTabBufferReaders.delete(key);
    }
  };
}

function readInitialTheme(): ThemeId {
  try {
    const saved = localStorage.getItem(LS_THEME) ?? localStorage.getItem(LS_LEGACY_THEME);
    if (saved === 'aptana-dark' || saved === 'modern-dark' || saved === 'modern-light') {
      return saved;
    }
  } catch {
    // Ignore
  }
  return 'aptana-dark';
}

function readInitialDesktopIslandMode(): DesktopIslandMode {
  try {
    const saved = localStorage.getItem(LS_DESKTOP_ISLAND);
    if (saved === 'auto' || saved === 'always' || saved === 'off') {
      return saved;
    }
  } catch {
    // Ignore
  }
  return 'auto';
}

function readInitialBookmarks(): CodeBookmark[] {
  try {
    const raw = localStorage.getItem(LS_BOOKMARKS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CodeBookmark[]) : [];
  } catch {
    return [];
  }
}

function persistBookmarks(items: CodeBookmark[]): void {
  try {
    localStorage.setItem(LS_BOOKMARKS, JSON.stringify(items.slice(0, 200)));
  } catch {
    // Ignore
  }
}

function resolveRelativePosixPath(baseFileRel: string, rawTarget: string): string {
  const cleanTarget = rawTarget.replace(/\\/g, '/').trim();
  if (cleanTarget.startsWith('/')) {
    return cleanTarget.replace(/^\/+/, '');
  }
  const baseParts = baseFileRel.replace(/\\/g, '/').split('/').filter(Boolean);
  baseParts.pop(); // dirname
  for (const seg of cleanTarget.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (baseParts.length > 0) {
        baseParts.pop();
      } else {
        baseParts.push('..');
      }
    } else {
      baseParts.push(seg);
    }
  }
  return baseParts.join('/');
}

function resolveLocalNeighborPath(currentFilePath: string, rawTarget: string): string {
  const isWin = /^[A-Za-z]:[\\/]/.test(currentFilePath);
  const sep = isWin ? '\\' : '/';
  const cleanTarget = rawTarget.replace(/\\/g, '/').trim();
  if (/^[A-Za-z]:[\\/]/.test(rawTarget) || (!isWin && cleanTarget.startsWith('/'))) {
    return rawTarget;
  }
  const normalizedCurrent = currentFilePath.replace(/\\/g, '/');
  const parts = normalizedCurrent.split('/');
  parts.pop(); // dirname
  for (const seg of cleanTarget.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (parts.length > (isWin ? 1 : 0)) {
        parts.pop();
      }
    } else {
      parts.push(seg);
    }
  }
  return parts.join(sep);
}

function inferToastIslandMeta(msg: string): { tone: IslandTone; badge: string } {
  const lower = msg.toLowerCase();
  if (lower.includes('gagal') || lower.includes('error') || lower.includes('kesalahan')) {
    return { tone: 'error', badge: 'PERINGATAN' };
  }
  if (lower.includes('gemini') || lower.includes('✨') || lower.includes('kode ai')) {
    return { tone: 'ai', badge: 'GEMINI AI' };
  }
  if (lower.includes('tersimpan') || lower.includes('berhasil') || lower.includes('dipulihkan')) {
    return { tone: 'success', badge: 'TERSIMPAN' };
  }
  if (lower.includes('wisanggeni') || lower.includes('laravel')) {
    return { tone: 'sync', badge: 'INTELLISENSE' };
  }
  return { tone: 'neutral', badge: 'HMW STUDIO' };
}

function updateWindowTitle(projectName?: string | null): void {
  if (typeof document === 'undefined') return;
  document.title = projectName ? `HMW Studio — ${projectName}` : 'HMW Studio';
}

export function buildCompanionCandidatesFromStore(input: {
  fileTree: FileNode[];
  connections: ConnectionProfile[];
  selectedConnectionId: string | null;
  remoteEntries: RemoteEntry[];
  remoteFilesIndexByConn: Record<string, RemoteFileIndexItem[]>;
  tabs: EditorTab[];
}): CompanionCandidateFile[] {
  const candidates: CompanionCandidateFile[] = [];
  const seenKeys = new Set<string>();

  const walkLocal = (nodes: FileNode[]): void => {
    for (const n of nodes) {
      if (n.isDirectory) {
        if (n.children) walkLocal(n.children);
      } else {
        const rel = n.relativePath.replace(/\\/g, '/');
        const key = `local:${rel.toLowerCase()}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          candidates.push({
            source: 'local',
            name: n.name,
            relativePath: rel,
            localPath: n.path
          });
        }
      }
    }
  };
  walkLocal(input.fileTree);

  const connNameMap = new Map(input.connections.map((c) => [c.id, c.name]));

  // Include active remote folder entries immediately even before full index completes
  if (input.selectedConnectionId) {
    const cname = connNameMap.get(input.selectedConnectionId) ?? 'Remote';
    for (const e of input.remoteEntries) {
      if (e.isDirectory) continue;
      const rel = normalizeRemoteRelPath(e.relativePath);
      const key = `remote:${input.selectedConnectionId}:${rel.toLowerCase()}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        candidates.push({
          source: 'remote',
          name: e.name,
          relativePath: rel,
          connectionId: input.selectedConnectionId,
          connectionName: cname
        });
      }
    }
  }

  for (const [cid, list] of Object.entries(input.remoteFilesIndexByConn)) {
    const cname = connNameMap.get(cid) ?? 'Remote';
    for (const item of list) {
      const rel = normalizeRemoteRelPath(item.relativePath);
      const key = `remote:${cid}:${rel.toLowerCase()}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        candidates.push({
          source: 'remote',
          name: item.name,
          relativePath: rel,
          connectionId: cid,
          connectionName: cname
        });
      }
    }
  }

  for (const t of input.tabs) {
    if (t.kind !== 'code') continue;
    if (t.remoteConnectionId) {
      const rel = normalizeRemoteRelPath(t.relativePath);
      const key = `remote:${t.remoteConnectionId}:${rel.toLowerCase()}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        candidates.push({
          source: 'remote',
          name: t.title,
          relativePath: rel,
          connectionId: t.remoteConnectionId,
          connectionName:
            t.remoteConnectionName ?? connNameMap.get(t.remoteConnectionId) ?? 'Remote'
        });
      }
    } else if (t.filePath) {
      const rel = t.relativePath.replace(/\\/g, '/');
      const key = `local:${rel.toLowerCase()}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        candidates.push({
          source: 'local',
          name: t.title,
          relativePath: rel,
          localPath: t.filePath
        });
      }
    }
  }

  return candidates;
}

export const useIdeStore = create<IdeState>((set, get) => ({
  splashVisible: true,
  theme: readInitialTheme(),
  suggestMode: readInitialSuggestMode(),
  systemVersionLabel: 'HMW Studio',
  wisanggeniSummary: null,
  laravelSummary: null,

  projects: [],
  activeProjectId: null,
  projectModalOpen: false,

  workspacePath: null,
  fileTree: [],
  expandedDirs: {},

  tabs: [],
  activeTabId: null,
  splitEditorOpen: false,
  secondaryTabId: null,
  focusedPane: 'primary',
  historyRefreshTick: 0,

  activeSidebar: 'explorer',
  bottomPanelOpen: false,
  activeBottomTab: 'terminal',

  connections: [],
  selectedConnectionId: null,
  remoteSubPath: '',
  remoteEntries: [],
  remoteLoading: false,
  remoteConnectionStatus: 'idle',
  remoteConnectionError: null,
  transferLogs: [],

  rubleBundles: [],
  commandOutputLines: [],

  gitStatus: null,

  previewOpen: false,
  previewState: { running: false, port: 0, url: '', workspacePath: '' },
  previewSubPath: 'index.html',
  previewViewport: 'desktop',
  previewReloadTick: 0,

  connectionModalOpen: false,
  editingConnection: null,
  syncModalOpen: false,
  paletteMode: 'closed',

  geminiConfig: null,
  geminiSubTab: 'chat',
  inlineAiBarOpen: false,
  selectedEditorText: '',
  phpDiagnosticsByTab: {},

  toast: null,
  desktopIslandMode: readInitialDesktopIslandMode(),
  islandActivity: null,
  islandHistory: [],
  islandExpanded: false,
  islandSearchRequest: null,
  localPhpSymbols: null,
  localWebCatalog: null,
  remoteIntelByConn: {},

  bookmarks: readInitialBookmarks(),
  dbProfiles: [],
  selectedDbProfileId: null,
  dbSchema: null,
  dbSchemaLoading: false,
  dbSchemaLoadingMessage: null,
  dbSchemaLoadingPercent: 0,
  dbSchemaLoadingTargetDb: null,
  dbSchemaError: null,
  pendingCrudFromDb: null,
  pendingSqlCodeLens: null,
  dbArchitectTab: 'closed',
  tableDesignerTarget: null,
  pendingJoinSeedTables: null,
  phpScratchpadOpen: false,
  phpScratchpadCode:
    "<?php\n// PHP Scratchpad / Tinker — Tekan Ctrl+Enter untuk menjalankan instan\n$tgl = date('Y-m-d H:i:s');\n$contoh = ['aplikasi' => 'HMW Studio', 'waktu' => $tgl];\nprint_r($contoh);\n",
  pendingSymbolSearch: null,
  remoteFilesIndexByConn: {},
  remoteIndexLoading: false,
  remoteIntelSummaryByConn: {},
  remoteIntelLoading: false,
  serverMonitorOpen: false,
  serverMonitorInitialTab: 'mysql-dashboard',
  pendingHttpEndpointDraft: null,
  pendingSaveGuard: null,
  smartRefactorRequest: null,
  pinnedFiles: readInitialPinnedFiles(),
  savedTabSessions: readInitialTabSessions(),
  savedSqlQueries: [],
  sqlQueryHistory: readInitialSqlQueryHistory(),
  pendingVisualSavedQuery: null,
  reportGeneratorDraft: null,
  dbRoutinesModalOpen: false,
  dbSeederModalOpen: false,
  dbSeederTargetTable: null,
  releasePatchModalOpen: false,
  dbSchedulerModalOpen: false,
  auditModalOpen: false,
  excelImportModalOpen: false,
  excelImportTargetTable: null,
  dbGlobalSearchModalOpen: false,
  securityScannerModalOpen: false,
  dbRbacModalOpen: false,
  docsModalOpen: false,
  xdebugState: {
    listening: false,
    port: 9003,
    connected: false,
    status: 'idle',
    initInfo: null,
    pausedFile: null,
    pausedLine: null,
    stack: [],
    locals: [],
    superglobals: [],
    pathMapping: { remoteRoot: '', localRoot: '' },
    lastError: null
  },
  xdebugBreakpoints: [],
  xdebugLogs: [],
  xdebugEvalHistory: [],

  serverLogEntries: [],
  logMonitorStatus: {
    running: false,
    source: null,
    lastPolledAt: null,
    fileSize: 0,
    lastError: null
  },
  appUpdateState: {
    phase: 'idle',
    currentVersion: '4.0.1',
    canAutoInstall: false
  },
  updateBannerDismissed: false,

  dismissSplash: () => set({ splashVisible: false }),

  setTheme: (theme) => {
    try {
      localStorage.setItem(LS_THEME, theme);
    } catch {
      // Ignore
    }
    document.documentElement.setAttribute('data-theme', theme);
    applyMonacoTheme(theme);
    set({ theme });
  },

  setSuggestMode: (mode) => {
    try {
      localStorage.setItem(LS_SUGGEST_MODE, mode);
    } catch {
      // Ignore
    }
    set({ suggestMode: mode });
  },

  cycleSuggestMode: () => {
    const cur = get().suggestMode;
    const next: EditorSuggestMode =
      cur === 'calm' ? 'manual' : cur === 'manual' ? 'full' : 'calm';
    get().setSuggestMode(next);
    const msg =
      next === 'calm'
        ? '✨ Mode Saran Santai: tidak mengganggu mengetik (Enter = baris baru, Tab / Klik = terima saran).'
        : next === 'manual'
          ? '🔇 Mode Saran Manual: popup tidak muncul otomatis. Tekan Ctrl+Space kapan saja saat butuh saran.'
          : '⚡ Mode Saran Aktif: saran cepat & bisa diterima dengan Enter atau Tab.';
    get().showToast(msg);
  },

  setDesktopIslandMode: (mode) => {
    try {
      localStorage.setItem(LS_DESKTOP_ISLAND, mode);
    } catch {
      // Ignore
    }
    set({ desktopIslandMode: mode });
  },

  setIslandExpanded: (expanded) => set({ islandExpanded: expanded }),

  openIslandSearch: (opts) => {
    set({
      islandExpanded: true,
      paletteMode: 'closed',
      islandSearchRequest: {
        query: opts?.query,
        mode: opts?.mode ?? 'all',
        scope: opts?.scope,
        token: Date.now() + Math.random()
      }
    });
  },

  consumeIslandSearchRequest: () => {
    const cur = get().islandSearchRequest;
    if (!cur) return null;
    set({ islandSearchRequest: null });
    return {
      query: cur.query,
      mode: cur.mode,
      scope: cur.scope
    };
  },

  pushIslandActivity: (payload) => {
    if (islandExpireTimer) {
      clearTimeout(islandExpireTimer);
      islandExpireTimer = null;
    }
    const cleanMsg = payload.title.replace(/^✨\s*/, '');
    const activity: IslandActivity = {
      id: payload.id ?? `isl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      tone: payload.tone,
      badge: payload.badge,
      title: cleanMsg,
      subtitle: payload.subtitle,
      busy: payload.busy,
      actionLabel: payload.actionLabel,
      actionType: payload.actionType,
      jumpTabId: payload.jumpTabId,
      jumpLine: payload.jumpLine,
      durationMs: payload.durationMs
    };

    set((s) => {
      const filteredHistory = s.islandHistory.filter((item) => item.id !== activity.id);
      return {
        islandActivity: activity,
        islandHistory: activity.busy
          ? s.islandHistory
          : [activity, ...filteredHistory].slice(0, 8)
      };
    });

    if (!activity.busy) {
      const ttl = payload.autoExpireMs ?? (activity.tone === 'error' ? 6200 : 4200);
      islandExpireTimer = setTimeout(() => {
        set((s) => (s.islandActivity?.id === activity.id ? { islandActivity: null } : {}));
      }, ttl);
    }
  },

  clearIslandActivity: () => {
    if (islandExpireTimer) {
      clearTimeout(islandExpireTimer);
      islandExpireTimer = null;
    }
    set({ islandActivity: null });
  },

  runIslandAction: (actionType, opts) => {
    const state = get();
    set({ islandExpanded: false });
    if (actionType === 'jump-error') {
      const targetTabId = opts?.tabId ?? state.activeTabId;
      const targetLine = opts?.line ?? 1;
      if (targetTabId) {
        state.jumpToTabLine(targetTabId, targetLine);
      }
      return;
    }
    if (actionType === 'open-ai') {
      state.setActiveSidebar('ai');
      return;
    }
    if (actionType === 'open-transfers') {
      state.setBottomPanel(true, 'transfers');
      return;
    }
    if (actionType === 'open-terminal') {
      state.setBottomPanel(true, 'terminal');
      return;
    }
    if (actionType === 'open-output') {
      state.setBottomPanel(true, 'output');
      return;
    }
    if (actionType === 'open-logs') {
      state.setBottomPanel(true, 'logs');
      return;
    }
    if (actionType === 'open-db') {
      state.setActiveSidebar('database');
      return;
    }
    if (actionType === 'open-http') {
      state.setActiveSidebar('http');
      return;
    }
    if (actionType === 'open-preview') {
      if (!state.previewOpen) {
        void state.togglePreviewPane();
      } else {
        state.bumpPreviewReload();
      }
      return;
    }
    if (actionType === 'save-all') {
      void state.saveAllTabs();
      return;
    }
    if (actionType === 'open-sync') {
      if (!state.workspacePath) {
        state.showToast('Buka folder lokal terlebih dahulu untuk sinkronisasi dua arah.');
        return;
      }
      if (!state.selectedConnectionId) {
        state.openConnectionModal(null);
        return;
      }
      state.setSyncModalOpen(true);
      return;
    }
    if (actionType === 'edit-connection') {
      const conn =
        state.connections.find((c) => c.id === state.selectedConnectionId) ??
        state.connections[0] ??
        null;
      state.openConnectionModal(conn);
      return;
    }
    if (actionType === 'retry-connection') {
      if (state.selectedConnectionId) {
        void state.browseRemoteDir(state.remoteSubPath);
      }
    }
  },

  showToast: (msg) => {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: msg });
    const meta = inferToastIslandMeta(msg);
    get().pushIslandActivity({
      tone: meta.tone,
      badge: meta.badge,
      title: msg,
      busy: false
    });
    toastTimer = setTimeout(() => {
      set({ toast: null });
    }, 3600);
  },

  initApp: async () => {
    if (appInitPromise) {
      return appInitPromise;
    }

    appInitPromise = (async () => {
      const initialTheme = get().theme;
      document.documentElement.setAttribute('data-theme', initialTheme);
      applyMonacoTheme(initialTheme);
      updateWindowTitle(null);

      setTimeout(() => {
        set({ splashVisible: false });
      }, 1650);

      const [sys, conns, rubles, savedProjects, aiCfg, dbList, initialSavedQueries] =
        await Promise.all([
          window.aptana.system.getInfo(),
          window.aptana.connections.list(),
          window.aptana.rubles.list(),
          window.aptana.projects.list(),
          window.aptana.ai.getConfig().catch(() => null),
          window.aptana.db.list().catch(() => []),
          window.aptana.db.listSavedQueries().catch(() => [])
        ]);

      set({ savedSqlQueries: initialSavedQueries });

      if (dbList.length > 0) {
        let lastProfId: string | null = null;
        try {
          lastProfId = localStorage.getItem(LS_LAST_DB_PROFILE);
        } catch {
          lastProfId = null;
        }
        const preferredId =
          lastProfId && dbList.some((p) => p.id === lastProfId)
            ? lastProfId
            : dbList[0].id;
        set({
          dbProfiles: dbList,
          selectedDbProfileId: preferredId
        });
      }

      if (aiCfg) {
        setGhostTextEnabledFlag(aiCfg.hasApiKey && aiCfg.ghostTextEnabled);
        set({ geminiConfig: aiCfg });
      }

      registerRubleSnippetsInMonaco(rubles);

      setOpenPhpBuffersProvider(() =>
        get()
          .tabs.filter((t) => t.language === 'php' || t.language === 'sql')
          .map((t) => ({
            uriOrPath: t.filePath,
            title: t.title,
            content: t.content
          }))
      );

      setOpenWebBuffersProvider(() =>
        get()
          .tabs.filter((t) =>
            ['javascript', 'typescript', 'css', 'scss', 'less', 'html', 'php'].includes(t.language)
          )
          .map((t) => ({
            uriOrPath: t.filePath,
            title: t.relativePath || t.title,
            content: t.content
          }))
      );

      setSqlCodeLensActionHandler((payload) => {
        const activeTab = get().tabs.find((t) => t.id === get().activeTabId);
        get().triggerSqlCodeLensAction({
          ...payload,
          sourceTitle: activeTab?.title
        });
      });

      // Muat katalog fungsi, class, & konstanta asli dari runtime PHP CLI di latar belakang
      void window.aptana.php
        .getCatalog()
        .then((catalog) => {
          hydratePhpRuntimeCatalog(catalog);
          if (catalog.available) {
            set({
              systemVersionLabel: `HMW Studio • PHP ${catalog.phpVersion} • Node ${sys.nodeVersion}`
            });
          }
        })
        .catch(() => {
          // Fallback ke katalog statis PHP 8 bawaan
        });

      // Muat katalog Framework Laravel bawaan (Facades, Eloquent, Helpers, Blade Directives, Validation Rules)
      void get().refreshLaravelIntelliSense(true, null);

      // Muat daftar profil Database & sinkronkan skema tabel/kolom secara diam-diam untuk SQL/PHP Suggestion
      void get()
        .refreshDbProfiles()
        .then(() => {
          const dbId = get().selectedDbProfileId;
          if (dbId) {
            void window.aptana.db
              .introspect(dbId, getRememberedDatabaseForProfile(dbId))
              .then((snap) => get().setDbSchema(snap))
              .catch(() => {});
          }
        })
        .catch(() => {});

      // Muat katalog Framework Wisanggeni (offline source scan + SQL/embedded docs + live docs_api.php)
      void window.aptana.php
        .getWisanggeniCatalog(false)
        .then((wsg) => {
          hydrateWisanggeniCatalog(wsg);
          if (wsg.available) {
            set({
              wisanggeniSummary: {
                available: true,
                classCount: wsg.stats.classCount,
                methodCount: wsg.stats.methodCount,
                functionCount: wsg.stats.functionCount,
                apiSynced: wsg.apiSynced,
                rootPath: wsg.rootPath
              }
            });
          }
        })
        .catch(() => {});

      let preferredConnId: string | null = conns[0]?.id ?? null;
      try {
        const storedConn =
          localStorage.getItem(LS_LAST_CONN) ?? localStorage.getItem(LS_LEGACY_CONN);
        if (storedConn && conns.some((c) => c.id === storedConn)) {
          preferredConnId = storedConn;
        }
      } catch {
        // Ignore
      }

      set({
        systemVersionLabel: `HMW Studio • Node ${sys.nodeVersion}`,
        connections: conns,
        selectedConnectionId: preferredConnId,
        rubleBundles: rubles,
        projects: savedProjects
      });

      // Jika sebelumnya pengguna membuka Proyek Tersimpan, pulihkan proyek tersebut secara otomatis
      let restoredViaProject = false;
      try {
        const lastProjectId = localStorage.getItem(LS_LAST_PROJECT_ID);
        if (lastProjectId && savedProjects.some((p) => p.id === lastProjectId)) {
          restoredViaProject = true;
          await get().openSavedProject(lastProjectId);
        }
      } catch {
        restoredViaProject = false;
      }

      if (!restoredViaProject) {
        try {
          const lastWs =
            localStorage.getItem(LS_LAST_WORKSPACE) ??
            localStorage.getItem(LS_LEGACY_WORKSPACE);
          if (lastWs) {
            const tree = await window.aptana.workspace.openFolder(lastWs);
            if (tree.length > 0) {
              set({ workspacePath: lastWs, fileTree: tree });
              await get().refreshGit();
              void window.aptana.php
                .scanWorkspace(lastWs)
                .then((syms) => {
                  hydratePhpWorkspaceSymbols(syms);
                  set({ localPhpSymbols: syms });
                })
                .catch(() => {});
              void window.aptana.workspace
                .scanJoinEdges(lastWs)
                .then((edges) => hydrateWorkspaceLearnedJoinEdges(edges))
                .catch(() => {});
              void window.aptana.workspace
                .scanWebAssets(lastWs)
                .then((cat) => {
                  hydrateWorkspaceWebCatalog(cat);
                  set({ localWebCatalog: cat });
                })
                .catch(() => {});
              void get().refreshLaravelIntelliSense(true, lastWs);
            }
          }
        } catch {
          // Ignore inaccessible folder
        }

        if (preferredConnId) {
          void get().browseRemoteDir('');
        }
      }
    })();

    return appInitPromise;
  },

  refreshGeminiConfig: async () => {
    try {
      const cfg = await window.aptana.ai.getConfig();
      setGhostTextEnabledFlag(cfg.hasApiKey && cfg.ghostTextEnabled);
      set({ geminiConfig: cfg });
    } catch {
      // Ignore
    }
  },

  saveGeminiConfig: async (payload) => {
    const cfg = await window.aptana.ai.saveConfig(payload);
    setGhostTextEnabledFlag(cfg.hasApiKey && cfg.ghostTextEnabled);
    set({ geminiConfig: cfg });
    return cfg;
  },

  setGeminiSubTab: (sub) => set({ geminiSubTab: sub }),
  setInlineAiBarOpen: (open) => set({ inlineAiBarOpen: open }),
  setSelectedEditorText: (text) => set({ selectedEditorText: text }),

  setTabPhpDiagnostics: (tabId, diagnostics) => {
    const prev = get().phpDiagnosticsByTab[tabId] ?? [];
    const tab = get().tabs.find((t) => t.id === tabId);
    set((s) => ({
      phpDiagnosticsByTab: {
        ...s.phpDiagnosticsByTab,
        [tabId]: diagnostics
      }
    }));

    if (!tab) return;
    if (diagnostics.length > 0) {
      const first = diagnostics[0];
      const prevFirst = prev[0];
      const changed =
        prev.length === 0 ||
        prevFirst?.line !== first.line ||
        prevFirst?.message !== first.message;
      if (changed) {
        get().pushIslandActivity({
          id: `php-lint-${tabId}`,
          tone: 'error',
          badge: 'PHP LINT',
          title: `Error Baris ${first.line} • ${tab.title}`,
          subtitle: first.message,
          busy: false,
          actionLabel: `Lompat :${first.line}`,
          actionType: 'jump-error',
          jumpTabId: tabId,
          jumpLine: first.line,
          autoExpireMs: 6500
        });
      }
    } else if (prev.length > 0 && diagnostics.length === 0) {
      get().pushIslandActivity({
        id: `php-lint-${tabId}`,
        tone: 'success',
        badge: 'PHP VALID',
        title: `Sintaks PHP valid • ${tab.title}`,
        subtitle: 'Seluruh error sintaks teratasi',
        busy: false,
        autoExpireMs: 3200
      });
    }
  },

  applyAiCodeToTab: async (tabId, newContent, reasonLabel, previewDiffFirst = false) => {
    const target = get().tabs.find((t) => t.id === tabId);
    if (!target || target.kind !== 'code') return;

    const historyKey = getTabHistoryKey(target);
    if (historyKey) {
      await window.aptana.history
        .record({
          fileKey: historyKey,
          label: `Sebelum AI: ${reasonLabel}`,
          sourceKind: target.remoteConnectionId ? 'remote' : 'local',
          displayPath: target.filePath,
          connectionId: target.remoteConnectionId,
          relativePath: target.relativePath,
          content: target.content
        })
        .catch(() => {});
    }

    if (previewDiffFirst) {
      get().openDiffTab({
        id: `ai-diff:${target.id}`,
        title: `✨ AI Diff: ${target.title}`,
        filePath: target.filePath,
        relativePath: target.relativePath,
        originalContent: target.content,
        modifiedContent: newContent,
        diffLabel: `✨ Pratinjau Perubahan Gemini AI (${reasonLabel}) ↔ ${target.title}`,
        applyTargetTabId: target.id,
        remoteConnectionId: target.remoteConnectionId,
        remoteConnectionName: target.remoteConnectionName
      });
      set((s) => ({ historyRefreshTick: s.historyRefreshTick + 1 }));
      return;
    }

    set((s) => ({
      activeTabId: target.id,
      historyRefreshTick: s.historyRefreshTick + 1,
      tabs: s.tabs.map((t) => (t.id === target.id ? { ...t, content: newContent } : t))
    }));
    get().showToast(
      `✨ Kode AI diterapkan ke "${target.title}" (Backup otomatis tersimpan di Local History).`
    );
  },

  setProjectModalOpen: (open) => set({ projectModalOpen: open }),

  refreshWisanggeniIntelliSense: async (silent = false) => {
    try {
      const wsg = await window.aptana.php.getWisanggeniCatalog(
        true,
        get().workspacePath ?? undefined
      );
      hydrateWisanggeniCatalog(wsg);
      set({
        wisanggeniSummary: wsg.available
          ? {
              available: true,
              classCount: wsg.stats.classCount,
              methodCount: wsg.stats.methodCount,
              functionCount: wsg.stats.functionCount,
              apiSynced: wsg.apiSynced,
              rootPath: wsg.rootPath
            }
          : null
      });
      if (!silent) {
        const modeLabel = wsg.apiSynced
          ? 'Live API docs_api.php + Source Lokal'
          : wsg.rootPath
            ? `Source Lokal (${wsg.rootPath})`
            : 'Katalog Dokumentasi Bawaan';
        get().showToast(
          `Wisanggeni IntelliSense disinkronkan: ${wsg.stats.classCount} Class, ${wsg.stats.methodCount} Method, ${wsg.stats.functionCount} Helper [${modeLabel}]`
        );
      }
    } catch (err) {
      if (!silent) {
        get().showToast(
          `Gagal memuat ulang Wisanggeni: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  },

  refreshLaravelIntelliSense: async (silent = false, customWs) => {
    try {
      const targetWs = customWs !== undefined ? customWs : get().workspacePath;
      const lv = await window.aptana.php.getLaravelCatalog(targetWs);
      hydrateLaravelCatalog(lv);
      set({
        laravelSummary: {
          isLaravelProject: lv.isLaravelProject,
          laravelVersion: lv.laravelVersion,
          classCount: lv.stats.classCount,
          helperCount: lv.stats.helperCount,
          directiveCount: lv.stats.directiveCount,
          routeCount: lv.stats.routeCount,
          viewCount: lv.stats.viewCount,
          modelCount: lv.stats.modelCount,
          configKeyCount: lv.stats.configKeyCount
        }
      });
      if (!silent) {
        get().showToast(
          lv.isLaravelProject
            ? `Laravel IntelliSense disinkronkan: ${lv.stats.classCount} Class/Model, ${lv.stats.routeCount} Route, ${lv.stats.viewCount} Blade View, ${lv.stats.configKeyCount} Config`
            : `Laravel Core IntelliSense aktif: ${lv.stats.classCount} Facade/Class, ${lv.stats.helperCount} Helper, ${lv.stats.directiveCount} Blade Directive`
        );
      }
    } catch (err) {
      if (!silent) {
        get().showToast(
          `Gagal menyinkronkan Laravel IntelliSense: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  },

  refreshProjects: async () => {
    const list = await window.aptana.projects.list();
    set({ projects: list });
  },

  saveCurrentProject: async (opts) => {
    const state = get();
    const existing = opts?.id
      ? state.projects.find((p) => p.id === opts.id)
      : undefined;

    const seenSaveKeys = new Set<string>();
    const openTabs: SavedProjectTab[] = [];
    for (const t of dedupeEditorTabs(state.tabs)) {
      if (t.kind !== 'code') continue;
      const item: SavedProjectTab = {
        kind: t.remoteConnectionId ? 'remote' : 'local',
        filePath: t.filePath,
        relativePath: t.remoteConnectionId
          ? normalizeRemoteRelPath(t.relativePath)
          : t.relativePath,
        remoteConnectionId: t.remoteConnectionId
      };
      const k = buildTabRestoreKey(item);
      if (!seenSaveKeys.has(k)) {
        seenSaveKeys.add(k);
        openTabs.push(item);
      }
    }

    const activeTab = state.tabs.find((t) => t.id === state.activeTabId);
    const activeTabKey =
      activeTab && activeTab.kind === 'code'
        ? buildTabRestoreKey({
            kind: activeTab.remoteConnectionId ? 'remote' : 'local',
            filePath: activeTab.filePath,
            relativePath: activeTab.relativePath,
            remoteConnectionId: activeTab.remoteConnectionId
          })
        : null;

    const activeConn = state.connections.find((c) => c.id === state.selectedConnectionId);
    const fallbackName =
      state.workspacePath?.split(/[/\\]/).filter(Boolean).pop() ||
      (activeConn
        ? state.remoteSubPath
          ? `${activeConn.name} (${state.remoteSubPath})`
          : activeConn.name
        : 'Proyek HMW Studio');

    const payload: ProjectSavePayload = {
      id: opts?.id,
      name: opts?.name?.trim() || existing?.name || fallbackName,
      notes: opts?.notes ?? existing?.notes,
      workspacePath: state.workspacePath,
      connectionId: state.selectedConnectionId,
      remoteSubPath: state.remoteSubPath,
      openTabs,
      activeTabKey,
      projectFilePath: existing?.projectFilePath
    };

    const saved = opts?.exportFile
      ? await window.aptana.projects.exportToFile(payload)
      : await window.aptana.projects.save(payload);

    if (!saved) return null;

    try {
      localStorage.setItem(LS_LAST_PROJECT_ID, saved.id);
    } catch {
      // Ignore
    }

    await get().refreshProjects();
    set({ activeProjectId: saved.id });
    updateWindowTitle(saved.name);
    get().showToast(
      opts?.exportFile
        ? `Proyek "${saved.name}" disimpan ke file .hmwproj`
        : `Proyek "${saved.name}" berhasil disimpan`
    );
    return saved;
  },

  quickSaveActiveProject: async () => {
    const activeId = get().activeProjectId;
    const existing = activeId ? get().projects.find((p) => p.id === activeId) : undefined;
    if (!existing) {
      set({ projectModalOpen: true });
      return;
    }
    await get().saveCurrentProject({
      id: existing.id,
      name: existing.name,
      notes: existing.notes
    });
  },

  openSavedProject: async (projectId) => {
    const dirty = get().tabs.some((t) => t.content !== t.savedContent);
    if (dirty) {
      const ok = window.confirm(
        'Masih ada perubahan file yang belum disimpan. Lanjutkan membuka proyek lain?'
      );
      if (!ok) return;
    }

    let target = get().projects.find((p) => p.id === projectId);
    if (!target) {
      await get().refreshProjects();
      target = get().projects.find((p) => p.id === projectId);
    }
    if (!target) {
      get().showToast('Data proyek tidak ditemukan.');
      return;
    }

    if (get().previewOpen) {
      await window.aptana.preview.stop();
      set({
        previewOpen: false,
        previewState: { running: false, port: 0, url: '', workspacePath: '' }
      });
    }

    // 1. Pulihkan workspace lokal (atau kosongkan jika ini Proyek Remote murni)
    let nextTree: FileNode[] = [];
    let nextWs: string | null = null;
    if (target.workspacePath) {
      try {
        nextTree = await window.aptana.workspace.openFolder(target.workspacePath);
        nextWs = target.workspacePath;
        localStorage.setItem(LS_LAST_WORKSPACE, target.workspacePath);
      } catch {
        get().showToast(
          `Folder lokal "${target.workspacePath}" tidak ditemukan; membuka bagian remote proyek.`
        );
        await window.aptana.workspace.closeFolder();
      }
    } else {
      await window.aptana.workspace.closeFolder();
      try {
        localStorage.removeItem(LS_LAST_WORKSPACE);
      } catch {
        // Ignore
      }
    }

    // 2. Pulihkan koneksi server & direktori remote
    const validConnId =
      target.connectionId && get().connections.some((c) => c.id === target!.connectionId)
        ? target.connectionId
        : null;

    try {
      if (validConnId) localStorage.setItem(LS_LAST_CONN, validConnId);
      localStorage.setItem(LS_LAST_PROJECT_ID, target.id);
    } catch {
      // Ignore
    }

    set({
      activeProjectId: target.id,
      projectModalOpen: false,
      workspacePath: nextWs,
      fileTree: nextTree,
      expandedDirs: {},
      tabs: [],
      activeTabId: null,
      selectedConnectionId: validConnId,
      remoteSubPath: target.remoteSubPath || '',
      remoteEntries: []
    });

    updateWindowTitle(target.name);
    await window.aptana.projects.touchOpened(target.id);
    await get().refreshProjects();
    await get().refreshGit();
    if (nextWs) {
      void window.aptana.php
        .scanWorkspace(nextWs)
        .then((syms) => {
          hydratePhpWorkspaceSymbols(syms);
          set({ localPhpSymbols: syms });
        })
        .catch(() => {});
      void window.aptana.workspace
        .scanJoinEdges(nextWs)
        .then((edges) => hydrateWorkspaceLearnedJoinEdges(edges))
        .catch(() => {});
      void window.aptana.workspace
        .scanWebAssets(nextWs)
        .then((cat) => {
          hydrateWorkspaceWebCatalog(cat);
          set({ localWebCatalog: cat });
        })
        .catch(() => {});
      void get().refreshLaravelIntelliSense(true, nextWs);
    } else {
      hydratePhpWorkspaceSymbols({ functions: [], classes: [], arrayKeys: [] });
      hydrateWorkspaceLearnedJoinEdges([]);
      hydrateWorkspaceWebCatalog(null);
      set({ localPhpSymbols: null, localWebCatalog: null });
      void get().refreshLaravelIntelliSense(true, null);
    }

    if (validConnId) {
      await get().browseRemoteDir(target.remoteSubPath || '');
    }

    // 3. Buka kembali tab editor yang tersimpan pada proyek (dengan deduplikasi ketat)
    let desiredActiveTabId: string | null = null;
    const seenRestoreKeys = new Set<string>();
    for (const savedTab of target.openTabs ?? []) {
      const restoreKey = buildTabRestoreKey(savedTab);
      if (seenRestoreKeys.has(restoreKey)) continue;
      seenRestoreKeys.add(restoreKey);
      try {
        if (savedTab.kind === 'remote' && savedTab.remoteConnectionId) {
          const cleanRel = normalizeRemoteRelPath(savedTab.relativePath);
          if (cleanRel && get().connections.some((c) => c.id === savedTab.remoteConnectionId)) {
            await get().openRemoteFileInTab(savedTab.remoteConnectionId, cleanRel);
            if (
              target.activeTabKey === restoreKey ||
              target.activeTabKey === `remote:${savedTab.remoteConnectionId}:${savedTab.relativePath}`
            ) {
              desiredActiveTabId = `remote:${savedTab.remoteConnectionId}:${cleanRel}`;
            }
          }
        } else if (savedTab.kind === 'local' && savedTab.filePath) {
          await get().openFileInTab(savedTab.filePath, savedTab.relativePath);
          if (
            target.activeTabKey === restoreKey ||
            target.activeTabKey === `local:${savedTab.filePath}`
          ) {
            const opened = get().tabs.find(
              (t) =>
                t.kind === 'code' &&
                !t.remoteConnectionId &&
                normalizeLocalFileKey(t.filePath) === normalizeLocalFileKey(savedTab.filePath)
            );
            if (opened) desiredActiveTabId = opened.id;
          }
        }
      } catch {
        // Abaikan file yang sudah dipindahkan/dihapus
      }
    }

    if (desiredActiveTabId && get().tabs.some((t) => t.id === desiredActiveTabId)) {
      set({ activeTabId: desiredActiveTabId });
    }

    get().showToast(`Proyek dibuka: ${target.name}`);
  },

  openProjectFromFile: async () => {
    try {
      const imported = await window.aptana.projects.openFromFile();
      if (!imported) return;
      await get().refreshProjects();
      await get().openSavedProject(imported.id);
    } catch (err) {
      get().showToast(
        `Gagal membuka file proyek: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  },

  deleteSavedProject: async (projectId) => {
    await window.aptana.projects.remove(projectId);
    const wasActive = get().activeProjectId === projectId;
    if (wasActive) {
      try {
        localStorage.removeItem(LS_LAST_PROJECT_ID);
      } catch {
        // Ignore
      }
      set({ activeProjectId: null });
      updateWindowTitle(null);
    }
    await get().refreshProjects();
    get().showToast('Proyek dihapus dari daftar proyek tersimpan.');
  },

  closeCurrentProject: async () => {
    const dirty = get().tabs.some((t) => t.content !== t.savedContent);
    if (dirty) {
      const ok = window.confirm(
        'Masih ada perubahan yang belum disimpan. Tutup proyek saat ini?'
      );
      if (!ok) return;
    }

    if (get().previewOpen) {
      await window.aptana.preview.stop();
    }
    await window.aptana.workspace.closeFolder();

    try {
      localStorage.removeItem(LS_LAST_PROJECT_ID);
      localStorage.removeItem(LS_LAST_WORKSPACE);
    } catch {
      // Ignore
    }

    set({
      activeProjectId: null,
      projectModalOpen: false,
      workspacePath: null,
      fileTree: [],
      expandedDirs: {},
      tabs: [],
      activeTabId: null,
      gitStatus: null,
      previewOpen: false,
      previewState: { running: false, port: 0, url: '', workspacePath: '' }
    });
    updateWindowTitle(null);
    hydratePhpWorkspaceSymbols({ functions: [], classes: [], arrayKeys: [] });
    hydrateWorkspaceWebCatalog(null);
    set({ localPhpSymbols: null, localWebCatalog: null });
    void get().refreshLaravelIntelliSense(true, null);
    get().showToast('Proyek ditutup.');
  },

  openWorkspaceFolder: async (folderPath) => {
    const chosen = folderPath ?? (await window.aptana.workspace.selectFolder());
    if (!chosen) return;
    const tree = await window.aptana.workspace.openFolder(chosen);
    try {
      localStorage.setItem(LS_LAST_WORKSPACE, chosen);
    } catch {
      // Ignore
    }
    set({
      workspacePath: chosen,
      fileTree: tree,
      expandedDirs: {}
    });
    await get().refreshGit();
    void window.aptana.php
      .scanWorkspace(chosen)
      .then((syms) => {
        hydratePhpWorkspaceSymbols(syms);
        set({ localPhpSymbols: syms });
      })
      .catch(() => {});
    void window.aptana.workspace
      .scanJoinEdges(chosen)
      .then((edges) => hydrateWorkspaceLearnedJoinEdges(edges))
      .catch(() => {});
    void window.aptana.workspace
      .scanWebAssets(chosen)
      .then((cat) => {
        hydrateWorkspaceWebCatalog(cat);
        set({ localWebCatalog: cat });
      })
      .catch(() => {});
    void get().refreshLaravelIntelliSense(true, chosen);
    if (get().previewOpen) {
      const st = await window.aptana.preview.start(chosen);
      set({ previewState: st });
    }
    get().showToast(`Folder proyek dibuka: ${chosen}`);
  },

  createAndOpenDemoProject: async () => {
    const createdDir = await window.aptana.workspace.createSampleProject();
    await get().openWorkspaceFolder(createdDir);
    const indexNode = get().fileTree.find((n) => n.name === 'index.html');
    if (indexNode) {
      await get().openFileInTab(indexNode.path, indexNode.relativePath);
    }
  },

  refreshTree: async () => {
    const ws = get().workspacePath;
    if (!ws) return;
    const tree = await window.aptana.workspace.listTree(ws);
    set({ fileTree: tree });
  },

  toggleDirExpanded: (dirPath) => {
    set((s) => ({
      expandedDirs: {
        ...s.expandedDirs,
        [dirPath]: !s.expandedDirs[dirPath]
      }
    }));
  },

  openFileInTab: async (filePath, relativePath, jumpLine) => {
    const canonicalKey = normalizeLocalFileKey(filePath);
    const focusExistingTab = (existingId: string): void => {
      const targetSecondary =
        get().splitEditorOpen && get().focusedPane === 'secondary';
      set((s) => ({
        activeTabId: targetSecondary ? s.activeTabId : existingId,
        secondaryTabId: targetSecondary ? existingId : s.secondaryTabId,
        tabs: dedupeEditorTabs(
          s.tabs.map((t) =>
            t.id === existingId && jumpLine
              ? { ...t, cursorLine: jumpLine, jumpToken: (t.jumpToken ?? 0) + 1 }
              : t
          )
        )
      }));
    };

    const existing = get().tabs.find(
      (t) => t.kind === 'code' && !t.remoteConnectionId && getCanonicalTabKey(t) === canonicalKey
    );
    if (existing) {
      focusExistingTab(existing.id);
      return;
    }

    const inFlight = inFlightTabOpens.get(canonicalKey);
    if (inFlight) {
      await inFlight;
      const afterWait = get().tabs.find(
        (t) => t.kind === 'code' && !t.remoteConnectionId && getCanonicalTabKey(t) === canonicalKey
      );
      if (afterWait) focusExistingTab(afterWait.id);
      return;
    }

    const openTask = (async () => {
      const targetSecondary =
        get().splitEditorOpen && get().focusedPane === 'secondary';
      const res = await window.aptana.workspace.readFile(filePath);
      if (res.isBinary) {
        get().showToast('File biner tidak dapat diedit langsung di editor kode.');
        return;
      }

      const name = filePath.split(/[/\\]/).pop() || filePath;
      const tab: EditorTab = {
        id: `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        kind: 'code',
        title: name,
        filePath,
        relativePath: relativePath || name,
        language: detectLanguageFromPath(filePath, res.content),
        content: res.content,
        savedContent: res.content,
        cursorLine: jumpLine || 1,
        cursorCol: 1,
        jumpToken: jumpLine ? 1 : 0
      };

      set((s) => {
        const raced = s.tabs.find(
          (t) => t.kind === 'code' && !t.remoteConnectionId && getCanonicalTabKey(t) === canonicalKey
        );
        const chosenId = raced ? raced.id : tab.id;
        const mergedTabs = raced ? dedupeEditorTabs(s.tabs) : dedupeEditorTabs([...s.tabs, tab]);
        return {
          tabs: mergedTabs,
          activeTabId: targetSecondary && s.activeTabId ? s.activeTabId : chosenId,
          secondaryTabId: targetSecondary ? chosenId : s.secondaryTabId,
          historyRefreshTick: s.historyRefreshTick + 1
        };
      });
    })();

    inFlightTabOpens.set(canonicalKey, openTask);
    try {
      await openTask;
    } finally {
      inFlightTabOpens.delete(canonicalKey);
    }
  },

  openRemoteFileInTab: async (connectionId, remoteRelativePath, jumpLine) => {
    const cleanRel = normalizeRemoteRelPath(remoteRelativePath);
    const tabKey = `remote:${connectionId}:${cleanRel}`;

    const focusExistingRemote = (existingId: string): void => {
      const targetSecondary =
        get().splitEditorOpen && get().focusedPane === 'secondary';
      set((s) => ({
        activeTabId: targetSecondary ? s.activeTabId : existingId,
        secondaryTabId: targetSecondary ? existingId : s.secondaryTabId,
        tabs: dedupeEditorTabs(
          s.tabs.map((t) =>
            t.id === existingId && jumpLine
              ? { ...t, cursorLine: jumpLine, jumpToken: (t.jumpToken ?? 0) + 1 }
              : t
          )
        )
      }));
    };

    const existing = get().tabs.find(
      (t) => t.kind === 'code' && getCanonicalTabKey(t) === tabKey
    );
    if (existing) {
      focusExistingRemote(existing.id);
      return;
    }

    const inFlight = inFlightTabOpens.get(tabKey);
    if (inFlight) {
      await inFlight;
      const afterWait = get().tabs.find(
        (t) => t.kind === 'code' && getCanonicalTabKey(t) === tabKey
      );
      if (afterWait) focusExistingRemote(afterWait.id);
      return;
    }

    const openTask = (async () => {
      const targetSecondary =
        get().splitEditorOpen && get().focusedPane === 'secondary';
      const conn = get().connections.find((c) => c.id === connectionId);
      const connLabel = conn?.name ?? 'Remote';
      get().showToast(`Membuka dari ${connLabel}: ${cleanRel}...`);

      const remoteContent = await window.aptana.connections.readRemoteFile(
        connectionId,
        cleanRel
      );

      const fileName = cleanRel.split('/').pop() || cleanRel;
      const tab: EditorTab = {
        id: tabKey,
        kind: 'code',
        title: `[${connLabel}] ${fileName}`,
        filePath: `${connLabel}:${cleanRel}`,
        relativePath: cleanRel,
        language: detectLanguageFromPath(cleanRel, remoteContent),
        content: remoteContent,
        savedContent: remoteContent,
        remoteConnectionId: connectionId,
        remoteConnectionName: connLabel,
        cursorLine: jumpLine || 1,
        cursorCol: 1,
        jumpToken: jumpLine ? 1 : 0
      };

      set((s) => {
        const raced = s.tabs.find(
          (t) => t.kind === 'code' && getCanonicalTabKey(t) === tabKey
        );
        const chosenId = raced ? raced.id : tab.id;
        const mergedTabs = raced ? dedupeEditorTabs(s.tabs) : dedupeEditorTabs([...s.tabs, tab]);
        return {
          tabs: mergedTabs,
          activeTabId: targetSecondary && s.activeTabId ? s.activeTabId : chosenId,
          secondaryTabId: targetSecondary ? chosenId : s.secondaryTabId,
          historyRefreshTick: s.historyRefreshTick + 1
        };
      });
    })();

    inFlightTabOpens.set(tabKey, openTask);
    try {
      await openTask;
    } finally {
      inFlightTabOpens.delete(tabKey);
    }
  },

  jumpToTabLine: (tabId, line) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId
          ? { ...t, cursorLine: line, cursorCol: 1, jumpToken: (t.jumpToken ?? 0) + 1 }
          : t
      )
    }));
  },

  toggleSplitEditor: (preferredRightTabId) => {
    const state = get();
    if (state.splitEditorOpen) {
      set({
        splitEditorOpen: false,
        secondaryTabId: null,
        focusedPane: 'primary'
      });
      return;
    }
    if (state.tabs.length === 0) {
      state.showToast('Buka minimal 1 file kode terlebih dahulu untuk Split Editor.');
      return;
    }
    const rightId =
      preferredRightTabId ??
      state.tabs.find((t) => t.id !== state.activeTabId && t.kind === 'code')?.id ??
      state.tabs.find((t) => t.id !== state.activeTabId)?.id ??
      state.activeTabId;
    set({
      splitEditorOpen: true,
      secondaryTabId: rightId,
      focusedPane: 'secondary'
    });
  },

  closeSplitEditor: () =>
    set({
      splitEditorOpen: false,
      secondaryTabId: null,
      focusedPane: 'primary'
    }),

  setSecondaryTab: (tabId) =>
    set({
      splitEditorOpen: true,
      secondaryTabId: tabId,
      focusedPane: 'secondary'
    }),

  setFocusedPane: (pane) => set({ focusedPane: pane }),

  formatTabContent: (tabId) => {
    const state = get();
    const targetId =
      tabId ??
      (state.splitEditorOpen && state.focusedPane === 'secondary'
        ? state.secondaryTabId
        : state.activeTabId);
    if (!targetId) {
      state.showToast('Tidak ada file kode yang sedang aktif untuk dirapikan.');
      return;
    }
    const tab = state.tabs.find((t) => t.id === targetId);
    if (!tab || tab.kind !== 'code') {
      state.showToast('Tab Diff tidak dapat diformat otomatis.');
      return;
    }
    const formatted = formatCodeByLanguage(tab.content, tab.language);
    if (formatted === tab.content) {
      state.showToast(`Kode ${tab.title} sudah rapi.`);
      return;
    }
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === targetId ? { ...t, content: formatted } : t))
    }));
    state.showToast(`Kode dirapikan (${tab.language.toUpperCase()}): ${tab.title}`);
  },

  restoreTabFromHistory: (tabId, restoredContent, timestampLabel) => {
    const target = get().tabs.find((t) => t.id === tabId);
    if (!target) return;
    set((s) => ({
      activeTabId: tabId,
      focusedPane: 'primary',
      tabs: s.tabs.map((t) =>
        t.id === tabId ? { ...t, content: restoredContent } : t
      )
    }));
    get().showToast(
      `Versi (${timestampLabel}) dipulihkan ke editor "${target.title}". Tekan Ctrl+S untuk menyimpan.`
    );
  },

  openDiffTab: ({
    id,
    title,
    filePath,
    relativePath,
    originalContent,
    modifiedContent,
    diffLabel,
    applyTargetTabId,
    remoteConnectionId,
    remoteConnectionName
  }) => {
    const existing = get().tabs.find((t) => t.id === id);
    const diffTab: EditorTab = {
      id,
      kind: 'diff',
      title,
      filePath,
      relativePath,
      language: detectLanguageFromPath(filePath),
      content: modifiedContent,
      savedContent: modifiedContent,
      originalContent,
      diffLabel,
      applyTargetTabId,
      remoteConnectionId,
      remoteConnectionName,
      cursorLine: 1,
      cursorCol: 1
    };

    if (existing) {
      set((s) => ({
        tabs: s.tabs.map((t) => (t.id === id ? diffTab : t)),
        activeTabId: id
      }));
    } else {
      set((s) => ({
        tabs: [...s.tabs, diffTab],
        activeTabId: id
      }));
    }
  },

  updateTabContent: (tabId, content) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, content } : t))
    }));
  },

  updateTabCursor: (tabId, line, col) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId ? { ...t, cursorLine: line, cursorCol: col } : t
      )
    }));
  },

  saveTab: async (tabId, bypassGuard = false) => {
    if (inFlightTabSaves.has(tabId)) return;
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab) return;

    const preferredPane =
      get().splitEditorOpen && get().focusedPane === 'secondary' ? 'secondary' : 'primary';
    const reader =
      liveTabBufferReaders.get(`${preferredPane}:${tabId}`) ??
      liveTabBufferReaders.get(`primary:${tabId}`) ??
      liveTabBufferReaders.get(`secondary:${tabId}`) ??
      liveTabBufferReaders.get(`diff:${tabId}`);
    const latestContent = reader ? reader() : tab.content;

    // Pre-Save SFTP Quality & Debug-Trap Guard (for Remote SFTP tabs or Auto-Sync Remote connections)
    const stateNow = get();
    const targetRemoteConn = tab.remoteConnectionId
      ? stateNow.connections.find((c) => c.id === tab.remoteConnectionId) ?? null
      : stateNow.connections.find(
          (c) => c.id === stateNow.selectedConnectionId && c.keepSynchronized
        ) ?? null;

    if (!bypassGuard && targetRemoteConn) {
      const hazardReport = analyzePreSaveHazards({
        content: latestContent,
        previousSavedContent: tab.savedContent,
        language: tab.language,
        fileName: tab.relativePath || tab.title,
        isProduction: Boolean(targetRemoteConn.isProduction)
      });

      if (hazardReport.hasHazards) {
        set({
          pendingSaveGuard: {
            tabId,
            tabTitle: tab.title,
            connectionName: targetRemoteConn.name,
            isProduction: Boolean(targetRemoteConn.isProduction),
            contentToSave: latestContent,
            hazards: hazardReport.items,
            hasAutoRemovable: hazardReport.hasAutoRemovable
          }
        });
        get().pushIslandActivity({
          id: `save-guard-${tabId}`,
          tone: targetRemoteConn.isProduction ? 'error' : 'warning',
          badge: 'SAVE GUARD',
          title: `${hazardReport.items.length} peringatan pra-simpan • ${tab.title}`,
          subtitle: hazardReport.items[0]?.message,
          busy: false,
          autoExpireMs: 6000
        });
        return;
      }
    }

    const savedResourceKey = tab.remoteConnectionId
      ? `remote:${tab.remoteConnectionId}:${normalizeRemoteRelPath(tab.relativePath)}`
      : normalizeLocalFileKey(tab.filePath);

    inFlightTabSaves.add(tabId);
    try {
      if (tab.remoteConnectionId) {
        await window.aptana.connections.writeRemoteFile(
          tab.remoteConnectionId,
          tab.relativePath,
          latestContent
        );
        set((s) => ({
          historyRefreshTick: s.historyRefreshTick + 1,
          remoteConnectionStatus:
            s.selectedConnectionId === tab.remoteConnectionId
              ? 'connected'
              : s.remoteConnectionStatus,
          remoteConnectionError:
            s.selectedConnectionId === tab.remoteConnectionId
              ? null
              : s.remoteConnectionError,
          tabs: s.tabs.map((t) =>
            t.id === tabId ||
            t.id === tab.applyTargetTabId ||
            (t.kind === 'code' && getCanonicalTabKey(t) === savedResourceKey)
              ? { ...t, content: latestContent, savedContent: latestContent }
              : t
          )
        }));
        return;
      }

      await window.aptana.workspace.writeFile(tab.filePath, latestContent);
      set((s) => ({
        historyRefreshTick: s.historyRefreshTick + 1,
        tabs: s.tabs.map((t) =>
          t.id === tabId ||
          t.id === tab.applyTargetTabId ||
          (t.kind === 'code' && getCanonicalTabKey(t) === savedResourceKey)
            ? { ...t, content: latestContent, savedContent: latestContent }
            : t
        )
      }));
      await get().refreshGit();
      get().showToast(`Tersimpan: ${tab.title}`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (tab.remoteConnectionId && get().selectedConnectionId === tab.remoteConnectionId) {
        set({
          remoteConnectionStatus: 'error',
          remoteConnectionError: errMsg
        });
      }
      get().showToast(`Gagal menyimpan ${tab.title}: ${errMsg}`);
    } finally {
      inFlightTabSaves.delete(tabId);
    }
  },

  saveActiveTab: async () => {
    const state = get();
    const targetId =
      state.splitEditorOpen &&
      state.focusedPane === 'secondary' &&
      state.secondaryTabId &&
      state.tabs.some((t) => t.id === state.secondaryTabId)
        ? state.secondaryTabId
        : state.activeTabId && state.tabs.some((t) => t.id === state.activeTabId)
          ? state.activeTabId
          : state.tabs[0]?.id ?? null;

    if (!targetId) {
      state.showToast('Tidak ada file yang sedang dibuka untuk disimpan.');
      return;
    }
    await state.saveTab(targetId);
  },

  saveAllTabs: async () => {
    const dirty = get().tabs.filter((t) => {
      const reader =
        liveTabBufferReaders.get(`primary:${t.id}`) ??
        liveTabBufferReaders.get(`secondary:${t.id}`) ??
        liveTabBufferReaders.get(`diff:${t.id}`);
      const current = reader ? reader() : t.content;
      return current !== t.savedContent;
    });
    if (dirty.length === 0) {
      if (get().tabs.length > 0) {
        await get().saveActiveTab();
      } else {
        get().showToast('Tidak ada perubahan file yang perlu disimpan.');
      }
      return;
    }
    for (const tab of dirty) {
      await get().saveTab(tab.id);
    }
    if (dirty.length > 1) {
      get().showToast(`${dirty.length} file berhasil disimpan.`);
    }
  },

  closeTab: (tabId) => {
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === tabId);
      const nextTabs = s.tabs.filter((t) => t.id !== tabId);
      let nextActive = s.activeTabId;
      if (s.activeTabId === tabId) {
        nextActive =
          nextTabs[Math.min(idx, nextTabs.length - 1)]?.id ?? null;
      }
      let nextSecondary = s.secondaryTabId;
      let nextSplit = s.splitEditorOpen;
      let nextFocused = s.focusedPane;
      if (s.secondaryTabId === tabId) {
        nextSecondary =
          nextTabs.find((t) => t.id !== nextActive)?.id ?? nextActive ?? null;
        if (!nextSecondary) {
          nextSplit = false;
          nextFocused = 'primary';
        }
      }
      if (nextTabs.length === 0) {
        nextSplit = false;
        nextSecondary = null;
        nextFocused = 'primary';
      }
      return {
        tabs: nextTabs,
        activeTabId: nextActive,
        secondaryTabId: nextSecondary,
        splitEditorOpen: nextSplit,
        focusedPane: nextFocused
      };
    });
  },

  setActiveTab: (tabId) => set({ activeTabId: tabId, focusedPane: 'primary' }),

  insertTextIntoActiveTab: (snippetText) => {
    const activeId = get().activeTabId;
    if (!activeId) {
      get().showToast('Buka file kode terlebih dahulu untuk menyisipkan snippet.');
      return;
    }
    const cleaned = snippetText.replace(/\$\{\d+:([^}]+)\}/g, '$1').replace(/\$\d+/g, '');
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === activeId
          ? { ...t, content: t.content ? `${t.content}\n${cleaned}` : cleaned }
          : t
      )
    }));
  },

  syncRenamedRemoteTabs: (connectionId, oldRelativePath, newRelativePath) => {
    const conn = get().connections.find((c) => c.id === connectionId);
    const connLabel = conn?.name ?? 'Remote';
    set((s) => {
      let nextActiveId = s.activeTabId;
      const nextTabs = s.tabs.map((t) => {
        if (t.remoteConnectionId !== connectionId) return t;
        if (
          t.relativePath === oldRelativePath ||
          t.relativePath.startsWith(`${oldRelativePath}/`)
        ) {
          const updatedRel =
            t.relativePath === oldRelativePath
              ? newRelativePath
              : `${newRelativePath}${t.relativePath.slice(oldRelativePath.length)}`;
          const newId = `remote:${connectionId}:${updatedRel}`;
          const newFileName = updatedRel.split('/').pop() || updatedRel;
          if (s.activeTabId === t.id) {
            nextActiveId = newId;
          }
          return {
            ...t,
            id: newId,
            title: `[${connLabel}] ${newFileName}`,
            filePath: `${connLabel}:${updatedRel}`,
            relativePath: updatedRel,
            language: detectLanguageFromPath(updatedRel)
          };
        }
        return t;
      });
      return { tabs: nextTabs, activeTabId: nextActiveId };
    });
  },

  closeDeletedRemoteTabs: (connectionId, deletedRelativePath) => {
    const matching = get().tabs.filter(
      (t) =>
        t.remoteConnectionId === connectionId &&
        (t.relativePath === deletedRelativePath ||
          t.relativePath.startsWith(`${deletedRelativePath}/`))
    );
    for (const tab of matching) {
      get().closeTab(tab.id);
    }
  },

  setActiveSidebar: (section) => set({ activeSidebar: section }),

  setBottomPanel: (open, tab) =>
    set((s) => ({
      bottomPanelOpen: open,
      activeBottomTab: tab ?? s.activeBottomTab
    })),

  refreshConnections: async () => {
    const conns = await window.aptana.connections.list();
    const byId = new Map(conns.map((c) => [c.id, c]));
    set((s) => ({
      connections: conns,
      selectedConnectionId:
        (s.selectedConnectionId && byId.get(s.selectedConnectionId)?.id) ??
        conns[0]?.id ??
        null,
      editingConnection: s.editingConnection
        ? byId.get(s.editingConnection.id) ?? null
        : null,
      tabs: s.tabs.map((t) => {
        if (!t.remoteConnectionId) return t;
        const updatedConn = byId.get(t.remoteConnectionId);
        if (!updatedConn || updatedConn.name === t.remoteConnectionName) return t;
        const fileName = t.relativePath.split('/').pop() || t.relativePath;
        return {
          ...t,
          remoteConnectionName: updatedConn.name,
          title:
            t.kind === 'diff'
              ? t.title
              : `[${updatedConn.name}] ${fileName}`,
          filePath:
            t.kind === 'diff'
              ? t.filePath
              : `${updatedConn.name}:${t.relativePath}`
        };
      })
    }));
  },

  selectConnection: async (id) => {
    try {
      if (id) localStorage.setItem(LS_LAST_CONN, id);
      else localStorage.removeItem(LS_LAST_CONN);
    } catch {
      // Ignore
    }
    set({
      selectedConnectionId: id,
      remoteSubPath: '',
      remoteEntries: [],
      remoteConnectionStatus: id ? 'connecting' : 'idle',
      remoteConnectionError: null
    });
    if (id) {
      await get().browseRemoteDir('');
    }
  },

  setRemoteConnectionStatus: (status, errorMessage = null) =>
    set({
      remoteConnectionStatus: status,
      remoteConnectionError: status === 'error' ? errorMessage : null
    }),

  browseRemoteDir: async (subPath = '') => {
    const id = get().selectedConnectionId;
    if (!id) {
      set({ remoteConnectionStatus: 'idle', remoteConnectionError: null });
      return;
    }
    set({
      remoteLoading: true,
      remoteConnectionStatus: 'connecting',
      remoteConnectionError: null
    });
    try {
      const entries = await window.aptana.connections.listRemoteDir(id, subPath);
      set({
        remoteEntries: entries,
        remoteSubPath: subPath,
        remoteLoading: false,
        remoteConnectionStatus: 'connected',
        remoteConnectionError: null
      });

      // Otomatis indeks daftar file + simbol PHP/JS/CSS/SQL Server Remote di latar belakang sekali terkoneksi!
      if (!get().remoteFilesIndexByConn[id]?.length) {
        void get().refreshRemoteFilesIndex(id, false);
      }
      if (!get().remoteIntelSummaryByConn[id]) {
        void get().refreshRemoteWorkspaceIntel(id, false);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({
        remoteLoading: false,
        remoteEntries: [],
        remoteConnectionStatus: 'error',
        remoteConnectionError: msg
      });
    }
  },

  openConnectionModal: (conn = null) =>
    set({ connectionModalOpen: true, editingConnection: conn }),

  closeConnectionModal: () =>
    set({ connectionModalOpen: false, editingConnection: null }),

  setSyncModalOpen: (open) => set({ syncModalOpen: open }),

  pushTransferLog: (entry) =>
    set((s) => {
      const isSelected = entry.connectionId === s.selectedConnectionId;
      return {
        transferLogs: [entry, ...s.transferLogs].slice(0, 250),
        ...(isSelected && entry.status === 'error'
          ? {
              remoteConnectionStatus: 'error' as const,
              remoteConnectionError: entry.message
            }
          : isSelected && entry.status === 'success'
            ? {
                remoteConnectionStatus: 'connected' as const,
                remoteConnectionError: null
              }
            : {})
      };
    }),

  refreshRubles: async () => {
    const bundles = await window.aptana.rubles.list();
    registerRubleSnippetsInMonaco(bundles);
    set({ rubleBundles: bundles });
  },

  executeRubleCommand: async (name, commandLine) => {
    const cwd = get().workspacePath || '.';
    set((s) => ({
      activeBottomTab: 'output',
      commandOutputLines: [
        ...s.commandOutputLines,
        `▶ [${new Date().toLocaleTimeString()}] Menjalankan Ruble "${name}": ${commandLine}`
      ]
    }));
    const res = await window.aptana.terminal.runCommand(commandLine, cwd);
    set((s) => ({
      commandOutputLines: [
        ...s.commandOutputLines,
        ...(res.stdout ? res.stdout.trimEnd().split(/\r?\n/) : []),
        ...(res.stderr ? res.stderr.trimEnd().split(/\r?\n/).map((l) => `[stderr] ${l}`) : []),
        `✓ Selesai dengan kode keluar ${res.code}`,
        ''
      ]
    }));
  },

  refreshGit: async () => {
    const ws = get().workspacePath;
    if (!ws) {
      set({ gitStatus: null });
      return;
    }
    const st = await window.aptana.git.status(ws);
    set({ gitStatus: st });
  },

  togglePreviewPane: async () => {
    const currentlyOpen = get().previewOpen;
    if (currentlyOpen) {
      await window.aptana.preview.stop();
      set({
        previewOpen: false,
        previewState: { running: false, port: 0, url: '', workspacePath: '' }
      });
      get().pushIslandActivity({
        tone: 'neutral',
        badge: 'PREVIEW',
        title: 'Live Web Preview dihentikan',
        busy: false
      });
      return;
    }

    const ws = get().workspacePath;
    if (!ws) {
      get().showToast('Buka folder proyek terlebih dahulu untuk menyalakan Live Web Preview.');
      return;
    }
    const st = await window.aptana.preview.start(ws);
    set({ previewOpen: true, previewState: st });
    get().pushIslandActivity({
      tone: 'preview',
      badge: 'PREVIEW',
      title: `Live Preview aktif di port :${st.port}`,
      subtitle: st.url,
      busy: false,
      actionLabel: 'Segarkan',
      actionType: 'open-preview'
    });
  },

  setPreviewSubPath: (subPath) => set({ previewSubPath: subPath }),
  setPreviewViewport: (vp) => set({ previewViewport: vp }),
  bumpPreviewReload: () => set((s) => ({ previewReloadTick: s.previewReloadTick + 1 })),

  setPaletteMode: (mode) => set({ paletteMode: mode }),

  toggleBookmarkAtLine: (tabId, line, lineText) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.kind !== 'code') return;
    const fileKey = getCanonicalTabKey(tab);
    const existing = get().bookmarks.find(
      (b) => b.fileKey === fileKey && b.line === line
    );
    if (existing) {
      const next = get().bookmarks.filter((b) => b.id !== existing.id);
      persistBookmarks(next);
      set({ bookmarks: next });
      get().showToast(`Bookmark dihapus pada ${tab.title}:${line}`);
      return;
    }

    const snippet =
      (lineText ?? tab.content.split(/\r?\n/)[line - 1] ?? '').trim().slice(0, 90) ||
      `Baris ${line}`;
    const created: CodeBookmark = {
      id: `bm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      fileKey,
      sourceKind: tab.remoteConnectionId ? 'remote' : 'local',
      filePath: tab.filePath,
      relativePath: tab.relativePath,
      connectionId: tab.remoteConnectionId,
      line,
      label: snippet,
      createdAt: new Date().toISOString()
    };
    const next = [...get().bookmarks, created].sort((a, b) =>
      a.fileKey === b.fileKey ? a.line - b.line : a.relativePath.localeCompare(b.relativePath)
    );
    persistBookmarks(next);
    set({ bookmarks: next });
    get().showToast(`Bookmark ditambahkan: ${tab.title}:${line}`);
  },

  removeBookmark: (bookmarkId) => {
    const next = get().bookmarks.filter((b) => b.id !== bookmarkId);
    persistBookmarks(next);
    set({ bookmarks: next });
  },

  clearBookmarks: () => {
    persistBookmarks([]);
    set({ bookmarks: [] });
  },

  jumpToBookmark: async (bm) => {
    if (bm.sourceKind === 'remote' && bm.connectionId) {
      await get().openRemoteFileInTab(bm.connectionId, bm.relativePath, bm.line);
    } else {
      await get().openFileInTab(bm.filePath, bm.relativePath, bm.line);
    }
  },

  jumpToNextBookmark: async () => {
    const all = get().bookmarks;
    if (all.length === 0) {
      get().showToast('Belum ada bookmark. Tekan Ctrl+F2 pada baris kode untuk menandai.');
      return;
    }
    const activeTab = get().tabs.find((t) => t.id === get().activeTabId);
    if (!activeTab) {
      await get().jumpToBookmark(all[0]);
      return;
    }
    const curKey = getCanonicalTabKey(activeTab);
    const curLine = activeTab.cursorLine;

    const afterInSameFile = all.find(
      (b) => b.fileKey === curKey && b.line > curLine
    );
    if (afterInSameFile) {
      await get().jumpToBookmark(afterInSameFile);
      return;
    }

    const curFileFirstIdx = all.findIndex((b) => b.fileKey === curKey);
    if (curFileFirstIdx >= 0) {
      const nextDifferent = all.slice(curFileFirstIdx + 1).find((b) => b.fileKey !== curKey);
      if (nextDifferent) {
        await get().jumpToBookmark(nextDifferent);
        return;
      }
    }
    await get().jumpToBookmark(all[0]);
  },

  refreshDbProfiles: async () => {
    const list = await window.aptana.db.list();
    let storedId: string | null = null;
    try {
      storedId = localStorage.getItem(LS_LAST_DB_PROFILE);
    } catch {
      storedId = null;
    }
    set((s) => {
      const chosen =
        (s.selectedDbProfileId && list.some((p) => p.id === s.selectedDbProfileId)
          ? s.selectedDbProfileId
          : storedId && list.some((p) => p.id === storedId)
            ? storedId
            : list[0]?.id) ?? null;
      return {
        dbProfiles: list,
        selectedDbProfileId: chosen
      };
    });
  },

  setSelectedDbProfileId: (id) => {
    try {
      if (id) localStorage.setItem(LS_LAST_DB_PROFILE, id);
      else localStorage.removeItem(LS_LAST_DB_PROFILE);
    } catch {
      // Ignore
    }
    set({ selectedDbProfileId: id });
  },

  setDbSchema: (schema) => {
    if (schema?.profileId && schema.currentDatabase) {
      rememberDatabaseForProfile(schema.profileId, schema.currentDatabase);
    }
    hydrateDatabaseSchemaCatalog(schema);
    set({ dbSchema: schema });
  },

  setDbLoadingProgress: (evt) => {
    const state = get();
    if (!state.dbSchemaLoading) return;
    if (state.selectedDbProfileId && evt.profileId !== state.selectedDbProfileId) return;
    set({
      dbSchemaLoadingPercent: Math.max(state.dbSchemaLoadingPercent, evt.percent),
      dbSchemaLoadingMessage: evt.message,
      dbSchemaLoadingTargetDb: evt.database ?? state.dbSchemaLoadingTargetDb
    });
  },

  applyPartialDbSchema: (partialSnap) => {
    const state = get();
    if (state.selectedDbProfileId && partialSnap.profileId !== state.selectedDbProfileId) return;
    // Only apply Stage-1 stub tables if we don't already have full columns loaded for this database
    const existingHasCols =
      state.dbSchema?.profileId === partialSnap.profileId &&
      state.dbSchema.currentDatabase.toLowerCase() ===
        partialSnap.currentDatabase.toLowerCase() &&
      state.dbSchema.tables.some((t) => t.columns.length > 0);
    if (existingHasCols) return;
    hydrateDatabaseSchemaCatalog(partialSnap);
    set({ dbSchema: partialSnap });
  },

  loadDbSchema: async (profileId, databaseName, forceFull = false) => {
    const state = get();
    const targetId = profileId ?? state.selectedDbProfileId;
    if (!targetId) return null;

    const effectiveDb =
      databaseName !== undefined
        ? databaseName || undefined
        : getRememberedDatabaseForProfile(targetId);

    const prof = state.dbProfiles.find((p) => p.id === targetId);
    const seq = ++latestDbLoadSeq;

    // Method 3: Stale-While-Revalidate Local Disk Cache (< 10 ms instant hydration!)
    if (!forceFull) {
      const cached = await window.aptana.db
        .getCachedSchema(targetId, effectiveDb)
        .catch(() => null);
      if (seq !== latestDbLoadSeq) return cached;
      if (cached) {
        if (cached.profileId && cached.currentDatabase) {
          rememberDatabaseForProfile(cached.profileId, cached.currentDatabase);
        }
        hydrateDatabaseSchemaCatalog(cached);
        set({
          selectedDbProfileId: targetId,
          dbSchema: cached,
          dbSchemaLoading: false,
          dbSchemaLoadingPercent: 100,
          dbSchemaLoadingMessage: null,
          dbSchemaLoadingTargetDb: null,
          dbSchemaError: null
        });

        // Silent background revalidation over warm connection pool
        void window.aptana.db
          .introspect(targetId, effectiveDb, false)
          .then((freshSnap) => {
            if (seq !== latestDbLoadSeq) return;
            if (freshSnap.profileId && freshSnap.currentDatabase) {
              rememberDatabaseForProfile(freshSnap.profileId, freshSnap.currentDatabase);
            }
            hydrateDatabaseSchemaCatalog(freshSnap);
            set({ dbSchema: freshSnap, dbSchemaError: null });
          })
          .catch(() => {
            // Keep instant cached schema usable if background sync fails
          });

        return cached;
      }
    }

    set({
      selectedDbProfileId: targetId,
      dbSchemaLoading: true,
      dbSchemaLoadingPercent: 10,
      dbSchemaLoadingTargetDb: effectiveDb || prof?.database || null,
      dbSchemaLoadingMessage: effectiveDb
        ? `Menghubungkan & memuat database "${effectiveDb}"...`
        : `Menghubungkan ke "${prof?.name ?? 'Database'}"...`,
      dbSchemaError: null
    });

    try {
      const snap = await window.aptana.db.introspect(targetId, effectiveDb, forceFull);
      if (seq !== latestDbLoadSeq) return snap;
      if (snap.profileId && snap.currentDatabase) {
        rememberDatabaseForProfile(snap.profileId, snap.currentDatabase);
      }
      hydrateDatabaseSchemaCatalog(snap);
      set({
        dbSchema: snap,
        dbSchemaLoading: false,
        dbSchemaLoadingPercent: 100,
        dbSchemaLoadingMessage: null,
        dbSchemaLoadingTargetDb: null,
        dbSchemaError: null
      });
      return snap;
    } catch (err) {
      if (seq !== latestDbLoadSeq) return null;
      const msg = err instanceof Error ? err.message : String(err);
      set({
        dbSchemaLoading: false,
        dbSchemaLoadingPercent: 0,
        dbSchemaLoadingMessage: null,
        dbSchemaLoadingTargetDb: null,
        dbSchemaError: msg
      });
      return null;
    }
  },

  triggerWisanggeniCrudFromTable: async (table, engine) => {
    const ddl = await window.aptana.db.generateTableDdl(table, engine);
    set({
      pendingCrudFromDb: { tableName: table.name, ddl },
      activeSidebar: 'ai',
      geminiSubTab: 'crud'
    });
    get().showToast(
      `✨ Skema tabel "${table.name}" dikirim ke Generator CRUD Wisanggeni.`
    );
  },

  consumePendingCrudFromDb: () => {
    const item = get().pendingCrudFromDb;
    if (item) {
      set({ pendingCrudFromDb: null });
    }
    return item;
  },

  pushServerLogEntries: (entries) => {
    if (entries.length === 0) return;
    set((s) => ({
      serverLogEntries: [...s.serverLogEntries, ...entries].slice(-400)
    }));
  },

  clearServerLogEntries: () => set({ serverLogEntries: [] }),

  setLogMonitorStatus: (status) => set({ logMonitorStatus: status }),

  openLogEntryLocation: async (entry) => {
    const rawPath = entry.filePath?.trim();
    if (!rawPath) {
      get().showToast('Baris log ini tidak memuat path file spesifik.');
      return;
    }
    const line = entry.line ?? 1;
    const state = get();

    // 1. Check if already open in a tab by basename or path suffix
    const normRaw = rawPath.replace(/\\/g, '/');
    const exactOpen = state.tabs.find(
      (t) =>
        t.kind === 'code' &&
        (t.filePath.replace(/\\/g, '/').toLowerCase() === normRaw.toLowerCase() ||
          normRaw.toLowerCase().endsWith(`/${normalizeRemoteRelPath(t.relativePath).toLowerCase()}`))
    );
    if (exactOpen) {
      state.jumpToTabLine(exactOpen.id, line);
      return;
    }

    // 2. Check active or log-associated remote connection
    const connId =
      state.logMonitorStatus.source?.connectionId ?? state.selectedConnectionId;
    if (connId && rawPath.startsWith('/')) {
      const conn = state.connections.find((c) => c.id === connId);
      if (conn) {
        const remoteRoot = conn.remotePath.replace(/\\/g, '/').replace(/\/+$/, '');
        if (remoteRoot && normRaw.startsWith(`${remoteRoot}/`)) {
          const rel = normRaw.slice(remoteRoot.length + 1);
          await state.openRemoteFileInTab(conn.id, rel, line);
          return;
        }
      }
    }

    // 3. Check local path directly (Windows drive or workspace relative)
    if (/^[A-Za-z]:[\\/]/.test(rawPath)) {
      await state.openFileInTab(rawPath, undefined, line);
      return;
    }

    if (state.workspacePath) {
      const baseName = normRaw.split('/').pop() || normRaw;
      const wsNorm = state.workspacePath.replace(/\\/g, '/').replace(/\/+$/, '');
      if (normRaw.toLowerCase().startsWith(wsNorm.toLowerCase() + '/')) {
        const rel = normRaw.slice(wsNorm.length + 1);
        await state.openFileInTab(rawPath, rel, line);
        return;
      }
      // Try matching file in local fileTree by suffix or basename
      const findInTree = (nodes: FileNode[]): FileNode | null => {
        for (const n of nodes) {
          if (!n.isDirectory) {
            if (
              normRaw.toLowerCase().endsWith(`/${n.relativePath.toLowerCase()}`) ||
              n.name.toLowerCase() === baseName.toLowerCase()
            ) {
              return n;
            }
          } else if (n.children) {
            const sub = findInTree(n.children);
            if (sub) return sub;
          }
        }
        return null;
      };
      const matchedNode = findInTree(state.fileTree);
      if (matchedNode) {
        await state.openFileInTab(matchedNode.path, matchedNode.relativePath, line);
        return;
      }
    }

    state.showToast(`Tidak dapat menemukan file sumber untuk: ${rawPath}`);
  },

  setActiveTabLanguage: (language) => {
    const activeId = get().activeTabId;
    if (!activeId) return;
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === activeId ? { ...t, language } : t))
    }));
    scheduleAmbientExtraLibSync();
  },

  navigatePhpDefinition: async (tabId, lineContent, column, wordAtCursor) => {
    const state = get();
    const tab = state.tabs.find((t) => t.id === tabId);
    if (!tab || tab.kind !== 'code') return false;

    const target =
      resolvePhpNavigationTarget(
        lineContent,
        column,
        wordAtCursor,
        tab.content,
        tab.title
      ) ??
      resolveWebNavigationTarget(
        lineContent,
        column,
        wordAtCursor,
        tab.content,
        tab.relativePath || tab.title
      );
    if (!target) return false;

    if (target.kind === 'same-file') {
      state.jumpToTabLine(tab.id, target.line);
      return true;
    }

    if (target.kind === 'include-rel') {
      if (tab.remoteConnectionId) {
        const rel = resolveRelativePosixPath(tab.relativePath, target.rawTarget);
        if (!rel.startsWith('..')) {
          await state.openRemoteFileInTab(tab.remoteConnectionId, rel, 1);
          return true;
        }
        // Fallback if include points to local Wisanggeni root (e.g. ../wisanggeni/main_lib.php)
        if (
          state.wisanggeniSummary?.rootPath &&
          target.rawTarget.toLowerCase().includes('wisanggeni/')
        ) {
          const afterWsg = target.rawTarget.replace(/^.*?wisanggeni[/\\]/i, '');
          const wsgTarget = resolveLocalNeighborPath(
            `${state.wisanggeniSummary.rootPath}\\placeholder.php`,
            afterWsg
          );
          await state.openFileInTab(wsgTarget, `wisanggeni/${afterWsg}`, 1);
          return true;
        }
        state.showToast(
          `Path include "${target.rawTarget}" berada di luar folder root koneksi remote saat ini.`
        );
        return false;
      }

      const localTarget = resolveLocalNeighborPath(tab.filePath, target.rawTarget);
      await state.openFileInTab(localTarget, undefined, 1);
      return true;
    }

    if (target.kind === 'laravel-view') {
      if (tab.remoteConnectionId) {
        await state.openRemoteFileInTab(tab.remoteConnectionId, target.relativePath, 1);
        return true;
      }
      if (target.filePath) {
        await state.openFileInTab(target.filePath, target.relativePath, 1);
        return true;
      }
      if (state.workspacePath) {
        const sep = state.workspacePath.includes('\\') ? '\\' : '/';
        const full = `${state.workspacePath.replace(/[/\\]+$/, '')}${sep}${target.relativePath.replace(/\//g, sep)}`;
        await state.openFileInTab(full, target.relativePath, 1);
        return true;
      }
      return false;
    }

    if (target.kind === 'laravel-route') {
      const rel = target.relativePath || 'routes/web.php';
      if (tab.remoteConnectionId) {
        await state.openRemoteFileInTab(tab.remoteConnectionId, rel, target.line ?? 1);
        return true;
      }
      if (state.workspacePath) {
        const sep = state.workspacePath.includes('\\') ? '\\' : '/';
        const full = `${state.workspacePath.replace(/[/\\]+$/, '')}${sep}${rel.replace(/\//g, sep)}`;
        await state.openFileInTab(full, rel, target.line ?? 1);
        return true;
      }
      return false;
    }

    if (target.kind === 'symbol') {
      const jumpLn = target.line ?? 1;
      // 1. Check if symbol belongs to an already-open tab (local or remote!)
      const openMatch = state.tabs.find(
        (t) =>
          t.kind === 'code' &&
          (t.filePath === target.filePath ||
            (target.relativePath && t.relativePath === target.relativePath))
      );
      if (openMatch) {
        state.jumpToTabLine(openMatch.id, jumpLn);
        return true;
      }

      // 2a. Explicit `remote://<connId>/<relPath>` URI from Remote Workspace Symbol Scanner
      if (target.filePath?.startsWith('remote://')) {
        const withoutProto = target.filePath.slice('remote://'.length);
        const slashIdx = withoutProto.indexOf('/');
        if (slashIdx > 0) {
          const rConnId = withoutProto.slice(0, slashIdx);
          const rRel = withoutProto.slice(slashIdx + 1);
          await state.openRemoteFileInTab(rConnId, rRel, jumpLn);
          return true;
        }
      }

      // 2b. Real local file path (workspace or Wisanggeni local source)
      if (
        target.filePath &&
        (/^[A-Za-z]:[\\/]/.test(target.filePath) ||
          (!target.filePath.includes(':') && target.filePath.startsWith('/')))
      ) {
        await state.openFileInTab(target.filePath, target.relativePath, jumpLn);
        return true;
      }

      // 3. Remote connection relative path
      if (tab.remoteConnectionId && target.relativePath && !target.relativePath.includes(':')) {
        await state.openRemoteFileInTab(tab.remoteConnectionId, target.relativePath, jumpLn);
        return true;
      }
    }

    return false;
  },

  reloadOpenTabsAfterReplace: async (sourceKind, modifiedRelPaths, connectionId) => {
    if (modifiedRelPaths.length === 0) return;
    const modSet = new Set(
      modifiedRelPaths.map((p) => normalizeRemoteRelPath(p).toLowerCase())
    );
    const tabsToReload = get().tabs.filter((t) => {
      if (t.kind !== 'code') return false;
      if (sourceKind === 'remote') {
        return (
          t.remoteConnectionId === connectionId &&
          modSet.has(normalizeRemoteRelPath(t.relativePath).toLowerCase())
        );
      }
      return (
        !t.remoteConnectionId &&
        modSet.has(normalizeRemoteRelPath(t.relativePath).toLowerCase())
      );
    });

    for (const t of tabsToReload) {
      try {
        if (sourceKind === 'remote' && t.remoteConnectionId) {
          const fresh = await window.aptana.connections.readRemoteFile(
            t.remoteConnectionId,
            t.relativePath
          );
          set((s) => ({
            tabs: s.tabs.map((item) =>
              item.id === t.id ? { ...item, content: fresh, savedContent: fresh } : item
            )
          }));
        } else {
          const fresh = await window.aptana.workspace.readFile(t.filePath);
          if (!fresh.isBinary) {
            set((s) => ({
              tabs: s.tabs.map((item) =>
                item.id === t.id
                  ? { ...item, content: fresh.content, savedContent: fresh.content }
                  : item
              )
            }));
          }
        }
      } catch {
        // Ignore individual reload errors
      }
    }
  },

  triggerSqlCodeLensAction: (req) => {
    set({
      activeSidebar: 'database',
      pendingSqlCodeLens: {
        ...req,
        token: Date.now() + Math.random()
      }
    });
  },

  consumePendingSqlCodeLens: () => {
    const cur = get().pendingSqlCodeLens;
    if (!cur) return null;
    set({ pendingSqlCodeLens: null });
    return cur;
  },

  setDbArchitectTab: (tab) => {
    set({ dbArchitectTab: tab });
    if (tab !== 'closed') {
      const st = get();
      if (
        st.selectedDbProfileId &&
        !st.dbSchemaLoading &&
        (!st.dbSchema || st.dbSchema.profileId !== st.selectedDbProfileId)
      ) {
        void st.loadDbSchema(st.selectedDbProfileId);
      }
    }
  },

  openVisualJoinBuilder: (seedTables) => {
    set({
      dbArchitectTab: 'join',
      pendingJoinSeedTables:
        seedTables && seedTables.length > 0 ? seedTables : null
    });
    const st = get();
    if (
      st.selectedDbProfileId &&
      !st.dbSchemaLoading &&
      (!st.dbSchema || st.dbSchema.profileId !== st.selectedDbProfileId)
    ) {
      void st.loadDbSchema(st.selectedDbProfileId);
    }
  },

  consumePendingJoinSeedTables: () => {
    const cur = get().pendingJoinSeedTables;
    if (!cur) return null;
    set({ pendingJoinSeedTables: null });
    return cur;
  },

  openPhpScratchpad: (initialCode) => {
    if (initialCode && initialCode.trim()) {
      const trimmed = initialCode.trim();
      const ready =
        trimmed.startsWith('<?php') || trimmed.startsWith('<?=')
          ? initialCode
          : `<?php\n${initialCode}\n`;
      set({ phpScratchpadOpen: true, phpScratchpadCode: ready });
    } else {
      set({ phpScratchpadOpen: true });
    }
  },

  setPhpScratchpadOpen: (open) => set({ phpScratchpadOpen: open }),
  setPhpScratchpadCode: (code) => set({ phpScratchpadCode: code }),

  findReferencesForSymbol: (symbol, scopeHint) => {
    const clean = symbol.replace(/^\$/, '').trim();
    if (!clean) return;
    const state = get();
    const activeTab = state.tabs.find((t) => t.id === state.activeTabId);
    const resolvedScope: 'local' | 'remote' =
      scopeHint ??
      (activeTab?.remoteConnectionId || (!state.workspacePath && state.selectedConnectionId)
        ? 'remote'
        : 'local');
    set({
      activeSidebar: 'search',
      pendingSymbolSearch: {
        symbol: clean,
        scopeHint: resolvedScope,
        token: Date.now()
      }
    });
  },

  consumePendingSymbolSearch: () => {
    const cur = get().pendingSymbolSearch;
    if (!cur) return null;
    set({ pendingSymbolSearch: null });
    return { symbol: cur.symbol, scopeHint: cur.scopeHint };
  },

  refreshRemoteFilesIndex: async (connectionId, force = false) => {
    const state = get();
    const targetConnId = connectionId ?? state.selectedConnectionId;
    if (!targetConnId) return;
    if (!force && state.remoteFilesIndexByConn[targetConnId]?.length) {
      hydrateRemoteIndexedAssetPaths(
        state.remoteFilesIndexByConn[targetConnId].map((f) => f.relativePath)
      );
      return;
    }
    if (state.remoteIndexLoading) return;

    // A2: Stale-While-Revalidate Local Disk Cache (< 10 ms instant hydration!)
    if (!force) {
      const cached = await window.aptana.connections
        .getCachedRemoteIndex(targetConnId)
        .catch(() => null);
      if (cached && cached.files.length > 0) {
        hydrateRemoteIndexedAssetPaths(cached.files.map((f) => f.relativePath));
        set((s) => ({
          remoteFilesIndexByConn: {
            ...s.remoteFilesIndexByConn,
            [targetConnId]: cached.files
          }
        }));
        if (cached.intel) {
          hydrateRemotePhpWorkspaceSymbols(cached.intel.phpSymbols);
          hydrateRemoteWebCatalog(cached.intel.webCatalog);
          hydrateRemoteLearnedJoinEdges(cached.intel.joinEdges);
          set((s) => ({
            remoteIntelByConn: {
              ...s.remoteIntelByConn,
              [targetConnId]: cached.intel!
            },
            remoteIntelSummaryByConn: {
              ...s.remoteIntelSummaryByConn,
              [targetConnId]: {
                scannedFiles: cached.intel!.scannedFiles,
                phpFnCount:
                  cached.intel!.phpSymbols.functions.length +
                  cached.intel!.phpSymbols.classes.length,
                jsFnCount:
                  cached.intel!.webCatalog.jsFunctions.length +
                  cached.intel!.webCatalog.jsClasses.length,
                cssClassCount: cached.intel!.webCatalog.cssClasses.length
              }
            }
          }));
        }
      }
    }

    set({ remoteIndexLoading: true });
    try {
      const files = await window.aptana.connections.listRemoteFilesIndex(
        targetConnId,
        '',
        50000
      );
      hydrateRemoteIndexedAssetPaths(files.map((f) => f.relativePath));
      set((s) => ({
        remoteFilesIndexByConn: {
          ...s.remoteFilesIndexByConn,
          [targetConnId]: files
        }
      }));
      if (force) {
        void get().refreshRemoteWorkspaceIntel(targetConnId, true);
      }
    } catch {
      // Silently ignore when SFTP is offline
    } finally {
      set({ remoteIndexLoading: false });
    }
  },

  refreshRemoteWorkspaceIntel: async (connectionId, force = false) => {
    const state = get();
    const targetConnId = connectionId ?? state.selectedConnectionId;
    if (!targetConnId) return;
    if (!force && state.remoteIntelSummaryByConn[targetConnId]) {
      return;
    }
    if (state.remoteIntelLoading) return;
    set({ remoteIntelLoading: true });
    try {
      const intel = await window.aptana.connections.scanRemoteWorkspaceSymbols(
        targetConnId,
        '',
        220
      );
      hydrateRemotePhpWorkspaceSymbols(intel.phpSymbols);
      hydrateRemoteWebCatalog(intel.webCatalog);
      hydrateRemoteLearnedJoinEdges(intel.joinEdges);
      set((s) => ({
        remoteIntelByConn: {
          ...s.remoteIntelByConn,
          [targetConnId]: intel
        },
        remoteIntelSummaryByConn: {
          ...s.remoteIntelSummaryByConn,
          [targetConnId]: {
            scannedFiles: intel.scannedFiles,
            phpFnCount:
              intel.phpSymbols.functions.length + intel.phpSymbols.classes.length,
            jsFnCount:
              intel.webCatalog.jsFunctions.length + intel.webCatalog.jsClasses.length,
            cssClassCount: intel.webCatalog.cssClasses.length
          }
        }
      }));
    } catch {
      // Ignore if connection is offline
    } finally {
      set({ remoteIntelLoading: false });
    }
  },

  compareTabWithCounterpart: async (tabId) => {
    const state = get();
    const targetId = tabId ?? state.activeTabId;
    const tab = state.tabs.find((t) => t.id === targetId);
    if (!tab || tab.kind !== 'code') return;

    const liveBuffer =
      liveTabBufferReaders.get(`primary:${tab.id}`)?.() ??
      liveTabBufferReaders.get(`secondary:${tab.id}`)?.() ??
      tab.content;

    // Case 1: Active tab is a Remote SFTP/FTPS file
    if (tab.remoteConnectionId) {
      const conn = state.connections.find((c) => c.id === tab.remoteConnectionId);
      const connLabel = conn?.name ?? 'Server Remote';
      const relNorm = normalizeRemoteRelPath(tab.relativePath);

      // Try comparing against matching Local Workspace file if available
      if (state.workspacePath) {
        const sep = state.workspacePath.includes('\\') ? '\\' : '/';
        const candidateLocal = `${state.workspacePath.replace(/[/\\]+$/, '')}${sep}${relNorm.replace(/\//g, sep)}`;
        try {
          const localRead = await window.aptana.workspace.readFile(candidateLocal);
          if (!localRead.isBinary) {
            state.openDiffTab({
              id: `diff-loc-rem-${tab.id}`,
              title: `⇄ ${tab.title}`,
              filePath: tab.filePath,
              relativePath: tab.relativePath,
              originalContent: localRead.content,
              modifiedContent: liveBuffer,
              diffLabel: `Workspace Lokal (Kiri) ↔ Server Remote [${connLabel}] (Kanan)`,
              remoteConnectionId: tab.remoteConnectionId,
              remoteConnectionName: connLabel
            });
            return;
          }
        } catch {
          // Local counterpart doesn't exist — fall back to comparing live server copy vs editor buffer
        }
      }

      // Compare live copy on SFTP server vs current buffer in editor
      try {
        state.pushIslandActivity({
          id: `diff-rem-${tab.id}`,
          tone: 'sync',
          badge: 'SFTP DIFF',
          title: `Membaca file live dari [${connLabel}]...`,
          subtitle: relNorm,
          busy: true
        });
        const liveRemoteText = await window.aptana.connections.readRemoteFile(
          tab.remoteConnectionId,
          relNorm
        );
        state.clearIslandActivity();
        state.openDiffTab({
          id: `diff-srv-buf-${tab.id}`,
          title: `⇄ ${tab.title}`,
          filePath: tab.filePath,
          relativePath: tab.relativePath,
          originalContent: liveRemoteText,
          modifiedContent: liveBuffer,
          diffLabel: `Versi Tersimpan di Server [${connLabel}] (Kiri) ↔ Buffer Editor Saat Ini (Kanan)`,
          remoteConnectionId: tab.remoteConnectionId,
          remoteConnectionName: connLabel
        });
      } catch (err) {
        state.showToast(
          `Gagal membaca file pembanding dari server: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      return;
    }

    // Case 2: Active tab is a Local file -> compare against active SFTP/FTPS server!
    if (!state.selectedConnectionId) {
      state.showToast(
        'Pilih koneksi Server Remote SFTP/FTPS terlebih dahulu untuk membandingkan Lokal ↔ Server.'
      );
      return;
    }
    const conn = state.connections.find((c) => c.id === state.selectedConnectionId);
    const connLabel = conn?.name ?? 'Server Remote';
    const relNorm = normalizeRemoteRelPath(tab.relativePath);

    try {
      state.pushIslandActivity({
        id: `diff-loc-srv-${tab.id}`,
        tone: 'sync',
        badge: 'SFTP DIFF',
        title: `Membandingkan dengan [${connLabel}]...`,
        subtitle: relNorm,
        busy: true
      });
      let remoteContent = '';
      let remoteMissing = false;
      try {
        remoteContent = await window.aptana.connections.readRemoteFile(
          state.selectedConnectionId,
          relNorm
        );
      } catch {
        remoteMissing = true;
        remoteContent = '';
      }
      state.clearIslandActivity();
      state.openDiffTab({
        id: `diff-srv-loc-${tab.id}`,
        title: `⇄ ${tab.title}`,
        filePath: tab.filePath,
        relativePath: tab.relativePath,
        originalContent: remoteContent,
        modifiedContent: liveBuffer,
        diffLabel: remoteMissing
          ? `Server [${connLabel}: Belum Ada File] (Kiri) ↔ File Lokal (Kanan)`
          : `Server Remote [${connLabel}] (Kiri) ↔ File Lokal (Kanan)`
      });
    } catch (err) {
      state.showToast(
        `Gagal membandingkan dengan server: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  },

  setServerMonitorOpen: (open, initialTab) =>
    set((s) => ({
      serverMonitorOpen: open,
      serverMonitorInitialTab: initialTab ?? s.serverMonitorInitialTab
    })),

  sendTabToHttpTester: (tabId) => {
    const state = get();
    const targetId = tabId ?? state.activeTabId;
    const tab = state.tabs.find((t) => t.id === targetId);
    if (!tab || tab.kind !== 'code') {
      state.showToast('Buka file PHP / Controller terlebih dahulu untuk menguji endpoint.');
      return;
    }

    const liveBuffer =
      liveTabBufferReaders.get(`primary:${tab.id}`)?.() ??
      liveTabBufferReaders.get(`secondary:${tab.id}`)?.() ??
      tab.content;

    let baseUrl = state.previewState.running && state.previewState.url
      ? state.previewState.url
      : 'http://localhost:8080';
    if (tab.remoteConnectionId) {
      const conn = state.connections.find((c) => c.id === tab.remoteConnectionId);
      if (conn?.host) {
        baseUrl = `http://${conn.host}`;
      }
    }

    const spec = extractPhpHttpEndpointSpec(liveBuffer, tab.relativePath, baseUrl);
    set({
      activeSidebar: 'http',
      pendingHttpEndpointDraft: { ...spec, token: Date.now() }
    });
    state.showToast(
      `HTTP Tester disiapkan (${spec.method} • ${spec.formFields.length} field terdeteksi dari ${tab.title})`
    );
  },

  consumePendingHttpEndpointDraft: () => {
    const cur = get().pendingHttpEndpointDraft;
    if (!cur) return null;
    set({ pendingHttpEndpointDraft: null });
    const { token: _token, ...rest } = cur;
    return rest;
  },

  switchModuleCompanion: async () => {
    const state = get();
    const tab = state.tabs.find((t) => t.id === state.activeTabId);
    if (!tab || tab.kind !== 'code') return;

    if (tab.remoteConnectionId && !state.remoteFilesIndexByConn[tab.remoteConnectionId]?.length) {
      void state.refreshRemoteFilesIndex(tab.remoteConnectionId);
    }

    const candidates = buildCompanionCandidatesFromStore({
      fileTree: state.fileTree,
      connections: state.connections,
      selectedConnectionId: tab.remoteConnectionId ?? state.selectedConnectionId,
      remoteEntries: state.remoteEntries,
      remoteFilesIndexByConn: state.remoteFilesIndexByConn,
      tabs: state.tabs
    });

    const companions = findModuleCompanions(
      tab.relativePath,
      tab.remoteConnectionId ? 'remote' : 'local',
      candidates
    );
    if (companions.length <= 1) {
      state.showToast('Tidak ditemukan file pasangan modul lainnya untuk file ini.');
      return;
    }

    const curIdx = companions.findIndex((c) => c.isCurrent);
    const nextComp = companions[(curIdx >= 0 ? curIdx + 1 : 0) % companions.length];
    if (!nextComp) return;

    if (nextComp.source === 'remote' && nextComp.connectionId) {
      await state.openRemoteFileInTab(nextComp.connectionId, nextComp.relativePath);
    } else if (nextComp.localPath) {
      await state.openFileInTab(nextComp.localPath, nextComp.relativePath);
    }
  },

  openTableDesigner: (opts) => {
    set({ tableDesignerTarget: opts });
  },

  closeTableDesigner: () => {
    set({ tableDesignerTarget: null });
  },

  dismissSaveGuard: () => {
    set({ pendingSaveGuard: null });
  },

  confirmSaveGuardForce: async () => {
    const guard = get().pendingSaveGuard;
    if (!guard) return;
    set({ pendingSaveGuard: null });
    await get().saveTab(guard.tabId, true);
  },

  cleanAndSaveGuard: async () => {
    const guard = get().pendingSaveGuard;
    if (!guard) return;
    const cleaned = stripAutoRemovableDebugTraps(guard.contentToSave, guard.hazards);
    set((s) => ({
      pendingSaveGuard: null,
      tabs: s.tabs.map((t) => (t.id === guard.tabId ? { ...t, content: cleaned } : t))
    }));
    // Wait a microtask so editor buffer syncs cleaned content before saving
    await new Promise((r) => setTimeout(r, 25));
    await get().saveTab(guard.tabId, true);
  },

  openSmartRefactor: (req) => {
    set({ smartRefactorRequest: req });
  },

  closeSmartRefactor: () => {
    set({ smartRefactorRequest: null });
  },

  togglePinFile: (entry) => {
    const cur = get().pinnedFiles;
    const exists = cur.some((p) => p.key === entry.key);
    const next: PinnedFileEntry[] = exists
      ? cur.filter((p) => p.key !== entry.key)
      : [{ ...entry, pinnedAt: new Date().toISOString() }, ...cur].slice(0, 40);
    try {
      localStorage.setItem(LS_PINNED_FILES, JSON.stringify(next));
    } catch {
      // Ignore
    }
    set({ pinnedFiles: next });
    get().showToast(
      exists
        ? `Dilepas dari Pin Favorit: ${entry.name}`
        : `⭐ Disematkan ke Pin Favorit Island: ${entry.name}`
    );
  },

  togglePinActiveTab: (tabId) => {
    const state = get();
    const targetId = tabId ?? state.activeTabId;
    const tab = state.tabs.find((t) => t.id === targetId);
    if (!tab || tab.kind !== 'code') return;

    if (tab.remoteConnectionId) {
      const cleanRel = normalizeRemoteRelPath(tab.relativePath);
      const name = cleanRel.split('/').pop() || cleanRel;
      state.togglePinFile({
        key: `remote:${tab.remoteConnectionId}:${cleanRel}`,
        source: 'remote',
        name,
        relativePath: cleanRel,
        connectionId: tab.remoteConnectionId,
        connectionName: tab.remoteConnectionName || 'Server'
      });
    } else {
      const name = tab.filePath.split(/[/\\]/).pop() || tab.title;
      state.togglePinFile({
        key: `local:${tab.filePath}`,
        source: 'local',
        name,
        relativePath: tab.relativePath,
        localPath: tab.filePath
      });
    }
  },

  saveCurrentTabsAsSession: (name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const state = get();
    const codeTabs = dedupeEditorTabs(state.tabs).filter((t) => t.kind === 'code');
    if (codeTabs.length === 0) {
      state.showToast('Buka minimal 1 tab file sebelum menyimpan Sesi Tugas.');
      return;
    }

    const session: SavedTabSession = {
      id: `sess-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: trimmed,
      createdAt: new Date().toISOString(),
      connectionId: state.selectedConnectionId,
      tabs: codeTabs.map((t) => ({
        source: t.remoteConnectionId ? 'remote' : 'local',
        filePath: t.filePath,
        relativePath: t.remoteConnectionId
          ? normalizeRemoteRelPath(t.relativePath)
          : t.relativePath,
        connectionId: t.remoteConnectionId,
        cursorLine: t.cursorLine
      }))
    };

    const next = [
      session,
      ...state.savedTabSessions.filter(
        (s) => s.name.toLowerCase() !== trimmed.toLowerCase()
      )
    ].slice(0, 20);

    try {
      localStorage.setItem(LS_TAB_SESSIONS, JSON.stringify(next));
    } catch {
      // Ignore
    }
    set({ savedTabSessions: next });
    state.showToast(`📌 Sesi Tugas "${trimmed}" disimpan (${session.tabs.length} tab).`);
  },

  restoreTabSession: async (sessionId, closeCurrentFirst = false) => {
    const state = get();
    const session = state.savedTabSessions.find((s) => s.id === sessionId);
    if (!session) return;

    if (closeCurrentFirst) {
      const hasDirty = state.tabs.some((t) => t.content !== t.savedContent);
      if (!hasDirty) {
        set({ tabs: [], activeTabId: null });
      }
    }

    if (
      session.connectionId &&
      session.connectionId !== state.selectedConnectionId &&
      state.connections.some((c) => c.id === session.connectionId)
    ) {
      await get().selectConnection(session.connectionId);
    }

    for (const item of session.tabs) {
      try {
        if (item.source === 'remote' && item.connectionId) {
          await get().openRemoteFileInTab(
            item.connectionId,
            item.relativePath,
            item.cursorLine
          );
        } else if (item.filePath) {
          await get().openFileInTab(item.filePath, item.relativePath, item.cursorLine);
        }
      } catch {
        // Skip deleted/unreachable files
      }
    }
    get().showToast(`📌 Sesi Tugas "${session.name}" dibuka (${session.tabs.length} file).`);
  },

  deleteTabSession: (sessionId) => {
    const next = get().savedTabSessions.filter((s) => s.id !== sessionId);
    try {
      localStorage.setItem(LS_TAB_SESSIONS, JSON.stringify(next));
    } catch {
      // Ignore
    }
    set({ savedTabSessions: next });
  },

  openReportGenerator: (draft) => {
    set({ reportGeneratorDraft: draft });
  },

  closeReportGenerator: () => {
    set({ reportGeneratorDraft: null });
  },

  refreshSavedQueries: async () => {
    try {
      const list = await window.aptana.db.listSavedQueries();
      set({ savedSqlQueries: list });
    } catch {
      // Ignore
    }
  },

  saveSqlQueryItem: async (payload) => {
    const saved = await window.aptana.db.saveQuery(payload);
    const list = await window.aptana.db.listSavedQueries();
    set({ savedSqlQueries: list });
    get().showToast(`💾 Query disimpan: "${saved.name}"`);
    return saved;
  },

  deleteSavedSqlQueryItem: async (id) => {
    await window.aptana.db.deleteSavedQuery(id);
    const list = await window.aptana.db.listSavedQueries();
    set({ savedSqlQueries: list });
    get().showToast('Query tersimpan dihapus.');
  },

  toggleFavoriteSavedQuery: async (id) => {
    const target = get().savedSqlQueries.find((q) => q.id === id);
    if (!target) return;
    await window.aptana.db.saveQuery({
      ...target,
      isFavorite: !target.isFavorite
    });
    const list = await window.aptana.db.listSavedQueries();
    set({ savedSqlQueries: list });
  },

  exportSavedSqlQueries: async () => {
    const res = await window.aptana.db.exportSavedQueries();
    if (!res.canceled && res.filePath) {
      get().showToast(`📤 ${res.count} query tersimpan diekspor ke: ${res.filePath}`);
    }
  },

  importSavedSqlQueries: async () => {
    const res = await window.aptana.db.importSavedQueries();
    if (!res.canceled) {
      set({ savedSqlQueries: res.items });
      get().showToast(`📥 ${res.importedCount} query berhasil diimpor ke Pustaka!`);
    }
  },

  recordSqlExecutionHistory: (entry) => {
    const cleanSql = entry.sql.trim();
    if (!cleanSql) return;
    const normNew = cleanSql.replace(/\s+/g, ' ').toLowerCase();
    const cur = get().sqlQueryHistory;
    const nextItem: SqlExecutionHistoryItem = {
      id: `qhist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      sql: cleanSql,
      profileId: entry.profileId,
      database: entry.database,
      rowCount: entry.rowCount,
      durationMs: entry.durationMs,
      executedAt: new Date().toISOString()
    };
    const deduped = [
      nextItem,
      ...cur.filter((h) => h.sql.replace(/\s+/g, ' ').toLowerCase() !== normNew)
    ].slice(0, 50);
    try {
      localStorage.setItem(LS_SQL_QUERY_HISTORY, JSON.stringify(deduped));
    } catch {
      // Ignore
    }
    set({ sqlQueryHistory: deduped });
  },

  clearSqlExecutionHistory: () => {
    try {
      localStorage.removeItem(LS_SQL_QUERY_HISTORY);
    } catch {
      // Ignore
    }
    set({ sqlQueryHistory: [] });
  },

  openSavedQueryInVisualBuilder: (item) => {
    set({
      pendingVisualSavedQuery: item,
      dbArchitectTab: 'join'
    });
    const st = get();
    const targetProfId = item.profileId || st.selectedDbProfileId;
    if (
      targetProfId &&
      !st.dbSchemaLoading &&
      (!st.dbSchema ||
        st.dbSchema.profileId !== targetProfId ||
        (item.database &&
          st.dbSchema.currentDatabase.toLowerCase() !== item.database.toLowerCase()))
    ) {
      void st.loadDbSchema(targetProfId, item.database);
    }
  },

  consumePendingVisualSavedQuery: () => {
    const cur = get().pendingVisualSavedQuery;
    if (!cur) return null;
    set({ pendingVisualSavedQuery: null });
    return cur;
  },

  setDbRoutinesModalOpen: (open) => set({ dbRoutinesModalOpen: open }),

  openDbSeeder: (table) => {
    const fallbackTbl = table ?? get().dbSchema?.tables[0] ?? null;
    set({ dbSeederModalOpen: true, dbSeederTargetTable: fallbackTbl });
  },

  closeDbSeeder: () => set({ dbSeederModalOpen: false, dbSeederTargetTable: null }),

  setReleasePatchModalOpen: (open) => set({ releasePatchModalOpen: open }),

  setDbSchedulerModalOpen: (open) => set({ dbSchedulerModalOpen: open }),

  setAuditModalOpen: (open) => set({ auditModalOpen: open }),

  openExcelImportModal: (targetTable) => {
    const fallbackTbl = targetTable ?? get().dbSchema?.tables[0]?.name ?? null;
    set({ excelImportModalOpen: true, excelImportTargetTable: fallbackTbl });
  },

  closeExcelImportModal: () =>
    set({ excelImportModalOpen: false, excelImportTargetTable: null }),

  setDbGlobalSearchModalOpen: (open) => set({ dbGlobalSearchModalOpen: open }),

  setSecurityScannerModalOpen: (open) => set({ securityScannerModalOpen: open }),
  setDbRbacModalOpen: (open) => set({ dbRbacModalOpen: open }),
  setDocsModalOpen: (open) => set({ docsModalOpen: open }),
  setAppUpdateState: (next) => {
    const prev = get().appUpdateState;
    const shouldReopenBanner =
      (next.phase === 'available' &&
        (prev.phase !== 'available' || prev.latestVersion !== next.latestVersion)) ||
      (next.phase === 'downloaded' && prev.phase !== 'downloaded');
    set((s) => ({
      appUpdateState: next,
      updateBannerDismissed: shouldReopenBanner ? false : s.updateBannerDismissed
    }));
  },
  dismissUpdateBanner: () => set({ updateBannerDismissed: true }),
  checkForAppUpdates: async (silent = false) => {
    if (!silent) {
      set({ updateBannerDismissed: false });
    }
    try {
      const st = await window.aptana.updater.checkForUpdates();
      get().setAppUpdateState(st);
      if (!silent) {
        if (st.phase === 'available' && st.latestVersion) {
          get().showToast(`Pembaruan HMW Studio v${st.latestVersion} tersedia dari GitHub!`);
        } else if (st.phase === 'up-to-date') {
          get().showToast(`HMW Studio v${st.currentVersion} sudah merupakan versi terbaru.`);
        } else if (st.phase === 'error') {
          get().showToast(`Gagal memeriksa pembaruan: ${st.errorMessage || 'Periksa koneksi internet.'}`);
        }
      }
      return st;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!silent) {
        get().showToast(`Gagal memeriksa pembaruan: ${msg}`);
      }
      return null;
    }
  },
  downloadAppUpdate: async () => {
    set({ updateBannerDismissed: false });
    try {
      const st = await window.aptana.updater.downloadUpdate();
      set({ appUpdateState: st });
      if (st.phase === 'error') {
        get().showToast(`Gagal mengunduh pembaruan: ${st.errorMessage || 'Coba unduh manual dari GitHub.'}`);
      } else if (!st.canAutoInstall) {
        get().showToast('Halaman unduhan GitHub Release dibuka di browser.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      get().showToast(`Gagal mengunduh pembaruan: ${msg}`);
    }
  },
  installAppUpdate: async () => {
    try {
      await window.aptana.updater.quitAndInstall();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      get().showToast(`Gagal memasang pembaruan: ${msg}`);
    }
  },
  openAppReleasePage: async () => {
    try {
      await window.aptana.updater.openReleasePage();
    } catch {
      // ignore
    }
  },
  handleXdebugEvent: (evt) => {
    if (evt.type === 'state' && evt.state) {
      const prev = get().xdebugState;
      set({ xdebugState: evt.state });
      if (evt.state.status === 'break' && (evt.state.pausedFile !== prev.pausedFile || evt.state.pausedLine !== prev.pausedLine)) {
        set({ bottomPanelOpen: true, activeBottomTab: 'xdebug' });
      }
    } else if (evt.type === 'log' && evt.message) {
      const ts = new Date().toLocaleTimeString('id-ID');
      set((s) => ({ xdebugLogs: [...s.xdebugLogs.slice(-149), `[${ts}] ${evt.message}`] }));
    } else if (evt.type === 'eval-result' && evt.evalExpr !== undefined) {
      const ts = new Date().toLocaleTimeString('id-ID');
      set((s) => ({
        xdebugEvalHistory: [
          ...s.xdebugEvalHistory.slice(-49),
          { expr: evt.evalExpr!, result: evt.evalResult ?? '', ts }
        ]
      }));
    }
  },
  toggleXdebugBreakpoint: (filePath, line) => {
    const cur = get().xdebugBreakpoints;
    const norm = filePath.replace(/\\/g, '/').toLowerCase();
    const exists = cur.find(
      (b) => b.filePath.replace(/\\/g, '/').toLowerCase() === norm && b.line === line
    );
    const next = exists
      ? cur.filter((b) => b.id !== exists.id)
      : [
          ...cur,
          {
            id: `bp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            filePath,
            line,
            enabled: true
          }
        ];
    set({ xdebugBreakpoints: next });
    void window.aptana.xdebug.syncBreakpoints(next);
  },
  clearXdebugBreakpoints: () => {
    set({ xdebugBreakpoints: [] });
    void window.aptana.xdebug.syncBreakpoints([]);
  },
  clearXdebugLogs: () => set({ xdebugLogs: [], xdebugEvalHistory: [] })
}));
