import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  BarChart3,
  BookMarked,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Code2,
  Copy,
  Database,
  Download,
  Eye,
  FileSpreadsheet,
  Filter,
  FlaskConical,
  GitBranch,
  GitCompare,
  HardDriveDownload,
  KeyRound,
  LayoutGrid,
  Link2,
  Lock,
  Maximize2,
  Network,
  Pencil,
  Play,
  PlugZap,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  Table2,
  Trash2,
  Undo2,
  Unlock,
  Upload,
  Users,
  X,
  Zap
} from 'lucide-react';
import type {
  DatabaseProfile,
  DbEngine,
  DbMultiQueryResultItem,
  DbQueryResult,
  DbTableMeta,
  SavedSqlQueryItem
} from '@shared/types';
import {
  applySqlInlineParams,
  extractSqlInlineParams,
  substituteSqlTestParams,
  type SqlTemplateParam
} from '@shared/sqlSchemaAnalyzer';
import { analyzeDangerousSql, type SqlHazardReport } from '@shared/sqlSafetyGuard';
import { splitSqlStatements } from '@shared/sqlUndoBuilder';
import { ensureMonacoInitialized, getMonacoSuggestOptions, monaco } from '../themes/monacoSetup';
import { applySqlAndSecurityDiagnosticsToModel } from '../languages/phpIntelliSense';
import { getRememberedDatabaseForProfile, useIdeStore } from '../store/useIdeStore';
import { SavedQueryDrawerPanel } from './SavedQueryDrawerPanel';
import { QueryChartPivotPanel } from './QueryChartPivotPanel';
import { VisualExplainPanel } from './VisualExplainPanel';
import { useVirtualWindow } from './VirtualScrollList';
import {
  analyzeQueryIndexRecommendations,
  type SqlIndexRecommendation
} from '@shared/sqlIndexAdvisor';
import {
  buildPendingMutationsBatch,
  isWriteSqlBlockedInReadOnly,
  type PendingGridMutation
} from '@shared/dbSafeTransaction';
import {
  buildFkLookupSql,
  resolveForeignKeyTargetForColumn,
  type ResolvedFkTarget
} from '@shared/dbForeignKeyLookup';
import type { VisualExplainReport } from '@shared/mysqlExplainVisualizer';

const SqlMonacoEditor: React.FC<{
  value: string;
  onChange: (next: string) => void;
  onExecute: () => void;
  height?: number;
  compact?: boolean;
  placeholder?: string;
}> = ({ value, onChange, onExecute, height = 78, compact = false, placeholder }) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const onChangeRef = useRef(onChange);
  const onExecuteRef = useRef(onExecute);
  onChangeRef.current = onChange;
  onExecuteRef.current = onExecute;

  const theme = useIdeStore((s) => s.theme);
  const suggestMode = useIdeStore((s) => s.suggestMode);

  useEffect(() => {
    ensureMonacoInitialized();
    if (!hostRef.current) return;

    const model = monaco.editor.createModel(value, 'sql');
    const editor = monaco.editor.create(hostRef.current, {
      model,
      theme,
      automaticLayout: true,
      fixedOverflowWidgets: true,
      codeLens: false,
      minimap: { enabled: false },
      lineNumbers: compact ? 'off' : 'on',
      glyphMargin: false,
      folding: false,
      lineDecorationsWidth: compact ? 6 : 10,
      lineNumbersMinChars: 2,
      wordWrap: 'on',
      scrollBeyondLastLine: false,
      renderLineHighlight: 'none',
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      scrollbar: {
        vertical: 'auto',
        horizontal: 'hidden',
        verticalScrollbarSize: 6
      },
      fontSize: compact ? 12.5 : 13,
      fontFamily: "'Cascadia Code', 'JetBrains Mono', Consolas, monospace",
      padding: { top: 7, bottom: 7 },
      wordBasedSuggestions: 'off',
      ...getMonacoSuggestOptions(useIdeStore.getState().suggestMode, 'sql')
    });

    const actExec = editor.addAction({
      id: compact ? 'hmw.executeSqlCompact' : 'hmw.executeSqlWide',
      label: 'Jalankan Query SQL (Ctrl+Enter / F5)',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, monaco.KeyCode.F5],
      run: () => {
        onExecuteRef.current();
      }
    });

    let lintTimer: ReturnType<typeof setTimeout> | null = null;
    applySqlAndSecurityDiagnosticsToModel(model, 'sql');

    const subChange = editor.onDidChangeModelContent(() => {
      onChangeRef.current(editor.getValue());
      if (lintTimer) clearTimeout(lintTimer);
      lintTimer = setTimeout(() => {
        if (!model.isDisposed()) {
          applySqlAndSecurityDiagnosticsToModel(model, 'sql');
        }
      }, 180);
    });

    editorRef.current = editor;

    return () => {
      if (lintTimer) clearTimeout(lintTimer);
      actExec.dispose();
      subChange.dispose();
      editor.dispose();
      model.dispose();
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compact]);

  useEffect(() => {
    monaco.editor.setTheme(theme);
  }, [theme]);

  useEffect(() => {
    editorRef.current?.updateOptions(getMonacoSuggestOptions(suggestMode, 'sql'));
  }, [suggestMode]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel();
    if (model && !model.isDisposed() && editor.getValue() !== value) {
      model.setValue(value);
    }
  }, [value]);

  return (
    <div className="sql-monaco-box" style={{ height, width: '100%' }}>
      {!value && placeholder && (
        <div
          style={{
            position: 'absolute',
            top: 7,
            left: compact ? 8 : 34,
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
            fontSize: compact ? 12 : 12.5,
            pointerEvents: 'none',
            zIndex: 1
          }}
        >
          {placeholder}
        </div>
      )}
      <div ref={hostRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
};

function formatCellText(val: unknown): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'object') {
    try {
      return JSON.stringify(val);
    } catch {
      return String(val);
    }
  }
  return String(val);
}

function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildInsertSqlExport(
  tableName: string,
  columns: string[],
  rows: Array<Record<string, unknown>>,
  engine: DbEngine
): string {
  if (!columns.length || !rows.length) return '-- Tidak ada baris untuk diekspor';
  const q = (id: string): string =>
    engine === 'postgres' ? `"${id.replace(/"/g, '""')}"` : `\`${id.replace(/`/g, '``')}\``;
  const colList = columns.map(q).join(', ');
  const lines = rows.map((row) => {
    const vals = columns.map((c) => {
      const v = row[c];
      if (v === null || v === undefined) return 'NULL';
      if (typeof v === 'number' || typeof v === 'bigint') return String(v);
      if (typeof v === 'boolean') return v ? '1' : '0';
      const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
      return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
    });
    return `INSERT INTO ${q(tableName)} (${colList}) VALUES (${vals.join(', ')});`;
  });
  return lines.join('\n');
}

