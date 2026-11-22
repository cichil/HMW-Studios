import type { TableRowDiffReport } from './dbRowDiffEngine';
import type { DbHealthSnapshot } from './mysqlHealthAnalyzer';
import type { VisualExplainReport } from './mysqlExplainVisualizer';
import type { DbRbacSnapshot } from './dbRbacAnalyzer';
import type { ProjectSecurityScanReport } from './projectSecurityScanner';
import type { ParsedXlsxWorkbook } from './xlsxReader';
import type { HttpCollectionWorkspace } from './apiCollectionEngine';
import type { MultiSshExecItemResult, SshSnippetItem } from './sshSnippetsCatalog';
import type { XdebugBreakpointItem, XdebugInitInfo, XdebugStackFrame, XdebugVariableItem } from './xdebugProtocol';
import type { AppUpdateStateDto } from './appUpdaterHelpers';

export type { AppUpdateStateDto };

export interface XdebugPathMappingDto {
  remoteRoot: string;
  localRoot: string;
}

export interface XdebugSessionStateDto {
  listening: boolean;
  port: number;
  connected: boolean;
  status: 'idle' | 'listening' | 'running' | 'break' | 'stopping';
  initInfo: XdebugInitInfo | null;
  pausedFile: string | null;
  pausedLine: number | null;
  stack: XdebugStackFrame[];
  locals: XdebugVariableItem[];
  superglobals: XdebugVariableItem[];
  pathMapping: XdebugPathMappingDto;
  lastError: string | null;
}

export interface XdebugEventDto {
  type: 'state' | 'log' | 'eval-result';
  state?: XdebugSessionStateDto;
  message?: string;
  evalExpr?: string;
  evalResult?: string;
}

export interface ExportHmwPackPayload {
  passphrase: string;
  includeConnections: boolean;
  includeDbProfiles: boolean;
  includeSavedQueries: boolean;
  includeHttpCollections: boolean;
  includeSshSnippets: boolean;
  includeSecrets: boolean;
}

export interface ExportHmwPackResult {
  canceled: boolean;
  filePath?: string;
  counts?: {
    connections: number;
    dbProfiles: number;
    savedQueries: number;
    httpRequests: number;
    sshSnippets: number;
  };
}

export interface ImportHmwPackResult {
  canceled: boolean;
  filePath?: string;
  imported?: {
    connections: number;
    dbProfiles: number;
    savedQueries: number;
    httpRequests: number;
    sshSnippets: number;
  };
}

export type ThemeId = 'aptana-dark' | 'modern-dark' | 'modern-light';

export interface FileNode {
  name: string;
  path: string;
  relativePath: string;
  isDirectory: boolean;
  size: number;
  mtimeMs: number;
  extension: string;
  children?: FileNode[];
}

export interface FileReadResult {
  path: string;
  content: string;
  size: number;
  mtimeMs: number;
  encoding: string;
  isBinary: boolean;
}

export interface SearchMatch {
  filePath: string;
  relativePath: string;
  line: number;
  column: number;
  lineText: string;
}

export type ConnectionProtocol = 'sftp' | 'ftps' | 'ftp' | 'local';
export type ConnectionAuthType = 'password' | 'privateKey' | 'none';

