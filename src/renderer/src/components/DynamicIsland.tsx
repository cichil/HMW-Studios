import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  ArrowLeftRight,
  Bookmark,
  CheckCircle2,
  ChevronDown,
  Cloud,
  Code2,
  Copy,
  Database,
  ExternalLink,
  FileCode2,
  FolderKanban,
  FolderOpen,
  GitBranch,
  Globe,
  Layers,
  MonitorUp,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  SaveAll,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  TerminalSquare,
  Trash2,
  X
} from 'lucide-react';
import type {
  DesktopIslandMode,
  FileNode,
  IslandTone,
  RemoteSearchMatch,
  SearchMatch
} from '@shared/types';
import {
  buildIslandDbTablesFromSchema,
  buildIslandSymbolsFromCatalogs,
  rankIslandSearchResults,
  type IslandCommandCandidate,
  type IslandFileCandidate,
  type IslandSearchResultItem,
  type IslandSearchScope,
  type IslandSearchTabMode
} from '@shared/islandSearchEngine';
import { useIdeStore } from '../store/useIdeStore';

function getToneAccent(tone: IslandTone): string {
  switch (tone) {
    case 'sync':
      return '#38bdf8';
    case 'ai':
      return '#c084fc';
    case 'success':
      return '#22c55e';
    case 'error':
      return '#fb7185';
    case 'warning':
      return '#fbbf24';
    case 'command':
      return '#fb923c';
    case 'preview':
      return '#34d399';
    default:
      return '#94a3b8';
  }
}

function flattenTreeFiles(nodes: FileNode[]): FileNode[] {
  const out: FileNode[] = [];
  for (const n of nodes) {
    if (n.isDirectory) {
      if (n.children) out.push(...flattenTreeFiles(n.children));
    } else {
      out.push(n);
    }
  }
  return out;
}

interface UnifiedGrepMatch {
  id: string;
  source: 'remote' | 'local';
  connectionId?: string;
  connectionName?: string;
  filePath?: string;
  relativePath: string;
  line: number;
  preview: string;
}

function highlightMatchSnippet(text: string, rawNeedle: string): React.ReactNode {
  const needle = rawNeedle.trim();
  if (!needle) return text;
  const idx = text.toLowerCase().indexOf(needle.toLowerCase());
  if (idx < 0) return text;
  const before = text.slice(0, idx);
  const hit = text.slice(idx, idx + needle.length);
  const after = text.slice(idx + needle.length);
  return (
    <>
      {before}
      <mark className="island-grep-mark">{hit}</mark>
      {after}
    </>
  );
}

const QUICK_EXT_CHIPS = ['.php', '.js', '.css', '.sql', '.blade.php'] as const;