export const DatabaseSidebar: React.FC = () => {
  const {
    dbProfiles,
    selectedDbProfileId,
    dbSchema,
    dbSchemaLoading,
    dbSchemaLoadingMessage,
    dbSchemaLoadingPercent,
    dbSchemaLoadingTargetDb,
    dbSchemaError,
    loadDbSchema,
    connections,
    pendingSqlCodeLens,
    consumePendingSqlCodeLens,
    setDbArchitectTab,
    openTableDesigner,
    openReportGenerator,
    openVisualJoinBuilder,
    setDbRoutinesModalOpen,
    openDbSeeder,
    setDbSchedulerModalOpen,
    setAuditModalOpen,
    openExcelImportModal,
    setDbGlobalSearchModalOpen,
    setDbRbacModalOpen,
    savedSqlQueries,
    recordSqlExecutionHistory,
    setServerMonitorOpen,
    findReferencesForSymbol,
    refreshDbProfiles,
    setSelectedDbProfileId,
    setDbSchema,
    triggerWisanggeniCrudFromTable,
    showToast,
    pushIslandActivity
  } = useIdeStore();

  const [runningQuery, setRunningQuery] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);
  const loadingSchema = dbSchemaLoading;
  const schemaError = dbSchemaError;

  const [tableFilter, setTableFilter] = useState('');
  const [sidebarTableLimit, setSidebarTableLimit] = useState(120);
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>({});
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  const [sidebarBrowseTab, setSidebarBrowseTab] = useState<'tables' | 'queries'>('tables');
  const [sidebarSaveFormMode, setSidebarSaveFormMode] = useState(false);
  const [quickSqlExpanded, setQuickSqlExpanded] = useState(true);
  const [sqlText, setSqlText] = useState('SELECT * FROM ');
  const [queryResult, setQueryResult] = useState<DbQueryResult | null>(null);
  const [multiResults, setMultiResults] = useState<DbMultiQueryResultItem[]>([]);
  const [activeMultiIdx, setActiveMultiIdx] = useState(0);
  const [wideModalOpen, setWideModalOpen] = useState(false);
  const [wideSavedDrawerOpen, setWideSavedDrawerOpen] = useState(false);
  const [activeSavedQueryId, setActiveSavedQueryId] = useState<string | null>(null);

  const quickSavedChips = useMemo(() => {
    return [...savedSqlQueries]
      .sort((a, b) => {
        if (Boolean(a.isFavorite) !== Boolean(b.isFavorite)) {
          return a.isFavorite ? -1 : 1;
        }
        return (b.updatedAt || '').localeCompare(a.updatedAt || '');
      })
      .slice(0, 12);
  }, [savedSqlQueries]);
  const [wideChartOpen, setWideChartOpen] = useState(false);
  const [indexAdvisorOpen, setIndexAdvisorOpen] = useState(false);
  const [explainRows, setExplainRows] = useState<Array<Record<string, unknown>>>([]);
  const [creatingIndexId, setCreatingIndexId] = useState<string | null>(null);

  // Phase 30 #1: Safe Transaction Workbench (Read-Only Lock + Staged Pending Changes)
  const [readOnlyOverrideByProfile, setReadOnlyOverrideByProfile] = useState<Record<string, boolean>>({});
  const [stagingMode, setStagingMode] = useState(true);
  const [pendingMutations, setPendingMutations] = useState<PendingGridMutation[]>([]);
  const [pendingPreviewOpen, setPendingPreviewOpen] = useState(false);
  const [committingTx, setCommittingTx] = useState(false);

  // Phase 30 #2: Visual EXPLAIN ANALYZE Tree Panel
  const [visualExplainOpen, setVisualExplainOpen] = useState(false);
  const [visualExplainLoading, setVisualExplainLoading] = useState(false);
  const [visualExplainReport, setVisualExplainReport] = useState<VisualExplainReport | null>(null);
  const [visualExplainError, setVisualExplainError] = useState<string | null>(null);

  // Phase 30 #3: Foreign-Key Jump-to-Row & Master-Detail Split Drawer
  const [fkDetailStack, setFkDetailStack] = useState<
    Array<{
      label: string;
      sql: string;
      target: ResolvedFkTarget;
      columns: string[];
      rows: Array<Record<string, unknown>>;
      loading: boolean;
      error?: string;
    }>
  >([]);

  const indexRecommendations = useMemo<SqlIndexRecommendation[]>(() => {
    const engine = dbSchema?.engine ?? 'mysql';
    const allTbls = dbSchema?.allTables ?? dbSchema?.tables ?? [];
    return analyzeQueryIndexRecommendations({
      sql: sqlText,
      engine,
      defaultSchema: dbSchema?.currentDatabase,
      tables: allTbls,
      explainRows
    });
  }, [sqlText, dbSchema, explainRows]);

  const handleRunIndexAdvisor = async (): Promise<void> => {
    setIndexAdvisorOpen(true);
    if (!selectedDbProfileId || !/^\s*select\b/i.test(sqlText.trim())) return;
    try {
      const activeDb =
        dbSchema?.profileId === selectedDbProfileId
          ? dbSchema.currentDatabase
          : getRememberedDatabaseForProfile(selectedDbProfileId);
      const res = await window.aptana.db.query(
        selectedDbProfileId,
        `EXPLAIN ${sqlText.trim()}`,
        activeDb,
        50
      );
      setExplainRows(res.rows);
    } catch {
      // Static schema-based recommendations still work even if EXPLAIN fails
    }
  };

  const handleApplyRecommendedIndex = async (rec: SqlIndexRecommendation): Promise<void> => {
    if (!selectedDbProfileId) return;
    const prof = dbProfiles.find((p) => p.id === selectedDbProfileId);
    if (prof?.isProduction) {
      if (
        !window.confirm(
          `⚠️ PERINGATAN PRODUKSI: Pasang INDEX "${rec.indexName}" pada tabel "${rec.table}" di server PRODUKSI "${prof.name}"?`
        )
      ) {
        return;
      }
    }
    setCreatingIndexId(rec.id);
    try {
      const activeDb =
        rec.schema ||
        dbSchema?.currentDatabase ||
        getRememberedDatabaseForProfile(selectedDbProfileId);
      await window.aptana.db.query(selectedDbProfileId, rec.createIndexSql, activeDb, 5);
      showToast(`⚡ INDEX "${rec.indexName}" berhasil dipasang pada tabel "${rec.table}"!`);
      void handleRunIndexAdvisor();
    } catch (err) {
      showToast(`Gagal memasang INDEX: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCreatingIndexId(null);
    }
  };

  // Inline SQL CodeLens PHP Variable Test Parameters
  const [codeLensTemplate, setCodeLensTemplate] = useState<string | null>(null);
  const [codeLensMode, setCodeLensMode] = useState<'run' | 'explain'>('run');
  const [codeLensParams, setCodeLensParams] = useState<SqlTemplateParam[]>([]);
  const [codeLensValues, setCodeLensValues] = useState<Record<string, string>>({});
  const [codeLensSourceTitle, setCodeLensSourceTitle] = useState<string | null>(null);

  // Automatic Live SQL Template Parameters (`{$id}`, `{{id}}`, `:id`, `${id}`, `$id`)
  const inlineSqlParams = useMemo(() => extractSqlInlineParams(sqlText), [sqlText]);
  const [inlineParamValues, setInlineParamValues] = useState<Record<string, string>>({});
  const firstInlineParamRef = useRef<HTMLInputElement | null>(null);

  // Inline cell editing state in Wide Results Modal
  const [editingCell, setEditingCell] = useState<{
    rowIndex: number;
    column: string;
    draft: string;
    isNull: boolean;
  } | null>(null);
  const [savingCell, setSavingCell] = useState(false);

  // AI SQL explanation inside modal
  const [aiReport, setAiReport] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  // Profile Modal state
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [formName, setFormName] = useState('Database Intranet');
  const [formEngine, setFormEngine] = useState<DbEngine>('mysql');
  const [formHost, setFormHost] = useState('127.0.0.1');
  const [formPort, setFormPort] = useState(3306);
  const [formUsername, setFormUsername] = useState('root');
  const [formPassword, setFormPassword] = useState('');
  const [formDatabase, setFormDatabase] = useState('');
  const [formSsl, setFormSsl] = useState(false);
  const [formSshTunnelId, setFormSshTunnelId] = useState('');
  const [formIsProduction, setFormIsProduction] = useState(false);
  const [formHasSecret, setFormHasSecret] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [testStatus, setTestStatus] = useState<{ ok: boolean; text: string } | null>(null);

  // Table Browser Sort, Quick WHERE, Pagination, New Row CRUD, & Dangerous SQL Guardrail
  const [browseTableName, setBrowseTableName] = useState<string | null>(null);
  const [gridWhereFilter, setGridWhereFilter] = useState('');
  const [gridSortCol, setGridSortCol] = useState<string | null>(null);
  const [gridSortDir, setGridSortDir] = useState<'ASC' | 'DESC'>('ASC');
  const [gridPageSize, setGridPageSize] = useState<number>(100);
  const [gridOffset, setGridOffset] = useState<number>(0);

  const [newRowOpen, setNewRowOpen] = useState(false);
  const [newRowDraft, setNewRowDraft] = useState<Record<string, string>>({});
  const [newRowNulls, setNewRowNulls] = useState<Record<string, boolean>>({});
  const [savingNewRow, setSavingNewRow] = useState(false);
  const [exportingXlsx, setExportingXlsx] = useState(false);
  const [openExcelAfterSave, setOpenExcelAfterSave] = useState(true);

  const [pendingDangerSql, setPendingDangerSql] = useState<{
    sql: string;
    openModalAfter: boolean;
    report: SqlHazardReport;
  } | null>(null);

  const autoIntrospectedRef = useRef<string | null>(null);

  useEffect(() => {
    void refreshDbProfiles();
  }, [refreshDbProfiles]);

  useEffect(() => {
    if (!selectedDbProfileId) return;
    if (dbSchema?.profileId === selectedDbProfileId) {
      autoIntrospectedRef.current = selectedDbProfileId;
      return;
    }
    if (autoIntrospectedRef.current === selectedDbProfileId) return;
    autoIntrospectedRef.current = selectedDbProfileId;
    void handleIntrospect(selectedDbProfileId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDbProfileId, dbSchema?.profileId]);

  // Consume Inline SQL CodeLens triggers from PHP / SQL editors
  useEffect(() => {
    if (!pendingSqlCodeLens) return;
    const req = consumePendingSqlCodeLens();
    if (!req) return;

    const engine = dbSchema?.engine ?? dbProfiles.find((p) => p.id === selectedDbProfileId)?.engine ?? 'mysql';

    if (req.mode === 'structure' && req.primaryTable) {
      const tblName = req.primaryTable.table;
      setTableFilter(tblName);
      setExpandedTables((prev) => ({ ...prev, [tblName]: true }));
      const descSql =
        engine === 'postgres'
          ? `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = '${tblName.replace(/'/g, "''")}' ORDER BY ordinal_position;`
          : req.primaryTable.schema
            ? `DESCRIBE \`${req.primaryTable.schema.replace(/`/g, '``')}\`.\`${tblName.replace(/`/g, '``')}\`;`
            : `DESCRIBE \`${tblName.replace(/`/g, '``')}\`;`;
      setCodeLensParams([]);
      setCodeLensTemplate(null);
      setSqlText(descSql);
      setWideModalOpen(true);
      if (selectedDbProfileId) {
        void executeSqlQuery(descSql, true);
      } else {
        showToast('Pilih profil database untuk melihat struktur tabel secara live.');
      }
      return;
    }

    const initVals: Record<string, string> = {};
    for (const p of req.params) {
      initVals[p.key] = p.defaultValue;
    }
    const modeNow: 'run' | 'explain' = req.mode === 'explain' ? 'explain' : 'run';
    let builtSql = substituteSqlTestParams(req.sqlTemplate, req.params, initVals);
    if (modeNow === 'explain' && !/^\s*explain\b/i.test(builtSql)) {
      builtSql = `EXPLAIN ${builtSql}`;
    }

    setCodeLensMode(modeNow);
    setCodeLensTemplate(req.sqlTemplate);
    setCodeLensParams(req.params);
    setCodeLensValues(initVals);
    setCodeLensSourceTitle(req.sourceTitle ?? null);
    setSqlText(builtSql);
    setWideModalOpen(true);

    if (selectedDbProfileId) {
      if (req.params.length === 0 || modeNow === 'explain') {
        void executeSqlQuery(builtSql, true);
      } else {
        showToast(
          `Query dimuat dari ${req.sourceTitle || 'editor'} (${req.params.length} variabel PHP siap diisi uji).`
        );
      }
    } else {
      showToast('Query dimuat ke SQL Runner. Pilih profil database untuk mengeksekusi.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSqlCodeLens]);

  const activeProfile = useMemo(
    () => dbProfiles.find((p) => p.id === selectedDbProfileId) ?? null,
    [dbProfiles, selectedDbProfileId]
  );

  // Read-Only Lock defaults to ON for Production profiles until consciously unlocked
  const isReadOnlyLocked = useMemo(() => {
    if (!activeProfile) return false;
    if (Object.prototype.hasOwnProperty.call(readOnlyOverrideByProfile, activeProfile.id)) {
      return Boolean(readOnlyOverrideByProfile[activeProfile.id]);
    }
    return Boolean(activeProfile.isProduction);
  }, [activeProfile, readOnlyOverrideByProfile]);

  const toggleReadOnlyLock = (): void => {
    if (!activeProfile) return;
    const nextLocked = !isReadOnlyLocked;
    setReadOnlyOverrideByProfile((prev) => ({ ...prev, [activeProfile.id]: nextLocked }));
    showToast(
      nextLocked
        ? `🔒 Mode Read-Only AKTIF untuk "${activeProfile.name}" — semua edit & tulis diblokir.`
        : `🔓 Mode Edit DIBUKA untuk "${activeProfile.name}"${activeProfile.isProduction ? ' (Hati-hati: Produksi!)' : ''}.`
    );
  };

  const pendingBatchInfo = useMemo(() => {
    const eng = dbSchema?.engine ?? activeProfile?.engine ?? 'mysql';
    return buildPendingMutationsBatch(pendingMutations, eng);
  }, [pendingMutations, dbSchema?.engine, activeProfile?.engine]);

  const activeSourceTableMeta = useMemo(() => {
    if (!queryResult?.editableTable || !dbSchema) return null;
    const tblName = queryResult.editableTable.table.toLowerCase();
    return (
      dbSchema.tables.find((t) => t.name.toLowerCase() === tblName) ??
      (dbSchema.allTables ?? []).find((t) => t.name.toLowerCase() === tblName) ??
      null
    );
  }, [queryResult?.editableTable, dbSchema]);

  const fkTargetsByColumn = useMemo<Record<string, ResolvedFkTarget>>(() => {
    const out: Record<string, ResolvedFkTarget> = {};
    if (!queryResult || queryResult.columns.length === 0 || !dbSchema) return out;
    const allTbls = dbSchema.allTables ?? dbSchema.tables ?? [];
    for (const col of queryResult.columns) {
      const found = resolveForeignKeyTargetForColumn({
        sourceTable: activeSourceTableMeta,
        columnName: col,
        allTables: allTbls,
        currentDatabase: dbSchema.currentDatabase
      });
      if (found) {
        out[col] = found;
      }
    }
    return out;
  }, [queryResult, dbSchema, activeSourceTableMeta]);

  const handleRunVisualExplain = async (): Promise<void> => {
    if (!selectedDbProfileId || !sqlText.trim()) return;
    let targetSql = sqlText;
    const detected = extractSqlInlineParams(targetSql);
    if (detected.length > 0) {
      const applied = applySqlInlineParams(targetSql, detected, inlineParamValues);
      if (applied.missingKeys.length > 0) {
        showToast(`Isi nilai parameter "${applied.missingKeys.join(', ')}" terlebih dahulu sebelum Visual EXPLAIN.`);
        firstInlineParamRef.current?.focus();
        return;
      }
      targetSql = applied.sql;
    }
    setVisualExplainOpen(true);
    setVisualExplainLoading(true);
    setVisualExplainError(null);
    try {
      const rep = await window.aptana.db.explainVisual(
        selectedDbProfileId,
        targetSql,
        dbSchema?.currentDatabase || undefined
      );
      setVisualExplainReport(rep);
    } catch (err) {
      setVisualExplainError(err instanceof Error ? err.message : String(err));
    } finally {
      setVisualExplainLoading(false);
    }
  };

  const handleFkJump = async (
    target: ResolvedFkTarget,
    cellValue: unknown,
    appendToStack = false
  ): Promise<void> => {
    if (!selectedDbProfileId || cellValue === null || cellValue === undefined) return;
    const eng = dbSchema?.engine ?? activeProfile?.engine ?? 'mysql';
    const lookupSql = buildFkLookupSql(target, cellValue, eng);
    const label = `${target.targetTable}.${target.targetColumn} = ${formatCellText(cellValue)}`;
    const loadingItem = {
      label,
      sql: lookupSql,
      target,
      columns: [],
      rows: [],
      loading: true
    };
    setFkDetailStack((prev) => (appendToStack ? [...prev, loadingItem] : [loadingItem]));
    try {
      const res = await window.aptana.db.query(
        selectedDbProfileId,
        lookupSql,
        target.targetSchema || dbSchema?.currentDatabase || undefined,
        20
      );
      setFkDetailStack((prev) => {
        const next = [...prev];
        if (next.length > 0) {
          next[next.length - 1] = {
            ...next[next.length - 1],
            columns: res.columns,
            rows: res.rows,
            loading: false
          };
        }
        return next;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setFkDetailStack((prev) => {
        const next = [...prev];
        if (next.length > 0) {
          next[next.length - 1] = { ...next[next.length - 1], loading: false, error: msg };
        }
        return next;
      });
    }
  };

  const handleCommitPendingTx = async (): Promise<void> => {
    if (!selectedDbProfileId || pendingMutations.length === 0) return;
    if (isReadOnlyLocked) {
      showToast('🔒 Mode Read-Only aktif — buka gembok terlebih dahulu sebelum COMMIT.');
      return;
    }
    setCommittingTx(true);
    try {
      const res = await window.aptana.db.executeBatchTx(
        selectedDbProfileId,
        pendingBatchInfo.statements,
        dbSchema?.currentDatabase || undefined
      );
      if (res.committed) {
        showToast(
          `✅ COMMIT Transaksi berhasil (${res.executedCount} perubahan disimpan atomik dalam ${res.durationMs} ms).`
        );
        setPendingMutations([]);
        setPendingPreviewOpen(false);
        refreshBrowseGrid();
      } else {
        showToast(
          `❌ Transaksi di-ROLLBACK otomatis karena error: ${res.errorMessage || 'Kesalahan SQL'}`
        );
      }
    } catch (err) {
      showToast(`Gagal COMMIT transaksi: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCommittingTx(false);
    }
  };

  const handleRollbackPendingTx = (): void => {
    setPendingMutations([]);
    setPendingPreviewOpen(false);
    showToast('↩ Semua perubahan tertunda (Pending Changes) dibatalkan (ROLLBACK lokal).');
    refreshBrowseGrid();
  };

  const sftpConnections = useMemo(
    () => connections.filter((c) => c.protocol === 'sftp'),
    [connections]
  );

  const filteredTables = useMemo(() => {
    if (!dbSchema) return [];
    const q = tableFilter.trim().toLowerCase();
    if (!q) return dbSchema.tables;
    return dbSchema.tables.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.columns.some((c) => c.name.toLowerCase().includes(q))
    );
  }, [dbSchema, tableFilter]);

  const openAddProfileModal = (): void => {
    setEditingProfileId(null);
    setFormName('Database Baru');
    setFormEngine('mysql');
    setFormHost('127.0.0.1');
    setFormPort(3306);
    setFormUsername('root');
    setFormPassword('');
    setFormDatabase('');
    setFormSsl(false);
    setFormSshTunnelId('');
    setFormIsProduction(false);
    setFormHasSecret(false);
    setTestStatus(null);
    setProfileModalOpen(true);
  };

  const openEditProfileModal = (prof: DatabaseProfile): void => {
    setEditingProfileId(prof.id);
    setFormName(prof.name);
    setFormEngine(prof.engine);
    setFormHost(prof.host);
    setFormPort(prof.port);
    setFormUsername(prof.username);
    setFormPassword('');
    setFormDatabase(prof.database);
    setFormSsl(Boolean(prof.ssl));
    setFormSshTunnelId(prof.sshTunnelConnectionId ?? '');
    setFormIsProduction(Boolean(prof.isProduction));
    setFormHasSecret(Boolean(prof.hasSavedSecret));
    setTestStatus(null);
    setProfileModalOpen(true);
  };

  const handleSaveProfile = async (): Promise<DatabaseProfile | null> => {
    if (!formName.trim() || !formHost.trim() || !formUsername.trim()) {
      showToast('Nama profil, host, dan username database wajib diisi.');
      return null;
    }
    setSavingProfile(true);
    try {
      const saved = await window.aptana.db.save({
        profile: {
          id: editingProfileId ?? undefined,
          name: formName.trim(),
          engine: formEngine,
          host: formHost.trim(),
          port: Number(formPort) || (formEngine === 'postgres' ? 5432 : 3306),
          username: formUsername.trim(),
          database: formDatabase.trim(),
          ssl: formSsl,
          sshTunnelConnectionId: formSshTunnelId || undefined,
          isProduction: formIsProduction
        },
        password: formPassword || undefined
      });
      await refreshDbProfiles();
      setSelectedDbProfileId(saved.id);
      setEditingProfileId(saved.id);
      setFormHasSecret(Boolean(saved.hasSavedSecret));
      setFormPassword('');
      showToast(`Profil database "${saved.name}" tersimpan.`);
      return saved;
    } catch (err) {
      showToast(`Gagal menyimpan database: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    } finally {
      setSavingProfile(false);
    }
  };

  const handleTestInModal = async (): Promise<void> => {
    const saved = await handleSaveProfile();
    if (!saved) return;
    setTestStatus({ ok: true, text: 'Menghubungi server database...' });
    try {
      const res = await window.aptana.db.test(saved.id);
      setTestStatus({
        ok: res.ok,
        text: `${res.message} (${res.latencyMs} ms)`
      });
      if (res.ok) {
        void handleIntrospect(saved.id, saved.database || undefined);
      }
    } catch (err) {
      setTestStatus({
        ok: false,
        text: err instanceof Error ? err.message : String(err)
      });
    }
  };

  const handleDeleteProfile = async (): Promise<void> => {
    if (!activeProfile) return;
    try {
      await window.aptana.db.remove(activeProfile.id);
      await refreshDbProfiles();
      if (dbSchema?.profileId === activeProfile.id) {
        setDbSchema(null);
      }
      showToast(`Profil database "${activeProfile.name}" dihapus.`);
    } catch (err) {
      showToast(`Gagal menghapus profil: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleIntrospect = async (
    profileId?: string,
    databaseName?: string,
    forceFull = false
  ): Promise<void> => {
    const targetId = profileId ?? selectedDbProfileId;
    if (!targetId) {
      openAddProfileModal();
      return;
    }
    await loadDbSchema(targetId, databaseName, forceFull);
  };

  const gridVirtual = useVirtualWindow({
    itemCount: queryResult?.rows.length ?? 0,
    itemHeight: 30,
    overscan: 15
  });

  const executeSqlQuery = async (
    customSql?: string,
    openModalAfter = false,
    bypassSafety = false,
    options?: { keepEditorTemplate?: boolean; paramValuesOverride?: Record<string, string> }
  ): Promise<void> => {
    const targetId = selectedDbProfileId;
    if (!targetId) {
      showToast('Pilih atau tambahkan profil database terlebih dahulu.');
      return;
    }
    const rawQuery = (customSql ?? sqlText).trim();
    if (!rawQuery) {
      showToast('Masukkan perintah SQL terlebih dahulu.');
      return;
    }
    if (customSql !== undefined && !options?.keepEditorTemplate) {
      setSqlText(customSql);
    }

    // Automatically detect and substitute SQL template placeholders like `{$id}`, `{{id}}`, `:id`, `$id`
    let queryToRun = rawQuery;
    const detectedInline = extractSqlInlineParams(rawQuery);
    if (detectedInline.length > 0) {
      const vals = options?.paramValuesOverride ?? inlineParamValues;
      const applied = applySqlInlineParams(rawQuery, detectedInline, vals);
      if (applied.missingKeys.length > 0) {
        if (openModalAfter) {
          setWideModalOpen(true);
        }
        showToast(
          `🎛️ Isi nilai parameter "${applied.missingKeys.join(', ')}" di kotak Parameter Query lalu tekan Enter!`
        );
        setTimeout(() => {
          firstInlineParamRef.current?.focus();
          firstInlineParamRef.current?.select();
        }, 70);
        return;
      }
      queryToRun = applied.sql;
    }

    if (isReadOnlyLocked) {
      const roCheck = isWriteSqlBlockedInReadOnly(queryToRun);
      if (roCheck.blocked) {
        showToast(
          `🔒 Mode Read-Only AKTIF: Perintah ${roCheck.keyword || 'TULIS'} diblokir. Klik tombol "🔒 Read-Only" untuk membuka kunci.`
        );
        return;
      }
    }

    if (!bypassSafety) {
      const hazard = analyzeDangerousSql(queryToRun, Boolean(activeProfile?.isProduction));
      if (hazard.hazardous) {
        setPendingDangerSql({
          sql: queryToRun,
          openModalAfter,
          report: hazard
        });
        return;
      }
    }

    setRunningQuery(true);
    setQueryError(null);
    setEditingCell(null);
    try {
      const activeDbUsed =
        dbSchema?.profileId === targetId
          ? dbSchema.currentDatabase
          : getRememberedDatabaseForProfile(targetId);

      const statements = splitSqlStatements(queryToRun);
      if (statements.length > 1) {
        const items = await window.aptana.db.queryMulti(
          targetId,
          queryToRun,
          activeDbUsed,
          Math.max(500, gridPageSize)
        );
        setMultiResults(items);
        setActiveMultiIdx(0);
        const first = items[0];
        setQueryResult(first?.result ?? null);
        setQueryError(first?.error ?? null);
        recordSqlExecutionHistory({
          sql: queryToRun,
          profileId: targetId,
          database: activeDbUsed || undefined,
          rowCount: items.reduce((acc, it) => acc + (it.result?.rowCount ?? 0), 0),
          durationMs: items.reduce((acc, it) => acc + (it.result?.durationMs ?? 0), 0)
        });
        if (openModalAfter) {
          setWideModalOpen(true);
        }
        return;
      }

      setMultiResults([]);
      const res = await window.aptana.db.query(
        targetId,
        queryToRun,
        activeDbUsed,
        Math.max(500, gridPageSize)
      );
      setQueryResult(res);
      recordSqlExecutionHistory({
        sql: queryToRun,
        profileId: targetId,
        database: activeDbUsed || undefined,
        rowCount: res.rowCount,
        durationMs: res.durationMs
      });
      if (res.editableTable?.table) {
        setBrowseTableName(res.editableTable.table);
      }
      if (dbSchema?.profileId !== targetId) {
        void handleIntrospect(targetId);
      }
      if (openModalAfter) {
        setWideModalOpen(true);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setQueryError(msg);
      showToast(`Query Gagal: ${msg}`);
    } finally {
      setRunningQuery(false);
    }
  };

  const handleQuickLoadSavedQuery = (
    item: SavedSqlQueryItem,
    runNow = false,
    openWide = false
  ): void => {
    setCodeLensParams([]);
    setCodeLensTemplate(null);
    setSqlText(item.sql);
    setActiveSavedQueryId(item.id);
    if (openWide) {
      setWideModalOpen(true);
    }
    const detected = extractSqlInlineParams(item.sql);
    if (runNow) {
      void executeSqlQuery(item.sql, openWide);
      return;
    }
    if (detected.length > 0) {
      showToast(
        `⭐ Query "${item.name}" dimuat — isi nilai ${detected.map((d) => d.displayToken).join(', ')} lalu tekan Enter!`
      );
      setTimeout(() => {
        firstInlineParamRef.current?.focus();
        firstInlineParamRef.current?.select();
      }, 90);
    } else {
      showToast(`⭐ Query "${item.name}" dimuat ke editor SQL (Ctrl+Enter untuk jalankan).`);
    }
  };

  const buildBrowseTableSql = (opts: {
    tableName: string;
    whereClause?: string;
    sortCol?: string | null;
    sortDir?: 'ASC' | 'DESC';
    limit?: number;
    offset?: number;
  }): string => {
    const engine = dbSchema?.engine ?? activeProfile?.engine ?? 'mysql';
    const qIdent = (ident: string): string =>
      engine === 'postgres'
        ? `"${ident.replace(/"/g, '""')}"`
        : `\`${ident.replace(/`/g, '``')}\``;
    const cleanWhere = (opts.whereClause ?? '').trim().replace(/^where\s+/i, '').replace(/;+\s*$/, '');
    const whereSql = cleanWhere ? ` WHERE ${cleanWhere}` : '';
    const orderSql = opts.sortCol ? ` ORDER BY ${qIdent(opts.sortCol)} ${opts.sortDir ?? 'ASC'}` : '';
    const lim = opts.limit ?? gridPageSize;
    const off = opts.offset ?? 0;
    const offSql = off > 0 ? ` OFFSET ${off}` : '';
    return `SELECT * FROM ${qIdent(opts.tableName)}${whereSql}${orderSql} LIMIT ${lim}${offSql};`;
  };

  const refreshBrowseGrid = (overrides?: {
    tableName?: string;
    whereClause?: string;
    sortCol?: string | null;
    sortDir?: 'ASC' | 'DESC';
    limit?: number;
    offset?: number;
    openModal?: boolean;
  }): void => {
    const tbl = overrides?.tableName ?? queryResult?.editableTable?.table ?? browseTableName;
    if (!tbl) return;
    const nextWhere = overrides?.whereClause !== undefined ? overrides.whereClause : gridWhereFilter;
    const nextSortCol = overrides?.sortCol !== undefined ? overrides.sortCol : gridSortCol;
    const nextSortDir = overrides?.sortDir ?? gridSortDir;
    const nextLimit = overrides?.limit ?? gridPageSize;
    const nextOffset = overrides?.offset ?? gridOffset;

    setBrowseTableName(tbl);
    setGridWhereFilter(nextWhere);
    setGridSortCol(nextSortCol);
    setGridSortDir(nextSortDir);
    setGridPageSize(nextLimit);
    setGridOffset(nextOffset);

    const nextSql = buildBrowseTableSql({
      tableName: tbl,
      whereClause: nextWhere,
      sortCol: nextSortCol,
      sortDir: nextSortDir,
      limit: nextLimit,
      offset: nextOffset
    });
    void executeSqlQuery(nextSql, overrides?.openModal ?? false, true);
  };

  const handleSelectTopRows = (table: DbTableMeta): void => {
    setNewRowOpen(false);
    refreshBrowseGrid({
      tableName: table.name,
      whereClause: '',
      sortCol: null,
      sortDir: 'ASC',
      limit: gridPageSize,
      offset: 0,
      openModal: true
    });
  };

  const handleToggleColumnSort = (col: string): void => {
    const tbl = queryResult?.editableTable?.table ?? browseTableName;
    if (!tbl) return;
    const nextDir: 'ASC' | 'DESC' =
      gridSortCol === col && gridSortDir === 'ASC' ? 'DESC' : 'ASC';
    refreshBrowseGrid({
      tableName: tbl,
      sortCol: col,
      sortDir: nextDir,
      offset: 0
    });
  };

  const openInsertRowForm = (seedRow?: Record<string, unknown>): void => {
    if (!queryResult?.editableTable) return;
    const tblMeta = dbSchema?.tables.find(
      (t) => t.name.toLowerCase() === queryResult.editableTable!.table.toLowerCase()
    );
    const pks = new Set(queryResult.editableTable.primaryKeys.map((k) => k.toLowerCase()));
    const drafts: Record<string, string> = {};
    const nulls: Record<string, boolean> = {};

    for (const col of queryResult.columns) {
      const meta = tblMeta?.columns.find((c) => c.name.toLowerCase() === col.toLowerCase());
      const isAutoInc =
        Boolean(meta?.extra?.toLowerCase().includes('auto_increment')) ||
        Boolean(meta?.defaultValue?.toLowerCase().includes('nextval'));
      if (seedRow) {
        if (pks.has(col.toLowerCase()) && isAutoInc) {
          drafts[col] = '';
          nulls[col] = true;
        } else {
          const v = seedRow[col];
          drafts[col] = v === null || v === undefined ? '' : formatCellText(v);
          nulls[col] = v === null || v === undefined;
        }
      } else {
        drafts[col] =
          meta?.defaultValue && !/current_timestamp|now\(\)|nextval/i.test(meta.defaultValue)
            ? meta.defaultValue
            : '';
        nulls[col] = isAutoInc || Boolean(meta?.nullable && !meta?.defaultValue);
      }
    }
    setNewRowDraft(drafts);
    setNewRowNulls(nulls);
    setNewRowOpen(true);
  };

  const handleSaveNewRow = async (): Promise<void> => {
    if (!queryResult?.editableTable || !selectedDbProfileId) return;
    if (isReadOnlyLocked) {
      showToast('🔒 Mode Read-Only aktif — buka gembok untuk menambah baris.');
      return;
    }
    const tblMeta = dbSchema?.tables.find(
      (t) => t.name.toLowerCase() === queryResult.editableTable!.table.toLowerCase()
    );
    const values: Record<string, unknown> = {};
    for (const col of queryResult.columns) {
      const meta = tblMeta?.columns.find((c) => c.name.toLowerCase() === col.toLowerCase());
      const isAutoOrDefault =
        Boolean(meta?.extra?.toLowerCase().includes('auto_increment')) ||
        Boolean(meta?.defaultValue);
      const isMarkedNull = Boolean(newRowNulls[col]);
      const raw = newRowDraft[col] ?? '';
      if (isMarkedNull) {
        if (!isAutoOrDefault) {
          values[col] = null;
        }
      } else if (raw !== '' || !isAutoOrDefault) {
        values[col] = raw;
      }
    }

    if (stagingMode) {
      const rowKey = `ins-${Date.now()}`;
      setPendingMutations((prev) => [
        ...prev,
        {
          id: rowKey,
          kind: 'insert',
          table: queryResult.editableTable!.table,
          database: queryResult.editableTable!.database,
          values,
          rowKey
        }
      ]);
      setNewRowOpen(false);
      showToast(`⏳ Baris baru diantrekan ke Pending Changes — klik COMMIT untuk menyimpan.`);
      return;
    }

    setSavingNewRow(true);
    try {
      const res = await window.aptana.db.insertRow(selectedDbProfileId, {
        database: queryResult.editableTable.database,
        table: queryResult.editableTable.table,
        values
      });
      setNewRowOpen(false);
      showToast(
        `Baris baru berhasil ditambahkan ke "${queryResult.editableTable.table}"${
          res.insertId ? ` (ID: ${res.insertId})` : ''
        }.`
      );
      refreshBrowseGrid();
    } catch (err) {
      showToast(`Gagal menambah baris: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSavingNewRow(false);
    }
  };

  const handleDeleteGridRow = async (row: Record<string, unknown>): Promise<void> => {
    if (!queryResult?.editableTable || !selectedDbProfileId) return;
    if (isReadOnlyLocked) {
      showToast('🔒 Mode Read-Only aktif — buka gembok untuk menghapus baris.');
      return;
    }
    const pkValues: Record<string, unknown> = {};
    for (const pk of queryResult.editableTable.primaryKeys) {
      if (!(pk in row)) {
        showToast(`Primary key "${pk}" tidak ditemukan pada baris ini.`);
        return;
      }
      pkValues[pk] = row[pk];
    }
    const pkDesc = Object.entries(pkValues)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(', ');

    if (stagingMode) {
      const rowKey = JSON.stringify(pkValues);
      setPendingMutations((prev) => {
        const filtered = prev.filter((m) => !(m.kind === 'delete' && m.rowKey === rowKey));
        return [
          ...filtered,
          {
            id: `del-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            kind: 'delete',
            table: queryResult.editableTable!.table,
            database: queryResult.editableTable!.database,
            primaryKeyValues: pkValues,
            deletedRowSnapshot: { ...row },
            rowKey
          }
        ];
      });
      showToast(`⏳ Hapus baris (${pkDesc}) diantrekan ke Pending Changes — klik COMMIT untuk mengeksekusi.`);
      return;
    }
    const ok = window.confirm(
      `Hapus baris (${pkDesc}) dari tabel "${queryResult.editableTable.table}"${
        activeProfile?.isProduction ? '\n\n⚠️ PERHATIAN: Ini adalah DATABASE PRODUKSI!' : ''
      }?`
    );
    if (!ok) return;

    try {
      const res = await window.aptana.db.deleteRow(selectedDbProfileId, {
        database: queryResult.editableTable.database,
        table: queryResult.editableTable.table,
        primaryKeyValues: pkValues
      });
      showToast(`Baris (${pkDesc}) dihapus (${res.affectedRows} baris).`);
      refreshBrowseGrid();
    } catch (err) {
      showToast(`Gagal menghapus baris: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleExportExcel = async (customData?: {
    fileName: string;
    sheetName: string;
    columns: string[];
    rows: Array<Record<string, unknown>>;
  }): Promise<void> => {
    const cols = customData?.columns ?? queryResult?.columns ?? [];
    const rows = customData?.rows ?? queryResult?.rows ?? [];
    if (cols.length === 0) {
      showToast('Tidak ada kolom hasil query untuk diekspor ke Excel.');
      return;
    }
    const baseTbl =
      customData?.fileName ||
      queryResult?.editableTable?.table ||
      browseTableName ||
      dbSchema?.currentDatabase ||
      'hasil_query';
    const stamp = new Date().toISOString().slice(0, 10);
    setExportingXlsx(true);
    try {
      const res = await window.aptana.db.exportExcel({
        defaultFileName: `${baseTbl}_${stamp}.xlsx`,
        sheetName: customData?.sheetName || baseTbl,
        columns: cols,
        rows,
        openAfterSave: openExcelAfterSave
      });
      if (!res.canceled && res.filePath) {
        showToast(`Berhasil diekspor ke Excel (${res.rowCount} baris): ${res.filePath}`);
      }
    } catch (err) {
      showToast(`Gagal export Excel: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExportingXlsx(false);
    }
  };

  const handleExportTableExcelDirect = async (tbl: DbTableMeta): Promise<void> => {
    if (!selectedDbProfileId) return;
    const engine = dbSchema?.engine ?? activeProfile?.engine ?? 'mysql';
    const qTbl =
      engine === 'postgres'
        ? `"${tbl.name.replace(/"/g, '""')}"`
        : `\`${tbl.name.replace(/`/g, '``')}\``;
    setExportingXlsx(true);
    try {
      const qRes = await window.aptana.db.query(
        selectedDbProfileId,
        `SELECT * FROM ${qTbl} LIMIT 10000;`,
        dbSchema?.currentDatabase || undefined,
        10000
      );
      await handleExportExcel({
        fileName: tbl.name,
        sheetName: tbl.name,
        columns: qRes.columns,
        rows: qRes.rows
      });
    } catch (err) {
      showToast(`Gagal export tabel ke Excel: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExportingXlsx(false);
    }
  };

  const handleExportSqlDump = async (tables?: string[]): Promise<void> => {
    if (!selectedDbProfileId) return;
    try {
      const res = await window.aptana.db.exportSqlDump(selectedDbProfileId, {
        database: dbSchema?.currentDatabase || activeProfile?.database || undefined,
        tables,
        includeSchema: true,
        includeData: true,
        maxRowsPerTable: 10000
      });
      if (!res.canceled && res.filePath) {
        showToast(
          `Backup .SQL tersimpan (${res.tablesExported} tabel • ${res.rowsExported} baris).`
        );
      }
    } catch (err) {
      showToast(`Gagal backup .SQL: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleImportCsvToTable = async (tableName: string): Promise<void> => {
    if (!selectedDbProfileId) return;
    try {
      const res = await window.aptana.db.importCsv(selectedDbProfileId, {
        database: dbSchema?.currentDatabase || activeProfile?.database || undefined,
        table: tableName
      });
      if (!res.canceled) {
        showToast(`Berhasil mengimpor ${res.insertedRows} baris CSV ke tabel "${tableName}".`);
        if (browseTableName === tableName || queryResult?.editableTable?.table === tableName) {
          refreshBrowseGrid({ tableName });
        }
      }
    } catch (err) {
      showToast(`Gagal impor CSV: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleCopyDdl = async (table: DbTableMeta): Promise<void> => {
    try {
      const engine = dbSchema?.engine ?? activeProfile?.engine ?? 'mysql';
      const ddl = await window.aptana.db.generateTableDdl(table, engine);
      await navigator.clipboard.writeText(ddl);
      setSqlText(ddl);
      showToast(`DDL CREATE TABLE "${table.name}" disalin ke clipboard & kotak SQL.`);
    } catch (err) {
      showToast(`Gagal membuat DDL: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleCommitCellEdit = async (): Promise<void> => {
    if (!editingCell || !queryResult?.editableTable || !selectedDbProfileId) return;
    if (isReadOnlyLocked) {
      showToast('🔒 Mode Read-Only aktif — buka gembok untuk mengubah isi sel.');
      setEditingCell(null);
      return;
    }
    const { rowIndex, column, draft, isNull } = editingCell;
    const row = queryResult.rows[rowIndex];
    if (!row) return;

    const pkValues: Record<string, unknown> = {};
    for (const pk of queryResult.editableTable.primaryKeys) {
      if (!(pk in row)) {
        showToast(
          `Kolom Primary Key "${pk}" harus ikut di-SELECT agar baris dapat diedit aman.`
        );
        return;
      }
      pkValues[pk] = row[pk];
    }

    const nextVal = isNull ? null : draft;
    if (stagingMode) {
      const rowKey = JSON.stringify(pkValues);
      setPendingMutations((prev) => {
        const filtered = prev.filter(
          (m) => !(m.kind === 'update' && m.rowKey === rowKey && m.column === column)
        );
        return [
          ...filtered,
          {
            id: `upd-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            kind: 'update',
            table: queryResult.editableTable!.table,
            database: queryResult.editableTable!.database,
            column,
            oldValue: row[column],
            newValue: nextVal,
            primaryKeyValues: pkValues,
            rowKey
          }
        ];
      });
      setQueryResult((prev) => {
        if (!prev) return prev;
        const nextRows = [...prev.rows];
        nextRows[rowIndex] = { ...nextRows[rowIndex], [column]: nextVal };
        return { ...prev, rows: nextRows };
      });
      setEditingCell(null);
      showToast(`⏳ Edit "${column}" masuk Pending Changes — klik COMMIT untuk menyimpan ke DB.`);
      return;
    }
    setSavingCell(true);
    try {
      const res = await window.aptana.db.updateCell(selectedDbProfileId, {
        database: queryResult.editableTable.database,
        table: queryResult.editableTable.table,
        primaryKeyValues: pkValues,
        column,
        newValue: nextVal
      });
      setQueryResult((prev) => {
        if (!prev) return prev;
        const nextRows = [...prev.rows];
        nextRows[rowIndex] = { ...nextRows[rowIndex], [column]: nextVal };
        return { ...prev, rows: nextRows };
      });
      setEditingCell(null);
      showToast(`Sel "${column}" berhasil disimpan ke database (${res.affectedRows} baris).`);
    } catch (err) {
      showToast(`Gagal update sel: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSavingCell(false);
    }
  };

  const handleExportCsv = async (): Promise<void> => {
    if (!queryResult || queryResult.columns.length === 0) return;
    const header = queryResult.columns.map(escapeCsvCell).join(',');
    const lines = queryResult.rows.map((r) =>
      queryResult.columns.map((c) => escapeCsvCell(r[c])).join(',')
    );
    const csv = [header, ...lines].join('\r\n');
    await navigator.clipboard.writeText(csv);
    showToast(`CSV (${queryResult.rows.length} baris) disalin ke clipboard.`);
  };

  const handleCopyInsertSql = async (): Promise<void> => {
    if (!queryResult || queryResult.columns.length === 0) return;
    const tbl = queryResult.editableTable?.table || 'nama_tabel';
    const engine = dbSchema?.engine ?? activeProfile?.engine ?? 'mysql';
    const sqlOut = buildInsertSqlExport(tbl, queryResult.columns, queryResult.rows, engine);
    await navigator.clipboard.writeText(sqlOut);
    showToast(`INSERT SQL (${queryResult.rows.length} baris) disalin ke clipboard.`);
  };

  const handleAskAiExplainSql = async (): Promise<void> => {
    if (!sqlText.trim()) return;
    setAiBusy(true);
    setAiReport(null);
    try {
      const res = await window.aptana.ai.sqlAndSecurityAudit({
        mode: 'explain-sql',
        input: sqlText
      });
      setAiReport(
        res.suggestedCode
          ? `${res.markdownReport}\n\n--- Rekomendasi SQL ---\n${res.suggestedCode}`
          : res.markdownReport
      );
      setWideModalOpen(true);
    } catch (err) {
      showToast(`AI SQL Gagal: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div className="sidebar-header">
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Database size={13} /> DATABASE &amp; SQL
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            className="icon-btn"
            style={{
              color:
                sidebarBrowseTab === 'queries'
                  ? '#fbbf24'
                  : savedSqlQueries.length > 0
                    ? '#fde68a'
                    : undefined
            }}
            title={`Buka Daftar Query Tersimpan (${savedSqlQueries.length})`}
            onClick={() => {
              setSidebarSaveFormMode(false);
              setSidebarBrowseTab((t) => (t === 'queries' ? 'tables' : 'queries'));
            }}
          >
            <Star size={13} fill={sidebarBrowseTab === 'queries' ? '#fbbf24' : 'none'} />
          </button>
          <button
            className="icon-btn"
            title="Tambah Profil Database (MySQL / PostgreSQL / SSH Tunnel)"
            onClick={openAddProfileModal}
          >
            <Plus size={14} />
          </button>
          <button
            className="icon-btn"
            title="Muat Ulang Skema Tabel & Kolom"
            onClick={() => void handleIntrospect()}
            disabled={loadingSchema || !selectedDbProfileId}
          >
            <RefreshCw size={13} className={loadingSchema ? 'spin' : ''} />
          </button>
          <button
            className="icon-btn"
            title="Buka SQL Query Runner & Tabel Lebar"
            onClick={() => setWideModalOpen(true)}
          >
            <Maximize2 size={13} />
          </button>
        </div>
      </div>

      <div className="sidebar-scroll" style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Compact Connection & Tools Card */}
        <div
          style={{
            padding: 8,
            borderRadius: 7,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6
          }}
        >
          {/* Row 1: Profile Dropdown + Edit/Delete */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <select
              className="form-input"
              style={{ flex: 1, minWidth: 0, fontSize: 12, padding: '4px 7px', height: 28 }}
              value={selectedDbProfileId ?? ''}
              onChange={(e) => {
                const nextId = e.target.value || null;
                setSelectedDbProfileId(nextId);
                if (nextId) {
                  void handleIntrospect(nextId);
                } else {
                  setDbSchema(null);
                }
              }}
            >
              {dbProfiles.length === 0 ? (
                <option value="">-- Belum ada profil DB --</option>
              ) : (
                dbProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.isProduction ? '🔴 ' : ''}{p.name} ({p.engine.toUpperCase()})
                    {p.sshTunnelConnectionId ? ' • SSH' : ''}
                  </option>
                ))
              )}
            </select>
            {activeProfile && (
              <>
                <button
                  className="icon-btn"
                  title="Edit Profil Database"
                  onClick={() => openEditProfileModal(activeProfile)}
                >
                  <Pencil size={13} />
                </button>
                <button
                  className="icon-btn"
                  title="Hapus Profil Database"
                  onClick={() => void handleDeleteProfile()}
                >
                  <Trash2 size={13} />
                </button>
              </>
            )}
          </div>

          {/* Row 2: Active Database Switcher + Compact Baca Skema Button */}
          {activeProfile ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              {dbSchema && dbSchema.profileId === selectedDbProfileId && dbSchema.databases.length > 0 ? (
                <select
                  className="form-input"
                  style={{ flex: 1, minWidth: 0, fontSize: 11.5, padding: '3px 7px', height: 27 }}
                  title="Pilih Database Aktif"
                  value={dbSchema.currentDatabase}
                  onChange={(e) => void handleIntrospect(selectedDbProfileId ?? undefined, e.target.value)}
                >
                  {dbSchema.databases.map((dbName) => (
                    <option key={dbName} value={dbName}>
                      {dbName}
                    </option>
                  ))}
                </select>
              ) : (
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {activeProfile.username}@{activeProfile.host}:{activeProfile.port}
                </span>
              )}
              <button
                className="btn btn-primary"
                style={{ padding: '0 9px', height: 27, fontSize: 11, flexShrink: 0 }}
                disabled={loadingSchema}
                onClick={() => void handleIntrospect(activeProfile.id, undefined, true)}
                title="Baca / Muat ulang seluruh skema database dari server"
              >
                {loadingSchema ? (
                  <RefreshCw size={11} className="spin" />
                ) : (
                  <PlugZap size={11} />
                )}
                <span>{loadingSchema ? `${dbSchemaLoadingPercent}%` : 'Skema'}</span>
              </button>
            </div>
          ) : (
            <button
              className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center', fontSize: 12 }}
              onClick={openAddProfileModal}
            >
              <Plus size={13} /> Tambah Koneksi MySQL / PostgreSQL
            </button>
          )}

          {/* Row 3: Sleek Meta & Production Guard Pill */}
          {activeProfile && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 6,
                fontSize: 10.5,
                color: 'var(--text-muted)'
              }}
            >
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  minWidth: 0
                }}
                title={`${activeProfile.username}@${activeProfile.host}:${activeProfile.port}`}
              >
                {activeProfile.username}@{activeProfile.host}:{activeProfile.port}
                {activeProfile.sshTunnelConnectionId ? ' • 🔒 SSH' : ''}
              </span>
              {activeProfile.isProduction && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3,
                    padding: '1px 6px',
                    borderRadius: 999,
                    background: 'rgba(239, 68, 68, 0.16)',
                    border: '1px solid rgba(239, 68, 68, 0.45)',
                    color: '#fca5a5',
                    fontSize: 10,
                    fontWeight: 700,
                    flexShrink: 0,
                    whiteSpace: 'nowrap'
                  }}
                  title="DATABASE PRODUKSI — Pengaman SQL Aktif (Konfirmasi sebelum UPDATE/DELETE/DROP)"
                >
                  <ShieldAlert size={10} /> PROD
                </span>
              )}
            </div>
          )}

          {/* Row 4: Ultra-Clean 3-Button Primary Strip + Grouped Collapsible Tools Menu */}
          {activeProfile && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 4, marginTop: 1 }}>
                <button
                  className="btn"
                  style={{
                    minWidth: 0,
                    justifyContent: 'center',
                    fontSize: 10.5,
                    fontWeight: 600,
                    padding: '4px 4px',
                    gap: 4,
                    color: '#6ee7b7',
                    borderColor: 'rgba(16, 185, 129, 0.4)',
                    background: 'rgba(16, 185, 129, 0.08)'
                  }}
                  title="Buka Visual Query Builder bergaya Navicat (Tarik Tabel ke Kanvas, JOIN, PHP/Laravel & Export Excel)"
                  onClick={() => openVisualJoinBuilder()}
                >
                  <Link2 size={11} style={{ color: '#34d399', flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    Builder
                  </span>
                </button>

                <button
                  className="btn"
                  style={{
                    minWidth: 0,
                    justifyContent: 'center',
                    fontSize: 10.5,
                    fontWeight: 600,
                    padding: '4px 4px',
                    gap: 4,
                    color: '#7dd3fc',
                    borderColor: 'rgba(56, 189, 248, 0.4)',
                    background: 'rgba(56, 189, 248, 0.08)'
                  }}
                  title="Buka MySQL Workbench Performance Dashboard & Health Monitor"
                  onClick={() => setServerMonitorOpen(true, 'mysql-dashboard')}
                >
                  <Activity size={11} style={{ color: '#38bdf8', flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    Monitor
                  </span>
                </button>

                <button
                  type="button"
                  className={`btn ${toolsMenuOpen ? 'btn-accent' : ''}`}
                  style={{
                    minWidth: 0,
                    justifyContent: 'center',
                    fontSize: 10.5,
                    fontWeight: 600,
                    padding: '4px 4px',
                    gap: 3
                  }}
                  title="Tampilkan / Sembunyikan Menu Alat Database Lainnya (ER Diagram, Diff, Sync, Backup, Import .XLSX, dll.)"
                  onClick={() => setToolsMenuOpen((v) => !v)}
                >
                  <LayoutGrid size={11} style={{ flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    Alat
                  </span>
                  <ChevronDown
                    size={10}
                    style={{
                      flexShrink: 0,
                      transform: toolsMenuOpen ? 'rotate(180deg)' : 'none',
                      transition: 'transform 0.15s ease'
                    }}
                  />
                </button>
              </div>

              {toolsMenuOpen && (
                <div
                  style={{
                    marginTop: 2,
                    padding: 7,
                    borderRadius: 6,
                    background: 'var(--bg-app)',
                    border: '1px solid var(--border-subtle)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 7
                  }}
                >
                  {/* Group 1: Arsitektur & Skema */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div
                      style={{
                        fontSize: 9.5,
                        fontWeight: 700,
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                        color: 'var(--text-muted)'
                      }}
                    >
                      Arsitektur &amp; Skema
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 4 }}>
                      <button
                        className="btn"
                        style={{ justifyContent: 'flex-start', fontSize: 11, padding: '4px 7px' }}
                        title="Visual ER Diagram Interaktif"
                        onClick={() => {
                          setToolsMenuOpen(false);
                          setDbArchitectTab('er');
                        }}
                      >
                        <Network size={12} style={{ color: '#38bdf8' }} /> ER Diagram
                      </button>
                      <button
                        className="btn"
                        style={{ justifyContent: 'flex-start', fontSize: 11, padding: '4px 7px' }}
                        title="Bandingkan Skema 2 Database & Buat Script ALTER TABLE"
                        onClick={() => {
                          setToolsMenuOpen(false);
                          setDbArchitectTab('diff');
                        }}
                      >
                        <GitCompare size={12} style={{ color: '#a855f7' }} /> Schema Diff
                      </button>
                      <button
                        className="btn"
                        style={{ justifyContent: 'flex-start', fontSize: 11, padding: '4px 7px' }}
                        title="Buat Tabel Baru secara Visual"
                        onClick={() => {
                          setToolsMenuOpen(false);
                          openTableDesigner({ mode: 'create' });
                        }}
                      >
                        <Plus size={12} style={{ color: '#34d399' }} /> Tabel Baru
                      </button>
                      <button
                        className="btn"
                        style={{ justifyContent: 'flex-start', fontSize: 11, padding: '4px 7px' }}
                        title="Manajer View, Stored Procedure, Function & Trigger"
                        onClick={() => {
                          setToolsMenuOpen(false);
                          setDbRoutinesModalOpen(true);
                        }}
                      >
                        <Code2 size={12} style={{ color: '#c084fc' }} /> View / Proc
                      </button>
                      <button
                        className="btn"
                        style={{ gridColumn: '1 / -1', justifyContent: 'flex-start', fontSize: 11, padding: '4px 7px' }}
                        title="Buat Kamus Data SPBE / BAST Siap Cetak (.HTML / PDF)"
                        onClick={() => {
                          setToolsMenuOpen(false);
                          if (!selectedDbProfileId) return;
                          void window.aptana.db
                            .exportDataDictionary(selectedDbProfileId, {
                              database: dbSchema?.currentDatabase,
                              format: 'html'
                            })
                            .then((res) => {
                              if (!res.canceled) {
                                showToast(`📘 Kamus Data dibuat (${res.tableCount} tabel)!`);
                              }
                            })
                            .catch((err) =>
                              showToast(`Gagal ekspor Kamus Data: ${err instanceof Error ? err.message : String(err)}`)
                            );
                        }}
                      >
                        <BookOpen size={12} style={{ color: '#38bdf8' }} /> Ekspor Kamus Data (SPBE / HTML)
                      </button>
                    </div>
                  </div>

                  {/* Group 2: Data & Migrasi */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div
                      style={{
                        fontSize: 9.5,
                        fontWeight: 700,
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                        color: 'var(--text-muted)'
                      }}
                    >
                      Data &amp; Migrasi
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 4 }}>
                      <button
                        className="btn"
                        style={{ justifyContent: 'flex-start', fontSize: 11, padding: '4px 7px' }}
                        title="Sinkronisasi Isi Data Antar-DB + Masking"
                        onClick={() => {
                          setToolsMenuOpen(false);
                          setDbArchitectTab('sync');
                        }}
                      >
                        <RefreshCw size={12} style={{ color: '#38bdf8' }} /> Data Sync
                      </button>
                      <button
                        className="btn"
                        style={{ justifyContent: 'flex-start', fontSize: 11, padding: '4px 7px' }}
                        title="Impor Multi-Sheet Excel (.XLSX) & Clipboard + Dry-Run"
                        onClick={() => {
                          setToolsMenuOpen(false);
                          openExcelImportModal();
                        }}
                      >
                        <FileSpreadsheet size={12} style={{ color: '#34d399' }} /> Import .XLSX
                      </button>
                      <button
                        className="btn"
                        style={{ justifyContent: 'flex-start', fontSize: 11, padding: '4px 7px' }}
                        title="Backup Dump Skema & Data (.sql)"
                        onClick={() => {
                          setToolsMenuOpen(false);
                          void handleExportSqlDump();
                        }}
                      >
                        <HardDriveDownload size={12} style={{ color: '#fbbf24' }} /> Backup .SQL
                      </button>
                      <button
                        className="btn"
                        style={{ justifyContent: 'flex-start', fontSize: 11, padding: '4px 7px' }}
                        title="Cari ID / NIP / NIB di seluruh tabel sekaligus"
                        onClick={() => {
                          setToolsMenuOpen(false);
                          setDbGlobalSearchModalOpen(true);
                        }}
                      >
                        <Search size={12} style={{ color: '#fde047' }} /> Cari Isi DB
                      </button>
                      <button
                        className="btn"
                        style={{ gridColumn: '1 / -1', justifyContent: 'flex-start', fontSize: 11, padding: '4px 7px' }}
                        title="Smart Data Seeder Indonesia (NIP, NIK, Nama, FK valid)"
                        onClick={() => {
                          setToolsMenuOpen(false);
                          openDbSeeder();
                        }}
                      >
                        <FlaskConical size={12} style={{ color: '#34d399' }} /> Smart Data Seeder Indonesia
                      </button>
                    </div>
                  </div>

                  {/* Group 3: Operasional & Audit */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div
                      style={{
                        fontSize: 9.5,
                        fontWeight: 700,
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                        color: 'var(--text-muted)'
                      }}
                    >
                      Operasional &amp; Keamanan
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 4 }}>
                      <button
                        className="btn"
                        style={{ justifyContent: 'flex-start', fontSize: 11, padding: '4px 7px' }}
                        title="Pantau Query Aktif & Kill Query Macet"
                        onClick={() => {
                          setToolsMenuOpen(false);
                          setServerMonitorOpen(true, 'processlist');
                        }}
                      >
                        <Activity size={12} style={{ color: '#34d399' }} /> Processlist
                      </button>
                      <button
                        className="btn"
                        style={{ justifyContent: 'flex-start', fontSize: 11, padding: '4px 7px' }}
                        title="Jadwal Otomatis Backup .SQL & Export .XLSX"
                        onClick={() => {
                          setToolsMenuOpen(false);
                          setDbSchedulerModalOpen(true);
                        }}
                      >
                        <Clock size={12} style={{ color: '#38bdf8' }} /> Jadwal Auto
                      </button>
                      <button
                        className="btn"
                        style={{ justifyContent: 'flex-start', fontSize: 11, padding: '4px 7px' }}
                        title="Manajer User, Role & Hak Akses MySQL/PostgreSQL + Audit Keamanan"
                        onClick={() => {
                          setToolsMenuOpen(false);
                          setDbRbacModalOpen(true);
                        }}
                      >
                        <Users size={12} style={{ color: '#c084fc' }} /> User &amp; RBAC
                      </button>
                      <button
                        className="btn"
                        style={{ justifyContent: 'flex-start', fontSize: 11, padding: '4px 7px' }}
                        title="Enterprise Audit Trail & 1-Click SQL Undo"
                        onClick={() => {
                          setToolsMenuOpen(false);
                          setAuditModalOpen(true);
                        }}
                      >
                        <ShieldCheck size={12} style={{ color: '#34d399' }} /> Audit &amp; Undo
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Live Database Load Progress Banner */}
        {loadingSchema && (
          <div
            style={{
              padding: '8px 10px',
              borderRadius: 6,
              background: 'rgba(56, 189, 248, 0.12)',
              border: '1px solid rgba(56, 189, 248, 0.42)',
              color: '#bae6fd',
              fontSize: 11.5,
              display: 'flex',
              flexDirection: 'column',
              gap: 5
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
              <strong style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <RefreshCw size={12} className="spin" color="#38bdf8" />
                <span>
                  Memuat Database{dbSchemaLoadingTargetDb ? ` "${dbSchemaLoadingTargetDb}"` : ''}...
                </span>
              </strong>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: '#38bdf8' }}>
                {dbSchemaLoadingPercent}%
              </span>
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--text-secondary)' }}>
              {dbSchemaLoadingMessage || 'Mengambil daftar tabel, kolom, & relasi Foreign Key...'}
            </div>
            <div
              style={{
                height: 4,
                borderRadius: 999,
                background: 'rgba(15, 23, 42, 0.7)',
                overflow: 'hidden'
              }}
            >
              <div
                style={{
                  width: `${Math.max(8, dbSchemaLoadingPercent)}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #38bdf8, #34d399)',
                  transition: 'width 0.22s ease'
                }}
              />
            </div>
          </div>
        )}

        {/* Schema Error Banner */}
        {schemaError && (
          <div
            style={{
              padding: '8px 10px',
              borderRadius: 6,
              background: 'rgba(239, 68, 68, 0.14)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              color: '#fca5a5',
              fontSize: 11.5,
              lineHeight: 1.4
            }}
          >
            <strong>Gagal Terhubung ke Database:</strong> {schemaError}
          </div>
        )}

        {/* Primary 2-Tab Switcher: Tabel & SQL vs Query Tersimpan (1-Click Access!) */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: 4,
            padding: 3,
            borderRadius: 7,
            background: 'var(--bg-app)',
            border: '1px solid var(--border-subtle)'
          }}
        >
          <button
            type="button"
            className={`btn ${sidebarBrowseTab === 'tables' ? 'btn-accent' : 'btn-ghost'}`}
            style={{
              minWidth: 0,
              justifyContent: 'center',
              padding: '4px 6px',
              fontSize: 11,
              fontWeight: 600,
              gap: 5
            }}
            onClick={() => setSidebarBrowseTab('tables')}
            title="Jelajahi Tabel, Kolom & SQL Cepat"
          >
            <Table2 size={12} style={{ flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Tabel{dbSchema && dbSchema.profileId === selectedDbProfileId ? ` (${dbSchema.tables.length})` : ''}
            </span>
          </button>
          <button
            type="button"
            className={`btn ${sidebarBrowseTab === 'queries' ? 'btn-accent' : 'btn-ghost'}`}
            style={{
              minWidth: 0,
              justifyContent: 'center',
              padding: '4px 6px',
              fontSize: 11,
              fontWeight: 600,
              gap: 5,
              color:
                sidebarBrowseTab === 'queries'
                  ? '#ffffff'
                  : savedSqlQueries.length > 0
                    ? '#fde68a'
                    : undefined
            }}
            onClick={() => {
              setSidebarSaveFormMode(false);
              setSidebarBrowseTab('queries');
            }}
            title="Buka Pustaka Query SQL Tersimpan & Riwayat Eksekusi"
          >
            <Star
              size={12}
              style={{ flexShrink: 0 }}
              fill={sidebarBrowseTab === 'queries' ? '#ffffff' : savedSqlQueries.length > 0 ? '#fbbf24' : 'none'}
            />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Query ({savedSqlQueries.length})
            </span>
          </button>
        </div>

        {/* TAB: SAVED QUERIES & HISTORY (Full Sidebar Height, 1-Click Run / Load) */}
        {sidebarBrowseTab === 'queries' && (
          <SavedQueryDrawerPanel
            compact
            fullHeight
            defaultShowSaveForm={sidebarSaveFormMode}
            currentSql={sqlText}
            activeSavedId={activeSavedQueryId}
            onSaved={(it) => {
              setActiveSavedQueryId(it.id);
              setSidebarSaveFormMode(false);
            }}
            onLoadSql={(sql, it) => {
              if (it) {
                handleQuickLoadSavedQuery(it, false, true);
              } else {
                setSqlText(sql);
                setActiveSavedQueryId(null);
                setWideModalOpen(true);
              }
            }}
            onExecuteSql={(sql, it) => {
              if (it) {
                handleQuickLoadSavedQuery(it, true, true);
              } else {
                setSqlText(sql);
                setActiveSavedQueryId(null);
                void executeSqlQuery(sql, true);
              }
            }}
          />
        )}

        {/* TAB: TABLES & QUICK SQL */}
        {sidebarBrowseTab === 'tables' && (
          <>
        {/* Quick SQL Runner Box (Compact & Collapsible) */}
        <div
          style={{
            padding: 8,
            borderRadius: 7,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
            <button
              type="button"
              onClick={() => setQuickSqlExpanded((v) => !v)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                background: 'transparent',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                color: 'var(--text-primary)',
                fontSize: 11.5,
                fontWeight: 700,
                whiteSpace: 'nowrap',
                minWidth: 0
              }}
              title={
                dbSchema && dbSchema.profileId === selectedDbProfileId
                  ? `Auto-Suggest Aktif: ${dbSchema.databases.length} DB • ${(dbSchema.allTables ?? dbSchema.tables).length} Tabel (Klik untuk lipat/buka)`
                  : 'Klik untuk lipat / buka editor SQL Cepat'
              }
            >
              {quickSqlExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <span>SQL Query</span>
              {dbSchema && dbSchema.profileId === selectedDbProfileId && (
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: '#34d399',
                    display: 'inline-block',
                    flexShrink: 0
                  }}
                />
              )}
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
              <button
                className="btn"
                style={{ padding: '2px 7px', fontSize: 10.5, color: '#fde68a' }}
                onClick={() => {
                  setSidebarSaveFormMode(true);
                  setSidebarBrowseTab('queries');
                }}
                title="Simpan Query SQL ini ke Pustaka Query Tersimpan"
              >
                <Save size={11} /> Simpan
              </button>
              <button
                className="icon-btn"
                style={{ color: '#38bdf8' }}
                onClick={() =>
                  openReportGenerator({
                    sqlQuery: sqlText,
                    columns: queryResult?.columns ?? []
                  })
                }
                title="Generate File Laporan PHP (*_cetak.php & *_excel.php) dari Query SQL ini"
              >
                <FileSpreadsheet size={13} />
              </button>
              <button
                className="icon-btn"
                onClick={() => setWideModalOpen(true)}
                title="Buka SQL Query Runner & Full Data Grid Layar Lebar"
              >
                <Maximize2 size={13} />
              </button>
            </div>
          </div>

          {quickSqlExpanded && (
            <>
              <SqlMonacoEditor
                compact
                height={64}
                value={sqlText}
                onChange={setSqlText}
                onExecute={() => void executeSqlQuery(undefined, true)}
                placeholder="SELECT * FROM nama_tabel LIMIT 50;"
              />

              {/* Compact Auto-Detected SQL Parameter Inputs in Sidebar */}
              {inlineSqlParams.length > 0 && (
                <div
                  style={{
                    padding: '6px 7px',
                    borderRadius: 6,
                    background: 'rgba(56, 189, 248, 0.09)',
                    border: '1px solid rgba(56, 189, 248, 0.38)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 5
                  }}
                >
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: '#7dd3fc', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <SlidersHorizontal size={11} /> Parameter Query (Enter untuk jalankan)
                  </div>
                  {inlineSqlParams.map((p, idx) => (
                    <div key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <code style={{ fontSize: 10.5, color: '#fde68a', minWidth: 46 }}>{p.displayToken}</code>
                      <input
                        ref={!wideModalOpen && idx === 0 ? firstInlineParamRef : undefined}
                        className="form-input"
                        style={{ flex: 1, height: 24, fontSize: 11, padding: '2px 6px', fontFamily: 'var(--font-mono)' }}
                        placeholder={`Isi ${p.key}...`}
                        value={inlineParamValues[p.key] ?? ''}
                        onChange={(e) =>
                          setInlineParamValues((prev) => ({ ...prev, [p.key]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void executeSqlQuery(sqlText, true, false, { keepEditorTemplate: true });
                          }
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', gap: 5 }}>
                <button
                  className="btn btn-primary"
                  style={{ flex: 1, justifyContent: 'center', fontSize: 11, padding: '4px 8px' }}
                  disabled={runningQuery || !selectedDbProfileId}
                  onClick={() => void executeSqlQuery(undefined, true)}
                  title="Jalankan Query (Ctrl+Enter)"
                >
                  <Play size={11} /> {runningQuery ? 'Menjalankan...' : 'Jalankan (Ctrl+Enter)'}
                </button>
                <button
                  className="btn"
                  style={{ fontSize: 11, padding: '4px 8px' }}
                  disabled={aiBusy || !sqlText.trim()}
                  onClick={() => void handleAskAiExplainSql()}
                  title="Optimasi & Jelaskan Query dengan Gemini AI"
                >
                  <Sparkles size={11} /> AI
                </button>
              </div>

              {queryError && (
                <div style={{ fontSize: 11, color: '#fca5a5', marginTop: 2 }}>{queryError}</div>
              )}

              {queryResult && (
                <div
                  style={{
                    marginTop: 2,
                    padding: '5px 7px',
                    borderRadius: 5,
                    background: 'rgba(16, 185, 129, 0.1)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 6,
                    flexWrap: 'wrap',
                    fontSize: 10.5
                  }}
                >
                  <span>
                    <strong>{queryResult.rowCount}</strong> baris • {queryResult.durationMs} ms
                  </span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {queryResult.columns.length > 0 && (
                      <button
                        className="btn"
                        style={{
                          padding: '2px 6px',
                          fontSize: 10,
                          color: '#6ee7b7',
                          borderColor: 'rgba(16, 185, 129, 0.45)'
                        }}
                        disabled={exportingXlsx}
                        onClick={() => void handleExportExcel()}
                        title="Export hasil query ini langsung ke file Microsoft Excel (.xlsx)"
                      >
                        <FileSpreadsheet size={10} /> Excel
                      </button>
                    )}
                    <button
                      className="btn"
                      style={{ padding: '2px 6px', fontSize: 10 }}
                      onClick={() => setWideModalOpen(true)}
                    >
                      Lihat Data
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Schema Explorer Tree */}
        {dbSchema && dbSchema.profileId === selectedDbProfileId && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>
                TABEL &amp; VIEW ({filteredTables.length}/{dbSchema.tables.length})
              </span>
              <span style={{ fontSize: 10.5, color: 'var(--accent)' }}>
                Autocomplete Aktif ✓
              </span>
            </div>

            <input
              className="form-input"
              style={{ fontSize: 11.5, padding: '5px 8px' }}
              placeholder="Filter nama tabel atau kolom..."
              value={tableFilter}
              onChange={(e) => setTableFilter(e.target.value)}
            />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {filteredTables.slice(0, sidebarTableLimit).map((tbl) => {
                const isExp = Boolean(expandedTables[tbl.name]);
                return (
                  <div
                    key={tbl.name}
                    style={{
                      borderRadius: 5,
                      border: '1px solid var(--border-subtle)',
                      background: 'var(--bg-elevated)',
                      overflow: 'hidden'
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        padding: '5px 7px',
                        cursor: 'pointer'
                      }}
                      onClick={() =>
                        setExpandedTables((s) => ({ ...s, [tbl.name]: !s[tbl.name] }))
                      }
                    >
                      {isExp ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      <Table2 size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                      <span
                        style={{
                          flex: 1,
                          fontSize: 12,
                          fontWeight: 600,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                        title={`${tbl.name} (${tbl.columns.length} kolom)`}
                      >
                        {tbl.name}
                      </span>
                      {tbl.kind === 'view' && (
                        <span className="badge" style={{ fontSize: 9.5 }}>
                          VIEW
                        </span>
                      )}
                      <button
                        className="btn"
                        style={{ padding: '1px 6px', fontSize: 10, flexShrink: 0 }}
                        title={`Tampilkan 100 baris pertama dari ${tbl.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectTopRows(tbl);
                        }}
                      >
                        DATA
                      </button>
                    </div>

                    {isExp && (
                      <div
                        style={{
                          borderTop: '1px solid var(--border-subtle)',
                          padding: '6px 8px 6px 18px',
                          background: 'rgba(0,0,0,0.16)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 3
                        }}
                      >
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
                          <button
                            className="btn"
                            style={{
                              padding: '2px 6px',
                              fontSize: 10,
                              color: '#38bdf8',
                              borderColor: 'rgba(56, 189, 248, 0.4)'
                            }}
                            onClick={() =>
                              openVisualJoinBuilder([
                                {
                                  schema: tbl.schema ?? dbSchema.currentDatabase,
                                  name: tbl.name
                                }
                              ])
                            }
                            title={`Rakit Query JOIN dengan tabel ${tbl.name} sebagai tabel utama`}
                          >
                            <Link2 size={10} /> JOIN
                          </button>
                          <button
                            className="btn"
                            style={{ padding: '2px 6px', fontSize: 10 }}
                            title={`Lacak semua query & file PHP yang memakai tabel ${tbl.name} (Shift+F12)`}
                            onClick={() => findReferencesForSymbol(tbl.name)}
                          >
                            <Search size={10} /> Lacak
                          </button>
                          {tbl.kind === 'table' && (
                            <button
                              className="btn"
                              style={{ padding: '2px 6px', fontSize: 10, color: '#38bdf8' }}
                              title={`Visual Table Designer: Tambah/Ubah kolom, tipe, indeks, & FK pada ${tbl.name}`}
                              onClick={() =>
                                openTableDesigner({
                                  mode: 'alter',
                                  table: tbl,
                                  schema: tbl.schema || dbSchema.currentDatabase
                                })
                              }
                            >
                              <SlidersHorizontal size={10} /> Desain
                            </button>
                          )}
                          <button
                            className="btn"
                            style={{
                              padding: '2px 6px',
                              fontSize: 10,
                              color: '#c4b5fd',
                              borderColor: 'rgba(139, 92, 246, 0.4)'
                            }}
                            title={`1-Klik Generate Modul CRUD Wisanggeni (_idx, _form, _save) dari tabel ${tbl.name}`}
                            onClick={() => void triggerWisanggeniCrudFromTable(tbl, dbSchema.engine)}
                          >
                            <Zap size={10} /> CRUD
                          </button>
                          {tbl.kind === 'table' && (
                            <button
                              className="btn"
                              style={{ padding: '2px 6px', fontSize: 10, color: '#34d399' }}
                              title={`Isi data uji Indonesia realistis (Seeder) ke tabel ${tbl.name}`}
                              onClick={() => openDbSeeder(tbl)}
                            >
                              <FlaskConical size={10} /> Seed
                            </button>
                          )}
                          <button
                            className="btn"
                            style={{ padding: '2px 6px', fontSize: 10 }}
                            onClick={() => void handleCopyDdl(tbl)}
                          >
                            <Copy size={10} /> DDL
                          </button>
                          <button
                            className="btn"
                            style={{
                              padding: '2px 6px',
                              fontSize: 10,
                              color: '#6ee7b7',
                              borderColor: 'rgba(16, 185, 129, 0.4)'
                            }}
                            disabled={exportingXlsx}
                            onClick={() => void handleExportTableExcelDirect(tbl)}
                            title={`Export isi tabel ${tbl.name} ke Microsoft Excel (.xlsx)`}
                          >
                            <FileSpreadsheet size={10} /> .XLSX
                          </button>
                          <button
                            className="btn"
                            style={{ padding: '2px 6px', fontSize: 10 }}
                            onClick={() => void handleExportSqlDump([tbl.name])}
                            title={`Backup skema & data tabel ${tbl.name} ke file .SQL`}
                          >
                            <HardDriveDownload size={10} /> .SQL
                          </button>
                          {tbl.kind === 'table' && (
                            <>
                              <button
                                className="btn"
                                style={{ padding: '2px 6px', fontSize: 10 }}
                                onClick={() => void handleImportCsvToTable(tbl.name)}
                                title={`Impor baris dari file CSV ke tabel ${tbl.name}`}
                              >
                                <Upload size={10} /> CSV
                              </button>
                              <button
                                className="btn"
                                style={{
                                  padding: '2px 6px',
                                  fontSize: 10,
                                  color: '#34d399',
                                  borderColor: 'rgba(52, 211, 153, 0.45)'
                                }}
                                onClick={() => openExcelImportModal(tbl.name)}
                                title={`Impor file Excel (.xlsx) atau Paste Excel dengan Dry-Run Rollback ke tabel ${tbl.name}`}
                              >
                                <FileSpreadsheet size={10} /> Import .XLSX
                              </button>
                            </>
                          )}
                        </div>
                        {tbl.columns.map((col) => (
                          <div
                            key={col.name}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 6,
                              fontSize: 11
                            }}
                          >
                            <span
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                                fontFamily: 'var(--font-mono)',
                                color: col.isPrimaryKey ? '#fcd34d' : 'var(--text-primary)'
                              }}
                            >
                              {col.isPrimaryKey && <KeyRound size={10} />}
                              {col.name}
                            </span>
                            <span
                              style={{
                                fontSize: 10.5,
                                color: 'var(--text-muted)',
                                fontFamily: 'var(--font-mono)'
                              }}
                            >
                              {col.columnType}
                              {!col.nullable ? ' NOT NULL' : ''}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {filteredTables.length > sidebarTableLimit && (
                <button
                  type="button"
                  className="btn"
                  style={{ marginTop: 4, justifyContent: 'center', fontSize: 11 }}
                  onClick={() => setSidebarTableLimit((n) => n + 300)}
                >
                  + Tampilkan Lebih Banyak ({filteredTables.length - sidebarTableLimit} tabel lagi)
                </button>
              )}
            </div>
          </div>
        )}
          </>
        )}
      </div>

      {/* Modal 1: Add / Edit DB Profile */}
      {profileModalOpen && (
        <div className="modal-backdrop">
          <div
            className="modal-card"
            style={{ width: 520, maxWidth: '94vw' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3 style={{ margin: 0, fontSize: 14, display: 'flex', alignItems: 'center', gap: 7, minHeight: 30 }}>
                <Database size={16} color="var(--accent)" />
                {editingProfileId ? 'Edit Profil Database' : 'Tambah Koneksi Database Baru'}
              </h3>
              <button
                type="button"
                className="btn-modal-exit"
                onClick={() => setProfileModalOpen(false)}
              >
                <X size={14} />
                <span>Keluar</span>
              </button>
            </div>

            <div className="modal-body" style={{ gap: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label className="form-label">Nama Profil</label>
                  <input
                    className="form-input"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="DB Produksi / Lokal"
                  />
                </div>
                <div>
                  <label className="form-label">Engine Database</label>
                  <select
                    className="form-input"
                    value={formEngine}
                    onChange={(e) => {
                      const eng = e.target.value as DbEngine;
                      setFormEngine(eng);
                      if (eng === 'postgres' && formPort === 3306) setFormPort(5432);
                      if (eng === 'mysql' && formPort === 5432) setFormPort(3306);
                    }}
                  >
                    <option value="mysql">MySQL / MariaDB</option>
                    <option value="postgres">PostgreSQL</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="form-label">
                  SSH Tunnel Otomatis via Profil SFTP (Opsional — untuk DB Intranet Tertutup)
                </label>
                <select
                  className="form-input"
                  value={formSshTunnelId}
                  onChange={(e) => setFormSshTunnelId(e.target.value)}
                >
                  <option value="">Tanpa SSH Tunnel (Koneksi TCP Langsung)</option>
                  {sftpConnections.map((c) => (
                    <option key={c.id} value={c.id}>
                      🔒 {c.name} ({c.username}@{c.host}:{c.port})
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
                <div>
                  <label className="form-label">
                    Host Database {formSshTunnelId ? '(di sisi server SSH, mis. 127.0.0.1)' : ''}
                  </label>
                  <input
                    className="form-input"
                    value={formHost}
                    onChange={(e) => setFormHost(e.target.value)}
                    placeholder="127.0.0.1"
                  />
                </div>
                <div>
                  <label className="form-label">Port</label>
                  <input
                    type="number"
                    className="form-input"
                    value={formPort}
                    onChange={(e) => setFormPort(Number(e.target.value))}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label className="form-label">Username DB</label>
                  <input
                    className="form-input"
                    value={formUsername}
                    onChange={(e) => setFormUsername(e.target.value)}
                  />
                </div>
                <div>
                  <label className="form-label">
                    Password DB {formHasSecret ? '(Tersimpan aman)' : ''}
                  </label>
                  <input
                    type="password"
                    className="form-input"
                    value={formPassword}
                    onChange={(e) => setFormPassword(e.target.value)}
                    placeholder={formHasSecret ? 'Kosongkan jika tetap' : 'Password database'}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10, alignItems: 'end' }}>
                <div>
                  <label className="form-label">Nama Database Default</label>
                  <input
                    className="form-input"
                    value={formDatabase}
                    onChange={(e) => setFormDatabase(e.target.value)}
                    placeholder="sipegi / wisanggeni / laravel"
                  />
                </div>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 12,
                    paddingBottom: 8,
                    cursor: 'pointer'
                  }}
                >
                  <input
                    type="checkbox"
                    checked={formSsl}
                    onChange={(e) => setFormSsl(e.target.checked)}
                  />
                  Gunakan SSL/TLS
                </label>
              </div>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 10px',
                  borderRadius: 6,
                  background: formIsProduction
                    ? 'rgba(239, 68, 68, 0.12)'
                    : 'var(--bg-elevated)',
                  border: `1px solid ${
                    formIsProduction ? 'rgba(239, 68, 68, 0.45)' : 'var(--border-subtle)'
                  }`,
                  cursor: 'pointer'
                }}
              >
                <input
                  type="checkbox"
                  checked={formIsProduction}
                  onChange={(e) => setFormIsProduction(e.target.checked)}
                />
                <div>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: formIsProduction ? '#fca5a5' : 'var(--text-primary)'
                    }}
                  >
                    🔴 Tandai sebagai Database PRODUKSI (Pengaman SQL Aktif)
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    Meminta konfirmasi pengaman sebelum menjalankan perintah ubah/hapus data pada database ini.
                  </div>
                </div>
              </label>

              {testStatus && (
                <div
                  style={{
                    padding: '8px 10px',
                    borderRadius: 6,
                    fontSize: 12,
                    background: testStatus.ok
                      ? 'rgba(16, 185, 129, 0.14)'
                      : 'rgba(239, 68, 68, 0.14)',
                    border: `1px solid ${testStatus.ok ? 'rgba(16,185,129,0.4)' : 'rgba(239,68,68,0.4)'}`,
                    color: testStatus.ok ? '#6ee7b7' : '#fca5a5'
                  }}
                >
                  {testStatus.text}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                <button
                  className="btn"
                  disabled={savingProfile}
                  onClick={() => void handleTestInModal()}
                >
                  <ShieldCheck size={14} /> Simpan &amp; Tes Koneksi
                </button>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn" onClick={() => setProfileModalOpen(false)}>
                    Tutup
                  </button>
                  <button
                    className="btn btn-primary"
                    disabled={savingProfile}
                    onClick={async () => {
                      const saved = await handleSaveProfile();
                      if (saved) {
                        setProfileModalOpen(false);
                        void handleIntrospect(saved.id);
                      }
                    }}
                  >
                    Simpan &amp; Buka Skema
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2: Wide SQL Runner & Inline Data Editor */}
      {wideModalOpen && (
        <div className="modal-backdrop">
          <div
            className="modal-card"
            style={{
              width: 'min(1160px, 96vw)',
              height: 'min(86vh, 820px)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header: Title on left, Keluar strictly pinned in top-right corner */}
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0, minHeight: 30 }}>
                <Database size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                <strong style={{ fontSize: 14 }}>SQL Query Runner &amp; Full Data Grid CRUD</strong>
                {activeProfile?.isProduction && (
                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 800,
                      padding: '2px 7px',
                      borderRadius: 4,
                      background: 'rgba(239, 68, 68, 0.2)',
                      border: '1px solid rgba(239, 68, 68, 0.5)',
                      color: '#fca5a5'
                    }}
                  >
                    🔴 PRODUKSI
                  </span>
                )}
                {dbSchema && (
                  <span className="badge">
                    {dbSchema.engine.toUpperCase()} • {dbSchema.currentDatabase}
                  </span>
                )}
              </div>

              <button
                type="button"
                className="btn-modal-exit"
                onClick={() => setWideModalOpen(false)}
                title="Keluar / Tutup Jendela"
              >
                <X size={14} />
                <span>Keluar</span>
              </button>
            </div>

            {/* Secondary Action Toolbar */}
            <div className="modal-subbar">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <button
                  className="btn"
                  style={{ fontSize: 11.5, color: '#6ee7b7' }}
                  onClick={() => {
                    setWideModalOpen(false);
                    openVisualJoinBuilder();
                  }}
                  title="Buka Visual JOIN Query Builder"
                >
                  <Link2 size={13} /> Rakit JOIN
                </button>
                <button
                  className={`btn ${wideSavedDrawerOpen ? 'btn-accent' : ''}`}
                  style={{ fontSize: 11.5 }}
                  onClick={() => setWideSavedDrawerOpen((v) => !v)}
                  title="Simpan Query atau Buka Pustaka Query Tersimpan & Riwayat"
                >
                  <BookMarked size={13} /> Simpan / Pustaka ({savedSqlQueries.length})
                </button>
                <button
                  className="btn"
                  style={{ fontSize: 11.5 }}
                  onClick={() => setServerMonitorOpen(true)}
                  title="Pantau Query Aktif & Kill Query"
                >
                  <Activity size={13} /> Processlist
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{
                    fontSize: 11.5,
                    fontWeight: 700,
                    color: isReadOnlyLocked ? '#fca5a5' : '#6ee7b7',
                    borderColor: isReadOnlyLocked
                      ? 'rgba(239, 68, 68, 0.5)'
                      : 'rgba(16, 185, 129, 0.45)',
                    background: isReadOnlyLocked
                      ? 'rgba(239, 68, 68, 0.14)'
                      : 'rgba(16, 185, 129, 0.12)'
                  }}
                  onClick={toggleReadOnlyLock}
                  title={
                    isReadOnlyLocked
                      ? 'Mode Read-Only AKTIF (semua edit/DELETE/UPDATE diblokir) — Klik untuk membuka kunci'
                      : 'Mode Edit Aktif — Klik untuk mengunci koneksi dalam mode Read-Only 100%'
                  }
                >
                  {isReadOnlyLocked ? <Lock size={12} /> : <Unlock size={12} />}
                  <span>{isReadOnlyLocked ? 'Read-Only' : 'Mode Edit'}</span>
                </button>
                <button
                  type="button"
                  className={`btn ${stagingMode ? 'btn-accent' : ''}`}
                  style={{ fontSize: 11.5 }}
                  onClick={() => {
                    setStagingMode((v) => !v);
                    showToast(
                      !stagingMode
                        ? '🛡️ Mode Safe Staging AKTIF: edit grid ditahan sebagai Pending Changes sampai Anda klik COMMIT.'
                        : '⚡ Mode Direct Save: edit sel langsung disimpan ke database.'
                    );
                  }}
                  title="Mode Safe Transaction Staging (TablePlus/DataGrip): tahan edit sel & hapus sebagai Pending Changes sebelum COMMIT / ROLLBACK"
                >
                  <ShieldCheck size={12} />
                  <span>{stagingMode ? 'Staging: ON' : 'Staging: OFF'}</span>
                </button>
              </div>

              {queryResult && queryResult.columns.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: 11,
                      color: 'var(--text-muted)',
                      cursor: 'pointer'
                    }}
                    title="Buka otomatis file .xlsx di Microsoft Excel setelah disimpan"
                  >
                    <input
                      type="checkbox"
                      checked={openExcelAfterSave}
                      onChange={(e) => setOpenExcelAfterSave(e.target.checked)}
                    />
                    Buka langsung
                  </label>
                  <button
                    className="btn"
                    style={{
                      fontSize: 11.5,
                      fontWeight: 700,
                      color: '#6ee7b7',
                      borderColor: 'rgba(16, 185, 129, 0.5)',
                      background: 'rgba(16, 185, 129, 0.14)'
                    }}
                    disabled={exportingXlsx}
                    onClick={() => void handleExportExcel()}
                    title="Export ke file Microsoft Excel (.xlsx) asli — menjaga angka 0 di depan & NIP 18 digit sebagai teks utuh"
                  >
                    <FileSpreadsheet size={13} />{' '}
                    {exportingXlsx ? 'Menyimpan...' : 'Export Excel (.xlsx)'}
                  </button>
                  <button className="btn" style={{ fontSize: 11.5 }} onClick={() => void handleExportCsv()}>
                    <Download size={13} /> Salin CSV
                  </button>
                  <button className="btn" style={{ fontSize: 11.5 }} onClick={() => void handleCopyInsertSql()}>
                    <Copy size={13} /> Salin INSERT SQL
                  </button>
                </div>
              )}
            </div>

            {/* 1-Click Saved Queries Quick-Access Strip (Always Visible When Saved Queries Exist) */}
            {quickSavedChips.length > 0 && (
              <div
                style={{
                  padding: '6px 16px',
                  borderBottom: '1px solid var(--border-subtle)',
                  background: 'var(--bg-surface)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  flexShrink: 0,
                  overflowX: 'auto'
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#fde68a',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    whiteSpace: 'nowrap',
                    flexShrink: 0
                  }}
                >
                  <Star size={11.5} fill="#fbbf24" color="#fbbf24" /> Query Tersimpan:
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, flex: 1, minWidth: 0, overflowX: 'auto' }}>
                  {quickSavedChips.map((q) => {
                    const isActiveChip = activeSavedQueryId === q.id;
                    return (
                      <button
                        key={q.id}
                        type="button"
                        className={`btn btn-xs ${isActiveChip ? 'btn-accent' : ''}`}
                        style={{
                          padding: '3px 8px',
                          fontSize: 11,
                          flexShrink: 0,
                          borderColor: isActiveChip
                            ? undefined
                            : q.isFavorite
                              ? 'rgba(251, 191, 36, 0.4)'
                              : undefined
                        }}
                        onClick={() => handleQuickLoadSavedQuery(q, false, false)}
                        onDoubleClick={() => handleQuickLoadSavedQuery(q, true, false)}
                        title={`${q.name}${q.folder ? ` [${q.folder}]` : ''} — Klik untuk muat, Klik 2x untuk jalankan\n${q.sql}`}
                      >
                        {q.isFavorite && (
                          <Star size={10} fill={isActiveChip ? '#ffffff' : '#fbbf24'} color={isActiveChip ? '#ffffff' : '#fbbf24'} />
                        )}
                        <span>{q.name}</span>
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  className={`btn btn-xs ${wideSavedDrawerOpen ? 'btn-accent' : ''}`}
                  style={{ padding: '3px 8px', fontSize: 10.5, flexShrink: 0 }}
                  onClick={() => setWideSavedDrawerOpen((v) => !v)}
                  title="Kelola semua Query Tersimpan, Folder, Simpan Baru, Impor/Ekspor, & Riwayat"
                >
                  <BookMarked size={11} /> Kelola ({savedSqlQueries.length})
                </button>
              </div>
            )}

            {wideSavedDrawerOpen && (
              <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
                <SavedQueryDrawerPanel
                  currentSql={sqlText}
                  activeSavedId={activeSavedQueryId}
                  onSaved={(it) => setActiveSavedQueryId(it.id)}
                  onLoadSql={(sql, it) => {
                    if (it) {
                      handleQuickLoadSavedQuery(it, false, false);
                    } else {
                      setSqlText(sql);
                      setActiveSavedQueryId(null);
                    }
                    setWideSavedDrawerOpen(false);
                  }}
                  onExecuteSql={(sql, it) => {
                    if (it) {
                      handleQuickLoadSavedQuery(it, true, false);
                    } else {
                      setSqlText(sql);
                      setActiveSavedQueryId(null);
                      void executeSqlQuery(sql, false);
                    }
                    setWideSavedDrawerOpen(false);
                  }}
                  onClose={() => setWideSavedDrawerOpen(false)}
                />
              </div>
            )}

            {/* Automatic Reusable SQL Template Parameter Bar (`{$id}`, `{{id}}`, `:id`, `$id`) */}
            {codeLensParams.length === 0 && inlineSqlParams.length > 0 && (
              <div
                style={{
                  padding: '8px 16px',
                  borderBottom: '1px solid rgba(56, 189, 248, 0.35)',
                  background: 'rgba(56, 189, 248, 0.09)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 8,
                    fontSize: 11.5
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#7dd3fc' }}>
                    <SlidersHorizontal size={13} />
                    <strong>Parameter Query Terdeteksi ({inlineSqlParams.length})</strong>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                      — Ketik nilainya lalu tekan <code>Enter</code> (template <code>{inlineSqlParams[0].displayToken}</code> tetap aman untuk dipakai ulang)
                    </span>
                  </span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      className="btn btn-xs"
                      onClick={() => {
                        const applied = applySqlInlineParams(sqlText, inlineSqlParams, inlineParamValues);
                        if (applied.missingKeys.length > 0) {
                          showToast(`Isi nilai "${applied.missingKeys.join(', ')}" terlebih dahulu.`);
                          firstInlineParamRef.current?.focus();
                          return;
                        }
                        setSqlText(applied.sql);
                        showToast('Nilai parameter telah disubstitusi permanen ke editor SQL.');
                      }}
                      title="Ganti placeholder di kotak editor SQL dengan nilai yang diketik"
                    >
                      Ganti di Editor
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary btn-xs"
                      disabled={runningQuery || !selectedDbProfileId}
                      onClick={() =>
                        void executeSqlQuery(sqlText, false, false, { keepEditorTemplate: true })
                      }
                    >
                      <Play size={11} /> Jalankan dengan Parameter (Enter)
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  {inlineSqlParams.map((p, idx) => (
                    <label
                      key={p.key}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 11.5,
                        background: 'var(--bg-surface)',
                        padding: '4px 8px',
                        borderRadius: 6,
                        border: '1px solid var(--border-subtle)'
                      }}
                    >
                      <code style={{ color: '#fde68a', fontWeight: 700 }}>{p.displayToken}</code>
                      <span style={{ color: 'var(--text-muted)' }}>=</span>
                      <input
                        ref={wideModalOpen && idx === 0 ? firstInlineParamRef : undefined}
                        className="form-input"
                        style={{
                          width: 170,
                          height: 25,
                          padding: '2px 7px',
                          fontSize: 12,
                          fontFamily: 'var(--font-mono)'
                        }}
                        placeholder={`Ketik nilai ${p.key}...`}
                        value={inlineParamValues[p.key] ?? ''}
                        onChange={(e) =>
                          setInlineParamValues((prev) => ({ ...prev, [p.key]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void executeSqlQuery(sqlText, false, false, {
                              keepEditorTemplate: true
                            });
                          }
                        }}
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Inline SQL CodeLens PHP Variable Parameter Bar */}
            {codeLensParams.length > 0 && codeLensTemplate && (
              <div
                style={{
                  padding: '8px 16px',
                  borderBottom: '1px solid var(--border-subtle)',
                  background: 'rgba(56, 189, 248, 0.08)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    fontSize: 11.5
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#7dd3fc' }}>
                    <SlidersHorizontal size={13} />
                    <strong>Parameter Uji Variabel PHP</strong>
                    {codeLensSourceTitle && (
                      <span style={{ color: 'var(--text-muted)' }}>dari {codeLensSourceTitle}</span>
                    )}
                  </span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      className="btn btn-primary"
                      style={{ padding: '2px 8px', fontSize: 11 }}
                      disabled={runningQuery || !selectedDbProfileId}
                      onClick={() => {
                        let nextSql = substituteSqlTestParams(
                          codeLensTemplate,
                          codeLensParams,
                          codeLensValues
                        );
                        if (codeLensMode === 'explain' && !/^\s*explain\b/i.test(nextSql)) {
                          nextSql = `EXPLAIN ${nextSql}`;
                        }
                        void executeSqlQuery(nextSql, false);
                      }}
                    >
                      <Play size={11} /> Terapkan &amp; Jalankan
                    </button>
                    <button
                      className="btn"
                      style={{ padding: '2px 7px', fontSize: 10.5 }}
                      onClick={() => {
                        setCodeLensParams([]);
                        setCodeLensTemplate(null);
                      }}
                    >
                      Tutup Parameter
                    </button>
                  </div>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                    gap: 8
                  }}
                >
                  {codeLensParams.map((p) => (
                    <label
                      key={p.key}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 2,
                        fontSize: 11
                      }}
                    >
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          color: '#fcd34d',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                        title={p.expr}
                      >
                        {p.expr}
                      </span>
                      <input
                        className="form-input"
                        style={{
                          padding: '3px 7px',
                          fontSize: 11.5,
                          fontFamily: 'var(--font-mono)'
                        }}
                        value={codeLensValues[p.key] ?? ''}
                        onChange={(e) => {
                          const nextVal = e.target.value;
                          const nextMap = { ...codeLensValues, [p.key]: nextVal };
                          setCodeLensValues(nextMap);
                          let nextSql = substituteSqlTestParams(
                            codeLensTemplate,
                            codeLensParams,
                            nextMap
                          );
                          if (codeLensMode === 'explain' && !/^\s*explain\b/i.test(nextSql)) {
                            nextSql = `EXPLAIN ${nextSql}`;
                          }
                          setSqlText(nextSql);
                        }}
                        placeholder="Nilai uji..."
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* SQL Input Area */}
            <div
              style={{
                padding: '10px 16px',
                borderBottom: '1px solid var(--border-subtle)',
                background: 'var(--bg-elevated)',
                display: 'flex',
                gap: 10,
                alignItems: 'stretch'
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <SqlMonacoEditor
                  height={92}
                  value={sqlText}
                  onChange={setSqlText}
                  onExecute={() => void executeSqlQuery(undefined, false)}
                  placeholder="Ketik SQL (otomatis suggestion tabel, kolom & klausa) lalu tekan Ctrl+Enter..."
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: 175 }}>
                <button
                  className="btn btn-primary"
                  style={{ flex: 1, justifyContent: 'center' }}
                  disabled={runningQuery || !selectedDbProfileId}
                  onClick={() => void executeSqlQuery(undefined, false)}
                >
                  <Play size={14} /> {runningQuery ? 'Menjalankan...' : 'Jalankan (Ctrl+Enter)'}
                </button>
                <button
                  className="btn"
                  style={{ justifyContent: 'center', fontSize: 11.5 }}
                  disabled={aiBusy || !sqlText.trim()}
                  onClick={() => void handleAskAiExplainSql()}
                >
                  <Sparkles size={13} /> {aiBusy ? 'Menganalisis...' : 'Optimasi / Jelaskan AI'}
                </button>
              </div>
            </div>

            {/* Optional AI Report */}
            {aiReport && (
              <div
                style={{
                  padding: '8px 16px',
                  borderBottom: '1px solid var(--border-subtle)',
                  background: 'rgba(139, 92, 246, 0.08)',
                  maxHeight: 140,
                  overflowY: 'auto',
                  fontSize: 12,
                  whiteSpace: 'pre-wrap'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <strong style={{ color: '#c4b5fd' }}>✨ Analisis SQL Gemini AI</strong>
                  <button className="btn" style={{ padding: '1px 6px', fontSize: 10.5 }} onClick={() => setAiReport(null)}>
                    Tutup Analisis
                  </button>
                </div>
                {aiReport}
              </div>
            )}

            {/* Status / Editable Info Banner */}
            {queryError && (
              <div
                style={{
                  padding: '8px 16px',
                  background: 'rgba(239, 68, 68, 0.14)',
                  color: '#fca5a5',
                  fontSize: 12
                }}
              >
                <strong>Error SQL:</strong> {queryError}
              </div>
            )}

            {queryResult && (
              <>
                <div
                  style={{
                    padding: '6px 16px',
                    borderBottom: '1px solid var(--border-subtle)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    flexWrap: 'wrap',
                    fontSize: 11.5,
                    color: 'var(--text-secondary)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span>
                      {queryResult.message ? (
                        <strong>{queryResult.message}</strong>
                      ) : (
                        <>
                          Menampilkan <strong>{queryResult.rows.length}</strong> baris
                          {queryResult.truncated ? ' (dibatasi 500 baris)' : ''} •{' '}
                          <strong>{queryResult.durationMs} ms</strong>
                        </>
                      )}
                    </span>

                    {queryResult.rows.length > 0 && (
                      <button
                        type="button"
                        className={`btn btn-xs ${wideChartOpen ? 'btn-accent' : ''}`}
                        onClick={() => setWideChartOpen((v) => !v)}
                        title="Tampilkan Grafik Visual (Bar / Line / Pie) & Tabel Pivot dari hasil query ini"
                      >
                        <BarChart3 size={11.5} /> Grafik &amp; Pivot
                      </button>
                    )}

                    <button
                      type="button"
                      className={`btn btn-xs ${visualExplainOpen ? 'btn-accent' : ''}`}
                      style={{ color: '#7dd3fc', borderColor: 'rgba(56, 189, 248, 0.45)' }}
                      onClick={() => void handleRunVisualExplain()}
                      title="Visual EXPLAIN ANALYZE Tree & Query Profiler (Before vs After Index Benchmark)"
                    >
                      <GitBranch size={11.5} /> Visual EXPLAIN
                    </button>

                    <button
                      type="button"
                      className={`btn btn-xs ${indexAdvisorOpen ? 'btn-accent' : ''}`}
                      style={{
                        borderColor:
                          indexRecommendations.length > 0
                            ? 'rgba(251, 191, 36, 0.5)'
                            : undefined,
                        color: indexRecommendations.length > 0 ? '#fbbf24' : undefined
                      }}
                      onClick={() => {
                        if (indexAdvisorOpen) setIndexAdvisorOpen(false);
                        else void handleRunIndexAdvisor();
                      }}
                      title="Analisis EXPLAIN & rekomendasi CREATE INDEX otomatis untuk mempercepat query"
                    >
                      <Zap size={11.5} /> Saran INDEX ({indexRecommendations.length})
                    </button>
                  </div>

                  {queryResult.editableTable ? (
                    <span style={{ color: '#6ee7b7' }}>
                      ✏️ Edit Langsung Aktif (Tabel <code>{queryResult.editableTable.table}</code> • PK:{' '}
                      <code>{queryResult.editableTable.primaryKeys.join(', ')}</code>) — Klik 2x sel untuk edit
                    </span>
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>
                      Mode Baca Saja (Gunakan SELECT dari 1 tabel ber-PK untuk edit sel langsung)
                    </span>
                  )}
                </div>

                {indexAdvisorOpen && (
                  <div
                    style={{
                      padding: '8px 16px',
                      borderBottom: '1px solid var(--border-subtle)',
                      background: 'rgba(245, 158, 11, 0.08)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong style={{ fontSize: 11.5, color: '#fcd34d' }}>
                        ⚡ Missing Index Advisor (Analisis Klausa JOIN / WHERE / ORDER BY + EXPLAIN)
                      </strong>
                      <button
                        type="button"
                        className="btn btn-xs"
                        onClick={() => setIndexAdvisorOpen(false)}
                      >
                        Tutup
                      </button>
                    </div>
                    {indexRecommendations.length === 0 ? (
                      <div style={{ fontSize: 11.5, color: '#86efac' }}>
                        ✓ Tidak ditemukan kolom JOIN / WHERE yang belum terindeks pada skema saat ini.
                      </div>
                    ) : (
                      indexRecommendations.map((rec) => (
                        <div
                          key={rec.id}
                          style={{
                            padding: '6px 9px',
                            borderRadius: 6,
                            background: 'var(--bg-surface)',
                            border: '1px solid var(--border-subtle)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 8,
                            flexWrap: 'wrap'
                          }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 11.5, fontWeight: 600 }}>{rec.reason}</div>
                            <code style={{ fontSize: 11, color: '#7dd3fc' }}>
                              {rec.createIndexSql}
                            </code>
                          </div>
                          <button
                            type="button"
                            className="btn btn-primary btn-xs"
                            disabled={creatingIndexId === rec.id}
                            onClick={() => void handleApplyRecommendedIndex(rec)}
                          >
                            <Zap size={11} />
                            <span>
                              {creatingIndexId === rec.id
                                ? 'Memasang...'
                                : 'Pasang INDEX Sekarang'}
                            </span>
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {wideChartOpen && queryResult.rows.length > 0 && (
                  <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
                    <QueryChartPivotPanel
                      columns={queryResult.columns}
                      rows={queryResult.rows}
                      title="Visualisasi Hasil Query SQL"
                    />
                  </div>
                )}
              </>
            )}

            {/* Quick WHERE Filter, CRUD Toolbar & Pagination for Editable Table */}
            {queryResult?.editableTable && (
              <div
                style={{
                  padding: '7px 16px',
                  borderBottom: '1px solid var(--border-subtle)',
                  background: 'var(--bg-surface)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  flexWrap: 'wrap'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 260 }}>
                  <Filter size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    WHERE
                  </span>
                  <input
                    className="form-input"
                    style={{
                      flex: 1,
                      fontSize: 11.5,
                      padding: '3px 8px',
                      fontFamily: 'var(--font-mono)'
                    }}
                    placeholder="contoh: kd_unitkerja LIKE '02%' AND aktif = 1"
                    value={gridWhereFilter}
                    onChange={(e) => setGridWhereFilter(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        refreshBrowseGrid({ whereClause: gridWhereFilter, offset: 0 });
                      }
                    }}
                  />
                  <button
                    className="btn"
                    style={{ fontSize: 11, padding: '3px 8px' }}
                    onClick={() => refreshBrowseGrid({ whereClause: gridWhereFilter, offset: 0 })}
                  >
                    Filter
                  </button>
                  {gridWhereFilter && (
                    <button
                      className="btn"
                      style={{ fontSize: 11, padding: '3px 7px' }}
                      onClick={() => refreshBrowseGrid({ whereClause: '', offset: 0 })}
                    >
                      Reset
                    </button>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <button
                    className="btn btn-primary"
                    style={{ fontSize: 11, padding: '3px 9px' }}
                    onClick={() => openInsertRowForm()}
                  >
                    <Plus size={12} /> Tambah Baris
                  </button>
                  <button
                    className="btn"
                    style={{ fontSize: 11, padding: '3px 8px' }}
                    onClick={() => void handleImportCsvToTable(queryResult.editableTable!.table)}
                    title="Impor baris dari file CSV ke tabel ini"
                  >
                    <Upload size={11} /> Import CSV
                  </button>
                  <button
                    className="btn"
                    style={{ fontSize: 11, padding: '3px 8px' }}
                    onClick={() => void handleExportSqlDump([queryResult.editableTable!.table])}
                    title="Backup tabel ini ke file .SQL"
                  >
                    <HardDriveDownload size={11} /> Backup .SQL
                  </button>

                  <select
                    className="form-input"
                    style={{ width: 88, fontSize: 11, padding: '2px 6px' }}
                    value={gridPageSize}
                    onChange={(e) => {
                      const nextLim = Number(e.target.value) || 100;
                      refreshBrowseGrid({ limit: nextLim, offset: 0 });
                    }}
                  >
                    <option value={50}>50 / hal</option>
                    <option value={100}>100 / hal</option>
                    <option value={250}>250 / hal</option>
                    <option value={500}>500 / hal</option>
                  </select>
                  <button
                    className="btn"
                    style={{ padding: '2px 6px', fontSize: 11 }}
                    disabled={gridOffset <= 0 || runningQuery}
                    onClick={() =>
                      refreshBrowseGrid({ offset: Math.max(0, gridOffset - gridPageSize) })
                    }
                    title="Halaman Sebelumnya"
                  >
                    <ChevronLeft size={12} /> Prev
                  </button>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    #{gridOffset + 1}–{gridOffset + queryResult.rows.length}
                  </span>
                  <button
                    className="btn"
                    style={{ padding: '2px 6px', fontSize: 11 }}
                    disabled={queryResult.rows.length < gridPageSize || runningQuery}
                    onClick={() => refreshBrowseGrid({ offset: gridOffset + gridPageSize })}
                    title="Halaman Berikutnya"
                  >
                    Next <ChevronRight size={12} />
                  </button>
                </div>
              </div>
            )}

            {/* Inline New / Duplicate Row Form */}
            {newRowOpen && queryResult?.editableTable && (
              <div
                style={{
                  padding: '10px 16px',
                  borderBottom: '1px solid var(--border-subtle)',
                  background: 'rgba(16, 185, 129, 0.07)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  maxHeight: 210,
                  overflowY: 'auto'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <strong style={{ fontSize: 12, color: '#6ee7b7' }}>
                    ➕ Tambah Baris Baru ke Tabel <code>{queryResult.editableTable.table}</code>
                  </strong>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      className="btn btn-primary"
                      style={{ fontSize: 11, padding: '3px 10px' }}
                      disabled={savingNewRow}
                      onClick={() => void handleSaveNewRow()}
                    >
                      <Check size={12} /> {savingNewRow ? 'Menyimpan...' : 'Simpan Baris ke DB'}
                    </button>
                    <button
                      className="btn"
                      style={{ fontSize: 11, padding: '3px 8px' }}
                      onClick={() => setNewRowOpen(false)}
                    >
                      Batal
                    </button>
                  </div>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
                    gap: 8
                  }}
                >
                  {queryResult.columns.map((col) => {
                    const isNull = Boolean(newRowNulls[col]);
                    return (
                      <div key={col} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            fontSize: 11,
                            fontFamily: 'var(--font-mono)'
                          }}
                        >
                          <span>{col}</span>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--text-muted)' }}>
                            <input
                              type="checkbox"
                              checked={isNull}
                              onChange={(e) =>
                                setNewRowNulls((prev) => ({ ...prev, [col]: e.target.checked }))
                              }
                            />
                            NULL/Auto
                          </label>
                        </div>
                        <input
                          className="form-input"
                          style={{ fontSize: 11.5, padding: '3px 7px', fontFamily: 'var(--font-mono)' }}
                          disabled={isNull || savingNewRow}
                          placeholder={isNull ? '(NULL / Auto)' : 'Nilai...'}
                          value={isNull ? '' : (newRowDraft[col] ?? '')}
                          onChange={(e) =>
                            setNewRowDraft((prev) => ({ ...prev, [col]: e.target.value }))
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Phase 30 #1: Safe Transaction Pending Changes Bar (COMMIT / ROLLBACK) */}
            {pendingMutations.length > 0 && (
              <div
                style={{
                  padding: '8px 16px',
                  borderBottom: '1px solid rgba(251, 191, 36, 0.45)',
                  background: 'rgba(245, 158, 11, 0.12)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#fde68a' }}>
                    ⏳ Safe Transaction Staging: {pendingMutations.length} perubahan tertunda (belum menyentuh DB live)
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button
                      type="button"
                      className="btn btn-xs"
                      onClick={() => setPendingPreviewOpen((v) => !v)}
                    >
                      <Eye size={11} /> {pendingPreviewOpen ? 'Sembunyikan SQL' : 'Preview SQL'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-xs"
                      style={{ color: '#fca5a5', borderColor: 'rgba(248, 113, 113, 0.45)' }}
                      disabled={committingTx}
                      onClick={handleRollbackPendingTx}
                    >
                      <Undo2 size={11} /> ROLLBACK (Batal)
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary btn-xs"
                      disabled={committingTx || isReadOnlyLocked}
                      onClick={() => void handleCommitPendingTx()}
                    >
                      <Check size={11} />{' '}
                      {committingTx ? 'Menyimpan...' : `COMMIT Transaksi (${pendingMutations.length})`}
                    </button>
                  </div>
                </div>
                {pendingPreviewOpen && (
                  <pre
                    style={{
                      margin: 0,
                      padding: 8,
                      borderRadius: 6,
                      background: 'var(--bg-app)',
                      border: '1px solid var(--border-subtle)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      maxHeight: 130,
                      overflowY: 'auto',
                      whiteSpace: 'pre-wrap'
                    }}
                  >
                    {pendingBatchInfo.previewSql}
                  </pre>
                )}
              </div>
            )}

            {/* Phase 30 #2: Visual EXPLAIN Execution Tree & Profiler Panel */}
            {visualExplainOpen && (
              <VisualExplainPanel
                report={visualExplainReport}
                loading={visualExplainLoading}
                error={visualExplainError}
                onRefresh={() => void handleRunVisualExplain()}
                onClose={() => setVisualExplainOpen(false)}
              />
            )}

            {/* Multi-Statement Result Tabs */}
            {multiResults.length > 1 && (
              <div
                style={{
                  padding: '6px 14px',
                  borderBottom: '1px solid var(--border-subtle)',
                  background: 'var(--bg-surface)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  overflowX: 'auto'
                }}
              >
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>
                  Multi-Query ({multiResults.length}):
                </span>
                {multiResults.map((item, idx) => (
                  <button
                    key={item.index}
                    type="button"
                    className={`btn btn-xs ${activeMultiIdx === idx ? 'btn-primary' : ''}`}
                    onClick={() => {
                      setActiveMultiIdx(idx);
                      setQueryResult(item.result ?? null);
                      setQueryError(item.error ?? null);
                    }}
                    title={item.sql}
                  >
                    #{item.index}{' '}
                    {item.error
                      ? '❌ Error'
                      : item.result?.columns.length
                        ? `(${item.result.rows.length} baris)`
                        : '✓ OK'}
                  </button>
                ))}
              </div>
            )}

            {/* Data Table Grid (60 FPS Windowed Virtual Scroll) */}
            <div
              ref={gridVirtual.containerRef}
              onScroll={gridVirtual.onScroll}
              style={{ flex: 1, overflow: 'auto', background: 'var(--bg-primary)' }}
            >
              {!queryResult ? (
                <div
                  style={{
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--text-muted)',
                    fontSize: 13
                  }}
                >
                  Jalankan query SQL atau klik tombol DATA pada salah satu tabel untuk melihat isi data.
                </div>
              ) : queryResult.columns.length === 0 ? (
                <div style={{ padding: 24, fontSize: 13, color: '#6ee7b7' }}>
                  ✓ {queryResult.message || `Perintah berhasil dijalankan (${queryResult.affectedRows ?? 0} baris terpengaruh).`}
                </div>
              ) : (
                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: 12,
                    fontFamily: 'var(--font-mono)'
                  }}
                >
                  <thead>
                    <tr
                      style={{
                        position: 'sticky',
                        top: 0,
                        background: 'var(--bg-elevated)',
                        zIndex: 2
                      }}
                    >
                      <th
                        style={{
                          padding: '7px 10px',
                          borderBottom: '1px solid var(--border-subtle)',
                          borderRight: '1px solid var(--border-subtle)',
                          textAlign: 'right',
                          color: 'var(--text-muted)',
                          width: 46
                        }}
                      >
                        #
                      </th>
                      {queryResult.editableTable && (
                        <th
                          style={{
                            padding: '7px 8px',
                            borderBottom: '1px solid var(--border-subtle)',
                            borderRight: '1px solid var(--border-subtle)',
                            textAlign: 'center',
                            color: 'var(--text-muted)',
                            width: 64
                          }}
                        >
                          Aksi
                        </th>
                      )}
                      {queryResult.columns.map((col) => {
                        const isPk = queryResult.editableTable?.primaryKeys.includes(col);
                        const isSorted = gridSortCol === col;
                        return (
                          <th
                            key={col}
                            onClick={() => {
                              if (queryResult.editableTable) {
                                handleToggleColumnSort(col);
                              }
                            }}
                            title={
                              queryResult.editableTable
                                ? `Klik untuk mengurutkan berdasarkan ${col}`
                                : col
                            }
                            style={{
                              padding: '7px 10px',
                              borderBottom: '1px solid var(--border-subtle)',
                              borderRight: '1px solid var(--border-subtle)',
                              textAlign: 'left',
                              whiteSpace: 'nowrap',
                              cursor: queryResult.editableTable ? 'pointer' : 'default',
                              userSelect: 'none',
                              color: isPk ? '#fcd34d' : 'var(--text-primary)'
                            }}
                          >
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              {isPk ? `🔑 ${col}` : col}
                              {isSorted &&
                                (gridSortDir === 'ASC' ? (
                                  <ArrowUp size={11} style={{ color: 'var(--accent)' }} />
                                ) : (
                                  <ArrowDown size={11} style={{ color: 'var(--accent)' }} />
                                ))}
                            </span>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {gridVirtual.topSpacerPx > 0 && (
                      <tr aria-hidden="true">
                        <td
                          colSpan={queryResult.columns.length + (queryResult.editableTable ? 2 : 1)}
                          style={{ height: gridVirtual.topSpacerPx, padding: 0, border: 'none' }}
                        />
                      </tr>
                    )}
                    {queryResult.rows
                      .slice(gridVirtual.startIndex, gridVirtual.endIndex)
                      .map((row, localIdx) => {
                        const rIdx = gridVirtual.startIndex + localIdx;
                        const rowPkKey = queryResult.editableTable
                          ? JSON.stringify(
                              Object.fromEntries(
                                queryResult.editableTable.primaryKeys.map((pk) => [pk, row[pk]])
                              )
                            )
                          : '';
                        const isPendingDelete =
                          Boolean(rowPkKey) &&
                          pendingMutations.some((m) => m.kind === 'delete' && m.rowKey === rowPkKey);
                        return (
                      <tr
                        key={rIdx}
                        style={{
                          background: isPendingDelete
                            ? 'rgba(239, 68, 68, 0.16)'
                            : rIdx % 2 === 1
                              ? 'rgba(255,255,255,0.02)'
                              : 'transparent',
                          textDecoration: isPendingDelete ? 'line-through' : 'none',
                          opacity: isPendingDelete ? 0.72 : 1
                        }}
                      >
                        <td
                          style={{
                            padding: '5px 10px',
                            borderBottom: '1px solid var(--border-subtle)',
                            borderRight: '1px solid var(--border-subtle)',
                            textAlign: 'right',
                            color: 'var(--text-muted)'
                          }}
                        >
                          {gridOffset + rIdx + 1}
                        </td>
                        {queryResult.editableTable && (
                          <td
                            style={{
                              padding: '3px 6px',
                              borderBottom: '1px solid var(--border-subtle)',
                              borderRight: '1px solid var(--border-subtle)',
                              textAlign: 'center',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            <button
                              className="icon-btn"
                              style={{ padding: 2 }}
                              title="Gandakan baris ini ke form Tambah Baris"
                              onClick={() => openInsertRowForm(row)}
                            >
                              <Copy size={12} />
                            </button>
                            <button
                              className="icon-btn"
                              style={{ padding: 2, color: '#fca5a5' }}
                              title="Hapus baris ini dari Database"
                              onClick={() => void handleDeleteGridRow(row)}
                            >
                              <Trash2 size={12} />
                            </button>
                          </td>
                        )}
                        {queryResult.columns.map((col) => {
                          const rawVal = row[col];
                          const isEditingThis =
                            editingCell?.rowIndex === rIdx && editingCell?.column === col;
                          const fkTarget = fkTargetsByColumn[col];
                          const isPendingCellUpdate =
                            Boolean(rowPkKey) &&
                            pendingMutations.some(
                              (m) => m.kind === 'update' && m.rowKey === rowPkKey && m.column === col
                            );

                          return (
                            <td
                              key={col}
                              style={{
                                padding: isEditingThis ? '3px 6px' : '5px 10px',
                                borderBottom: '1px solid var(--border-subtle)',
                                borderRight: '1px solid var(--border-subtle)',
                                maxWidth: 360,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                background: isPendingCellUpdate
                                  ? 'rgba(245, 158, 11, 0.18)'
                                  : undefined,
                                cursor:
                                  queryResult.editableTable && !isReadOnlyLocked
                                    ? 'pointer'
                                    : 'default'
                              }}
                              onDoubleClick={() => {
                                if (!queryResult.editableTable) return;
                                if (isReadOnlyLocked) {
                                  showToast('🔒 Mode Read-Only aktif — klik gembok Read-Only untuk mengedit.');
                                  return;
                                }
                                setEditingCell({
                                  rowIndex: rIdx,
                                  column: col,
                                  draft: rawVal === null || rawVal === undefined ? '' : formatCellText(rawVal),
                                  isNull: rawVal === null || rawVal === undefined
                                });
                              }}
                              title={formatCellText(rawVal)}
                            >
                              {isEditingThis ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <input
                                    autoFocus
                                    className="form-input"
                                    style={{
                                      padding: '2px 6px',
                                      fontSize: 11.5,
                                      minWidth: 140,
                                      fontFamily: 'var(--font-mono)'
                                    }}
                                    disabled={editingCell.isNull || savingCell}
                                    value={editingCell.isNull ? 'NULL' : editingCell.draft}
                                    onChange={(e) =>
                                      setEditingCell((s) =>
                                        s ? { ...s, draft: e.target.value, isNull: false } : s
                                      )
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        void handleCommitCellEdit();
                                      } else if (e.key === 'Escape') {
                                        setEditingCell(null);
                                      }
                                    }}
                                  />
                                  <label style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 2 }}>
                                    <input
                                      type="checkbox"
                                      checked={editingCell.isNull}
                                      onChange={(e) =>
                                        setEditingCell((s) =>
                                          s ? { ...s, isNull: e.target.checked } : s
                                        )
                                      }
                                    />
                                    NULL
                                  </label>
                                  <button
                                    className="icon-btn"
                                    title="Simpan ke DB (Enter)"
                                    disabled={savingCell}
                                    onClick={() => void handleCommitCellEdit()}
                                  >
                                    <Check size={13} style={{ color: '#6ee7b7' }} />
                                  </button>
                                  <button
                                    className="icon-btn"
                                    title="Batal (Esc)"
                                    onClick={() => setEditingCell(null)}
                                  >
                                    <X size={13} />
                                  </button>
                                </div>
                              ) : rawVal === null || rawVal === undefined ? (
                                <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                  NULL
                                </span>
                              ) : (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: '100%' }}>
                                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {formatCellText(rawVal)}
                                  </span>
                                  {fkTarget && (
                                    <button
                                      type="button"
                                      className="icon-btn"
                                      style={{
                                        padding: 1,
                                        color: '#38bdf8',
                                        flexShrink: 0
                                      }}
                                      title={`Jump-to-Row FK → ${fkTarget.targetTable}.${fkTarget.targetColumn} = ${formatCellText(rawVal)} (Master-Detail)`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        void handleFkJump(fkTarget, rawVal, false);
                                      }}
                                    >
                                      <ArrowUpRight size={12} />
                                    </button>
                                  )}
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                        );
                      })}
                    {gridVirtual.bottomSpacerPx > 0 && (
                      <tr aria-hidden="true">
                        <td
                          colSpan={queryResult.columns.length + (queryResult.editableTable ? 2 : 1)}
                          style={{ height: gridVirtual.bottomSpacerPx, padding: 0, border: 'none' }}
                        />
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>

            {/* Phase 30 #3: Foreign-Key Master-Detail Split Drawer */}
            {fkDetailStack.length > 0 && (() => {
              const currentFk = fkDetailStack[fkDetailStack.length - 1];
              const parentMeta =
                dbSchema?.tables.find(
                  (t) => t.name.toLowerCase() === currentFk.target.targetTable.toLowerCase()
                ) ??
                (dbSchema?.allTables ?? []).find(
                  (t) => t.name.toLowerCase() === currentFk.target.targetTable.toLowerCase()
                ) ??
                null;
              return (
                <div
                  style={{
                    borderTop: '2px solid var(--accent)',
                    background: 'var(--bg-elevated)',
                    maxHeight: 220,
                    display: 'flex',
                    flexDirection: 'column',
                    flexShrink: 0
                  }}
                >
                  <div
                    style={{
                      padding: '6px 14px',
                      borderBottom: '1px solid var(--border-subtle)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      fontSize: 11.5
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
                      <ArrowUpRight size={13} color="#38bdf8" />
                      <strong>Master-Detail FK:</strong>
                      {fkDetailStack.map((item, idx) => (
                        <React.Fragment key={idx}>
                          {idx > 0 && <span style={{ color: 'var(--text-muted)' }}>→</span>}
                          <button
                            type="button"
                            className="btn btn-xs"
                            style={{
                              fontFamily: 'var(--font-mono)',
                              borderColor:
                                idx === fkDetailStack.length - 1 ? 'var(--accent)' : undefined
                            }}
                            onClick={() => setFkDetailStack((prev) => prev.slice(0, idx + 1))}
                          >
                            {item.label}
                          </button>
                        </React.Fragment>
                      ))}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      <button
                        type="button"
                        className="btn btn-xs"
                        onClick={() => {
                          setSqlText(currentFk.sql);
                          void executeSqlQuery(currentFk.sql, false);
                        }}
                      >
                        Buka di Query Utama
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => setFkDetailStack([])}
                        title="Tutup panel Master-Detail"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  </div>
                  <div style={{ flex: 1, overflow: 'auto', padding: '6px 12px' }}>
                    {currentFk.loading ? (
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                        ⏳ Mengambil baris induk dari {currentFk.target.targetTable}...
                      </div>
                    ) : currentFk.error ? (
                      <div style={{ fontSize: 11.5, color: '#fca5a5' }}>{currentFk.error}</div>
                    ) : currentFk.rows.length === 0 ? (
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                        Baris referensi tidak ditemukan di <code>{currentFk.target.targetTable}</code>.
                      </div>
                    ) : (
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5, fontFamily: 'var(--font-mono)' }}>
                        <thead>
                          <tr style={{ background: 'var(--bg-surface)' }}>
                            {currentFk.columns.map((c) => (
                              <th
                                key={c}
                                style={{
                                  padding: '4px 8px',
                                  textAlign: 'left',
                                  borderBottom: '1px solid var(--border-subtle)',
                                  whiteSpace: 'nowrap'
                                }}
                              >
                                {c}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {currentFk.rows.map((r, idx) => (
                            <tr key={idx} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                              {currentFk.columns.map((c) => {
                                const val = r[c];
                                const nextFk =
                                  dbSchema && val !== null && val !== undefined
                                    ? resolveForeignKeyTargetForColumn({
                                        sourceTable: parentMeta,
                                        columnName: c,
                                        allTables: dbSchema.allTables ?? dbSchema.tables ?? [],
                                        currentDatabase:
                                          currentFk.target.targetSchema || dbSchema.currentDatabase
                                      })
                                    : null;
                                return (
                                  <td key={c} style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>
                                    <span>{val === null || val === undefined ? 'NULL' : formatCellText(val)}</span>
                                    {nextFk && (
                                      <button
                                        type="button"
                                        className="icon-btn"
                                        style={{ padding: 1, marginLeft: 4, color: '#38bdf8' }}
                                        title={`Lompat lagi → ${nextFk.targetTable}.${nextFk.targetColumn}`}
                                        onClick={() => void handleFkJump(nextFk, val, true)}
                                      >
                                        <ArrowUpRight size={11} />
                                      </button>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Modal 3: Dangerous SQL / Production DB Safety Interceptor */}
      {pendingDangerSql && (
        <div
          className="modal-backdrop"
          style={{ zIndex: 1450 }}
        >
          <div
            className="modal-card"
            style={{
              width: 'min(560px, 94vw)',
              border: '1px solid rgba(239, 68, 68, 0.6)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <ShieldAlert size={22} color="#ef4444" style={{ flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 14.5, color: '#fca5a5' }}>
                    {pendingDangerSql.report.title}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                    Profil DB: <strong>{activeProfile?.name}</strong>{' '}
                    {activeProfile?.isProduction ? '(🔴 PRODUKSI)' : ''}
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="btn-modal-exit"
                onClick={() => setPendingDangerSql(null)}
              >
                <X size={14} />
                <span>Keluar</span>
              </button>
            </div>

            <div className="modal-body">
              <ul
                style={{
                  margin: 0,
                  paddingLeft: 18,
                  fontSize: 12,
                  color: '#fecaca',
                  lineHeight: 1.5
                }}
              >
                {pendingDangerSql.report.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>

              <pre
                style={{
                  margin: 0,
                  padding: 10,
                  borderRadius: 6,
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11.5,
                  maxHeight: 160,
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap'
                }}
              >
                {pendingDangerSql.sql}
              </pre>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button className="btn" onClick={() => setPendingDangerSql(null)}>
                  Batalkan (Aman)
                </button>
                <button
                  className="btn"
                  style={{
                    background: '#dc2626',
                    borderColor: '#ef4444',
                    color: '#fff',
                    fontWeight: 700
                  }}
                  onClick={() => {
                    const next = pendingDangerSql;
                    setPendingDangerSql(null);
                    void executeSqlQuery(next.sql, next.openModalAfter, true);
                  }}
                >
                  Tetap Jalankan SQL (Saya Yakin)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