export interface ConnectionProfile {
  id: string;
  name: string;
  protocol: ConnectionProtocol;
  host: string;
  port: number;
  username: string;
  remotePath: string;
  authType: ConnectionAuthType;
  privateKeyPath?: string;
  passive?: boolean;
  rejectUnauthorized?: boolean;
  keepSynchronized: boolean;
  isProduction?: boolean;
  ignorePatterns: string[];
  hasSavedSecret?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectionSavePayload {
  profile: Omit<ConnectionProfile, 'id' | 'createdAt' | 'updatedAt' | 'hasSavedSecret'> & {
    id?: string;
  };
  password?: string;
  passphrase?: string;
}

export interface RemoteEntry {
  name: string;
  path: string;
  relativePath: string;
  isDirectory: boolean;
  size: number;
  mtimeMs: number;
  permissions?: string;
}

export interface RemoteFileIndexItem {
  name: string;
  relativePath: string;
  size: number;
  mtimeMs: number;
}

export interface RemoteSearchMatch {
  connectionId: string;
  relativePath: string;
  line: number;
  column: number;
  lineText: string;
}

export interface FileHistoryEntry {
  id: string;
  fileKey: string;
  label: string;
  sourceKind: 'local' | 'remote';
  displayPath: string;
  connectionId?: string;
  relativePath: string;
  timestamp: string;
  size: number;
}

export type SyncMode = 'push' | 'pull' | 'bidirectional';

export type SyncItemStatus =
  | 'upload-new'
  | 'upload-modified'
  | 'download-new'
  | 'download-modified'
  | 'conflict'
  | 'identical';

export type SyncAction = 'upload' | 'download' | 'skip';

export interface SyncDiffItem {
  relativePath: string;
  status: SyncItemStatus;
  action: SyncAction;
  localSize?: number;
  localMtimeMs?: number;
  remoteSize?: number;
  remoteMtimeMs?: number;
}

export interface SyncPlan {
  connectionId: string;
  connectionName: string;
  workspacePath: string;
  remoteRootPath: string;
  mode: SyncMode;
  generatedAt: string;
  items: SyncDiffItem[];
  identicalCount: number;
  ignoredCount: number;
}

export interface SyncExecutionResult {
  uploaded: number;
  downloaded: number;
  skipped: number;
  failed: number;
  errors: Array<{ relativePath: string; error: string }>;
  durationMs: number;
}

export interface TransferLogEntry {
  id: string;
  timestamp: string;
  connectionId: string;
  connectionName: string;
  direction: 'upload' | 'download' | 'info' | 'error';
  relativePath: string;
  status: 'running' | 'success' | 'error';
  message: string;
}

export type TerminalShellKind = 'default' | 'powershell' | 'cmd' | 'git-bash' | 'wsl';

export interface TerminalCreateOptions {
  kind: 'local' | 'ssh';
  shell?: TerminalShellKind;
  cwd?: string;
  connectionId?: string;
  cols?: number;
  rows?: number;
}

export interface TerminalSessionInfo {
  id: string;
  title: string;
  kind: 'local' | 'ssh';
  backend: string;
  cwd?: string;
  connectionId?: string;
}

export type RubleScope =
  | 'global'
  | 'html'
  | 'css'
  | 'javascript'
  | 'typescript'
  | 'php'
  | 'python'
  | 'json'
  | 'markdown';

export interface RubleSnippet {
  id: string;
  trigger: string;
  name: string;
  scope: RubleScope;
  description: string;
  body: string;
}

export interface RubleCommand {
  id: string;
  name: string;
  description: string;
  commandLine: string;
  shortcut?: string;
}

export interface RubleBundle {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  builtIn: boolean;
  snippets: RubleSnippet[];
  commands: RubleCommand[];
}

export interface GitFileChange {
  path: string;
  status: 'M' | 'A' | 'D' | 'R' | 'U' | '?';
  staged: boolean;
}

export interface GitCommitInfo {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
}

export interface GitStatusSummary {
  isRepo: boolean;
  branch: string;
  branches: string[];
  ahead: number;
  behind: number;
  changes: GitFileChange[];
  recentCommits: GitCommitInfo[];
}

export interface PreviewServerState {
  running: boolean;
  port: number;
  url: string;
  workspacePath: string;
}

export interface WorkspaceChangeEvent {
  eventType: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';
  path: string;
  relativePath: string;
}

export interface SavedProjectTab {
  kind: 'local' | 'remote';
  filePath: string;
  relativePath: string;
  remoteConnectionId?: string;
}

export interface SavedProject {
  id: string;
  name: string;
  notes?: string;
  workspacePath: string | null;
  connectionId: string | null;
  remoteSubPath: string;
  openTabs: SavedProjectTab[];
  activeTabKey?: string | null;
  projectFilePath?: string;
  lastOpenedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSavePayload {
  id?: string;
  name: string;
  notes?: string;
  workspacePath: string | null;
  connectionId: string | null;
  remoteSubPath: string;
  openTabs: SavedProjectTab[];
  activeTabKey?: string | null;
  projectFilePath?: string;
}

export interface PhpParamMeta {
  name: string;
  type?: string;
  optional?: boolean;
  defaultValue?: string;
}

export interface PhpFunctionMeta {
  name: string;
  params: PhpParamMeta[];
  returnType?: string;
  extension?: string;
  doc?: string;
  filePath?: string;
  relativePath?: string;
  line?: number;
  origin?: 'builtin' | 'wisanggeni' | 'laravel' | 'workspace';
}

export interface PhpClassMemberMeta {
  name: string;
  kind: 'method' | 'property' | 'constant';
  isStatic?: boolean;
  params?: PhpParamMeta[];
  type?: string;
  doc?: string;
  line?: number;
}

export interface PhpClassMeta {
  name: string;
  extendsClass?: string;
  members: PhpClassMemberMeta[];
  constructorParams?: PhpParamMeta[];
  doc?: string;
  filePath?: string;
  relativePath?: string;
  line?: number;
  origin?: 'builtin' | 'wisanggeni' | 'laravel' | 'workspace';
}

export interface LaravelBladeDirectiveMeta {
  name: string;
  insertText: string;
  detail: string;
  doc: string;
  hasArguments?: boolean;
}

export interface LaravelValidationRuleMeta {
  name: string;
  insertText: string;
  detail: string;
  doc: string;
}

export interface LaravelRouteEntry {
  name: string;
  method?: string;
  uri?: string;
  action?: string;
  relativePath?: string;
  line?: number;
}

export interface LaravelViewEntry {
  name: string;
  relativePath: string;
  filePath: string;
}

export interface LaravelConfigEntry {
  key: string;
  relativePath?: string;
  doc?: string;
}

export interface LaravelCatalog {
  isLaravelProject: boolean;
  laravelVersion: string | null;
  workspacePath: string | null;
  classes: PhpClassMeta[];
  functions: PhpFunctionMeta[];
  bladeDirectives: LaravelBladeDirectiveMeta[];
  validationRules: LaravelValidationRuleMeta[];
  routes: LaravelRouteEntry[];
  views: LaravelViewEntry[];
  configKeys: LaravelConfigEntry[];
  envKeys: string[];
  translationKeys: string[];
  middlewareAliases: string[];
  stats: {
    classCount: number;
    methodCount: number;
    helperCount: number;
    directiveCount: number;
    routeCount: number;
    viewCount: number;
    modelCount: number;
    configKeyCount: number;
  };
}

export interface WisanggeniGuideEntry {
  title: string;
  syntax?: string;
  description: string;
  example?: string;
}

export interface WisanggeniCatalog {
  available: boolean;
  rootPath: string | null;
  apiSynced: boolean;
  apiEndpoint?: string | null;
  classes: PhpClassMeta[];
  functions: PhpFunctionMeta[];
  globalVarTypes: Record<string, string>;
  guides: WisanggeniGuideEntry[];
  stats: {
    classCount: number;
    methodCount: number;
    propertyCount: number;
    functionCount: number;
    docCount: number;
  };
}

export interface PhpRuntimeCatalog {
  available: boolean;
  phpVersion: string;
  phpBinary: string | null;
  functions: PhpFunctionMeta[];
  classes: PhpClassMeta[];
  constants: string[];
}

export interface PhpLintDiagnostic {
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning';
}

export interface PhpLocalAutoFixResult {
  fixed: boolean;
  fixedCode?: string;
  explanation: string;
  appliedFixes: string[];
  durationMs: number;
  remainingError?: string;
}

export interface PhpSnippetRunResult {
  available: boolean;
  phpVersion: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface PhpWorkspaceSymbols {
  functions: PhpFunctionMeta[];
  classes: PhpClassMeta[];
  arrayKeys: string[];
}

export type GeminiModelId =
  | 'gemini-4-hydrogen'
  | 'gemini-4-argon'
  | 'gemini-4-carbon'
  | 'gemini-3.5-flash-lite';

export interface GeminiConfigSummary {
  hasApiKey: boolean;
  apiKeySource: 'vault' | 'env' | 'none';
  maskedKey: string;
  model: GeminiModelId;
  ghostTextEnabled: boolean;
  ghostTextModel: GeminiModelId;
}

export interface GeminiConfigSavePayload {
  apiKey?: string;
  clearApiKey?: boolean;
  model?: GeminiModelId;
  ghostTextEnabled?: boolean;
  ghostTextModel?: GeminiModelId;
}

export interface GeminiChatRequest {
  prompt: string;
  previousInteractionId?: string | null;
  activeFile?: {
    title: string;
    relativePath: string;
    language: string;
    content: string;
    selectedCode?: string;
    isRemote?: boolean;
    connectionName?: string;
  } | null;
  wisanggeniContextSummary?: string | null;
}

export interface GeminiChatResponse {
  interactionId: string;
  text: string;
  model: string;
}

export interface GeminiWisanggeniCrudRequest {
  moduleName: string;
  moduleTitle: string;
  sqlOrSpec: string;
  subFolderHint?: string;
}

export interface GeminiWisanggeniCrudResponse {
  idxFileName: string;
  idxContent: string;
  formFileName: string;
  formContent: string;
  saveFileName: string;
  saveContent: string;
  explanation: string;
}

export interface GeminiInlineTransformRequest {
  selectedCode: string;
  fullFileContent: string;
  instruction: string;
  language: string;
  fileName: string;
}

export interface GeminiInlineTransformResponse {
  transformedCode: string;
  explanation: string;
}

export interface GeminiFixErrorRequest {
  code: string;
  errorText: string;
  language: string;
  fileName: string;
}

export interface GeminiFixErrorResponse {
  fixedCode: string;
  explanation: string;
}

export interface GeminiSqlAuditRequest {
  mode: 'generate-sql' | 'explain-sql' | 'security-audit';
  input: string;
  fileName?: string;
}

export interface GeminiSqlAuditResponse {
  markdownReport: string;
  suggestedCode: string;
}

export interface GeminiDocGenRequest {
  code: string;
  fileName: string;
  targetSymbol?: string;
}

export interface GeminiDocGenResponse {
  markdownDoc: string;
  phpDocComment: string;
  wisanggeniSqlInsert: string;
}

export interface GeminiInlineCompletionRequest {
  prefix: string;
  suffix: string;
  language: string;
  fileName: string;
}

export interface GeminiSummarizeChangesRequest {
  mode: 'commit-message' | 'deploy-summary';
  changesText: string;
}

export interface GeminiSummarizeChangesResponse {
  commitMessage: string;
  summaryMarkdown: string;
}

export type DesktopIslandMode = 'auto' | 'always' | 'off';

export type RemoteConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error';

export type IslandTone =
  | 'neutral'
  | 'sync'
  | 'ai'
  | 'success'
  | 'error'
  | 'warning'
  | 'command'
  | 'preview';

export type IslandActionType =
  | 'jump-error'
  | 'open-ai'
  | 'open-transfers'
  | 'open-terminal'
  | 'open-output'
  | 'open-logs'
  | 'open-db'
  | 'open-http'
  | 'open-preview'
  | 'save-all'
  | 'open-sync'
  | 'edit-connection'
  | 'retry-connection';

export type DbEngine = 'mysql' | 'postgres';

export interface DatabaseProfile {
  id: string;
  name: string;
  engine: DbEngine;
  host: string;
  port: number;
  username: string;
  database: string;
  ssl?: boolean;
  sshTunnelConnectionId?: string;
  isProduction?: boolean;
  hasSavedSecret?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DatabaseSavePayload {
  profile: Omit<DatabaseProfile, 'id' | 'createdAt' | 'updatedAt' | 'hasSavedSecret'> & {
    id?: string;
  };
  password?: string;
}

export interface DbColumnMeta {
  name: string;
  dataType: string;
  columnType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  defaultValue?: string | null;
  extra?: string;
}

export interface DbForeignKeyMeta {
  column: string;
  referencedSchema?: string;
  referencedTable: string;
  referencedColumn: string;
  constraintName?: string;
}

export interface DbTableMeta {
  name: string;
  schema?: string;
  kind: 'table' | 'view';
  rowEstimate?: number;
  columns: DbColumnMeta[];
  primaryKeys: string[];
  foreignKeys?: DbForeignKeyMeta[];
}

export interface DbSchemaSnapshot {
  profileId: string;
  profileName: string;
  engine: DbEngine;
  currentDatabase: string;
  databases: string[];
  tables: DbTableMeta[];
  allTables?: DbTableMeta[];
  loadedAt: string;
}

export interface DbQueryResult {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  affectedRows?: number;
  insertId?: number | string;
  durationMs: number;
  truncated?: boolean;
  editableTable?: {
    database: string;
    table: string;
    primaryKeys: string[];
  } | null;
  message?: string;
}

export interface DbCellUpdatePayload {
  database?: string;
  table: string;
  primaryKeyValues: Record<string, unknown>;
  column: string;
  newValue: unknown;
}

export interface DbInsertRowPayload {
  database?: string;
  table: string;
  values: Record<string, unknown>;
}

export interface DbDeleteRowPayload {
  database?: string;
  table: string;
  primaryKeyValues: Record<string, unknown>;
}

export interface DbExcelExportPayload {
  defaultFileName: string;
  sheetName?: string;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  openAfterSave?: boolean;
}

export interface DbExcelExportResult {
  canceled: boolean;
  filePath?: string;
  rowCount: number;
  byteSize?: number;
}

export interface DbSqlDumpPayload {
  database?: string;
  tables?: string[];
  includeSchema?: boolean;
  includeData?: boolean;
  maxRowsPerTable?: number;
}

export interface DbSqlDumpResult {
  canceled: boolean;
  filePath?: string;
  tablesExported: number;
  rowsExported: number;
  sqlPreview?: string;
}

export interface DbCsvImportPayload {
  database?: string;
  table: string;
  csvText?: string;
}

export interface DbCsvImportResult {
  canceled: boolean;
  insertedRows: number;
  columns: string[];
  sourcePath?: string;
}

export interface DbProcessItem {
  id: number | string;
  user: string;
  host: string;
  db: string;
  command: string;
  timeSec: number;
  state: string;
  query: string;
}

export interface DbDataTransferPayload {
  sourceProfileId: string;
  sourceDatabase?: string;
  sourceTable: string;
  whereClause?: string;
  rowLimit?: number;
  targetProfileId: string;
  targetDatabase?: string;
  targetTable: string;
  primaryKeys?: string[];
  writeMode: 'upsert' | 'insert-ignore' | 'truncate-insert';
  columnMasks?: Record<
    string,
    | 'none'
    | 'bcrypt-dummy'
    | 'masked-email'
    | 'masked-phone'
    | 'masked-digits'
    | 'masked-name'
    | 'zero'
  >;
}

export interface DbDataTransferResult {
  rowsRead: number;
  batchesExecuted: number;
  maskedColumnCount: number;
  durationMs: number;
}

export interface PinnedFileEntry {
  key: string;
  source: 'local' | 'remote';
  name: string;
  relativePath: string;
  localPath?: string;
  connectionId?: string;
  connectionName?: string;
  pinnedAt: string;
}

export interface SavedTabSession {
  id: string;
  name: string;
  createdAt: string;
  connectionId?: string | null;
  tabs: Array<{
    source: 'local' | 'remote';
    filePath: string;
    relativePath: string;
    connectionId?: string;
    cursorLine?: number;
  }>;
}

export interface SavedVisualQuerySpec {
  nodes: Array<{
    id: string;
    schema?: string;
    name: string;
    alias: string;
    x: number;
    y: number;
    scrollTop?: number;
    fieldFilter?: string;
  }>;
  links: Array<{
    id: string;
    fromNodeId: string;
    fromColumn: string;
    toNodeId: string;
    toColumn: string;
    joinType: 'INNER JOIN' | 'LEFT JOIN' | 'RIGHT JOIN';
    operator: '=' | '!=' | '<' | '<=' | '>' | '>=';
  }>;
  selectedCols: Array<{
    id?: string;
    tableAlias: string;
    columnName: string;
    aggregate?: '' | 'COUNT' | 'COUNT_DISTINCT' | 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'GROUP_CONCAT';
    outputAlias?: string;
  }>;
  distinct?: boolean;
  autoAliasCollisions?: boolean;
  whereRules?: Array<{
    id: string;
    conjunction: 'AND' | 'OR';
    columnRef: string;
    operator: string;
    value: string;
    enabled?: boolean;
  }>;
  manualWhere?: string;
  groupByColumns?: string[];
  havingClause?: string;
  orderByRules?: Array<{
    id: string;
    columnRef: string;
    direction: 'ASC' | 'DESC';
  }>;
  limit?: number;
  offset?: number;
}

export interface SavedSqlQueryItem {
  id: string;
  name: string;
  folder?: string;
  sql: string;
  profileId?: string;
  database?: string;
  isFavorite?: boolean;
  visualDiagramSpec?: SavedVisualQuerySpec;
  createdAt: string;
  updatedAt: string;
}

export interface SavedSqlQuerySavePayload {
  id?: string;
  name: string;
  folder?: string;
  sql: string;
  profileId?: string;
  database?: string;
  isFavorite?: boolean;
  visualDiagramSpec?: SavedVisualQuerySpec;
}

export interface SqlExecutionHistoryItem {
  id: string;
  sql: string;
  profileId?: string;
  database?: string;
  rowCount: number;
  durationMs: number;
  executedAt: string;
}

export type DbRoutineKind = 'VIEW' | 'PROCEDURE' | 'FUNCTION' | 'TRIGGER';

export interface DbRoutineParamMeta {
  name: string;
  mode?: 'IN' | 'OUT' | 'INOUT';
  dataType: string;
}

export interface DbRoutineSummary {
  name: string;
  schema?: string;
  kind: DbRoutineKind;
  returnType?: string;
  targetTable?: string;
  triggerTiming?: string;
  triggerEvent?: string;
  params?: DbRoutineParamMeta[];
}

export interface DbScheduleJob {
  id: string;
  name: string;
  kind: 'sql-backup' | 'saved-query-xlsx';
  profileId: string;
  database?: string;
  savedQueryId?: string;
  scheduleType: 'interval' | 'daily';
  intervalMinutes?: number;
  dailyTimeHHMM?: string;
  outputDir: string;
  enabled: boolean;
  lastRunAt?: string | null;
  lastStatus?: 'ok' | 'error' | null;
  lastMessage?: string | null;
  lastOutputPath?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DbScheduleJobSavePayload {
  id?: string;
  name: string;
  kind: 'sql-backup' | 'saved-query-xlsx';
  profileId: string;
  database?: string;
  savedQueryId?: string;
  scheduleType: 'interval' | 'daily';
  intervalMinutes?: number;
  dailyTimeHHMM?: string;
  outputDir: string;
  enabled: boolean;
}

export interface PatchCandidateFileDto {
  relativePath: string;
  sizeBytes: number;
  mtimeMs: number;
  reason: string;
}

export interface BuildReleasePatchPayload {
  workspacePath: string;
  relativePaths: string[];
  releaseTitle?: string;
  migrationSql?: string;
}

export interface BuildReleasePatchResult {
  canceled: boolean;
  filePath?: string;
  fileCount: number;
  byteSize?: number;
}

export interface DbIntrospectProgressEvent {
  profileId: string;
  database?: string;
  phase: 'connecting' | 'databases' | 'tables' | 'columns' | 'relations' | 'done' | 'error';
  percent: number;
  message: string;
}

export interface ServerDiskMount {
  filesystem: string;
  size: string;
  used: string;
  avail: string;
  usePercent: number;
  mountPoint: string;
}

export interface ServerServiceStatus {
  name: string;
  active: boolean;
  detail?: string;
}

export interface ServerHealthSnapshot {
  connectionId: string;
  connectionName: string;
  hostname: string;
  osInfo: string;
  uptimeText: string;
  loadAvg: string;
  cpuCores: number;
  memTotalMb: number;
  memUsedMb: number;
  memAvailableMb: number;
  memUsedPercent: number;
  disks: ServerDiskMount[];
  services: ServerServiceStatus[];
  crontabText: string;
  collectedAt: string;
  latencyMs: number;
}

export interface MultiServerDeployResult {
  totalTargets: number;
  succeeded: Array<{ connectionId: string; connectionName: string; durationMs: number }>;
  failed: Array<{ connectionId: string; connectionName: string; error: string }>;
}

export type EnterpriseAuditKind =
  | 'db-cell-update'
  | 'db-row-delete'
  | 'db-query-mutating'
  | 'db-import'
  | 'sftp-deploy';

export interface EnterpriseAuditEntry {
  id: string;
  timestamp: string;
  kind: EnterpriseAuditKind;
  targetName: string;
  isProduction: boolean;
  database?: string;
  tableOrPath?: string;
  summary: string;
  detail?: string;
  undoSql?: string;
  profileId?: string;
}

export interface DbTabularImportColumnMap {
  sourceHeader: string;
  targetColumn: string;
}

export interface DbTabularImportPayload {
  database?: string;
  table: string;
  mode: 'insert' | 'upsert';
  dryRun: boolean;
  columns: DbTabularImportColumnMap[];
  rows: string[][];
}

export interface DbTabularImportResult {
  dryRun: boolean;
  processedRows: number;
  affectedRows: number;
  durationMs: number;
  committed: boolean;
  errorRowIndex?: number;
  errorMessage?: string;
}

export interface DbValueSearchPayload {
  database?: string;
  needle: string;
  exactMatch?: boolean;
  maxTables?: number;
}

export interface DbValueSearchProgressEvent {
  scannedTables: number;
  totalTables: number;
  currentTable: string;
  hitsSoFar: number;
}

export interface DbValueSearchTableHit {
  schema?: string;
  table: string;
  matchedColumns: string[];
  matchCount: number;
  sampleRows: Array<Record<string, unknown>>;
}

export interface DbDataDictionaryPayload {
  database?: string;
  format: 'html' | 'xlsx';
  organizationName?: string;
  projectTitle?: string;
}

export interface DbDataDictionaryResult {
  canceled: boolean;
  filePath?: string;
  tableCount: number;
  columnCount: number;
}

export interface DbTableRowDiffPayload {
  sourceProfileId: string;
  sourceDatabase?: string;
  sourceTable: string;
  targetProfileId: string;
  targetDatabase?: string;
  targetTable: string;
  primaryKeys?: string[];
  rowLimit?: number;
  includeDeleteMissingInTarget?: boolean;
}

export interface DbMultiQueryResultItem {
  index: number;
  sql: string;
  result?: DbQueryResult;
  error?: string;
}

export interface ProjectSecurityScanPayload {
  scope: 'local' | 'remote';
  workspacePath?: string;
  connectionId?: string;
  maxFiles?: number;
}

export interface GitLineBlameInfo {
  hash: string;
  shortHash: string;
  author: string;
  dateIso: string;
  relativeTime: string;
  summary: string;
}

export interface ConnectionPoolStat {
  connectionId: string;
  protocol: ConnectionProtocol;
  alive: boolean;
  idleMs: number;
  operationsCount: number;
}

export interface LogSourceConfig {
  kind: 'remote' | 'local';
  connectionId?: string;
  filePath: string;
  pollIntervalMs?: number;
}

export interface ParsedLogEntry {
  id: string;
  timestamp: string;
  level: 'fatal' | 'error' | 'warning' | 'info';
  message: string;
  raw: string;
  filePath?: string;
  line?: number;
}

export interface LogMonitorStatus {
  running: boolean;
  source: LogSourceConfig | null;
  lastPolledAt: string | null;
  fileSize: number;
  lastError: string | null;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
export type HttpBodyMode = 'none' | 'urlencoded' | 'json' | 'raw';

export interface HttpKeyValueItem {
  key: string;
  value: string;
  enabled: boolean;
}

export interface HttpSendPayload {
  method: HttpMethod;
  url: string;
  queryParams?: HttpKeyValueItem[];
  headers?: HttpKeyValueItem[];
  cookieSession?: string;
  bodyMode: HttpBodyMode;
  formFields?: HttpKeyValueItem[];
  rawBody?: string;
  insecureTls?: boolean;
  timeoutMs?: number;
  followRedirects?: boolean;
}

export interface SavedHttpRequest extends HttpSendPayload {
  id: string;
  name: string;
  updatedAt: string;
}

export interface HttpResponseData {
  ok: boolean;
  status: number;
  statusText: string;
  durationMs: number;
  sizeBytes: number;
  contentType: string;
  isJson: boolean;
  headers: Record<string, string>;
  body: string;
  finalUrl: string;
  truncated?: boolean;
}

export interface ReplaceInFilesOptions {
  caseSensitive?: boolean;
  includeRelPaths?: string[];
}

export interface ReplaceInFilesResult {
  filesModified: number;
  occurrencesReplaced: number;
  modifiedRelPaths: string[];
  errors: string[];
}

export interface TodoCommentItem {
  filePath: string;
  relativePath: string;
  line: number;
  tag: 'TODO' | 'FIXME' | 'HACK' | 'NOTE';
  text: string;
}

export interface IslandActivity {
  id: string;
  tone: IslandTone;
  badge: string;
  title: string;
  subtitle?: string;
  busy?: boolean;
  actionLabel?: string;
  actionType?: IslandActionType;
  jumpTabId?: string;
  jumpLine?: number;
  timestamp: number;
  durationMs?: number;
}

export interface DesktopIslandSnapshot {
  mode: DesktopIslandMode;
  theme: ThemeId;
  projectName: string | null;
  connectionName: string | null;
  connectionProtocol: string | null;
  connectionStatus: RemoteConnectionStatus;
  connectionError: string | null;
  keepSynchronized: boolean;
  dirtyCount: number;
  phpErrorCount: number;
  firstPhpError: {
    tabId: string;
    fileTitle: string;
    line: number;
    message: string;
  } | null;
  gitBranch: string | null;
  gitChangeCount: number;
  previewRunning: boolean;
  previewPort: number;
  previewUrl: string;
  frameworkBadge: string | null;
  activeActivity: IslandActivity | null;
}

export type DesktopIslandCommand =
  | { type: 'focus-ide' }
  | { type: 'save-all' }
  | { type: 'jump-error'; tabId?: string; line?: number }
  | { type: 'open-sync' }
  | { type: 'edit-connection' }
  | { type: 'retry-connection' }
  | { type: 'open-ai' }
  | { type: 'open-terminal' }
  | { type: 'open-output' }
  | { type: 'open-logs' }
  | { type: 'open-db' }
  | { type: 'open-http' }
  | { type: 'open-transfers' }
  | { type: 'open-preview' }
  | {
      type: 'island-search';
      query?: string;
      mode?: 'all' | 'files' | 'content' | 'symbols';
    }
  | { type: 'set-mode'; mode: DesktopIslandMode };

export type IdeShortcutAction = 'save' | 'save-all' | 'save-project';

export interface LearnedJoinEdgeDto {
  leftSchema?: string;
  leftTable: string;
  leftColumn: string;
  rightSchema?: string;
  rightTable: string;
  rightColumn: string;
  frequency: number;
}

export interface JsFunctionSymbol {
  name: string;
  params: string[];
  isAsync?: boolean;
  kind: 'function' | 'arrow' | 'window';
  doc?: string;
  filePath?: string;
  relativePath?: string;
  line: number;
}

export interface JsClassSymbol {
  name: string;
  methods: Array<{ name: string; params: string[]; isAsync?: boolean; isStatic?: boolean; line: number }>;
  doc?: string;
  filePath?: string;
  relativePath?: string;
  line: number;
}

export interface CssClassSymbol {
  name: string;
  declarationsPreview?: string;
  colorHex?: string;
  fromStylesheet: boolean;
  filePath?: string;
  relativePath?: string;
  line: number;
}

export interface CssVariableSymbol {
  name: string; // e.g. "--bg-primary"
  value: string;
  colorHex?: string;
  filePath?: string;
  relativePath?: string;
  line: number;
}

export interface HtmlIdSymbol {
  id: string;
  tagName?: string;
  filePath?: string;
  relativePath?: string;
  line: number;
}

export interface WebSymbolCatalog {
  jsFunctions: JsFunctionSymbol[];
  jsClasses: JsClassSymbol[];
  cssClasses: CssClassSymbol[];
  cssVariables: CssVariableSymbol[];
  htmlIds: HtmlIdSymbol[];
  jsFiles: string[];
  cssFiles: string[];
}

export interface RemoteWorkspaceIntelPayload {
  connectionId: string;
  connectionName: string;
  scannedFiles: number;
  phpSymbols: PhpWorkspaceSymbols;
  webCatalog: WebSymbolCatalog;
  joinEdges: LearnedJoinEdgeDto[];
}

export interface AptanaBridgeAPI {
  system: {
    getInfo: () => Promise<{
      appName: string;
      appVersion: string;
      electronVersion: string;
      nodeVersion: string;
      platform: string;
      arch: string;
    }>;
    getPathForFile: (file: File) => string;
    onShortcut: (callback: (action: IdeShortcutAction) => void) => () => void;
  };
  workspace: {
    selectFolder: () => Promise<string | null>;
    openFolder: (folderPath: string) => Promise<FileNode[]>;
    closeFolder: () => Promise<void>;
    createSampleProject: (targetDir?: string) => Promise<string>;
    listTree: (folderPath: string) => Promise<FileNode[]>;
    readFile: (filePath: string) => Promise<FileReadResult>;
    writeFile: (filePath: string, content: string) => Promise<{ mtimeMs: number; size: number }>;
    createEntry: (targetPath: string, isDirectory: boolean, initialContent?: string) => Promise<void>;
    renameEntry: (oldPath: string, newPath: string) => Promise<void>;
    deleteEntry: (targetPath: string) => Promise<void>;
    copyOrMoveEntry: (
      sourcePath: string,
      targetDirPath: string,
      mode: 'copy' | 'cut'
    ) => Promise<{ destinationPath: string }>;
    searchInFiles: (folderPath: string, query: string, caseSensitive?: boolean) => Promise<SearchMatch[]>;
    replaceInFiles: (
      folderPath: string,
      query: string,
      replacement: string,
      options?: ReplaceInFilesOptions
    ) => Promise<ReplaceInFilesResult>;
    scanTodos: (folderPath: string) => Promise<TodoCommentItem[]>;
    scanJoinEdges: (folderPath: string) => Promise<LearnedJoinEdgeDto[]>;
    scanWebAssets: (folderPath: string) => Promise<WebSymbolCatalog>;
    onChanged: (callback: (event: WorkspaceChangeEvent) => void) => () => void;
  };
  projects: {
    list: () => Promise<SavedProject[]>;
    save: (payload: ProjectSavePayload) => Promise<SavedProject>;
    remove: (id: string) => Promise<void>;
    touchOpened: (id: string) => Promise<SavedProject | null>;
    exportToFile: (payload: ProjectSavePayload) => Promise<SavedProject | null>;
    openFromFile: (filePath?: string) => Promise<SavedProject | null>;
  };
  connections: {
    list: () => Promise<ConnectionProfile[]>;
    save: (payload: ConnectionSavePayload) => Promise<ConnectionProfile>;
    remove: (id: string) => Promise<void>;
    test: (id: string) => Promise<{ ok: boolean; message: string; latencyMs: number }>;
    listRemoteDir: (id: string, remoteSubPath?: string) => Promise<RemoteEntry[]>;
    readRemoteFile: (id: string, remoteRelativePath: string) => Promise<string>;
    writeRemoteFile: (id: string, remoteRelativePath: string, content: string) => Promise<void>;
    createRemoteEntry: (
      id: string,
      remoteRelativePath: string,
      isDirectory: boolean,
      initialContent?: string
    ) => Promise<void>;
    renameRemoteEntry: (
      id: string,
      oldRelativePath: string,
      newRelativePath: string
    ) => Promise<void>;
    deleteRemoteEntry: (
      id: string,
      remoteRelativePath: string,
      isDirectory: boolean
    ) => Promise<void>;
    chmodRemoteEntry: (
      id: string,
      remoteRelativePath: string,
      modeOctal: string
    ) => Promise<void>;
    uploadMultiplePaths: (
      id: string,
      localPaths: string[],
      targetRemoteSubPath: string
    ) => Promise<{ uploaded: number; errors: string[] }>;
    searchRemoteFiles: (
      id: string,
      remoteSubPath: string,
      query: string,
      caseSensitive?: boolean
    ) => Promise<RemoteSearchMatch[]>;
    listRemoteFilesIndex: (
      id: string,
      remoteSubPath?: string,
      maxFiles?: number
    ) => Promise<RemoteFileIndexItem[]>;
    scanRemoteWorkspaceSymbols: (
      id: string,
      remoteSubPath?: string,
      maxFiles?: number
    ) => Promise<RemoteWorkspaceIntelPayload>;
    getCachedRemoteIndex: (
      id: string
    ) => Promise<{ files: RemoteFileIndexItem[]; intel?: RemoteWorkspaceIntelPayload } | null>;
    uploadSingleFile: (id: string, workspacePath: string, relativePath: string) => Promise<void>;
    downloadSingleFile: (id: string, workspacePath: string, relativePath: string) => Promise<void>;
    downloadEntryToLocalDir: (
      id: string,
      remoteRelativePath: string,
      isDirectory: boolean,
      targetLocalDir: string,
      deleteSourceAfter?: boolean
    ) => Promise<{ downloaded: number; localDestPath: string }>;
    copyOrMoveRemoteEntry: (
      sourceId: string,
      sourceRelativePath: string,
      isDirectory: boolean,
      destId: string,
      targetRemoteSubPath: string,
      mode: 'copy' | 'cut'
    ) => Promise<{ destRelativePath: string; transferred: number }>;
    replaceInRemoteFiles: (
      id: string,
      remoteSubPath: string,
      query: string,
      replacement: string,
      options?: ReplaceInFilesOptions
    ) => Promise<ReplaceInFilesResult>;
    poolStats: () => Promise<ConnectionPoolStat[]>;
    disconnectPool: (id?: string) => Promise<void>;
    broadcastWriteFile: (
      connectionIds: string[],
      remoteRelativePath: string,
      content: string
    ) => Promise<MultiServerDeployResult>;
    inspectServerHealth: (id: string) => Promise<ServerHealthSnapshot>;
    listSshSnippets: () => Promise<SshSnippetItem[]>;
    saveSshSnippet: (
      payload: Omit<SshSnippetItem, 'id' | 'builtIn'> & { id?: string }
    ) => Promise<SshSnippetItem[]>;
    deleteSshSnippet: (id: string) => Promise<SshSnippetItem[]>;
    runSshSnippetMulti: (
      connectionIds: string[],
      command: string
    ) => Promise<MultiSshExecItemResult[]>;
  };
  sync: {
    compare: (connectionId: string, workspacePath: string, mode: SyncMode) => Promise<SyncPlan>;
    execute: (
      connectionId: string,
      workspacePath: string,
      items: SyncDiffItem[]
    ) => Promise<SyncExecutionResult>;
    onTransferLog: (callback: (entry: TransferLogEntry) => void) => () => void;
  };
  terminal: {
    create: (options: TerminalCreateOptions) => Promise<TerminalSessionInfo>;
    write: (id: string, data: string) => Promise<void>;
    resize: (id: string, cols: number, rows: number) => Promise<void>;
    close: (id: string) => Promise<void>;
    runCommand: (commandLine: string, cwd: string) => Promise<{ stdout: string; stderr: string; code: number }>;
    onData: (callback: (payload: { id: string; data: string }) => void) => () => void;
    onExit: (callback: (payload: { id: string; exitCode: number }) => void) => () => void;
  };
  rubles: {
    list: () => Promise<RubleBundle[]>;
    saveSnippet: (snippet: Omit<RubleSnippet, 'id'> & { id?: string }) => Promise<RubleBundle[]>;
    deleteSnippet: (snippetId: string) => Promise<RubleBundle[]>;
    saveCommand: (cmd: Omit<RubleCommand, 'id'> & { id?: string }) => Promise<RubleBundle[]>;
    deleteCommand: (commandId: string) => Promise<RubleBundle[]>;
  };
  git: {
    status: (workspacePath: string) => Promise<GitStatusSummary>;
    init: (workspacePath: string) => Promise<GitStatusSummary>;
    stage: (workspacePath: string, paths: string[]) => Promise<GitStatusSummary>;
    unstage: (workspacePath: string, paths: string[]) => Promise<GitStatusSummary>;
    commit: (workspacePath: string, message: string) => Promise<GitStatusSummary>;
    checkout: (workspacePath: string, branch: string, createNew?: boolean) => Promise<GitStatusSummary>;
    pull: (workspacePath: string) => Promise<{ ok: boolean; summary: string }>;
    push: (workspacePath: string) => Promise<{ ok: boolean; summary: string }>;
    fileDiff: (workspacePath: string, relativePath: string) => Promise<{ original: string; modified: string }>;
    blameLine: (
      workspacePath: string,
      relativePath: string,
      line: number
    ) => Promise<GitLineBlameInfo | null>;
  };
  preview: {
    start: (workspacePath: string) => Promise<PreviewServerState>;
    stop: () => Promise<PreviewServerState>;
    status: () => Promise<PreviewServerState>;
    onReload: (callback: () => void) => () => void;
  };
  php: {
    getCatalog: () => Promise<PhpRuntimeCatalog>;
    lint: (code: string) => Promise<{ available: boolean; diagnostics: PhpLintDiagnostic[] }>;
    autoFixLocal: (code: string) => Promise<PhpLocalAutoFixResult>;
    runSnippet: (code: string, cwd?: string) => Promise<PhpSnippetRunResult>;
    scanWorkspace: (workspacePath: string) => Promise<PhpWorkspaceSymbols>;
    getWisanggeniCatalog: (
      forceRefresh?: boolean,
      customPathOrUrl?: string
    ) => Promise<WisanggeniCatalog>;
    getLaravelCatalog: (workspacePath?: string | null) => Promise<LaravelCatalog>;
  };
  history: {
    list: (fileKey: string) => Promise<FileHistoryEntry[]>;
    getContent: (snapshotId: string) => Promise<string>;
    record: (payload: {
      fileKey: string;
      label: string;
      sourceKind: 'local' | 'remote';
      displayPath: string;
      connectionId?: string;
      relativePath: string;
      content: string;
    }) => Promise<FileHistoryEntry | null>;
    clear: (fileKey: string) => Promise<void>;
  };
  ai: {
    getConfig: () => Promise<GeminiConfigSummary>;
    saveConfig: (payload: GeminiConfigSavePayload) => Promise<GeminiConfigSummary>;
    testConnection: () => Promise<{ ok: boolean; message: string; model: string; latencyMs: number }>;
    chat: (req: GeminiChatRequest) => Promise<GeminiChatResponse>;
    generateWisanggeniCrud: (
      req: GeminiWisanggeniCrudRequest
    ) => Promise<GeminiWisanggeniCrudResponse>;
    inlineTransform: (
      req: GeminiInlineTransformRequest
    ) => Promise<GeminiInlineTransformResponse>;
    fixError: (req: GeminiFixErrorRequest) => Promise<GeminiFixErrorResponse>;
    sqlAndSecurityAudit: (req: GeminiSqlAuditRequest) => Promise<GeminiSqlAuditResponse>;
    generateDocs: (req: GeminiDocGenRequest) => Promise<GeminiDocGenResponse>;
    inlineCompletion: (req: GeminiInlineCompletionRequest) => Promise<string>;
    summarizeChanges: (
      req: GeminiSummarizeChangesRequest
    ) => Promise<GeminiSummarizeChangesResponse>;
  };
  db: {
    list: () => Promise<DatabaseProfile[]>;
    save: (payload: DatabaseSavePayload) => Promise<DatabaseProfile>;
    remove: (id: string) => Promise<void>;
    test: (id: string) => Promise<{ ok: boolean; message: string; latencyMs: number }>;
    getCachedSchema: (id: string, database?: string) => Promise<DbSchemaSnapshot | null>;
    introspect: (id: string, database?: string, forceFull?: boolean) => Promise<DbSchemaSnapshot>;
    onProgress: (cb: (evt: DbIntrospectProgressEvent) => void) => () => void;
    onPartialSchema: (cb: (snap: DbSchemaSnapshot) => void) => () => void;
    query: (
      id: string,
      sql: string,
      database?: string,
      maxRows?: number
    ) => Promise<DbQueryResult>;
    queryMulti: (
      id: string,
      sqlScript: string,
      database?: string,
      maxRows?: number
    ) => Promise<DbMultiQueryResultItem[]>;
    openXlsxWorkbook: () => Promise<{ canceled: boolean; workbook?: ParsedXlsxWorkbook }>;
    importTabular: (
      id: string,
      payload: DbTabularImportPayload
    ) => Promise<DbTabularImportResult>;
    searchValueAcrossDb: (
      id: string,
      payload: DbValueSearchPayload
    ) => Promise<DbValueSearchTableHit[]>;
    onValueSearchProgress: (cb: (evt: DbValueSearchProgressEvent) => void) => () => void;
    exportDataDictionary: (
      id: string,
      payload: DbDataDictionaryPayload
    ) => Promise<DbDataDictionaryResult>;
    diffTableRows: (payload: DbTableRowDiffPayload) => Promise<TableRowDiffReport>;
    updateCell: (id: string, payload: DbCellUpdatePayload) => Promise<{ affectedRows: number }>;
    insertRow: (
      id: string,
      payload: DbInsertRowPayload
    ) => Promise<{ affectedRows: number; insertId?: number | string }>;
    deleteRow: (id: string, payload: DbDeleteRowPayload) => Promise<{ affectedRows: number }>;
    exportExcel: (payload: DbExcelExportPayload) => Promise<DbExcelExportResult>;
    exportSqlDump: (id: string, payload: DbSqlDumpPayload) => Promise<DbSqlDumpResult>;
    importCsv: (id: string, payload: DbCsvImportPayload) => Promise<DbCsvImportResult>;
    listProcesses: (id: string) => Promise<DbProcessItem[]>;
    killProcess: (id: string, processId: number | string) => Promise<{ ok: boolean; message: string }>;
    inspectHealth: (
      id: string,
      database?: string,
      mode?: 'fast' | 'slow-sql' | 'locks' | 'storage'
    ) => Promise<DbHealthSnapshot>;
    optimizeTable: (
      id: string,
      payload: { database?: string; table: string }
    ) => Promise<{ ok: boolean; message: string }>;
    generateTableDdl: (table: DbTableMeta, engine: DbEngine) => Promise<string>;
    transferTableData: (payload: DbDataTransferPayload) => Promise<DbDataTransferResult>;
    listSavedQueries: () => Promise<SavedSqlQueryItem[]>;
    saveQuery: (payload: SavedSqlQuerySavePayload) => Promise<SavedSqlQueryItem>;
    deleteSavedQuery: (id: string) => Promise<void>;
    exportSavedQueries: () => Promise<{ canceled: boolean; filePath?: string; count: number }>;
    importSavedQueries: () => Promise<{
      canceled: boolean;
      importedCount: number;
      items: SavedSqlQueryItem[];
    }>;
    listRoutines: (id: string, database?: string) => Promise<DbRoutineSummary[]>;
    getRoutineDdl: (
      id: string,
      payload: { kind: DbRoutineKind; name: string; database?: string }
    ) => Promise<string>;
    listSchedules: () => Promise<DbScheduleJob[]>;
    saveSchedule: (payload: DbScheduleJobSavePayload) => Promise<DbScheduleJob>;
    deleteSchedule: (id: string) => Promise<void>;
    runScheduleNow: (id: string) => Promise<DbScheduleJob>;
    executeBatchTx: (
      id: string,
      statements: string[],
      database?: string
    ) => Promise<{
      committed: boolean;
      executedCount: number;
      durationMs: number;
      errorMessage?: string;
    }>;
    explainVisual: (
      id: string,
      sql: string,
      database?: string
    ) => Promise<VisualExplainReport>;
    listUsersRbac: (id: string) => Promise<DbRbacSnapshot>;
    applyRbacSql: (
      id: string,
      statements: string[]
    ) => Promise<{ ok: boolean; executedCount: number; message: string }>;
  };
  audit: {
    list: (limit?: number) => Promise<EnterpriseAuditEntry[]>;
    clear: () => Promise<void>;
    exportJson: () => Promise<{ canceled: boolean; filePath?: string }>;
  };
  security: {
    scanProject: (payload: ProjectSecurityScanPayload) => Promise<ProjectSecurityScanReport>;
  };
  patch: {
    scanModified: (workspacePath: string, sinceHours: number) => Promise<PatchCandidateFileDto[]>;
    buildZip: (payload: BuildReleasePatchPayload) => Promise<BuildReleasePatchResult>;
  };
  logs: {
    start: (config: LogSourceConfig) => Promise<LogMonitorStatus>;
    stop: () => Promise<LogMonitorStatus>;
    status: () => Promise<LogMonitorStatus>;
    autoDetectPaths: (
      connectionId?: string | null,
      workspacePath?: string | null
    ) => Promise<LogSourceConfig[]>;
    readSnapshot: (config: LogSourceConfig) => Promise<ParsedLogEntry[]>;
    onEntries: (cb: (entries: ParsedLogEntry[]) => void) => () => void;
    onStatus: (cb: (status: LogMonitorStatus) => void) => () => void;
  };
  http: {
    listSaved: () => Promise<SavedHttpRequest[]>;
    saveRequest: (
      payload: Omit<SavedHttpRequest, 'id' | 'updatedAt'> & { id?: string }
    ) => Promise<SavedHttpRequest>;
    deleteSaved: (id: string) => Promise<void>;
    send: (payload: HttpSendPayload) => Promise<HttpResponseData>;
    getWorkspace: () => Promise<HttpCollectionWorkspace>;
    saveWorkspace: (ws: HttpCollectionWorkspace) => Promise<HttpCollectionWorkspace>;
  };
  xdebug: {
    getState: () => Promise<XdebugSessionStateDto>;
    start: (port?: number, pathMapping?: XdebugPathMappingDto) => Promise<XdebugSessionStateDto>;
    stop: () => Promise<XdebugSessionStateDto>;
    setPathMapping: (mapping: XdebugPathMappingDto) => Promise<XdebugSessionStateDto>;
    syncBreakpoints: (items: XdebugBreakpointItem[]) => Promise<XdebugBreakpointItem[]>;
    continueRun: () => Promise<void>;
    stepOver: () => Promise<void>;
    stepInto: () => Promise<void>;
    stepOut: () => Promise<void>;
    stopSession: () => Promise<void>;
    evalExpression: (expr: string) => Promise<void>;
    onEvent: (cb: (evt: XdebugEventDto) => void) => () => void;
  };
  bundle: {
    exportHmwPack: (payload: ExportHmwPackPayload) => Promise<ExportHmwPackResult>;
    importHmwPack: (passphrase: string) => Promise<ImportHmwPackResult>;
  };
  island: {
    pushSnapshot: (snapshot: DesktopIslandSnapshot) => Promise<void>;
    getSnapshot: () => Promise<DesktopIslandSnapshot | null>;
    setExpanded: (expanded: boolean) => Promise<void>;
    dispatchCommand: (cmd: DesktopIslandCommand) => Promise<void>;
    onActivity: (cb: (activity: IslandActivity) => void) => () => void;
    onSnapshot: (cb: (snapshot: DesktopIslandSnapshot) => void) => () => void;
    onCommand: (cb: (cmd: DesktopIslandCommand) => void) => () => void;
  };
  updater: {
    getState: () => Promise<AppUpdateStateDto>;
    checkForUpdates: () => Promise<AppUpdateStateDto>;
    downloadUpdate: () => Promise<AppUpdateStateDto>;
    quitAndInstall: () => Promise<void>;
    openReleasePage: () => Promise<void>;
    onStateChanged: (cb: (state: AppUpdateStateDto) => void) => () => void;
  };
}
