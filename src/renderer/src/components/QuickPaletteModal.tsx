import React, { useEffect, useMemo, useState } from 'react';
import { Cloud, FolderOpen, RefreshCw, X } from 'lucide-react';
import type { FileNode } from '@shared/types';
import { useIdeStore } from '../store/useIdeStore';

function flattenFiles(nodes: FileNode[]): FileNode[] {
  const out: FileNode[] = [];
  for (const n of nodes) {
    if (n.isDirectory) {
      if (n.children) out.push(...flattenFiles(n.children));
    } else {
      out.push(n);
    }
  }
  return out;
}

function matchesSearchTokens(haystackLower: string, rawNeedle: string): boolean {
  const trimmed = rawNeedle.trim().toLowerCase();
  if (!trimmed) return true;
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  for (const tok of tokens) {
    if (!haystackLower.includes(tok)) return false;
  }
  return true;
}

function isVendorOrMinifiedPath(relLower: string): boolean {
  const norm = relLower.replace(/\\/g, '/');
  if (
    /(?:^|\/)(?:vendor|node_modules|bower_components|packages|dist|\.git)(?:\/|$)/.test(
      norm
    )
  ) {
    return true;
  }
  return /\.(?:min\.(?:js|css)|map|lock)$/.test(norm);
}

export const QuickPaletteModal: React.FC = () => {
  const {
    paletteMode,
    setPaletteMode,
    fileTree,
    openFileInTab,
    openRemoteFileInTab,
    connections,
    selectedConnectionId,
    remoteSubPath,
    tabs,
    remoteFilesIndexByConn,
    remoteIndexLoading,
    remoteIntelSummaryByConn,
    remoteIntelLoading,
    refreshRemoteFilesIndex,
    refreshRemoteWorkspaceIntel,
    setDbArchitectTab,
    openVisualJoinBuilder,
    setServerMonitorOpen,
    sendTabToHttpTester,
    switchModuleCompanion,
    compareTabWithCounterpart,
    openPhpScratchpad,
    selectedEditorText,
    setProjectModalOpen,
    quickSaveActiveProject,
    openProjectFromFile,
    closeCurrentProject,
    openWorkspaceFolder,
    createAndOpenDemoProject,
    openConnectionModal,
    setSyncModalOpen,
    togglePreviewPane,
    saveActiveTab,
    saveAllTabs,
    formatTabContent,
    toggleSplitEditor,
    setActiveSidebar,
    setBottomPanel,
    jumpToNextBookmark,
    setGeminiSubTab,
    setInlineAiBarOpen,
    rubleBundles,
    executeRubleCommand,
    refreshWisanggeniIntelliSense,
    refreshLaravelIntelliSense,
    setIslandExpanded,
    setDesktopIslandMode,
    setTheme,
    setSuggestMode,
    setDocsModalOpen,
    checkForAppUpdates,
    showToast
  } = useIdeStore();

  const [filter, setFilter] = useState('');
  const [sourceScope, setSourceScope] = useState<'all' | 'remote' | 'local'>('all');
  const [selectedIdx, setSelectedIdx] = useState(0);

  useEffect(() => {
    setSelectedIdx(0);
  }, [filter, sourceScope, paletteMode]);

  useEffect(() => {
    if (paletteMode === 'files' && selectedConnectionId) {
      void refreshRemoteFilesIndex(selectedConnectionId, false);
      void refreshRemoteWorkspaceIntel(selectedConnectionId, false);
    }
  }, [
    paletteMode,
    selectedConnectionId,
    refreshRemoteFilesIndex,
    refreshRemoteWorkspaceIntel
  ]);

  const allFiles = useMemo(() => flattenFiles(fileTree), [fileTree]);
  const activeConn = useMemo(
    () => connections.find((c) => c.id === selectedConnectionId) ?? null,
    [connections, selectedConnectionId]
  );
  const remoteIndexedFiles = useMemo(
    () => (selectedConnectionId ? remoteFilesIndexByConn[selectedConnectionId] ?? [] : []),
    [selectedConnectionId, remoteFilesIndexByConn]
  );
  const remoteIntelSummary = selectedConnectionId
    ? remoteIntelSummaryByConn[selectedConnectionId]
    : undefined;

  const openTabKeySet = useMemo(() => {
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

  const combinedFileItems = useMemo(() => {
    const items: Array<{
      key: string;
      source: 'local' | 'remote';
      name: string;
      relativePath: string;
      localPath?: string;
      connectionId?: string;
      connectionName?: string;
    }> = [];

    for (const f of allFiles) {
      items.push({
        key: `local:${f.path}`,
        source: 'local',
        name: f.name,
        relativePath: f.relativePath,
        localPath: f.path
      });
    }

    if (selectedConnectionId) {
      for (const rf of remoteIndexedFiles) {
        items.push({
          key: `remote:${selectedConnectionId}:${rf.relativePath}`,
          source: 'remote',
          name: rf.name,
          relativePath: rf.relativePath,
          connectionId: selectedConnectionId,
          connectionName: activeConn?.name || 'Remote'
        });
      }
    }

    return items;
  }, [allFiles, selectedConnectionId, remoteIndexedFiles, activeConn?.name]);

  const commands = useMemo(() => {
    const base = [
      {
        id: 'act-proj-manage',
        label: 'Proyek: Buka Daftar Proyek Tersimpan / Manajer Proyek',
        run: () => setProjectModalOpen(true)
      },
      {
        id: 'act-proj-save',
        label: 'Proyek: Simpan Proyek Saat Ini (Ctrl+Alt+S)',
        run: () => void quickSaveActiveProject()
      },
      {
        id: 'act-proj-open-file',
        label: 'Proyek: Buka File Proyek (.hmwproj)...',
        run: () => void openProjectFromFile()
      },
      {
        id: 'act-proj-close',
        label: 'Proyek: Tutup Proyek Saat Ini',
        run: () => void closeCurrentProject()
      },
      {
        id: 'act-open-folder',
        label: 'Workspace: Buka Folder Proyek Lokal',
        run: () => void openWorkspaceFolder()
      },
      {
        id: 'act-demo',
        label: 'Workspace: Buat & Buka Proyek Demo Web Modern',
        run: () => void createAndOpenDemoProject()
      },
      {
        id: 'act-save-active',
        label: 'Editor: Simpan File Aktif (Ctrl+S)',
        run: () => void saveActiveTab()
      },
      {
        id: 'act-save-all',
        label: 'Editor: Simpan Semua File (Ctrl+Shift+S)',
        run: () => void saveAllTabs()
      },
      {
        id: 'act-format-code',
        label: 'Editor: Rapikan / Format Kode Aktif (Shift+Alt+F)',
        run: () => formatTabContent()
      },
      {
        id: 'act-split-editor',
        label: 'Editor: Toggle Split Editor Kiri & Kanan (Ctrl+\\)',
        run: () => toggleSplitEditor()
      },
      {
        id: 'act-code-outline',
        label: 'Editor: Buka Panel Code Outline, Bookmark Baris & Daftar TODO',
        run: () => setActiveSidebar('outline')
      },
      {
        id: 'act-next-bookmark',
        label: 'Editor: Lompat ke Bookmark Baris Berikutnya (F2)',
        run: () => void jumpToNextBookmark()
      },
      {
        id: 'act-db-explorer',
        label: '🗄️ Database: Buka Database Explorer & SQL Query Runner (MySQL / PostgreSQL / SSH Tunnel)',
        run: () => setActiveSidebar('database')
      },
      {
        id: 'act-db-join-builder',
        label: '🔗 Database: Rakit Query JOIN Tabel Visual (Lintas Database, Auto-ON & Export Excel)',
        run: () => openVisualJoinBuilder()
      },
      {
        id: 'act-db-er-diagram',
        label: '🗺️ Database: Buka Visual ER Diagram Interaktif (Relasi Tabel & Foreign Key)',
        run: () => setDbArchitectTab('er')
      },
      {
        id: 'act-db-schema-diff',
        label: '⚖️ Database: Bandingkan 2 Database (Schema Diff & Generator Migrasi ALTER TABLE)',
        run: () => setDbArchitectTab('diff')
      },
      {
        id: 'act-server-monitor',
        label: '🖥️ Server & DB: Monitor Kesehatan Server SSH (CPU/RAM/Disk), Crontab & Kill Query DB',
        run: () => setServerMonitorOpen(true)
      },
      {
        id: 'act-module-companion',
        label: '⇄ Modul: Pindah ke File Pasangan Modul Berikutnya (_idx / _form / _save / Controller↔Model) (Alt+O)',
        run: () => void switchModuleCompanion()
      },
      {
        id: 'act-http-extract-php',
        label: '🧪 HTTP Tester: Deteksi Otomatis Field $_POST / $_GET dari Tab PHP Aktif',
        run: () => sendTabToHttpTester()
      },
      {
        id: 'act-diff-counterpart',
        label: '⇄ Editor: Bandingkan File Aktif Lokal ↔ Server Remote SFTP (Ctrl+Alt+D)',
        run: () => void compareTabWithCounterpart()
      },
      {
        id: 'act-php-scratchpad',
        label: '⚡ PHP: Buka PHP Scratchpad / Tinker Runner (Ctrl+Shift+Enter)',
        run: () => openPhpScratchpad(selectedEditorText)
      },
      {
        id: 'act-find-references',
        label: '🔍 Navigasi: Lacak Pemakaian Fungsi / Tabel Database di Seluruh Proyek (Shift+F12)',
        run: () => setActiveSidebar('search')
      },
      {
        id: 'act-http-client',
        label: '🧪 HTTP / AJAX Tester: Buka Mini Postman & Tester Endpoint _save.php',
        run: () => setActiveSidebar('http')
      },
      {
        id: 'act-live-logs',
        label: '📡 Server Log: Buka Live Error Log Monitor (Apache / Nginx / PHP / Laravel)',
        run: () => setBottomPanel(true, 'logs')
      },
      {
        id: 'act-local-history',
        label: 'Backup: Buka Timeline Local History / Rollback File',
        run: () => setActiveSidebar('history')
      },
      {
        id: 'act-remote-search',
        label: 'Pencarian & Replace: Cari / Ganti Teks Massal di Proyek Lokal & Server Remote (Ctrl+Shift+F)',
        run: () => setActiveSidebar('search')
      },
      {
        id: 'act-ai-chat',
        label: '✨ Gemini AI: Buka Asisten Chat Kontekstual (Ctrl+Shift+A)',
        run: () => {
          setActiveSidebar('ai');
          setGeminiSubTab('chat');
        }
      },
      {
        id: 'act-ai-inline',
        label: '✨ Gemini AI: Inline Edit & Refactor Kode Aktif (Ctrl+I)',
        run: () => setInlineAiBarOpen(true)
      },
      {
        id: 'act-ai-crud',
        label: '✨ Gemini AI: Generator 3-File CRUD Wisanggeni (_idx, _form, _save)',
        run: () => {
          setActiveSidebar('ai');
          setGeminiSubTab('crud');
        }
      },
      {
        id: 'act-ai-audit',
        label: '✨ Gemini AI: Audit Keamanan PHP/SQL (SQLi, XSS, IDOR encid/decid)',
        run: () => {
          setActiveSidebar('ai');
          setGeminiSubTab('sql-audit');
        }
      },
      {
        id: 'act-ai-docs',
        label: '✨ Gemini AI: Generator Dokumentasi PHPDoc & SQL wisanggeni_docs',
        run: () => {
          setActiveSidebar('ai');
          setGeminiSubTab('docs');
        }
      },
      {
        id: 'act-ai-settings',
        label: '✨ Gemini AI: Pengaturan API Key Terenkripsi, Model & Ghost-Text',
        run: () => {
          setActiveSidebar('ai');
          setGeminiSubTab('settings');
        }
      },
      {
        id: 'act-laravel-sync',
        label: '🔺 Laravel: Sinkronisasi Ulang Route, Blade View, Eloquent Model & Config IntelliSense',
        run: () => void refreshLaravelIntelliSense(false)
      },
      {
        id: 'act-wisanggeni-sync',
        label: 'Wisanggeni: Sinkronisasi Ulang Dokumentasi & IntelliSense (docs_api.php / Lokal)',
        run: () => void refreshWisanggeniIntelliSense(false)
      },
      {
        id: 'act-new-conn',
        label: 'Deployment: Tambah Koneksi SFTP / FTPS / Local Baru',
        run: () => openConnectionModal(null)
      },
      {
        id: 'act-sync',
        label: 'Deployment: Buka Visual File Synchronizer',
        run: () => setSyncModalOpen(true)
      },
      {
        id: 'act-preview',
        label: 'Preview: Toggle Live Web Preview Server',
        run: () => void togglePreviewPane()
      },
      {
        id: 'act-island-open',
        label: 'Dynamic Island: Buka Pusat Kontrol Cepat di Toolbar',
        run: () => setIslandExpanded(true)
      },
      {
        id: 'act-island-desktop-auto',
        label: 'Dynamic Island Desktop: Mode Otomatis (Muncul Saat Buka Browser / Minimize)',
        run: () => setDesktopIslandMode('auto')
      },
      {
        id: 'act-island-desktop-always',
        label: 'Dynamic Island Desktop: Selalu Tampil Mengambang di Atas Layar Windows',
        run: () => setDesktopIslandMode('always')
      },
      {
        id: 'act-island-desktop-off',
        label: 'Dynamic Island Desktop: Matikan Overlay Luar (Hanya Tampil di Dalam IDE)',
        run: () => setDesktopIslandMode('off')
      },
      {
        id: 'act-theme-aptana',
        label: 'Theme: HMW Dark',
        run: () => setTheme('aptana-dark')
      },
      {
        id: 'act-theme-midnight',
        label: 'Theme: Midnight Blue',
        run: () => setTheme('modern-dark')
      },
      {
        id: 'act-theme-light',
        label: 'Theme: Clean Light',
        run: () => setTheme('modern-light')
      },
      {
        id: 'act-open-docs',
        label: 'Buka Dokumentasi & Panduan Lengkap Fitur HMW Studio (F1)',
        run: () => setDocsModalOpen(true)
      },
      {
        id: 'act-check-app-update',
        label: 'Pembaruan Aplikasi: Cek Update HMW Studio Otomatis dari GitHub Releases',
        run: () => void checkForAppUpdates(false)
      },
      {
        id: 'act-suggest-calm',
        label: 'Saran Kode (Auto-Suggestion): Mode Santai — Tidak Mengganggu (Tab terima, Enter baris baru)',
        run: () => {
          setSuggestMode('calm');
          showToast('💡 Mode Saran Santai aktif (Enter = baris baru, Tab / Klik = terima saran).');
        }
      },
      {
        id: 'act-suggest-manual',
        label: 'Saran Kode (Auto-Suggestion): Mode Manual — Hanya saat Ctrl+Space (0% Popup Otomatis)',
        run: () => {
          setSuggestMode('manual');
          showToast('🔇 Mode Saran Manual aktif — popup tidak muncul otomatis (tekan Ctrl+Space saat butuh).');
        }
      },
      {
        id: 'act-suggest-full',
        label: 'Saran Kode (Auto-Suggestion): Mode Aktif — Klasik (Enter / Tab)',
        run: () => {
          setSuggestMode('full');
          showToast('⚡ Mode Saran Aktif: saran cepat & dapat diterima dengan Enter atau Tab.');
        }
      }
    ];

    const rubleCmds = rubleBundles.flatMap((b) =>
      b.commands.map((c) => ({
        id: `ruble-${c.id}`,
        label: `Ruble [${b.name}]: ${c.name} (${c.commandLine})`,
        run: () => void executeRubleCommand(c.name, c.commandLine)
      }))
    );

    return [...base, ...rubleCmds];
  }, [
    closeCurrentProject,
    createAndOpenDemoProject,
    executeRubleCommand,
    openConnectionModal,
    openProjectFromFile,
    openWorkspaceFolder,
    quickSaveActiveProject,
    refreshLaravelIntelliSense,
    refreshWisanggeniIntelliSense,
    rubleBundles,
    saveActiveTab,
    saveAllTabs,
    formatTabContent,
    jumpToNextBookmark,
    toggleSplitEditor,
    setActiveSidebar,
    setBottomPanel,
    setDesktopIslandMode,
    setGeminiSubTab,
    setInlineAiBarOpen,
    setIslandExpanded,
    setProjectModalOpen,
    setSyncModalOpen,
    setTheme,
    setSuggestMode,
    setDocsModalOpen,
    checkForAppUpdates,
    showToast,
    togglePreviewPane,
    setDbArchitectTab,
    openVisualJoinBuilder,
    setServerMonitorOpen,
    sendTabToHttpTester,
    switchModuleCompanion,
    compareTabWithCounterpart,
    openPhpScratchpad,
    selectedEditorText
  ]);

  const needle = filter.trim().toLowerCase();
  const cleanRemoteSub = (remoteSubPath || '').replace(/^\/+|\/+$/g, '').toLowerCase();

  const visibleFileItems = useMemo(() => {
    if (paletteMode !== 'files') return [];

    const scopeFiltered = combinedFileItems.filter((item) => {
      if (sourceScope === 'remote' && item.source !== 'remote') return false;
      if (sourceScope === 'local' && item.source !== 'local') return false;
      if (!needle) return true;
      return matchesSearchTokens(
        `${item.name.toLowerCase()} ${item.relativePath.toLowerCase()}`,
        needle
      );
    });

    // When search box is empty (`Ctrl+P` initial open): show Open Tabs first, then interleave clean Remote & Local app files!
    if (!needle) {
      const openItems: typeof scopeFiltered = [];
      const remoteApp: typeof scopeFiltered = [];
      const localApp: typeof scopeFiltered = [];
      const vendorItems: typeof scopeFiltered = [];

      for (const it of scopeFiltered) {
        if (openTabKeySet.has(it.key)) {
          openItems.push(it);
          continue;
        }
        const relLow = it.relativePath.toLowerCase();
        if (isVendorOrMinifiedPath(relLow)) {
          if (vendorItems.length < 70) vendorItems.push(it);
          continue;
        }
        if (it.source === 'remote') {
          if (cleanRemoteSub && relLow.startsWith(`${cleanRemoteSub}/`)) {
            remoteApp.unshift(it);
          } else if (remoteApp.length < 120) {
            remoteApp.push(it);
          }
        } else if (localApp.length < 120) {
          localApp.push(it);
        }
      }

      const interleaved: typeof scopeFiltered = [...openItems];
      const maxLen = Math.max(remoteApp.length, localApp.length);
      for (let i = 0; i < maxLen && interleaved.length < 80; i++) {
        if (i < remoteApp.length) interleaved.push(remoteApp[i]);
        if (i < localApp.length) interleaved.push(localApp[i]);
      }
      for (const v of vendorItems) {
        if (interleaved.length >= 80) break;
        interleaved.push(v);
      }
      return interleaved.slice(0, 80);
    }

    // Ranked search when user types a query (`needle !== ''`)
    const firstTok = needle.split(/\s+/)[0] ?? needle;
    const scored = scopeFiltered.map((it) => {
      const nameLow = it.name.toLowerCase();
      const relLow = it.relativePath.toLowerCase().replace(/\\/g, '/');
      let score = 0;

      if (nameLow === needle || nameLow === firstTok) score += 1200;
      else if (nameLow.startsWith(firstTok)) score += 760;
      else if (nameLow.includes(firstTok)) score += 460;
      else score += 160;

      if (openTabKeySet.has(it.key)) score += 180;
      if (isVendorOrMinifiedPath(relLow)) score -= 420;
      else score += 220;

      if (it.source === 'remote') {
        score += 45;
        if (cleanRemoteSub && relLow.startsWith(`${cleanRemoteSub}/`)) {
          score += 70;
        }
      }

      const depth = relLow.split('/').length;
      score -= Math.min(60, depth * 5);

      return { it, score };
    });

    scored.sort((a, b) => b.score - a.score || a.it.name.localeCompare(b.it.name));
    return scored.slice(0, 80).map((s) => s.it);
  }, [
    paletteMode,
    combinedFileItems,
    sourceScope,
    needle,
    openTabKeySet,
    cleanRemoteSub
  ]);

  if (paletteMode === 'closed') return null;

  const visibleCommands =
    paletteMode === 'commands'
      ? commands.filter((c) => matchesSearchTokens(c.label.toLowerCase(), needle))
      : [];

  const handleOpenFileItem = (item: (typeof combinedFileItems)[number]): void => {
    if (item.source === 'local' && item.localPath) {
      void openFileInTab(item.localPath, item.relativePath);
    } else if (item.source === 'remote' && item.connectionId) {
      void openRemoteFileInTab(item.connectionId, item.relativePath);
    }
    setFilter('');
    setPaletteMode('closed');
  };

  return (
    <div
      className="modal-backdrop"
      style={{ alignItems: 'flex-start', paddingTop: '10vh' }}
    >
      <div
        className="modal-card"
        style={{ width: 640, maxWidth: '94vw', maxHeight: '68vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header" style={{ alignItems: 'center' }}>
          <input
            autoFocus
            className="form-input"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              const activeLen =
                paletteMode === 'files' ? visibleFileItems.length : visibleCommands.length;
              if (e.key === 'ArrowDown' && activeLen > 0) {
                e.preventDefault();
                setSelectedIdx((i) => (i + 1) % activeLen);
              } else if (e.key === 'ArrowUp' && activeLen > 0) {
                e.preventDefault();
                setSelectedIdx((i) => (i - 1 + activeLen) % activeLen);
              } else if (e.key === 'Enter') {
                e.preventDefault();
                const pickIdx = Math.min(selectedIdx, Math.max(0, activeLen - 1));
                if (paletteMode === 'files' && visibleFileItems[pickIdx]) {
                  handleOpenFileItem(visibleFileItems[pickIdx]);
                } else if (paletteMode === 'commands' && visibleCommands[pickIdx]) {
                  visibleCommands[pickIdx].run();
                  setFilter('');
                  setPaletteMode('closed');
                }
              }
            }}
            placeholder={
              paletteMode === 'files'
                ? 'Ketik nama file Lokal atau Server Remote SFTP untuk membuka kilat (Enter)...'
                : 'Ketik nama perintah IDE, Database, AI, atau Ruble...'
            }
            style={{ flex: 1, minWidth: 0, fontSize: 13.5, padding: '6px 10px' }}
          />
          <button
            type="button"
            className="btn-modal-exit"
            onClick={() => {
              setFilter('');
              setPaletteMode('closed');
            }}
          >
            <X size={14} />
            <span>Keluar</span>
          </button>
        </div>

        {paletteMode === 'files' && (
          <div
            className="modal-subbar"
            style={{
              flexDirection: 'column',
              alignItems: 'stretch',
              gap: 6
            }}
          >
            {/* Source Filter Pills: Semua | Server Remote | Lokal */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button
                    type="button"
                    className={sourceScope === 'all' ? 'btn btn-accent' : 'btn'}
                    style={{ padding: '2px 8px', fontSize: 10.5 }}
                    onClick={() => setSourceScope('all')}
                  >
                    Semua ({remoteIndexedFiles.length + allFiles.length})
                  </button>
                  {activeConn && (
                    <button
                      type="button"
                      className={sourceScope === 'remote' ? 'btn btn-accent' : 'btn'}
                      style={{ padding: '2px 8px', fontSize: 10.5 }}
                      onClick={() => setSourceScope('remote')}
                    >
                      <Cloud size={11} /> Server {activeConn.name} ({remoteIndexedFiles.length})
                    </button>
                  )}
                  <button
                    type="button"
                    className={sourceScope === 'local' ? 'btn btn-accent' : 'btn'}
                    style={{ padding: '2px 8px', fontSize: 10.5 }}
                    onClick={() => setSourceScope('local')}
                  >
                    <FolderOpen size={11} /> Lokal ({allFiles.length})
                  </button>
                </div>

                {activeConn && (
                  <button
                    type="button"
                    className="btn"
                    style={{ padding: '2px 7px', fontSize: 10.5 }}
                    disabled={remoteIndexLoading || remoteIntelLoading}
                    onClick={() => {
                      if (selectedConnectionId) {
                        void refreshRemoteFilesIndex(selectedConnectionId, true);
                        void refreshRemoteWorkspaceIntel(selectedConnectionId, true);
                      }
                    }}
                    title="Pindai ulang daftar file + simbol PHP, JavaScript & CSS di Server Remote"
                  >
                    <RefreshCw
                      size={10}
                      className={remoteIndexLoading || remoteIntelLoading ? 'spin' : ''}
                    />{' '}
                    Indeks Ulang Server
                  </button>
                )}
              </div>

              {activeConn && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: 10.5,
                    color: 'var(--text-secondary)'
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                    <Cloud size={11} color="#38bdf8" />
                    {remoteIndexLoading ? (
                      <span>Memindai daftar file di server {activeConn.name}...</span>
                    ) : (
                      <span>
                        Server <strong>{activeConn.name}</strong>:{' '}
                        <strong>{remoteIndexedFiles.length.toLocaleString('id-ID')}</strong> file remote
                        {remoteIntelLoading ? (
                          <span style={{ color: '#fbbf24' }}>
                            {' '}• ⏳ Mengindeks simbol PHP/JS/CSS remote...
                          </span>
                        ) : remoteIntelSummary ? (
                          <span style={{ color: '#6ee7b7' }}>
                            {' '}• IntelliSense Remote Aktif ({remoteIntelSummary.phpFnCount} PHP •{' '}
                            {remoteIntelSummary.jsFnCount} JS • {remoteIntelSummary.cssClassCount} CSS)
                          </span>
                        ) : null}
                      </span>
                    )}
                  </span>
                </div>
              )}
          </div>
        )}

        <div style={{ overflowY: 'auto', padding: 6 }}>
          {paletteMode === 'files' ? (
            visibleFileItems.length === 0 ? (
              <div style={{ padding: '14px 12px', color: 'var(--text-muted)', fontSize: 12 }}>
                {remoteIndexLoading
                  ? 'Sedang memuat indeks file server remote...'
                  : 'Tidak ada file lokal maupun remote yang cocok.'}
              </div>
            ) : (
              visibleFileItems.map((item, idx) => (
                <div
                  key={item.key}
                  className="tree-row"
                  style={{
                    padding: '7px 10px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    background:
                      idx === selectedIdx ? 'rgba(56, 189, 248, 0.14)' : undefined
                  }}
                  onMouseEnter={() => setSelectedIdx(idx)}
                  onClick={() => handleOpenFileItem(item)}
                >
                  {item.source === 'remote' ? (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 3,
                        fontSize: 10,
                        padding: '1px 6px',
                        borderRadius: 4,
                        background: 'rgba(56, 189, 248, 0.15)',
                        color: '#38bdf8',
                        flexShrink: 0
                      }}
                    >
                      <Cloud size={10} /> {item.connectionName}
                    </span>
                  ) : (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 3,
                        fontSize: 10,
                        padding: '1px 6px',
                        borderRadius: 4,
                        background: 'rgba(148, 163, 184, 0.14)',
                        color: 'var(--text-secondary)',
                        flexShrink: 0
                      }}
                    >
                      <FolderOpen size={10} /> Lokal
                    </span>
                  )}
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                    {item.name}
                  </span>
                  <span
                    style={{
                      color: 'var(--text-muted)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {item.source === 'remote' ? `/${item.relativePath}` : item.relativePath}
                  </span>
                </div>
              ))
            )
          ) : (
            visibleCommands.map((c) => (
              <div
                key={c.id}
                className="tree-row"
                style={{ padding: '7px 10px' }}
                onClick={() => {
                  c.run();
                  setFilter('');
                  setPaletteMode('closed');
                }}
              >
                <span>{c.label}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
