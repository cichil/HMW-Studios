import React, { Suspense, useEffect, useState } from 'react';
import {
  Blocks,
  BookOpen,
  Database,
  Files,
  FolderKanban,
  GitBranch,
  Globe,
  History,
  ListTree,
  Search,
  Sparkles
} from 'lucide-react';
import { useIdeStore } from './store/useIdeStore';
import { TopToolbar } from './components/TopToolbar';
import { ExplorerSidebar } from './components/ExplorerSidebar';
import { SearchSidebar } from './components/SearchSidebar';
import { OutlineSidebar } from './components/OutlineSidebar';
import { HistorySidebar } from './components/HistorySidebar';
import { GitSidebar } from './components/GitSidebar';
import { DatabaseSidebar } from './components/DatabaseSidebar';
import { HttpClientSidebar } from './components/HttpClientSidebar';
import { RublesSidebar } from './components/RublesSidebar';
import { GeminiSidebar } from './components/GeminiSidebar';
import { EditorArea } from './components/EditorArea';
import { LivePreviewPane } from './components/LivePreviewPane';
import { BottomPanel } from './components/BottomPanel';
import { StartupSplash } from './components/StartupSplash';

const ConnectionModal = React.lazy(() =>
  import('./components/ConnectionModal').then((m) => ({ default: m.ConnectionModal }))
);
const SynchronizerModal = React.lazy(() =>
  import('./components/SynchronizerModal').then((m) => ({ default: m.SynchronizerModal }))
);
const QuickPaletteModal = React.lazy(() =>
  import('./components/QuickPaletteModal').then((m) => ({ default: m.QuickPaletteModal }))
);
const ProjectModal = React.lazy(() =>
  import('./components/ProjectModal').then((m) => ({ default: m.ProjectModal }))
);
const DbArchitectModal = React.lazy(() =>
  import('./components/DbArchitectModal').then((m) => ({ default: m.DbArchitectModal }))
);
const PhpScratchpadModal = React.lazy(() =>
  import('./components/PhpScratchpadModal').then((m) => ({ default: m.PhpScratchpadModal }))
);
const ServerMonitorModal = React.lazy(() =>
  import('./components/ServerMonitorModal').then((m) => ({ default: m.ServerMonitorModal }))
);
const TableDesignerModal = React.lazy(() =>
  import('./components/TableDesignerModal').then((m) => ({ default: m.TableDesignerModal }))
);
const PreSaveGuardModal = React.lazy(() =>
  import('./components/PreSaveGuardModal').then((m) => ({ default: m.PreSaveGuardModal }))
);
const SmartRefactorModal = React.lazy(() =>
  import('./components/SmartRefactorModal').then((m) => ({ default: m.SmartRefactorModal }))
);
const ReportGeneratorModal = React.lazy(() =>
  import('./components/ReportGeneratorModal').then((m) => ({ default: m.ReportGeneratorModal }))
);
const DbRoutinesModal = React.lazy(() =>
  import('./components/DbRoutinesModal').then((m) => ({ default: m.DbRoutinesModal }))
);
const DbSeederModal = React.lazy(() =>
  import('./components/DbSeederModal').then((m) => ({ default: m.DbSeederModal }))
);
const ReleasePatchModal = React.lazy(() =>
  import('./components/ReleasePatchModal').then((m) => ({ default: m.ReleasePatchModal }))
);
const DbSchedulerModal = React.lazy(() =>
  import('./components/DbSchedulerModal').then((m) => ({ default: m.DbSchedulerModal }))
);
const EnterpriseAuditModal = React.lazy(() =>
  import('./components/EnterpriseAuditModal').then((m) => ({ default: m.EnterpriseAuditModal }))
);
const ExcelImportModal = React.lazy(() =>
  import('./components/ExcelImportModal').then((m) => ({ default: m.ExcelImportModal }))
);
const DbGlobalSearchModal = React.lazy(() =>
  import('./components/DbGlobalSearchModal').then((m) => ({ default: m.DbGlobalSearchModal }))
);
const EnterpriseScannerModal = React.lazy(() =>
  import('./components/EnterpriseScannerModal').then((m) => ({ default: m.EnterpriseScannerModal }))
);
const DbRbacModal = React.lazy(() =>
  import('./components/DbRbacModal').then((m) => ({ default: m.DbRbacModal }))
);
const DocumentationModal = React.lazy(() =>
  import('./components/DocumentationModal').then((m) => ({ default: m.DocumentationModal }))
);