export const DynamicIsland: React.FC = () => {
  const {
    projects,
    activeProjectId,
    workspacePath,
    fileTree,
    tabs,
    activeTabId,
    connections,
    selectedConnectionId,
    selectConnection,
    remoteSubPath,
    remoteConnectionStatus,
    remoteConnectionError,
    browseRemoteDir,
    openConnectionModal,
    setSyncModalOpen,
    saveAllTabs,
    phpDiagnosticsByTab,
    jumpToTabLine,
    openFileInTab,
    openRemoteFileInTab,
    gitStatus,
    previewOpen,
    previewState,
    togglePreviewPane,
    bumpPreviewReload,
    wisanggeniSummary,
    laravelSummary,
    setBottomPanel,
    setActiveSidebar,
    islandActivity,
    islandHistory,
    islandExpanded,
    setIslandExpanded,
    islandSearchRequest,
    consumeIslandSearchRequest,
    openIslandSearch,
    clearIslandActivity,
    runIslandAction,
    desktopIslandMode,
    setDesktopIslandMode,
    remoteFilesIndexByConn,
    remoteIndexLoading,
    remoteIntelByConn,
    remoteIntelLoading,
    refreshRemoteFilesIndex,
    refreshRemoteWorkspaceIntel,
    localPhpSymbols,
    localWebCatalog,
    dbSchema,
    triggerSqlCodeLensAction,
    openVisualJoinBuilder,
    openTableDesigner,
    setDbArchitectTab,
    findReferencesForSymbol,
    setProjectModalOpen,
    openPhpScratchpad,
    setServerMonitorOpen,
    toggleSplitEditor,
    formatTabContent,
    pinnedFiles,
    togglePinFile,
    savedTabSessions,
    saveCurrentTabsAsSession,
    restoreTabSession,
    deleteTabSession,
    savedSqlQueries,
    openSavedQueryInVisualBuilder,
    setDbRoutinesModalOpen,
    openDbSeeder,
    setReleasePatchModalOpen,
    setDbSchedulerModalOpen,
    setAuditModalOpen,
    openExcelImportModal,
    setDbGlobalSearchModalOpen,
    setSecurityScannerModalOpen,
    showToast
  } = useIdeStore();

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const activeItemRef = useRef<HTMLDivElement | null>(null);

  const [islandView, setIslandView] = useState<'search' | 'controls'>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState<IslandSearchTabMode>('all');
  const [searchScope, setSearchScope] = useState<IslandSearchScope>('all');
  const [extFilter, setExtFilter] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [newSessionPromptOpen, setNewSessionPromptOpen] = useState(false);
  const [newSessionName, setNewSessionName] = useState('');

  // Live content grep state (Remote SFTP + Local Workspace)
  const [grepRemoteSubfolderOnly, setGrepRemoteSubfolderOnly] = useState(false);
  const [grepLoading, setGrepLoading] = useState(false);
  const [grepMatches, setGrepMatches] = useState<UnifiedGrepMatch[]>([]);
  const [grepSearchedQuery, setGrepSearchedQuery] = useState('');
  const grepReqCounter = useRef(0);

  const selectedConn = connections.find((c) => c.id === selectedConnectionId) ?? null;
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  const dirtyCount = useMemo(
    () => tabs.filter((t) => t.content !== t.savedContent).length,
    [tabs]
  );

  // Consume external Island Search requests (Ctrl+K, Search pill click, or Desktop Floating Island)
  useEffect(() => {
    if (!islandSearchRequest) return;
    const req = consumeIslandSearchRequest();
    if (!req) return;
    setIslandView('search');
    if (req.mode) setSearchMode(req.mode);
    if (req.scope) setSearchScope(req.scope);
    if (req.query !== undefined) {
      setSearchQuery(req.query);
    }
    setSelectedIdx(0);
    setTimeout(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }, 25);
  }, [islandSearchRequest, consumeIslandSearchRequest]);

  // Auto-index remote files & symbols when Island opens and a remote server is selected
  useEffect(() => {
    if (islandExpanded && selectedConnectionId) {
      void refreshRemoteFilesIndex(selectedConnectionId, false);
      void refreshRemoteWorkspaceIntel(selectedConnectionId, false);
    }
    if (islandExpanded) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 30);
    }
  }, [
    islandExpanded,
    selectedConnectionId,
    refreshRemoteFilesIndex,
    refreshRemoteWorkspaceIntel
  ]);

  // Outside click & Escape handling
  useEffect(() => {
    if (!islandExpanded) return;
    const handlePointerDown = (ev: MouseEvent): void => {
      if (wrapperRef.current && !wrapperRef.current.contains(ev.target as Node)) {
        setIslandExpanded(false);
      }
    };
    const handleKeyDown = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') {
        if (searchQuery.trim().length > 0) {
          ev.stopPropagation();
          setSearchQuery('');
          setSelectedIdx(0);
          return;
        }
        setIslandExpanded(false);
      }
    };
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [islandExpanded, searchQuery, setIslandExpanded]);

  useEffect(() => {
    setSelectedIdx(0);
  }, [searchQuery, searchMode, searchScope, extFilter]);

  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx]);

  // Build unified file candidates (Local + Remote SFTP)
  const localFlatFiles = useMemo(() => flattenTreeFiles(fileTree), [fileTree]);
  const remoteIndexedFiles = useMemo(
    () => (selectedConnectionId ? remoteFilesIndexByConn[selectedConnectionId] ?? [] : []),
    [selectedConnectionId, remoteFilesIndexByConn]
  );

  const openTabKeys = useMemo(() => {
    const s = new Set<string>();
    for (const t of tabs) {
      if (t.remoteConnectionId) {
        s.add(`remote:${t.remoteConnectionId}:${t.relativePath.replace(/^\/+/, '')}`);
      } else {
        s.add(`local:${t.filePath}`);
      }
    }
    return s;
  }, [tabs]);

  const pinnedFileKeys = useMemo(
    () => new Set(pinnedFiles.map((p) => p.key)),
    [pinnedFiles]
  );

  const fileCandidates = useMemo<IslandFileCandidate[]>(() => {
    const out: IslandFileCandidate[] = [];
    const seen = new Set<string>();

    // Ensure pinned files are always included at the front
    for (const pf of pinnedFiles) {
      if (pf.source === 'remote' && pf.connectionId && pf.connectionId !== selectedConnectionId) {
        continue;
      }
      seen.add(pf.key);
      out.push({
        key: pf.key,
        source: pf.source,
        name: pf.name,
        relativePath: pf.relativePath,
        localPath: pf.localPath,
        connectionId: pf.connectionId,
        connectionName: pf.connectionName
      });
    }

    if (selectedConnectionId) {
      for (const rf of remoteIndexedFiles) {
        const key = `remote:${selectedConnectionId}:${rf.relativePath}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          key,
          source: 'remote',
          name: rf.name,
          relativePath: rf.relativePath,
          connectionId: selectedConnectionId,
          connectionName: selectedConn?.name || 'Server'
        });
      }
    }
    for (const lf of localFlatFiles) {
      const key = `local:${lf.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        key,
        source: 'local',
        name: lf.name,
        relativePath: lf.relativePath,
        localPath: lf.path
      });
    }
    return out;
  }, [pinnedFiles, selectedConnectionId, remoteIndexedFiles, selectedConn?.name, localFlatFiles]);

  // Build unified symbol candidates (PHP + JS + CSS across Remote & Local)
  const activeRemoteIntel = selectedConnectionId
    ? remoteIntelByConn[selectedConnectionId] ?? null
    : null;

  const symbolCandidates = useMemo(
    () =>
      buildIslandSymbolsFromCatalogs({
        localPhp: localPhpSymbols,
        localWeb: localWebCatalog,
        remotePhp: activeRemoteIntel?.phpSymbols ?? null,
        remoteWeb: activeRemoteIntel?.webCatalog ?? null,
        remoteConnectionId: selectedConnectionId,
        remoteConnectionName: selectedConn?.name ?? null
      }),
    [
      localPhpSymbols,
      localWebCatalog,
      activeRemoteIntel,
      selectedConnectionId,
      selectedConn?.name
    ]
  );

  const dbTableCandidates = useMemo(
    () => buildIslandDbTablesFromSchema(dbSchema),
    [dbSchema]
  );

  const commandCandidates = useMemo<IslandCommandCandidate[]>(
    () => [
      {
        id: 'visual-join',
        label: 'Navicat Visual Diagram Query Builder (Drag & Drop JOIN)',
        keywords: 'sql join database diagram query builder navicat'
      },
      {
        id: 'audit-trail',
        label: 'Enterprise Audit Trail & 1-Click SQL Undo (UPDATE / DELETE / Deploy)',
        keywords: 'audit log undo rollback history sql sftp'
      },
      {
        id: 'excel-import',
        label: 'Enterprise Excel (.XLSX) & Clipboard Importer (+ Dry-Run Rollback)',
        keywords: 'excel xlsx import paste dry run nip nik'
      },
      {
        id: 'db-global-search',
        label: 'Global Database Value Hunter (Cari Isi ID/NIP di Ratusan Tabel)',
        keywords: 'cari nilai isi database semua tabel global search'
      },
      {
        id: 'security-scanner',
        label: 'Enterprise Security, PHP 8 & Broken-Include Scanner (Offline SAST)',
        keywords: 'security scan sql injection xss php8 include rusak audit'
      },
      {
        id: 'db-row-diff',
        label: 'Data Diff Antar-Tabel Berdasarkan Primary Key (Staging ↔ Production)',
        keywords: 'row diff data compare pk insert update sync'
      },
      {
        id: 'table-designer',
        label: 'Visual Table Designer — Buat Tabel Database Baru',
        keywords: 'create alter table desain tabel kolom struktur index'
      },
      {
        id: 'db-data-sync',
        label: 'Sinkronisasi Isi Data Antar-Database + Smart Anonymizer',
        keywords: 'sync transfer data database masking password nik'
      },
      {
        id: 'release-patch',
        label: 'Buat Paket Rilis / Patch (.ZIP) dari File yang Berubah',
        keywords: 'patch zip rilis deploy git modified perubahan'
      },
      {
        id: 'db-routines',
        label: 'Manajer & Editor View, Stored Procedure, Function, & Trigger',
        keywords: 'view procedure function trigger database routine'
      },
      {
        id: 'db-seeder',
        label: 'Smart Data Seeder Indonesia (Generator Data Uji Realistis)',
        keywords: 'seed seeder faker data uji nip nik simulasi'
      },
      {
        id: 'db-scheduler',
        label: 'Penjadwal Otomatis Backup .SQL & Export Query (.XLSX)',
        keywords: 'jadwal cron backup otomatis sql excel xlsx scheduler'
      },
      {
        id: 'db-explorer',
        label: 'Buka Database Explorer & SQL Runner',
        keywords: 'mysql postgres database tabel query excel'
      },
      {
        id: 'sync-modal',
        label: 'Buka Visual File Synchronizer (Push / Pull SFTP)',
        keywords: 'sync sftp upload download diff deploy'
      },
      {
        id: 'ai-studio',
        label: 'Buka Google Gemini AI Studio (Chat, CRUD, Audit SQL)',
        keywords: 'ai gemini chat crud wisanggeni'
      },
      {
        id: 'search-replace',
        label: 'Buka Panel Search & Replace Massal (Ctrl+Shift+F)',
        keywords: 'replace ganti cari semua file'
      },
      {
        id: 'php-scratchpad',
        label: 'Buka PHP Scratchpad / Tinker Eksekusi Instan',
        keywords: 'php run test tinker scratchpad'
      },
      {
        id: 'mysql-workbench-monitor',
        label: 'MySQL Workbench Performance Dashboard (QPS, Buffer Pool, Slow SQL, Lock & Tuning)',
        keywords: 'mysql workbench kesehatan health monitor qps innodb slow query lock storage'
      },
      {
        id: 'server-monitor',
        label: 'Buka SSH Server Health Monitor (RAM / CPU / Disk)',
        keywords: 'ssh server monitor cpu ram disk cron'
      },
      {
        id: 'split-editor',
        label: 'Toggle Split Editor Kiri & Kanan (Ctrl+\\)',
        keywords: 'split bagi layar editor dua'
      },
      {
        id: 'format-code',
        label: 'Rapikan / Format Kode Aktif (Shift+Alt+F)',
        keywords: 'format beautify indent kode'
      },
      {
        id: 'project-manager',
        label: 'Buka Manajer Proyek Tersimpan (.hmwproj)',
        keywords: 'project proyek simpan buka'
      }
    ],
    []
  );

  const rankedItems = useMemo<IslandSearchResultItem[]>(() => {
    if (searchMode === 'content') return [];
    return rankIslandSearchResults({
      rawQuery: searchQuery,
      mode: searchMode,
      scope: searchScope,
      extFilter: searchMode === 'files' || searchMode === 'all' ? extFilter : null,
      files: fileCandidates,
      openTabKeys,
      pinnedFileKeys,
      activeRemoteSubPath: remoteSubPath,
      activeTabTitle: activeTab?.title ?? null,
      symbols: symbolCandidates,
      dbTables: dbTableCandidates,
      savedQueries: savedSqlQueries,
      commands: commandCandidates,
      limit: 65
    });
  }, [
    searchMode,
    searchQuery,
    searchScope,
    extFilter,
    fileCandidates,
    openTabKeys,
    pinnedFileKeys,
    remoteSubPath,
    activeTab?.title,
    symbolCandidates,
    dbTableCandidates,
    savedSqlQueries,
    commandCandidates
  ]);

  // Execute live content grep (debounced) when in 'content' mode
  const runLiveContentGrep = async (
    rawQ: string,
    scopeOpt: IslandSearchScope,
    subOnly: boolean
  ): Promise<void> => {
    const q = rawQ.trim();
    if (q.length < 2) {
      setGrepMatches([]);
      setGrepSearchedQuery('');
      setGrepLoading(false);
      return;
    }

    const reqId = ++grepReqCounter.current;
    setGrepLoading(true);

    const shouldRemote =
      Boolean(selectedConnectionId) && (scopeOpt === 'all' || scopeOpt === 'remote');
    const shouldLocal =
      Boolean(workspacePath) && (scopeOpt === 'all' || scopeOpt === 'local');

    try {
      const [remoteRes, localRes] = await Promise.allSettled([
        shouldRemote && selectedConnectionId
          ? window.aptana.connections.searchRemoteFiles(
              selectedConnectionId,
              subOnly ? remoteSubPath : '',
              q,
              false
            )
          : Promise.resolve<RemoteSearchMatch[]>([]),
        shouldLocal && workspacePath
          ? window.aptana.workspace.searchInFiles(workspacePath, q, false)
          : Promise.resolve<SearchMatch[]>([])
      ]);

      if (reqId !== grepReqCounter.current) return;

      const merged: UnifiedGrepMatch[] = [];
      if (remoteRes.status === 'fulfilled') {
        for (const rm of remoteRes.value.slice(0, 60)) {
          merged.push({
            id: `rgrep:${rm.connectionId}:${rm.relativePath}:${rm.line}`,
            source: 'remote',
            connectionId: rm.connectionId,
            connectionName: selectedConn?.name || 'Server',
            relativePath: rm.relativePath,
            line: rm.line,
            preview: rm.lineText
          });
        }
      }
      if (localRes.status === 'fulfilled') {
        for (const lm of localRes.value.slice(0, 60)) {
          merged.push({
            id: `lgrep:${lm.filePath}:${lm.line}`,
            source: 'local',
            filePath: lm.filePath,
            relativePath: lm.relativePath,
            line: lm.line,
            preview: lm.lineText
          });
        }
      }

      setGrepMatches(merged.slice(0, 80));
      setGrepSearchedQuery(q);
    } finally {
      if (reqId === grepReqCounter.current) {
        setGrepLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!islandExpanded || searchMode !== 'content') return;
    const trimmed = searchQuery.trim();
    if (trimmed.length < 2) {
      setGrepMatches([]);
      setGrepSearchedQuery('');
      setGrepLoading(false);
      return;
    }
    const t = setTimeout(() => {
      void runLiveContentGrep(trimmed, searchScope, grepRemoteSubfolderOnly);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [islandExpanded, searchMode, searchQuery, searchScope, grepRemoteSubfolderOnly, selectedConnectionId, workspacePath]);

  const executeCommandById = (cmdId: string): void => {
    switch (cmdId) {
      case 'visual-join':
        openVisualJoinBuilder();
        break;
      case 'table-designer':
        openTableDesigner({ mode: 'create' });
        break;
      case 'db-data-sync':
        setDbArchitectTab('sync');
        break;
      case 'release-patch':
        setReleasePatchModalOpen(true);
        break;
      case 'db-routines':
        setDbRoutinesModalOpen(true);
        break;
      case 'db-seeder':
        openDbSeeder();
        break;
      case 'db-scheduler':
        setDbSchedulerModalOpen(true);
        break;
      case 'audit-trail':
        setAuditModalOpen(true);
        break;
      case 'excel-import':
        openExcelImportModal();
        break;
      case 'db-global-search':
        setDbGlobalSearchModalOpen(true);
        break;
      case 'security-scanner':
        setSecurityScannerModalOpen(true);
        break;
      case 'db-row-diff':
        setDbArchitectTab('rowdiff');
        break;
      case 'db-explorer':
        setActiveSidebar('database');
        break;
      case 'sync-modal':
        if (workspacePath && selectedConnectionId) {
          setSyncModalOpen(true);
        } else if (!selectedConnectionId) {
          openConnectionModal(null);
        } else {
          showToast('Buka folder lokal terlebih dahulu untuk sinkronisasi dua arah.');
        }
        break;
      case 'ai-studio':
        setActiveSidebar('ai');
        break;
      case 'search-replace':
        if (searchQuery.trim()) {
          findReferencesForSymbol(
            searchQuery.trim(),
            searchScope === 'remote'
              ? 'remote'
              : searchScope === 'local'
                ? 'local'
                : undefined
          );
        } else {
          setActiveSidebar('search');
        }
        break;
      case 'php-scratchpad':
        openPhpScratchpad();
        break;
      case 'mysql-workbench-monitor':
        setServerMonitorOpen(true, 'mysql-dashboard');
        break;
      case 'server-monitor':
        setServerMonitorOpen(true, 'health');
        break;
      case 'split-editor':
        toggleSplitEditor();
        break;
      case 'format-code':
        formatTabContent();
        break;
      case 'project-manager':
        setProjectModalOpen(true);
        break;
    }
    setIslandExpanded(false);
  };

  const handleSelectRankedItem = (item: IslandSearchResultItem): void => {
    if (item.category === 'line-jump' && item.jumpLine) {
      if (activeTab) {
        jumpToTabLine(activeTab.id, item.jumpLine);
        setIslandExpanded(false);
      } else {
        showToast('Buka file terlebih dahulu sebelum melompat ke nomor baris.');
      }
      return;
    }

    if (item.category === 'file' && item.file) {
      const f = item.file;
      if (f.source === 'remote' && f.connectionId) {
        void openRemoteFileInTab(f.connectionId, f.relativePath, item.jumpLine);
      } else if (f.localPath) {
        void openFileInTab(f.localPath, f.relativePath, item.jumpLine);
      }
      setIslandExpanded(false);
      return;
    }

    if (item.category === 'symbol' && item.symbol) {
      const s = item.symbol;
      if (s.source === 'remote' && s.connectionId) {
        void openRemoteFileInTab(s.connectionId, s.relativePath, s.line);
      } else if (s.localPath) {
        void openFileInTab(s.localPath, s.relativePath, s.line);
      }
      setIslandExpanded(false);
      return;
    }

    if (item.category === 'db-table' && item.dbTable) {
      const tbl = item.dbTable;
      const engine = dbSchema?.engine ?? 'mysql';
      const q = (id: string): string =>
        engine === 'postgres' ? `"${id.replace(/"/g, '""')}"` : `\`${id.replace(/`/g, '``')}\``;
      const qualified = tbl.schema ? `${q(tbl.schema)}.${q(tbl.name)}` : q(tbl.name);
      triggerSqlCodeLensAction({
        mode: 'run',
        sqlTemplate: `SELECT * FROM ${qualified} LIMIT 100;`,
        params: [],
        primaryTable: { schema: tbl.schema, table: tbl.name },
        sourceTitle: `Island Search (${tbl.name})`
      });
      setActiveSidebar('database');
      setIslandExpanded(false);
      return;
    }

    if (item.category === 'saved-query' && item.savedQuery) {
      const sq = item.savedQuery;
      triggerSqlCodeLensAction({
        mode: 'run',
        sqlTemplate: sq.sql,
        params: [],
        sourceTitle: `Query Tersimpan (${sq.name})`
      });
      setActiveSidebar('database');
      setIslandExpanded(false);
      return;
    }

    if (item.category === 'command' && item.commandId) {
      executeCommandById(item.commandId);
    }
  };

  const handleSelectGrepMatch = (m: UnifiedGrepMatch): void => {
    if (m.source === 'remote' && m.connectionId) {
      void openRemoteFileInTab(m.connectionId, m.relativePath, m.line);
    } else if (m.filePath) {
      void openFileInTab(m.filePath, m.relativePath, m.line);
    }
    setIslandExpanded(false);
  };

  const handleSearchInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const order: IslandSearchTabMode[] = ['all', 'files', 'content', 'symbols'];
      const nextIdx = (order.indexOf(searchMode) + (e.shiftKey ? order.length - 1 : 1)) % order.length;
      setIslandView('search');
      setSearchMode(order[nextIdx]);
      return;
    }

    if (searchMode === 'content') {
      const max = Math.max(0, grepMatches.length - 1);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(max, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (grepMatches[selectedIdx]) {
          handleSelectGrepMatch(grepMatches[selectedIdx]);
        } else if (searchQuery.trim().length >= 2) {
          void runLiveContentGrep(searchQuery, searchScope, grepRemoteSubfolderOnly);
        }
      }
      return;
    }

    // Ctrl+Enter switches straight to live grep!
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && searchQuery.trim().length >= 2) {
      e.preventDefault();
      setIslandView('search');
      setSearchMode('content');
      return;
    }

    const max = Math.max(0, rankedItems.length - 1);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIslandView('search');
      setSelectedIdx((i) => Math.min(max, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIslandView('search');
      setSelectedIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (rankedItems[selectedIdx]) {
        handleSelectRankedItem(rankedItems[selectedIdx]);
      } else if (searchQuery.trim().length >= 2) {
        // Fallback: no filename/symbol hit -> jump into content search!
        setIslandView('search');
        setSearchMode('content');
      }
    }
  };

  const phpSummary = useMemo(() => {
    let totalErrors = 0;
    let first: { tabId: string; fileTitle: string; line: number; message: string } | null =
      null;

    if (activeTab && (phpDiagnosticsByTab[activeTab.id]?.length ?? 0) > 0) {
      const d = phpDiagnosticsByTab[activeTab.id][0];
      first = {
        tabId: activeTab.id,
        fileTitle: activeTab.title,
        line: d.line,
        message: d.message
      };
    }

    for (const tab of tabs) {
      const list = phpDiagnosticsByTab[tab.id] ?? [];
      totalErrors += list.length;
      if (!first && list.length > 0) {
        first = {
          tabId: tab.id,
          fileTitle: tab.title,
          line: list[0].line,
          message: list[0].message
        };
      }
    }

    return { totalErrors, first };
  }, [tabs, activeTab, phpDiagnosticsByTab]);

  const frameworkBadge = useMemo(() => {
    if (
      laravelSummary?.isLaravelProject ||
      activeTab?.relativePath.toLowerCase().endsWith('.blade.php')
    ) {
      const routes = laravelSummary?.routeCount ?? 0;
      return routes > 0 ? `🔺 Laravel (${routes} Route)` : '🔺 Laravel & Blade';
    }
    if (wisanggeniSummary?.available) {
      return `⚡ Wisanggeni (${wisanggeniSummary.classCount} Class)`;
    }
    if (laravelSummary) {
      return `🔺 Laravel (${laravelSummary.classCount} Facade)`;
    }
    return null;
  }, [laravelSummary, wisanggeniSummary, activeTab]);

  const handleOpenSync = (e: React.MouseEvent): void => {
    e.stopPropagation();
    if (!workspacePath) {
      showToast('Buka folder lokal terlebih dahulu sebelum melakukan sinkronisasi dua arah.');
      return;
    }
    if (!selectedConnectionId) {
      openConnectionModal(null);
      return;
    }
    setSyncModalOpen(true);
  };

  const isRemoteError = Boolean(selectedConn && remoteConnectionStatus === 'error');
  const isRemoteConnecting = Boolean(selectedConn && remoteConnectionStatus === 'connecting');

  const activeTone: IslandTone = islandActivity
    ? islandActivity.tone
    : phpSummary.totalErrors > 0 || isRemoteError
      ? 'error'
      : dirtyCount > 0
        ? 'warning'
        : previewState.running
          ? 'preview'
          : selectedConn
            ? 'sync'
            : 'neutral';

  const accentColor = getToneAccent(activeTone);

  const renderLeadingOrb = (): React.ReactNode => {
    if (islandActivity?.busy || isRemoteConnecting) {
      return (
        <span
          className="island-waveform"
          style={{ '--island-color': accentColor } as React.CSSProperties}
        >
          <i />
          <i />
          <i />
          <i />
        </span>
      );
    }
    if (islandActivity) {
      if (islandActivity.tone === 'error') {
        return <AlertTriangle size={14} color="#fb7185" style={{ flexShrink: 0 }} />;
      }
      if (islandActivity.tone === 'ai') {
        return <Sparkles size={14} color="#c084fc" style={{ flexShrink: 0 }} />;
      }
      if (islandActivity.tone === 'command') {
        return <TerminalSquare size={14} color="#fb923c" style={{ flexShrink: 0 }} />;
      }
      return <CheckCircle2 size={14} color={accentColor} style={{ flexShrink: 0 }} />;
    }
    if (phpSummary.totalErrors > 0 || isRemoteError) {
      return <span className="island-dot island-dot-pulse" style={{ background: '#fb7185' }} />;
    }
    if (selectedConn) {
      return <Cloud size={13.5} color="#38bdf8" style={{ flexShrink: 0 }} />;
    }
    if (activeProject) {
      return <FolderKanban size={13.5} color="var(--accent)" style={{ flexShrink: 0 }} />;
    }
    return <span className="island-dot" style={{ background: accentColor }} />;
  };

  const modeShortLabel =
    desktopIslandMode === 'always'
      ? 'Layar ON'
      : desktopIslandMode === 'auto'
        ? 'Auto'
        : null;

  const showSearchBody = islandView === 'search' || searchQuery.trim().length > 0;

  return (
    <div ref={wrapperRef} className="dynamic-island-anchor">
      <div className="dynamic-island-cluster">
        {/* Status Pill (Left side of Island) */}
        <div
          role="button"
          tabIndex={0}
          className={`dynamic-island-pill ${islandActivity ? 'is-live' : ''} ${
            islandExpanded && !showSearchBody ? 'is-expanded' : ''
          }`}
          style={{ '--island-accent': accentColor } as React.CSSProperties}
          onClick={() => {
            if (islandExpanded && islandView === 'controls' && !searchQuery.trim()) {
              setIslandExpanded(false);
            } else {
              setIslandView('controls');
              setIslandExpanded(true);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setIslandView('controls');
              setIslandExpanded(!islandExpanded);
            }
          }}
          title="HMW Dynamic Island — Klik untuk membuka Pusat Kontrol Server, Diagnostik & Overlay Layar"
        >
          {renderLeadingOrb()}

          {islandActivity ? (
            <div className="dynamic-island-live-body">
              <span
                className="dynamic-island-badge"
                style={{
                  color: accentColor,
                  borderColor: `${accentColor}44`,
                  background: `${accentColor}18`
                }}
              >
                {islandActivity.badge}
              </span>
              <span className="dynamic-island-title">{islandActivity.title}</span>
              {islandActivity.subtitle && (
                <span className="dynamic-island-subtitle">• {islandActivity.subtitle}</span>
              )}
              {islandActivity.actionLabel && islandActivity.actionType && (
                <button
                  type="button"
                  className="dynamic-island-inline-btn"
                  style={{ borderColor: `${accentColor}66`, color: accentColor }}
                  onClick={(e) => {
                    e.stopPropagation();
                    runIslandAction(islandActivity.actionType!, {
                      tabId: islandActivity.jumpTabId,
                      line: islandActivity.jumpLine
                    });
                  }}
                >
                  {islandActivity.actionLabel}
                </button>
              )}
            </div>
          ) : (
            <div className="dynamic-island-idle-body">
              <span className="dynamic-island-primary">
                {selectedConn
                  ? `${selectedConn.name}${selectedConn.keepSynchronized ? ' ⚡' : ''}`
                  : activeProject
                    ? activeProject.name
                    : workspacePath
                      ? workspacePath.split(/[/\\]/).pop() || 'Workspace'
                      : 'HMW Island'}
              </span>

              {phpSummary.first ? (
                <button
                  type="button"
                  className="dynamic-island-chip chip-error"
                  onClick={(e) => {
                    e.stopPropagation();
                    jumpToTabLine(phpSummary.first!.tabId, phpSummary.first!.line);
                  }}
                  title={`${phpSummary.first.fileTitle} Baris ${phpSummary.first.line}: ${phpSummary.first.message}`}
                >
                  🔴 Baris {phpSummary.first.line}
                </button>
              ) : isRemoteError ? (
                <span
                  className="dynamic-island-chip chip-error"
                  title={remoteConnectionError || 'Koneksi SFTP/Remote gagal'}
                >
                  🔴 {selectedConn?.protocol.toUpperCase()} Tidak Konek
                </span>
              ) : isRemoteConnecting ? (
                <span className="dynamic-island-chip">Menghubungi...</span>
              ) : dirtyCount > 0 ? (
                <span className="dynamic-island-chip chip-warn">
                  ● {dirtyCount} belum disimpan
                </span>
              ) : previewState.running ? (
                <span className="dynamic-island-chip chip-ok">🟢 :{previewState.port}</span>
              ) : gitStatus?.isRepo ? (
                <span className="dynamic-island-chip">
                  ⎇ {gitStatus.branch}
                  {gitStatus.changes.length > 0 ? ` *${gitStatus.changes.length}` : ''}
                </span>
              ) : frameworkBadge ? (
                <span className="dynamic-island-chip">{frameworkBadge}</span>
              ) : (
                <span className="dynamic-island-chip">Siap</span>
              )}

              {modeShortLabel && (
                <span
                  className="dynamic-island-float-tag"
                  title={
                    desktopIslandMode === 'always'
                      ? 'Desktop Floating Island selalu tampil di atas layar Windows'
                      : 'Desktop Floating Island otomatis tampil saat Anda beralih ke Browser / Minimize'
                  }
                >
                  <MonitorUp size={10.5} />
                  <span>{modeShortLabel}</span>
                </span>
              )}
            </div>
          )}

          <ChevronDown
            size={12.5}
            style={{
              flexShrink: 0,
              opacity: 0.72,
              transform: islandExpanded && !showSearchBody ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.2s ease'
            }}
          />
        </div>

        {/* NEW: Instant Unified Search Pill inside Dynamic Island */}
        <button
          type="button"
          className={`dynamic-island-search-btn ${
            islandExpanded && showSearchBody ? 'is-active' : ''
          }`}
          onClick={(e) => {
            e.stopPropagation();
            if (islandExpanded && showSearchBody) {
              searchInputRef.current?.focus();
              searchInputRef.current?.select();
            } else {
              openIslandSearch({ mode: searchMode });
            }
          }}
          title="Pencarian Terpadu di Dynamic Island: Cari File (Server & Lokal), Isi Kode (Grep), Fungsi PHP/JS, Class CSS, & Tabel DB (Ctrl+K)"
        >
          <Search size={13} className="island-search-trigger-icon" />
          <span className="island-search-trigger-placeholder">Cari file / kode...</span>
          <kbd className="island-search-kbd">Ctrl+K</kbd>
        </button>

        {/* Sync Pill */}
        <button
          type="button"
          className="dynamic-island-sync-btn"
          onClick={handleOpenSync}
          title="Buka Visual File Synchronizer (Push / Pull / Bidirectional + Diff)"
        >
          <ArrowLeftRight size={13} />
          <span>Sync</span>
        </button>
      </div>

      {islandExpanded && (
        <div className="dynamic-island-popover">
          {/* Header Bar with Search vs Control Center Toggle */}
          <div className="island-pop-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <Layers size={14} color="var(--accent)" />
              <strong style={{ fontSize: 12.5, letterSpacing: 0.2 }}>
                HMW Dynamic Island
              </strong>
              <div className="island-view-tabs">
                <button
                  type="button"
                  className={`island-view-tab ${showSearchBody ? 'active' : ''}`}
                  onClick={() => {
                    setIslandView('search');
                    searchInputRef.current?.focus();
                  }}
                >
                  <Search size={11.5} />
                  <span>Pencarian</span>
                </button>
                <button
                  type="button"
                  className={`island-view-tab ${!showSearchBody ? 'active' : ''}`}
                  onClick={() => {
                    setSearchQuery('');
                    setIslandView('controls');
                  }}
                >
                  <SlidersHorizontal size={11.5} />
                  <span>Kontrol Server</span>
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {islandActivity && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ padding: '2px 7px', fontSize: 11 }}
                  onClick={() => clearIslandActivity()}
                >
                  Bersihkan Status
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: '3px 5px' }}
                onClick={() => setIslandExpanded(false)}
                title="Tutup (Esc)"
              >
                <X size={13.5} />
              </button>
            </div>
          </div>

          {/* Always-Ready Omnibox Search Bar */}
          <div className="island-omnibox-box">
            <Search size={14.5} className="island-omnibox-icon" />
            <input
              ref={searchInputRef}
              type="text"
              className="island-omnibox-input"
              placeholder={
                searchMode === 'content'
                  ? 'Ketik potongan kode / teks yang ingin dicari di dalam file Server / Lokal...'
                  : searchMode === 'symbols'
                    ? 'Ketik nama fungsi PHP/JS, .class CSS, atau nama tabel database...'
                    : 'Cari nama file, isi kode, @fungsi, .class, #tabel, atau file.php:baris...'
              }
              value={searchQuery}
              onFocus={() => setIslandView('search')}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (e.target.value.trim()) setIslandView('search');
              }}
              onKeyDown={handleSearchInputKeyDown}
            />
            {searchQuery && (
              <button
                type="button"
                className="island-omnibox-clear"
                onClick={() => {
                  setSearchQuery('');
                  searchInputRef.current?.focus();
                }}
                title="Kosongkan pencarian"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {showSearchBody ? (
            <div className="island-search-panel">
              {/* Mode Tabs: Semua | File | Isi Kode | Simbol & DB */}
              <div className="island-search-modes">
                {(
                  [
                    { id: 'all', label: '⚡ Semua', hint: 'File + Simbol + DB + Aksi' },
                    { id: 'files', label: '📄 File', hint: 'Cari nama & path file' },
                    {
                      id: 'content',
                      label: '🔎 Isi Kode',
                      hint: 'Cari teks/kode di dalam file (Grep)'
                    },
                    {
                      id: 'symbols',
                      label: '🧩 Simbol & DB',
                      hint: 'Fungsi PHP/JS, Class CSS, & Tabel DB'
                    }
                  ] as Array<{ id: IslandSearchTabMode; label: string; hint: string }>
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={`island-mode-tab ${searchMode === m.id ? 'active' : ''}`}
                    onClick={() => {
                      setSearchMode(m.id);
                      searchInputRef.current?.focus();
                    }}
                    title={`${m.hint} (Tekan Tab untuk berpindah mode)`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {/* Scope Filter Pills (Semua | Server | Lokal) + Quick Ext / Subfolder Controls */}
              <div className="island-search-subbar">
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                  {(
                    [
                      { id: 'all', label: 'Semua' },
                      ...(selectedConn
                        ? [
                            {
                              id: 'remote' as const,
                              label: `☁ ${selectedConn.name} (${
                                remoteIndexLoading && remoteIndexedFiles.length === 0
                                  ? '...'
                                  : remoteIndexedFiles.length
                              })`
                            }
                          ]
                        : []),
                      ...(workspacePath || localFlatFiles.length > 0
                        ? [
                            {
                              id: 'local' as const,
                              label: `📁 Lokal (${localFlatFiles.length})`
                            }
                          ]
                        : [])
                    ] as Array<{ id: IslandSearchScope; label: string }>
                  ).map((sc) => (
                    <button
                      key={sc.id}
                      type="button"
                      className={`island-scope-pill ${searchScope === sc.id ? 'active' : ''}`}
                      onClick={() => setSearchScope(sc.id)}
                    >
                      {sc.label}
                    </button>
                  ))}

                  {/* Extension filter chips for File / All mode */}
                  {(searchMode === 'files' || searchMode === 'all') && (
                    <div className="island-ext-chips">
                      {QUICK_EXT_CHIPS.map((ext) => (
                        <button
                          key={ext}
                          type="button"
                          className={`island-ext-chip ${extFilter === ext ? 'active' : ''}`}
                          onClick={() => setExtFilter((cur) => (cur === ext ? null : ext))}
                          title={`Filter hanya file ${ext}`}
                        >
                          {ext}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Remote Subfolder vs Whole Server toggle for Content Grep */}
                  {searchMode === 'content' && selectedConn && remoteSubPath && (
                    <button
                      type="button"
                      className={`island-scope-pill ${grepRemoteSubfolderOnly ? 'active' : ''}`}
                      onClick={() => setGrepRemoteSubfolderOnly((v) => !v)}
                      title="Batasi pencarian isi kode hanya pada subfolder remote yang sedang dibuka agar lebih kilat"
                    >
                      📂 /{remoteSubPath}
                    </button>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                  {searchMode === 'content' && searchQuery.trim().length >= 2 && (
                    <button
                      type="button"
                      className="island-mini-action"
                      onClick={() => {
                        findReferencesForSymbol(
                          searchQuery.trim(),
                          searchScope === 'remote'
                            ? 'remote'
                            : searchScope === 'local'
                              ? 'local'
                              : undefined
                        );
                        setIslandExpanded(false);
                      }}
                      title="Buka hasil lengkap & fitur Replace Massal di panel kiri"
                    >
                      <span>Replace</span>
                      <ExternalLink size={10.5} />
                    </button>
                  )}
                  {selectedConnectionId && (
                    <button
                      type="button"
                      className="island-mini-action"
                      disabled={remoteIndexLoading || remoteIntelLoading}
                      onClick={() => void refreshRemoteFilesIndex(selectedConnectionId, true)}
                      title="Segarkan indeks file & simbol Server Remote SFTP"
                    >
                      <RefreshCw
                        size={10.5}
                        className={remoteIndexLoading || remoteIntelLoading ? 'spin' : undefined}
                      />
                      <span>Indeks</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Saved Tab Sessions (Sesi Fokus Tugas) Strip */}
              {(savedTabSessions.length > 0 || tabs.length > 0) && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 6,
                    flexWrap: 'wrap',
                    padding: '4px 6px',
                    borderRadius: 7,
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-subtle)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', flex: 1 }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        fontSize: 10.5,
                        fontWeight: 700,
                        color: 'var(--text-secondary)'
                      }}
                    >
                      <Bookmark size={11} color="#fbbf24" />
                      <span>Sesi Tugas:</span>
                    </span>
                    {savedTabSessions.length === 0 ? (
                      <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                        Simpan kumpulan tab terbuka per modul/tugas
                      </span>
                    ) : (
                      savedTabSessions.slice(0, 5).map((sess) => (
                        <span
                          key={sess.id}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 3,
                            padding: '1px 6px',
                            borderRadius: 999,
                            background: 'var(--bg-app)',
                            border: '1px solid var(--border-subtle)',
                            fontSize: 10.5
                          }}
                        >
                          <button
                            type="button"
                            style={{
                              border: 'none',
                              background: 'transparent',
                              color: 'var(--text-primary)',
                              fontWeight: 600,
                              cursor: 'pointer',
                              padding: 0,
                              fontSize: 10.5
                            }}
                            onClick={() => {
                              void restoreTabSession(sess.id, false);
                              setIslandExpanded(false);
                            }}
                            title={`Buka ${sess.tabs.length} file dari sesi "${sess.name}"`}
                          >
                            📌 {sess.name} ({sess.tabs.length})
                          </button>
                          <button
                            type="button"
                            style={{
                              border: 'none',
                              background: 'transparent',
                              color: 'var(--text-muted)',
                              cursor: 'pointer',
                              padding: 0,
                              display: 'inline-flex'
                            }}
                            onClick={() => deleteTabSession(sess.id)}
                            title="Hapus sesi ini"
                          >
                            <Trash2 size={9.5} />
                          </button>
                        </span>
                      ))
                    )}
                  </div>

                  {tabs.some((t) => t.kind === 'code') &&
                    (newSessionPromptOpen ? (
                      <form
                        style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (newSessionName.trim()) {
                            saveCurrentTabsAsSession(newSessionName.trim());
                            setNewSessionName('');
                            setNewSessionPromptOpen(false);
                          }
                        }}
                      >
                        <input
                          className="form-input"
                          style={{ width: 130, padding: '2px 6px', fontSize: 10.5 }}
                          placeholder="Nama tugas..."
                          autoFocus
                          value={newSessionName}
                          onChange={(e) => setNewSessionName(e.target.value)}
                        />
                        <button type="submit" className="island-mini-action">
                          Simpan
                        </button>
                      </form>
                    ) : (
                      <button
                        type="button"
                        className="island-mini-action"
                        onClick={() => setNewSessionPromptOpen(true)}
                        title="Simpan kumpulan tab yang sedang dibuka sebagai Sesi Tugas bernama"
                      >
                        <Plus size={10} />
                        <span>Simpan Sesi Tab</span>
                      </button>
                    ))}
                </div>
              )}

              {/* Search Results List */}
              <div className="island-results-list">
                {searchMode === 'content' ? (
                  searchQuery.trim().length < 2 ? (
                    <div className="island-empty-state">
                      Ketik minimal <strong>2 karakter</strong> untuk mencari teks atau potongan
                      kode langsung di dalam file{' '}
                      {selectedConn ? `Server ${selectedConn.name}` : ''}{' '}
                      {selectedConn && workspacePath ? 'maupun ' : ''}
                      {workspacePath ? 'Folder Lokal' : ''}.
                    </div>
                  ) : grepLoading ? (
                    <div className="island-empty-state">
                      <RefreshCw size={14} className="spin" style={{ display: 'inline', marginRight: 6 }} />
                      Menelusuri isi kode untuk <strong>"{searchQuery.trim()}"</strong>...
                    </div>
                  ) : grepMatches.length === 0 ? (
                    <div className="island-empty-state">
                      Tidak ditemukan teks <strong>"{grepSearchedQuery || searchQuery.trim()}"</strong>{' '}
                      pada cakupan {searchScope === 'remote' ? 'Server Remote' : searchScope === 'local' ? 'Folder Lokal' : 'Server & Lokal'}.
                    </div>
                  ) : (
                    grepMatches.map((m, idx) => (
                      <div
                        key={m.id}
                        ref={idx === selectedIdx ? activeItemRef : undefined}
                        className={`island-result-row ${idx === selectedIdx ? 'selected' : ''}`}
                        onMouseEnter={() => setSelectedIdx(idx)}
                        onClick={() => handleSelectGrepMatch(m)}
                      >
                        <span
                          className={`island-res-badge ${
                            m.source === 'remote' ? 'is-remote' : 'is-local'
                          }`}
                        >
                          {m.source === 'remote' ? (
                            <>
                              <Cloud size={10} /> {m.connectionName}
                            </>
                          ) : (
                            <>
                              <FolderOpen size={10} /> Lokal
                            </>
                          )}
                        </span>
                        <div className="island-res-main">
                          <div className="island-res-top">
                            <span className="island-res-title">
                              {m.relativePath.replace(/\\/g, '/')}
                            </span>
                            <span className="island-res-line">:{m.line}</span>
                          </div>
                          <div className="island-res-snippet">
                            {highlightMatchSnippet(m.preview.trim(), searchQuery)}
                          </div>
                        </div>
                      </div>
                    ))
                  )
                ) : rankedItems.length === 0 ? (
                  <div className="island-empty-state">
                    <div>Tidak ada file atau simbol yang cocok dengan pencarian ini.</div>
                    {searchQuery.trim().length >= 2 && (
                      <button
                        type="button"
                        className="btn btn-accent"
                        style={{ marginTop: 8, padding: '5px 11px', fontSize: 11.5 }}
                        onClick={() => setSearchMode('content')}
                      >
                        <Search size={12} />
                        <span>Cari "{searchQuery.trim()}" di dalam Isi Kode (Grep) →</span>
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    {rankedItems.map((item, idx) => {
                      const badgeClass =
                        item.source === 'remote'
                          ? 'is-remote'
                          : item.category === 'db-table' || item.category === 'saved-query'
                            ? 'is-db'
                            : item.category === 'symbol'
                              ? 'is-symbol'
                              : item.category === 'command'
                                ? 'is-cmd'
                                : 'is-local';

                      return (
                        <div
                          key={item.id}
                          ref={idx === selectedIdx ? activeItemRef : undefined}
                          className={`island-result-row ${idx === selectedIdx ? 'selected' : ''}`}
                          onMouseEnter={() => setSelectedIdx(idx)}
                          onClick={() => handleSelectRankedItem(item)}
                        >
                          <span className={`island-res-badge ${badgeClass}`}>
                            {item.category === 'file' && item.source === 'remote' && (
                              <Cloud size={10} />
                            )}
                            {item.category === 'file' && item.source === 'local' && (
                              <FileCode2 size={10} />
                            )}
                            {item.category === 'symbol' && <Code2 size={10} />}
                            {item.category === 'db-table' && <Database size={10} />}
                            <span>{item.badge.replace(/^[☁📁🗄️⚡]\s*/, '')}</span>
                          </span>

                          <div className="island-res-main">
                            <div className="island-res-top">
                              <span className="island-res-title">{item.title}</span>
                              <span className="island-res-sub">{item.subtitle}</span>
                            </div>
                          </div>

                          {/* Pin/Unpin Star button on File rows */}
                          {item.category === 'file' && item.file && (
                            <button
                              type="button"
                              className="icon-btn"
                              style={{
                                padding: 3,
                                color: pinnedFileKeys.has(item.file.key)
                                  ? '#fbbf24'
                                  : 'var(--text-muted)'
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                togglePinFile({
                                  key: item.file!.key,
                                  source: item.file!.source,
                                  name: item.file!.name,
                                  relativePath: item.file!.relativePath,
                                  localPath: item.file!.localPath,
                                  connectionId: item.file!.connectionId,
                                  connectionName: item.file!.connectionName
                                });
                              }}
                              title={
                                pinnedFileKeys.has(item.file.key)
                                  ? 'Lepas dari Pin Favorit'
                                  : 'Sematkan (Pin) file ini ke urutan teratas Dynamic Island'
                              }
                            >
                              <Star size={12} />
                            </button>
                          )}

                          {/* Contextual 1-Click Visual Builder button on Saved Queries that carry a 2D diagram */}
                          {item.category === 'saved-query' &&
                            item.savedQuery?.visualDiagramSpec && (
                              <button
                                type="button"
                                className="island-row-cta"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openSavedQueryInVisualBuilder(item.savedQuery!);
                                  setIslandExpanded(false);
                                }}
                                title="Buka diagram tabel & relasi query ini di Navicat Visual Query Builder"
                              >
                                <Network size={11} />
                                <span>Desain Visual</span>
                              </button>
                            )}

                          {/* Contextual 1-Click Desain & Visual JOIN buttons right on DB Table rows */}
                          {item.category === 'db-table' && item.dbTable && (
                            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                              {item.dbTable.kind === 'table' && (
                                <button
                                  type="button"
                                  className="island-mini-action"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openTableDesigner({
                                      mode: 'alter',
                                      table: item.dbTable!.tableMeta,
                                      schema: item.dbTable!.schema
                                    });
                                    setIslandExpanded(false);
                                  }}
                                  title="Buka Visual Table Designer (Ubah Kolom / Indeks / FK)"
                                >
                                  <SlidersHorizontal size={10.5} />
                                  <span>Desain</span>
                                </button>
                              )}
                              <button
                                type="button"
                                className="island-row-cta"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openVisualJoinBuilder([
                                    {
                                      schema: item.dbTable!.schema,
                                      name: item.dbTable!.name
                                    }
                                  ]);
                                  setIslandExpanded(false);
                                }}
                                title="Buka tabel ini di Navicat Visual Diagram Query Builder"
                              >
                                <Network size={11} />
                                <span>Visual JOIN</span>
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Quick 1-click bridge to Content Grep at bottom of file/symbol results */}
                    {searchQuery.trim().length >= 2 && (
                      <button
                        type="button"
                        className="island-grep-bridge-btn"
                        onClick={() => setSearchMode('content')}
                      >
                        <Search size={12} color="#38bdf8" />
                        <span>
                          Tidak ketemu di nama file? Klik untuk cari teks{' '}
                          <strong>"{searchQuery.trim()}"</strong> di dalam Isi Kode (Ctrl+Enter)
                        </span>
                      </button>
                    )}
                  </>
                )}
              </div>

              {/* Compact Keyboard Hints Footer */}
              <div className="island-search-footer">
                <span>
                  <kbd>↑↓</kbd> Pilih • <kbd>Enter</kbd> Buka • <kbd>Tab</kbd> Ganti Mode •{' '}
                  <kbd>Ctrl+Enter</kbd> Cari Isi Kode
                </span>
                <span>
                  Tips: <code>:85</code> ke baris • <code>@fn</code> simbol •{' '}
                  <code>#tabel</code> DB
                </span>
              </div>
            </div>
          ) : (
            <>
              {/* Section 1: Code Health & Unsaved Files */}
              <div
                className="island-pop-card"
                style={{
                  borderColor:
                    phpSummary.totalErrors > 0 ? 'rgba(251, 113, 133, 0.45)' : undefined,
                  background:
                    phpSummary.totalErrors > 0
                      ? 'rgba(244, 63, 94, 0.09)'
                      : 'rgba(255, 255, 255, 0.025)'
                }}
              >
                {phpSummary.first ? (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#fda4af' }}>
                        🔴 {phpSummary.totalErrors} Error Sintaks PHP •{' '}
                        {phpSummary.first.fileTitle}:{phpSummary.first.line}
                      </div>
                      <div
                        style={{
                          fontSize: 11.5,
                          color: 'var(--text-secondary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          marginTop: 2
                        }}
                      >
                        {phpSummary.first.message}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button
                        type="button"
                        className="btn btn-accent"
                        style={{ padding: '4px 9px', fontSize: 11.5 }}
                        onClick={() => {
                          jumpToTabLine(phpSummary.first!.tabId, phpSummary.first!.line);
                          setIslandExpanded(false);
                        }}
                      >
                        Lompat :{phpSummary.first.line}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ai"
                        style={{ padding: '4px 9px', fontSize: 11.5 }}
                        onClick={() => {
                          jumpToTabLine(phpSummary.first!.tabId, phpSummary.first!.line);
                          setActiveSidebar('ai');
                          setIslandExpanded(false);
                        }}
                      >
                        <Sparkles size={12} color="#c084fc" />
                        <span>AI Fix</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8
                    }}
                  >
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
                    >
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#4ade80' }}>
                        ✓ Diagnostik Sintaks Bersih
                      </span>
                      {gitStatus?.isRepo && (
                        <span className="island-meta-pill">
                          <GitBranch size={11} />
                          <span>
                            {gitStatus.branch} ({gitStatus.changes.length} perubahan)
                          </span>
                        </span>
                      )}
                    </div>
                    {dirtyCount > 0 && (
                      <button
                        type="button"
                        className="btn btn-accent"
                        style={{ padding: '4px 9px', fontSize: 11.5 }}
                        onClick={() => {
                          void saveAllTabs();
                          setIslandExpanded(false);
                        }}
                      >
                        <SaveAll size={12.5} />
                        <span>Simpan Semua ({dirtyCount})</span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Section 2: Remote Connection Switcher & Sync */}
              <div
                className="island-pop-card"
                style={{
                  borderColor: isRemoteError ? 'rgba(251, 113, 133, 0.45)' : undefined
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8
                  }}
                >
                  <span className="island-pop-label">
                    Target Server Remote (SFTP / FTPS / FTP / Lokal)
                  </span>
                  {selectedConn && (
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color:
                          remoteConnectionStatus === 'error'
                            ? '#fb7185'
                            : remoteConnectionStatus === 'connected'
                              ? '#4ade80'
                              : '#38bdf8'
                      }}
                    >
                      {remoteConnectionStatus === 'error'
                        ? '🔴 Tidak Terhubung'
                        : remoteConnectionStatus === 'connected'
                          ? '🟢 Terhubung'
                          : remoteConnectionStatus === 'connecting'
                            ? '⏳ Menghubungi...'
                            : 'Siap'}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                  <select
                    value={selectedConnectionId ?? ''}
                    onChange={(e) => void selectConnection(e.target.value || null)}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      backgroundColor: 'var(--bg-app)',
                      color: 'var(--text-primary)',
                      padding: '5px 8px',
                      fontWeight: selectedConn ? 600 : 400
                    }}
                  >
                    <option value="">— Tanpa Koneksi Remote —</option>
                    {connections.map((c) => (
                      <option key={c.id} value={c.id}>
                        [{c.protocol.toUpperCase()}] {c.name}
                        {c.keepSynchronized ? ' ⚡Auto' : ''}
                      </option>
                    ))}
                  </select>

                  {selectedConn && (
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: '5px 8px' }}
                      onClick={() => void browseRemoteDir(remoteSubPath)}
                      title="Coba Hubungkan Ulang ke Server"
                    >
                      <RefreshCw size={12.5} />
                    </button>
                  )}

                  {(selectedConn || connections.length > 0) && (
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: '5px 8px' }}
                      onClick={() => {
                        openConnectionModal(selectedConn ?? connections[0]);
                        setIslandExpanded(false);
                      }}
                      title="Edit Konfigurasi Server"
                    >
                      <Pencil size={12.5} color="var(--accent)" />
                      <span>Edit</span>
                    </button>
                  )}

                  <button
                    type="button"
                    className="btn"
                    style={{ padding: '5px 8px' }}
                    onClick={() => {
                      openConnectionModal(null);
                      setIslandExpanded(false);
                    }}
                    title="Tambah Profil Server Baru"
                  >
                    <Plus size={13} />
                    <span>Baru</span>
                  </button>
                </div>
                {isRemoteError && remoteConnectionError && (
                  <div
                    style={{
                      marginTop: 7,
                      padding: '6px 8px',
                      borderRadius: 6,
                      background: 'rgba(244, 63, 94, 0.1)',
                      border: '1px solid rgba(251, 113, 133, 0.35)',
                      color: '#fecdd3',
                      fontSize: 11,
                      fontFamily: 'Consolas, monospace',
                      wordBreak: 'break-word'
                    }}
                  >
                    {remoteConnectionError}
                  </div>
                )}
              </div>

              {/* Section 3: Quick Live Preview, Patch ZIP & Panel Shortcuts */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6 }}>
                <button
                  type="button"
                  className={`btn ${previewOpen ? 'btn-accent' : ''}`}
                  style={{ justifyContent: 'center', padding: '6px 8px', fontSize: 11.5 }}
                  onClick={() => {
                    void togglePreviewPane();
                    setIslandExpanded(false);
                  }}
                >
                  <Globe size={13} />
                  <span>
                    {previewState.running ? `Stop :${previewState.port}` : 'Preview'}
                  </span>
                </button>

                <button
                  type="button"
                  className="btn"
                  style={{ justifyContent: 'center', padding: '6px 8px', fontSize: 11.5 }}
                  onClick={() => {
                    setReleasePatchModalOpen(true);
                    setIslandExpanded(false);
                  }}
                  title="Kemas file perubahan hari ini / Git menjadi Paket Rilis (.zip)"
                >
                  <Archive size={12.5} color="#38bdf8" />
                  <span>Patch .ZIP</span>
                </button>

                <button
                  type="button"
                  className="btn"
                  style={{ justifyContent: 'center', padding: '6px 8px', fontSize: 11.5 }}
                  onClick={() => {
                    if (previewState.running && previewState.url) {
                      void navigator.clipboard?.writeText(previewState.url);
                      bumpPreviewReload();
                      showToast(`URL Preview disalin & disegarkan: ${previewState.url}`);
                    } else {
                      setBottomPanel(true, 'transfers');
                    }
                    setIslandExpanded(false);
                  }}
                >
                  <Copy size={12.5} />
                  <span>{previewState.running ? 'Salin URL Preview' : 'Log Transfer'}</span>
                </button>

                <button
                  type="button"
                  className="btn"
                  style={{ justifyContent: 'center', padding: '6px 8px', fontSize: 11.5 }}
                  onClick={() => {
                    setBottomPanel(true, 'output');
                    setIslandExpanded(false);
                  }}
                >
                  <TerminalSquare size={13} />
                  <span>Output & CLI</span>
                </button>
              </div>

              {/* Section 4: Desktop Floating Dynamic Island Mode */}
              <div className="island-pop-card">
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}
                >
                  <span
                    className="island-pop-label"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
                  >
                    <MonitorUp size={12.5} color="#38bdf8" />
                    <span>Desktop Floating Island (Mengambang di Atas Browser / Windows)</span>
                  </span>
                </div>
                <div className="island-segmented" style={{ marginTop: 6 }}>
                  {(
                    [
                      {
                        id: 'auto',
                        label: 'Otomatis (Saat Buka Browser)',
                        desc: 'Muncul otomatis di atas layar saat Anda beralih ke Chrome / Minimize'
                      },
                      {
                        id: 'always',
                        label: 'Selalu Tampil',
                        desc: 'Tampil terus mengambang di tepi atas layar Windows'
                      },
                      {
                        id: 'off',
                        label: 'Mati (Hanya IDE)',
                        desc: 'Nonaktifkan jendela mengambang di luar IDE'
                      }
                    ] as Array<{ id: DesktopIslandMode; label: string; desc: string }>
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      className={`island-seg-btn ${desktopIslandMode === opt.id ? 'active' : ''}`}
                      onClick={() => setDesktopIslandMode(opt.id)}
                      title={opt.desc}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Section 5: Recent Live Activity Feed */}
              {islandHistory.length > 0 && (
                <div className="island-pop-card" style={{ padding: '7px 10px' }}>
                  <div className="island-pop-label" style={{ marginBottom: 4 }}>
                    Aktivitas Terakhir
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {islandHistory.slice(0, 4).map((item) => {
                      const col = getToneAccent(item.tone);
                      return (
                        <div
                          key={`${item.id}-${item.timestamp}`}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 8,
                            fontSize: 11.5
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              minWidth: 0,
                              overflow: 'hidden'
                            }}
                          >
                            <span
                              style={{
                                width: 6,
                                height: 6,
                                borderRadius: '50%',
                                background: col,
                                flexShrink: 0
                              }}
                            />
                            <span
                              style={{
                                color: col,
                                fontWeight: 700,
                                fontSize: 10,
                                flexShrink: 0
                              }}
                            >
                              {item.badge}
                            </span>
                            <span
                              style={{
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                color: 'var(--text-primary)'
                              }}
                            >
                              {item.title}
                            </span>
                          </div>
                          <span
                            style={{
                              fontSize: 10.5,
                              color: 'var(--text-muted)',
                              flexShrink: 0
                            }}
                          >
                            {new Date(item.timestamp).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit'
                            })}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};