export const App: React.FC = () => {
  const {
    initApp,
    theme,
    suggestMode,
    cycleSuggestMode,
    docsModalOpen,
    setDocsModalOpen,
    activeSidebar,
    setActiveSidebar,
    projects,
    activeProjectId,
    setProjectModalOpen,
    workspacePath,
    tabs,
    activeTabId,
    setActiveTabLanguage,
    phpDiagnosticsByTab,
    gitStatus,
    connections,
    selectedConnectionId,
    remoteConnectionStatus,
    remoteConnectionError,
    remoteFilesIndexByConn,
    remoteIntelSummaryByConn,
    remoteIntelLoading,
    refreshRemoteFilesIndex,
    refreshRemoteWorkspaceIntel,
    openConnectionModal,
    previewState,
    systemVersionLabel,
    wisanggeniSummary,
    refreshWisanggeniIntelliSense,
    laravelSummary,
    refreshLaravelIntelliSense,
    geminiConfig,
    setGeminiSubTab,
    setInlineAiBarOpen,
    bottomPanelOpen,
    setBottomPanel,
    desktopIslandMode,
    setDesktopIslandMode,
    islandActivity,
    pushIslandActivity,
    runIslandAction,
    refreshTree,
    pushTransferLog,
    bumpPreviewReload,
    setPaletteMode
  } = useIdeStore();

  useEffect(() => {
    void initApp();

    const unsubWs = window.aptana.workspace.onChanged(() => {
      void refreshTree();
    });
    const unsubXfer = window.aptana.sync.onTransferLog((entry) => {
      pushTransferLog(entry);
    });
    const unsubPreview = window.aptana.preview.onReload(() => {
      bumpPreviewReload();
    });
    const unsubLogEntries = window.aptana.logs.onEntries((entries) => {
      useIdeStore.getState().pushServerLogEntries(entries);
    });
    const unsubLogStatus = window.aptana.logs.onStatus((st) => {
      useIdeStore.getState().setLogMonitorStatus(st);
    });
    const unsubIslandAct = window.aptana.island.onActivity((act) => {
      pushIslandActivity(act);
    });
    const unsubDbProgress = window.aptana.db.onProgress((evt) => {
      useIdeStore.getState().setDbLoadingProgress(evt);
    });
    const unsubDbPartial = window.aptana.db.onPartialSchema((snap) => {
      useIdeStore.getState().applyPartialDbSchema(snap);
    });
    const unsubXdebug = window.aptana.xdebug.onEvent((evt) => {
      useIdeStore.getState().handleXdebugEvent(evt);
    });
    const unsubIslandCmd = window.aptana.island.onCommand((cmd) => {
      if (cmd.type === 'focus-ide') {
        return;
      }
      if (cmd.type === 'island-search') {
        useIdeStore.getState().openIslandSearch({
          query: cmd.query,
          mode: cmd.mode ?? 'all'
        });
        return;
      }
      if (cmd.type === 'set-mode') {
        setDesktopIslandMode(cmd.mode);
        return;
      }
      if (cmd.type === 'jump-error') {
        runIslandAction('jump-error', { tabId: cmd.tabId, line: cmd.line });
        return;
      }
      if (
        cmd.type === 'save-all' ||
        cmd.type === 'open-sync' ||
        cmd.type === 'edit-connection' ||
        cmd.type === 'retry-connection' ||
        cmd.type === 'open-ai' ||
        cmd.type === 'open-terminal' ||
        cmd.type === 'open-output' ||
        cmd.type === 'open-logs' ||
        cmd.type === 'open-db' ||
        cmd.type === 'open-http' ||
        cmd.type === 'open-transfers' ||
        cmd.type === 'open-preview'
      ) {
        runIslandAction(cmd.type);
      }
    });

    const unsubShortcut = window.aptana.system.onShortcut((action) => {
      if (action === 'save') {
        void useIdeStore.getState().saveActiveTab();
      } else if (action === 'save-all') {
        void useIdeStore.getState().saveAllTabs();
      } else if (action === 'save-project') {
        void useIdeStore.getState().quickSaveActiveProject();
      }
    });

    const onKeyDown = (e: KeyboardEvent): void => {
      const key = e.key.toLowerCase();
      const isKeyS = key === 's' || e.code === 'KeyS';

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && isKeyS) {
        e.preventDefault();
        e.stopPropagation();
        void useIdeStore.getState().saveActiveTab();
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && isKeyS) {
        e.preventDefault();
        e.stopPropagation();
        void useIdeStore.getState().saveAllTabs();
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.altKey && isKeyS) {
        e.preventDefault();
        e.stopPropagation();
        void useIdeStore.getState().quickSaveActiveProject();
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === 'k') {
        e.preventDefault();
        useIdeStore.getState().openIslandSearch({ mode: 'all' });
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && key === 'p') {
        e.preventDefault();
        setPaletteMode('commands');
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && key === 'p') {
        e.preventDefault();
        useIdeStore.getState().openIslandSearch({ mode: 'files' });
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && key === 'f') {
        e.preventDefault();
        setActiveSidebar('search');
      } else if (e.shiftKey && e.altKey && !e.ctrlKey && key === 'f') {
        e.preventDefault();
        useIdeStore.getState().formatTabContent();
      } else if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
        e.preventDefault();
        useIdeStore.getState().toggleSplitEditor();
      } else if ((e.ctrlKey || e.metaKey) && e.key === '`') {
        e.preventDefault();
        setBottomPanel(!useIdeStore.getState().bottomPanelOpen, 'terminal');
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && key === 'i') {
        e.preventDefault();
        setInlineAiBarOpen(true);
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && key === 'a') {
        e.preventDefault();
        setActiveSidebar('ai');
      } else if ((e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey && key === 'd') {
        e.preventDefault();
        void useIdeStore.getState().compareTabWithCounterpart();
      } else if (!e.ctrlKey && !e.metaKey && e.altKey && !e.shiftKey && key === 'o') {
        e.preventDefault();
        void useIdeStore.getState().switchModuleCompanion();
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key === 'Enter') {
        e.preventDefault();
        const st = useIdeStore.getState();
        st.openPhpScratchpad(st.selectedEditorText || undefined);
      } else if (e.key === 'F1' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        const st = useIdeStore.getState();
        st.setDocsModalOpen(!st.docsModalOpen);
      } else if (e.key === 'Escape') {
        setPaletteMode('closed');
        setInlineAiBarOpen(false);
        setDocsModalOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      unsubWs();
      unsubXfer();
      unsubPreview();
      unsubLogEntries();
      unsubLogStatus();
      unsubIslandAct();
      unsubDbProgress();
      unsubDbPartial();
      unsubXdebug();
      unsubIslandCmd();
      unsubShortcut();
      window.removeEventListener('keydown', onKeyDown, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const activeConn = connections.find((c) => c.id === selectedConnectionId) ?? null;
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;

  useEffect(() => {
    const dirtyCount = tabs.filter((t) => t.content !== t.savedContent).length;
    let phpErrorCount = 0;
    let firstPhpError: {
      tabId: string;
      fileTitle: string;
      line: number;
      message: string;
    } | null = null;

    if (activeTab && (phpDiagnosticsByTab[activeTab.id]?.length ?? 0) > 0) {
      const d = phpDiagnosticsByTab[activeTab.id][0];
      firstPhpError = {
        tabId: activeTab.id,
        fileTitle: activeTab.title,
        line: d.line,
        message: d.message
      };
    }

    for (const tab of tabs) {
      const list = phpDiagnosticsByTab[tab.id] ?? [];
      phpErrorCount += list.length;
      if (!firstPhpError && list.length > 0) {
        firstPhpError = {
          tabId: tab.id,
          fileTitle: tab.title,
          line: list[0].line,
          message: list[0].message
        };
      }
    }

    const frameworkBadge =
      laravelSummary?.isLaravelProject ||
      activeTab?.relativePath.toLowerCase().endsWith('.blade.php')
        ? `🔺 Laravel (${laravelSummary?.routeCount ?? 0} Route)`
        : wisanggeniSummary?.available
          ? `⚡ Wisanggeni (${wisanggeniSummary.classCount})`
          : laravelSummary
            ? `🔺 Laravel`
            : null;

    void window.aptana.island
      .pushSnapshot({
        mode: desktopIslandMode,
        theme,
        projectName: activeProject?.name ?? (workspacePath ? workspacePath.split(/[/\\]/).pop() ?? null : null),
        connectionName: activeConn?.name ?? null,
        connectionProtocol: activeConn?.protocol ?? null,
        connectionStatus: remoteConnectionStatus,
        connectionError: remoteConnectionError,
        keepSynchronized: Boolean(activeConn?.keepSynchronized),
        dirtyCount,
        phpErrorCount,
        firstPhpError,
        gitBranch: gitStatus?.isRepo ? gitStatus.branch : null,
        gitChangeCount: gitStatus?.isRepo ? gitStatus.changes.length : 0,
        previewRunning: previewState.running,
        previewPort: previewState.port,
        previewUrl: previewState.url,
        frameworkBadge,
        activeActivity: islandActivity
      })
      .catch(() => {});
  }, [
    desktopIslandMode,
    theme,
    activeProject,
    workspacePath,
    activeConn,
    remoteConnectionStatus,
    remoteConnectionError,
    tabs,
    activeTab,
    phpDiagnosticsByTab,
    gitStatus,
    previewState,
    wisanggeniSummary,
    laravelSummary,
    islandActivity
  ]);

  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const saved = Number(window.localStorage.getItem('hmw.sidebarWidth'));
      if (Number.isFinite(saved) && saved >= 240 && saved <= 560) return saved;
    } catch {
      // ignore
    }
    return 300;
  });
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);

  const handleStartResizeSidebar = (e: React.MouseEvent): void => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    setIsResizingSidebar(true);
    let latestW = startW;

    const onMove = (ev: MouseEvent): void => {
      latestW = Math.min(560, Math.max(240, Math.round(startW + (ev.clientX - startX))));
      setSidebarWidth(latestW);
    };
    const onUp = (): void => {
      setIsResizingSidebar(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      try {
        window.localStorage.setItem('hmw.sidebarWidth', String(latestW));
      } catch {
        // ignore
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div className="ide-shell">
      <StartupSplash />
      <TopToolbar />

      <div className="ide-body">
        <nav className="activity-bar">
          <button
            className={`activity-btn ${activeSidebar === 'explorer' ? 'active' : ''}`}
            title="App Explorer & Remote Browser"
            onClick={() => setActiveSidebar('explorer')}
          >
            <Files size={19} />
          </button>

          <button
            className="activity-btn"
            title="Manajer Proyek Tersimpan (Simpan & Buka Kembali Proyek)"
            onClick={() => setProjectModalOpen(true)}
          >
            <FolderKanban size={19} />
          </button>

          <button
            className={`activity-btn ${activeSidebar === 'search' ? 'active' : ''}`}
            title="Cari di Proyek Lokal & Server Remote (Ctrl+Shift+F)"
            onClick={() => setActiveSidebar('search')}
          >
            <Search size={19} />
          </button>

          <button
            className={`activity-btn ${activeSidebar === 'outline' ? 'active' : ''}`}
            title="Code Outline (Struktur Class, Method, Fungsi & Elemen)"
            onClick={() => setActiveSidebar('outline')}
          >
            <ListTree size={19} />
          </button>

          <button
            className={`activity-btn ${activeSidebar === 'history' ? 'active' : ''}`}
            title="Local History / Auto-Backup & Rollback File"
            onClick={() => setActiveSidebar('history')}
          >
            <History size={19} />
          </button>

          <button
            className={`activity-btn ${activeSidebar === 'git' ? 'active' : ''}`}
            title="Git Source Control"
            onClick={() => setActiveSidebar('git')}
          >
            <GitBranch size={19} />
          </button>

          <button
            className={`activity-btn ${activeSidebar === 'database' ? 'active' : ''}`}
            title="Database Explorer & SQL Query Runner (MySQL / PostgreSQL / SSH Tunnel)"
            onClick={() => setActiveSidebar('database')}
          >
            <Database size={19} />
          </button>

          <button
            className={`activity-btn ${activeSidebar === 'http' ? 'active' : ''}`}
            title="HTTP / AJAX Request Tester (Mini Postman + Cookie PHPSESSID)"
            onClick={() => setActiveSidebar('http')}
          >
            <Globe size={19} />
          </button>

          <button
            className={`activity-btn ${activeSidebar === 'rubles' ? 'active' : ''}`}
            title="Rubles 2.0: Bundles, Snippets & Automation"
            onClick={() => setActiveSidebar('rubles')}
          >
            <Blocks size={19} />
          </button>

          <button
            className={`activity-btn ${activeSidebar === 'ai' ? 'active' : ''}`}
            title="Google Gemini AI Studio: Chat, CRUD Wisanggeni, Audit Keamanan & Docs (Ctrl+Shift+A)"
            onClick={() => setActiveSidebar('ai')}
          >
            <Sparkles size={19} color={activeSidebar === 'ai' ? '#a855f7' : undefined} />
          </button>

          <button
            className={`activity-btn ${docsModalOpen ? 'active' : ''}`}
            style={{ marginTop: 'auto' }}
            title="Dokumentasi & Panduan Lengkap Fitur HMW Studio (F1)"
            onClick={() => setDocsModalOpen(!docsModalOpen)}
          >
            <BookOpen size={19} color={docsModalOpen ? '#38bdf8' : undefined} />
          </button>
        </nav>

        <aside className="sidebar-pane" style={{ width: sidebarWidth }}>
          {activeSidebar === 'explorer' && <ExplorerSidebar />}
          {activeSidebar === 'search' && <SearchSidebar />}
          {activeSidebar === 'outline' && <OutlineSidebar />}
          {activeSidebar === 'history' && <HistorySidebar />}
          {activeSidebar === 'git' && <GitSidebar />}
          {activeSidebar === 'database' && <DatabaseSidebar />}
          {activeSidebar === 'http' && <HttpClientSidebar />}
          {activeSidebar === 'rubles' && <RublesSidebar />}
          {activeSidebar === 'ai' && <GeminiSidebar />}
        </aside>

        <div
          className={`sidebar-resizer ${isResizingSidebar ? 'dragging' : ''}`}
          onMouseDown={handleStartResizeSidebar}
          onDoubleClick={() => {
            setSidebarWidth(300);
            try {
              window.localStorage.setItem('hmw.sidebarWidth', '300');
            } catch {
              // ignore
            }
          }}
          title="Seret kiri/kanan untuk ubah lebar sidebar (Klik 2x untuk reset)"
        />

        <main className="center-column">
          <div className="editor-and-preview">
            <EditorArea />
            <LivePreviewPane />
          </div>
          <BottomPanel />
        </main>
      </div>

      <footer className="status-bar">
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 12px' }}>
          {activeProject && (
            <span
              style={{ color: 'var(--accent)', fontWeight: 700, cursor: 'pointer' }}
              onClick={() => setProjectModalOpen(true)}
              title="Klik untuk membuka Manajer Proyek"
            >
              🗂 Proyek: {activeProject.name}
            </span>
          )}
          <span>
            {workspacePath ? `📁 ${workspacePath}` : 'Tanpa folder lokal'}
          </span>
          {gitStatus?.isRepo && (
            <span>
              ⎇ {gitStatus.branch} ({gitStatus.changes.length} perubahan)
            </span>
          )}
          {activeConn && (
            <span
              style={{
                color:
                  remoteConnectionStatus === 'error'
                    ? '#fb7185'
                    : remoteConnectionStatus === 'connected'
                      ? '#4ade80'
                      : '#38bdf8',
                fontWeight: 600,
                cursor: 'pointer'
              }}
              onClick={() => openConnectionModal(activeConn)}
              title={
                remoteConnectionStatus === 'error'
                  ? `GAGAL TERHUBUNG: ${remoteConnectionError || 'Periksa host/port/password'} — Klik untuk mengedit konfigurasi server`
                  : 'Klik untuk mengedit konfigurasi koneksi server ini'
              }
            >
              {remoteConnectionStatus === 'error'
                ? `🔴 ${activeConn.name} [${activeConn.protocol.toUpperCase()}: TIDAK KONEK]`
                : `⇄ ${activeConn.name} [${activeConn.protocol.toUpperCase()}]${
                    activeConn.keepSynchronized ? ' • Keep-Synchronized ON' : ''
                  }`}
            </span>
          )}
          {activeConn && remoteConnectionStatus === 'connected' && selectedConnectionId && (
            <span
              style={{
                color: remoteIntelLoading ? '#fbbf24' : '#7dd3fc',
                fontWeight: 600,
                cursor: 'pointer'
              }}
              onClick={() => {
                void refreshRemoteFilesIndex(selectedConnectionId, true);
                void refreshRemoteWorkspaceIntel(selectedConnectionId, true);
              }}
              title="Klik untuk mengindeks ulang daftar file & simbol PHP/JS/CSS di server remote ini"
            >
              {remoteIntelLoading
                ? `⏳ Mengindeks Server ${activeConn.name}...`
                : `☁ Indeks Remote: ${(remoteFilesIndexByConn[selectedConnectionId]?.length ?? 0).toLocaleString('id-ID')} file${
                    remoteIntelSummaryByConn[selectedConnectionId]
                      ? ` • ${remoteIntelSummaryByConn[selectedConnectionId].phpFnCount} PHP • ${remoteIntelSummaryByConn[selectedConnectionId].jsFnCount} JS • ${remoteIntelSummaryByConn[selectedConnectionId].cssClassCount} CSS`
                      : ''
                  }`}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 12px', marginLeft: 'auto' }}>
          <span
            style={{
              color:
                suggestMode === 'manual'
                  ? 'var(--text-muted)'
                  : suggestMode === 'full'
                    ? '#fbbf24'
                    : '#38bdf8',
              fontWeight: 600,
              cursor: 'pointer'
            }}
            onClick={() => cycleSuggestMode()}
            title={
              suggestMode === 'calm'
                ? 'Mode Saran Santai (Default): tidak mengganggu mengetik — Enter = baris baru, Tab / Klik = terima saran, Ctrl+Space = panggil manual. Klik untuk beralih ke Manual.'
                : suggestMode === 'manual'
                  ? 'Mode Saran Manual: popup tidak muncul otomatis. Tekan Ctrl+Space kapan saja untuk memanggil saran. Klik untuk beralih ke Aktif.'
                  : 'Mode Saran Aktif: saran lebih cepat & bisa diterima dengan Enter atau Tab. Klik untuk kembali ke Santai.'
            }
          >
            {suggestMode === 'calm'
              ? '💡 Saran: Santai (Tab)'
              : suggestMode === 'manual'
                ? '🔇 Saran: Manual (Ctrl+Space)'
                : '⚡ Saran: Aktif'}
          </span>
          <span
            style={{
              color: bottomPanelOpen ? 'var(--accent)' : 'var(--text-secondary)',
              fontWeight: 600,
              cursor: 'pointer'
            }}
            onClick={() => setBottomPanel(!bottomPanelOpen, 'terminal')}
            title="Klik untuk membuka/menutup Panel Terminal & SSH (Ctrl+`)"
          >
            ⌨ Terminal
          </span>
          <span
            style={{
              color: geminiConfig?.hasApiKey ? '#c084fc' : 'var(--text-muted)',
              fontWeight: 600,
              cursor: 'pointer'
            }}
            onClick={() => {
              setActiveSidebar('ai');
              if (!geminiConfig?.hasApiKey) setGeminiSubTab('settings');
            }}
            title={
              geminiConfig?.hasApiKey
                ? `Google Gemini AI Aktif (${geminiConfig.model}${
                    geminiConfig.ghostTextEnabled ? ' • Ghost-Text ON' : ''
                  }) — Klik untuk membuka Gemini AI Studio`
                : 'Klik untuk mengatur GEMINI_API_KEY di HMW Studio'
            }
          >
            ✨ {geminiConfig?.hasApiKey ? `Gemini (${geminiConfig.model})` : 'Gemini AI (Setup Key)'}
          </span>
          {laravelSummary && (
            <span
              style={{ color: '#fb7185', fontWeight: 600, cursor: 'pointer' }}
              onClick={() => void refreshLaravelIntelliSense(false)}
              title={
                laravelSummary.isLaravelProject
                  ? `Proyek Laravel Terdeteksi (${laravelSummary.laravelVersion ?? 'Laravel'}) — ${laravelSummary.routeCount} Route • ${laravelSummary.viewCount} Blade View • ${laravelSummary.modelCount} Model • ${laravelSummary.configKeyCount} Config. Klik untuk sinkronisasi ulang.`
                  : `Laravel & Blade Core IntelliSense Aktif (${laravelSummary.classCount} Facade/Class • ${laravelSummary.helperCount} Helper • ${laravelSummary.directiveCount} Blade Directive). Klik untuk memindai ulang workspace.`
              }
            >
              🔺{' '}
              {laravelSummary.isLaravelProject
                ? `Laravel (${laravelSummary.routeCount} Route • ${laravelSummary.viewCount} View • ${laravelSummary.modelCount} Model)`
                : `Laravel (${laravelSummary.classCount} Facade • ${laravelSummary.directiveCount} Blade)`}
            </span>
          )}
          {wisanggeniSummary?.available && (
            <span
              style={{ color: '#4ade80', fontWeight: 600, cursor: 'pointer' }}
              onClick={() => void refreshWisanggeniIntelliSense(false)}
              title={`Wisanggeni Framework IntelliSense Aktif (${
                wisanggeniSummary.rootPath ?? 'Katalog Bawaan'
              }${
                wisanggeniSummary.apiSynced ? ' • Live docs_api.php' : ''
              }) — Klik untuk sinkronisasi ulang`}
            >
              ⚡ Wisanggeni ({wisanggeniSummary.classCount} Class •{' '}
              {wisanggeniSummary.functionCount} Helper)
            </span>
          )}
          {activeTab && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span>
                Baris {activeTab.cursorLine}, Kolom {activeTab.cursorCol} •
              </span>
              <select
                title="Mode Bahasa & IntelliSense Tab Aktif (Klik untuk mengganti bahasa)"
                value={activeTab.language}
                onChange={(e) => setActiveTabLanguage(e.target.value)}
                style={{
                  background: 'transparent',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 4,
                  fontSize: 10.5,
                  fontWeight: 700,
                  padding: '0 4px',
                  cursor: 'pointer'
                }}
              >
                <option value="php" style={{ background: '#0f172a' }}>
                  {activeTab.language === 'php' &&
                  /<(?:script|style)\b/i.test(activeTab.content)
                    ? 'PHP + JS/CSS'
                    : 'PHP'}
                </option>
                <option value="javascript" style={{ background: '#0f172a' }}>JAVASCRIPT</option>
                <option value="typescript" style={{ background: '#0f172a' }}>TYPESCRIPT</option>
                <option value="css" style={{ background: '#0f172a' }}>CSS</option>
                <option value="scss" style={{ background: '#0f172a' }}>SCSS</option>
                <option value="less" style={{ background: '#0f172a' }}>LESS</option>
                <option value="html" style={{ background: '#0f172a' }}>HTML</option>
                <option value="sql" style={{ background: '#0f172a' }}>SQL</option>
                <option value="json" style={{ background: '#0f172a' }}>JSON</option>
                <option value="markdown" style={{ background: '#0f172a' }}>MARKDOWN</option>
                <option value="plaintext" style={{ background: '#0f172a' }}>PLAINTEXT</option>
              </select>
              <span>• UTF-8</span>
            </span>
          )}
          <span>{systemVersionLabel}</span>
        </div>
      </footer>

      <Suspense fallback={null}>
        <ProjectModal />
        <ConnectionModal />
        <SynchronizerModal />
        <QuickPaletteModal />
        <DbArchitectModal />
        <TableDesignerModal />
        <PreSaveGuardModal />
        <SmartRefactorModal />
        <ReportGeneratorModal />
        <DbRoutinesModal />
        <DbSeederModal />
        <ReleasePatchModal />
        <DbSchedulerModal />
        <PhpScratchpadModal />
        <ServerMonitorModal />
        <EnterpriseAuditModal />
        <ExcelImportModal />
        <DbGlobalSearchModal />
        <EnterpriseScannerModal />
        <DbRbacModal />
        <DocumentationModal />
      </Suspense>
    </div>
  );
};
