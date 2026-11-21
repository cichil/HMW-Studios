import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckSquare,
  Cloud,
  Eye,
  FolderOpen,
  Replace,
  ReplaceAll,
  Search,
  Square
} from 'lucide-react';
import type { RemoteSearchMatch, SearchMatch } from '@shared/types';
import {
  classifyReferenceLineKind,
  type ReferenceUsageKind
} from '@shared/sqlSchemaAnalyzer';
import { useIdeStore } from '../store/useIdeStore';

function escapeRegExpClient(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getUsageBadgeColor(kind: ReferenceUsageKind): { bg: string; fg: string } {
  switch (kind) {
    case 'SELECT':
      return { bg: 'rgba(56, 189, 248, 0.16)', fg: '#7dd3fc' };
    case 'INSERT':
      return { bg: 'rgba(16, 185, 129, 0.18)', fg: '#6ee7b7' };
    case 'UPDATE':
      return { bg: 'rgba(245, 158, 11, 0.18)', fg: '#fcd34d' };
    case 'DELETE':
      return { bg: 'rgba(239, 68, 68, 0.2)', fg: '#fca5a5' };
    case 'JOIN':
      return { bg: 'rgba(168, 85, 247, 0.18)', fg: '#d8b4fe' };
    case 'DDL':
      return { bg: 'rgba(236, 72, 153, 0.18)', fg: '#f9a8d4' };
    case 'DEF':
      return { bg: 'rgba(34, 197, 94, 0.2)', fg: '#86efac' };
    case 'CALL':
      return { bg: 'rgba(99, 102, 241, 0.18)', fg: '#a5b4fc' };
    default:
      return { bg: 'rgba(148, 163, 184, 0.14)', fg: '#cbd5e1' };
  }
}

export const SearchSidebar: React.FC = () => {
  const {
    workspacePath,
    connections,
    selectedConnectionId,
    remoteSubPath,
    openFileInTab,
    openRemoteFileInTab,
    openDiffTab,
    reloadOpenTabsAfterReplace,
    pendingSymbolSearch,
    consumePendingSymbolSearch,
    pushIslandActivity,
    showToast
  } = useIdeStore();

  const activeConn = connections.find((c) => c.id === selectedConnectionId) ?? null;

  const [scope, setScope] = useState<'local' | 'remote'>(() =>
    !workspacePath && selectedConnectionId ? 'remote' : 'local'
  );
  const [query, setQuery] = useState('');
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replacement, setReplacement] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [remoteDirFilter, setRemoteDirFilter] = useState(remoteSubPath);
  const [localMatches, setLocalMatches] = useState<SearchMatch[]>([]);
  const [remoteMatches, setRemoteMatches] = useState<RemoteSearchMatch[]>([]);
  const [excludedRelPaths, setExcludedRelPaths] = useState<Record<string, boolean>>({});
  const [searching, setSearching] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [kindFilter, setKindFilter] = useState<ReferenceUsageKind | 'ALL'>('ALL');

  useEffect(() => {
    setRemoteDirFilter(remoteSubPath);
  }, [remoteSubPath]);

  useEffect(() => {
    if (!workspacePath && selectedConnectionId) {
      setScope('remote');
    }
  }, [workspacePath, selectedConnectionId]);

  const executeSearchNow = async (
    overrideQuery?: string,
    overrideScope?: 'local' | 'remote'
  ): Promise<void> => {
    const effectiveQuery = (overrideQuery ?? query).trim();
    const effectiveScope = overrideScope ?? scope;
    if (!effectiveQuery) return;
    setExcludedRelPaths({});
    setKindFilter('ALL');

    if (effectiveScope === 'local') {
      if (!workspacePath) return;
      setSearching(true);
      setHasSearched(true);
      try {
        const res = await window.aptana.workspace.searchInFiles(
          workspacePath,
          effectiveQuery,
          caseSensitive
        );
        setLocalMatches(res);
      } finally {
        setSearching(false);
      }
      return;
    }

    if (!selectedConnectionId) return;
    setSearching(true);
    setHasSearched(true);
    try {
      const res = await window.aptana.connections.searchRemoteFiles(
        selectedConnectionId,
        remoteDirFilter,
        effectiveQuery,
        caseSensitive
      );
      setRemoteMatches(res);
    } catch (err) {
      showToast(
        `Gagal mencari di server remote: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    if (!pendingSymbolSearch) return;
    const req = consumePendingSymbolSearch();
    if (!req) return;
    const targetScope: 'local' | 'remote' =
      req.scopeHint ?? (workspacePath ? 'local' : selectedConnectionId ? 'remote' : 'local');
    setQuery(req.symbol);
    setScope(targetScope);
    void executeSearchNow(req.symbol, targetScope);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSymbolSearch]);

  const runSearch = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    await executeSearchNow();
  };

  const uniqueMatchedFiles = useMemo(() => {
    const map = new Map<
      string,
      { relativePath: string; filePath: string; count: number; connectionId?: string }
    >();
    if (scope === 'local') {
      for (const m of localMatches) {
        const cur = map.get(m.relativePath);
        if (cur) {
          cur.count += 1;
        } else {
          map.set(m.relativePath, {
            relativePath: m.relativePath,
            filePath: m.filePath,
            count: 1
          });
        }
      }
    } else {
      for (const m of remoteMatches) {
        const cur = map.get(m.relativePath);
        if (cur) {
          cur.count += 1;
        } else {
          map.set(m.relativePath, {
            relativePath: m.relativePath,
            filePath: `/${m.relativePath}`,
            count: 1,
            connectionId: m.connectionId
          });
        }
      }
    }
    return Array.from(map.values());
  }, [scope, localMatches, remoteMatches]);

  const selectedRelPaths = useMemo(
    () =>
      uniqueMatchedFiles
        .filter((f) => !excludedRelPaths[f.relativePath])
        .map((f) => f.relativePath),
    [uniqueMatchedFiles, excludedRelPaths]
  );

  const handlePreviewFileDiff = async (item: {
    relativePath: string;
    filePath: string;
    connectionId?: string;
  }): Promise<void> => {
    if (!query) return;
    try {
      let original = '';
      if (scope === 'local') {
        const read = await window.aptana.workspace.readFile(item.filePath);
        if (read.isBinary) {
          showToast('File biner tidak dapat dipratinjau.');
          return;
        }
        original = read.content;
      } else if (item.connectionId) {
        original = await window.aptana.connections.readRemoteFile(
          item.connectionId,
          item.relativePath
        );
      }
      const flags = caseSensitive ? 'g' : 'gi';
      const regex = new RegExp(escapeRegExpClient(query), flags);
      const modified = original.replace(regex, () => replacement);
      const baseName = item.relativePath.split(/[/\\]/).pop() || item.relativePath;

      openDiffTab({
        id: `replace-preview:${scope}:${item.relativePath}`,
        title: `Diff Replace: ${baseName}`,
        filePath: item.filePath,
        relativePath: item.relativePath,
        originalContent: original,
        modifiedContent: modified,
        diffLabel: `Pratinjau Ganti Teks ("${query}" → "${replacement}") • ${item.relativePath}`,
        remoteConnectionId: item.connectionId,
        remoteConnectionName: activeConn?.name
      });
    } catch (err) {
      showToast(
        `Gagal membuka pratinjau diff: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };

  const handleReplaceAllSelected = async (): Promise<void> => {
    if (!query || selectedRelPaths.length === 0) {
      showToast('Pilih minimal 1 file hasil pencarian untuk diganti.');
      return;
    }
    setReplacing(true);
    try {
      if (scope === 'local') {
        if (!workspacePath) return;
        const res = await window.aptana.workspace.replaceInFiles(
          workspacePath,
          query,
          replacement,
          {
            caseSensitive,
            includeRelPaths: selectedRelPaths
          }
        );
        await reloadOpenTabsAfterReplace('local', res.modifiedRelPaths);
        pushIslandActivity({
          id: 'global-replace',
          tone: 'success',
          badge: 'REPLACE LOKAL',
          title: `${res.occurrencesReplaced} teks diganti di ${res.filesModified} file`,
          subtitle: 'Backup otomatis tersimpan di Local History',
          autoExpireMs: 4200
        });
        showToast(
          `Berhasil mengganti ${res.occurrencesReplaced} kemunculan di ${res.filesModified} file lokal (Backup tersimpan di History).`
        );
      } else {
        if (!selectedConnectionId) return;
        const res = await window.aptana.connections.replaceInRemoteFiles(
          selectedConnectionId,
          remoteDirFilter,
          query,
          replacement,
          {
            caseSensitive,
            includeRelPaths: selectedRelPaths
          }
        );
        await reloadOpenTabsAfterReplace('remote', res.modifiedRelPaths, selectedConnectionId);
        pushIslandActivity({
          id: 'global-replace-remote',
          tone: 'success',
          badge: 'REPLACE SFTP',
          title: `${res.occurrencesReplaced} teks diganti di ${res.filesModified} file server`,
          subtitle: 'Backup otomatis tersimpan di Local History',
          autoExpireMs: 4500
        });
        showToast(
          `Berhasil mengganti ${res.occurrencesReplaced} kemunculan di ${res.filesModified} file server ${activeConn?.name ?? ''} (Backup tersimpan di History).`
        );
      }
      await executeSearchNow();
    } catch (err) {
      showToast(`Gagal mengganti teks: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setReplacing(false);
    }
  };

  const canSearch =
    Boolean(query.trim()) &&
    !searching &&
    (scope === 'local' ? Boolean(workspacePath) : Boolean(selectedConnectionId));

  const usageCounts = useMemo(() => {
    const counts = new Map<ReferenceUsageKind, number>();
    const activeList = scope === 'local' ? localMatches : remoteMatches;
    for (const m of activeList) {
      const k = classifyReferenceLineKind(m.lineText, query);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [scope, localMatches, remoteMatches, query]);

  const filteredLocalMatches = useMemo(() => {
    if (kindFilter === 'ALL') return localMatches;
    return localMatches.filter((m) => classifyReferenceLineKind(m.lineText, query) === kindFilter);
  }, [localMatches, kindFilter, query]);

  const filteredRemoteMatches = useMemo(() => {
    if (kindFilter === 'ALL') return remoteMatches;
    return remoteMatches.filter((m) => classifyReferenceLineKind(m.lineText, query) === kindFilter);
  }, [remoteMatches, kindFilter, query]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="sidebar-header">
        <span>Cari &amp; Ganti (Lokal &amp; Remote)</span>
        <button
          className="icon-btn"
          title="Tampilkan / Sembunyikan Panel Ganti Teks Massal (Global Replace)"
          onClick={() => setReplaceOpen((v) => !v)}
          style={{ color: replaceOpen ? 'var(--accent)' : undefined }}
        >
          <Replace size={14} />
        </button>
      </div>

      <form
        onSubmit={(e) => void runSearch(e)}
        style={{
          padding: 10,
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8
        }}
      >
        {/* Toggle Lokal vs Server Remote */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 4,
            padding: 3,
            borderRadius: 7,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)'
          }}
        >
          <button
            type="button"
            className="btn-ghost"
            style={{
              justifyContent: 'center',
              padding: '4px 6px',
              fontSize: 11.5,
              borderRadius: 5,
              border: 'none',
              background: scope === 'local' ? 'var(--accent)' : 'transparent',
              color: scope === 'local' ? '#fff' : 'var(--text-secondary)',
              fontWeight: scope === 'local' ? 700 : 500
            }}
            onClick={() => setScope('local')}
          >
            <FolderOpen size={12} />
            <span>Folder Lokal</span>
          </button>
          <button
            type="button"
            className="btn-ghost"
            style={{
              justifyContent: 'center',
              padding: '4px 6px',
              fontSize: 11.5,
              borderRadius: 5,
              border: 'none',
              background: scope === 'remote' ? '#0284c7' : 'transparent',
              color: scope === 'remote' ? '#fff' : 'var(--text-secondary)',
              fontWeight: scope === 'remote' ? 700 : 500
            }}
            onClick={() => setScope('remote')}
          >
            <Cloud size={12} />
            <span>Server Remote</span>
          </button>
        </div>

        {scope === 'remote' && activeConn && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, color: '#38bdf8', fontWeight: 600 }}>
              Target: {activeConn.name} ({activeConn.protocol.toUpperCase()})
            </span>
            <input
              value={remoteDirFilter}
              onChange={(e) => setRemoteDirFilter(e.target.value)}
              placeholder="Subfolder remote (kosongkan = root /)"
              title="Batasi pencarian pada subfolder tertentu agar lebih cepat"
              style={{ fontSize: 11.5, padding: '4px 7px' }}
            />
          </div>
        )}

        <div style={{ display: 'flex', gap: 6 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              scope === 'remote'
                ? 'Cari variabel / SQL / teks di server...'
                : 'Ketik teks atau simbol...'
            }
            style={{ flex: 1 }}
          />
          <button
            type="button"
            className="btn"
            title="Mode Ganti Teks Massal (Global Replace)"
            onClick={() => setReplaceOpen((v) => !v)}
            style={{
              padding: '4px 7px',
              borderColor: replaceOpen ? 'var(--accent)' : undefined
            }}
          >
            <Replace size={13} />
          </button>
          <button type="submit" className="btn btn-accent" disabled={!canSearch}>
            <Search size={13} />
          </button>
        </div>

        {replaceOpen && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              padding: 8,
              borderRadius: 6,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)'
            }}
          >
            <input
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              placeholder="Ganti dengan teks baru (aman untuk $variabel PHP)..."
              style={{ fontSize: 12 }}
            />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
              <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                Otomatis backup ke History
              </span>
              <button
                type="button"
                className="btn btn-primary"
                style={{ fontSize: 11.5, padding: '4px 9px' }}
                disabled={replacing || selectedRelPaths.length === 0 || !query}
                onClick={() => void handleReplaceAllSelected()}
              >
                <ReplaceAll size={13} />
                <span>
                  {replacing
                    ? 'Mengganti...'
                    : `Ganti di ${selectedRelPaths.length} File`}
                </span>
              </button>
            </div>
          </div>
        )}

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            color: 'var(--text-secondary)',
            fontSize: 12
          }}
        >
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(e) => setCaseSensitive(e.target.checked)}
          />
          <span>Peka huruf besar/kecil (Aa)</span>
        </label>
      </form>

      {/* File Selection Summary when Replace is open and matches exist */}
      {replaceOpen && uniqueMatchedFiles.length > 0 && (
        <div
          style={{
            padding: '6px 10px',
            borderBottom: '1px solid var(--border-subtle)',
            background: 'rgba(255,255,255,0.02)',
            maxHeight: 150,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 4
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11 }}>
            <strong style={{ color: 'var(--text-secondary)' }}>
              Target File ({selectedRelPaths.length}/{uniqueMatchedFiles.length}):
            </strong>
            <button
              className="btn-ghost"
              style={{ fontSize: 10.5, padding: '1px 5px' }}
              onClick={() => {
                if (selectedRelPaths.length === uniqueMatchedFiles.length) {
                  const allOff: Record<string, boolean> = {};
                  for (const f of uniqueMatchedFiles) allOff[f.relativePath] = true;
                  setExcludedRelPaths(allOff);
                } else {
                  setExcludedRelPaths({});
                }
              }}
            >
              {selectedRelPaths.length === uniqueMatchedFiles.length
                ? 'Lepas Semua'
                : 'Pilih Semua'}
            </button>
          </div>
          {uniqueMatchedFiles.map((f) => {
            const checked = !excludedRelPaths[f.relativePath];
            return (
              <div
                key={f.relativePath}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 11
                }}
              >
                <button
                  type="button"
                  className="icon-btn"
                  style={{ padding: 1 }}
                  onClick={() =>
                    setExcludedRelPaths((s) => ({
                      ...s,
                      [f.relativePath]: !s[f.relativePath]
                    }))
                  }
                >
                  {checked ? (
                    <CheckSquare size={13} color="var(--accent)" />
                  ) : (
                    <Square size={13} color="var(--text-muted)" />
                  )}
                </button>
                <span
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                  title={f.relativePath}
                >
                  {f.relativePath} ({f.count})
                </span>
                <button
                  type="button"
                  className="btn"
                  style={{ padding: '1px 5px', fontSize: 10 }}
                  title="Pratinjau perubahan baris (Diff) sebelum mengganti"
                  onClick={() => void handlePreviewFileDiff(f)}
                >
                  <Eye size={10} /> Diff
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Semantic Usage Kind Filter Chips (Shift+F12 / Table & Function Usage) */}
      {usageCounts.length > 1 && !searching && (
        <div
          style={{
            padding: '5px 8px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 4
          }}
        >
          <button
            type="button"
            className="btn"
            style={{
              padding: '1px 6px',
              fontSize: 10,
              borderColor: kindFilter === 'ALL' ? 'var(--accent)' : undefined,
              color: kindFilter === 'ALL' ? '#fff' : undefined
            }}
            onClick={() => setKindFilter('ALL')}
          >
            Semua ({scope === 'local' ? localMatches.length : remoteMatches.length})
          </button>
          {usageCounts.map(([k, count]) => {
            const col = getUsageBadgeColor(k);
            const active = kindFilter === k;
            return (
              <button
                key={k}
                type="button"
                className="btn"
                style={{
                  padding: '1px 6px',
                  fontSize: 10,
                  background: active ? col.bg : undefined,
                  borderColor: active ? col.fg : undefined,
                  color: col.fg
                }}
                onClick={() => setKindFilter(active ? 'ALL' : k)}
              >
                {k} ({count})
              </button>
            );
          })}
        </div>
      )}

      <div className="sidebar-scroll">
        {scope === 'local' ? (
          !workspacePath ? (
            <div style={{ padding: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Buka folder proyek lokal terlebih dahulu, atau klik tab{' '}
              <strong>Server Remote</strong> di atas untuk mencari langsung di SFTP/FTPS.
            </div>
          ) : searching ? (
            <div style={{ padding: 12, color: 'var(--text-muted)' }}>
              Memindai file lokal...
            </div>
          ) : localMatches.length === 0 ? (
            <div style={{ padding: 12, color: 'var(--text-muted)' }}>
              {hasSearched
                ? 'Tidak ditemukan kecocokan di folder lokal.'
                : 'Masukkan kata kunci lalu tekan Enter untuk mencari.'}
            </div>
          ) : (
            <>
              <div style={{ padding: '4px 8px', fontSize: 11, color: 'var(--text-muted)' }}>
                Ditemukan {filteredLocalMatches.length} baris di {uniqueMatchedFiles.length} file lokal:
              </div>
              {filteredLocalMatches.map((m, idx) => {
                const kind = classifyReferenceLineKind(m.lineText, query);
                const badgeCol = getUsageBadgeColor(kind);
                return (
                  <div
                    key={`${m.filePath}:${m.line}:${idx}`}
                    className="tree-row"
                    style={{
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      gap: 2,
                      padding: '6px 8px'
                    }}
                    onClick={() => void openFileInTab(m.filePath, m.relativePath, m.line)}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        width: '100%',
                        gap: 6
                      }}
                    >
                      <span style={{ fontWeight: 600, color: 'var(--accent)', fontSize: 11.5 }}>
                        {m.relativePath}:{m.line}
                      </span>
                      <span
                        style={{
                          fontSize: 9.5,
                          fontWeight: 700,
                          padding: '0px 5px',
                          borderRadius: 4,
                          background: badgeCol.bg,
                          color: badgeCol.fg,
                          flexShrink: 0
                        }}
                      >
                        {kind}
                      </span>
                    </div>
                    <div
                      style={{
                        fontFamily: 'Consolas, monospace',
                        fontSize: 11.5,
                        color: 'var(--text-secondary)',
                        width: '100%',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {m.lineText.trim()}
                    </div>
                  </div>
                );
              })}
            </>
          )
        ) : !activeConn ? (
          <div style={{ padding: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Pilih atau buat koneksi SFTP / FTPS terlebih dahulu untuk mencari isi file di server remote.
          </div>
        ) : searching ? (
          <div style={{ padding: 12, color: '#38bdf8' }}>
            Memindai file teks di server {activeConn.name}...
          </div>
        ) : remoteMatches.length === 0 ? (
          <div style={{ padding: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            {hasSearched
              ? 'Tidak ditemukan kecocokan pada direktori remote tersebut.'
              : 'Ketik kata kunci lalu tekan Enter untuk mencari langsung di server remote.'}
          </div>
        ) : (
          <>
            <div style={{ padding: '4px 8px', fontSize: 11, color: '#38bdf8' }}>
              Ditemukan {filteredRemoteMatches.length} baris di {uniqueMatchedFiles.length} file server{' '}
              {activeConn.name}:
            </div>
            {filteredRemoteMatches.map((m, idx) => {
              const kind = classifyReferenceLineKind(m.lineText, query);
              const badgeCol = getUsageBadgeColor(kind);
              return (
                <div
                  key={`${m.connectionId}:${m.relativePath}:${m.line}:${idx}`}
                  className="tree-row"
                  style={{
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: 2,
                    padding: '6px 8px'
                  }}
                  onClick={() =>
                    void openRemoteFileInTab(m.connectionId, m.relativePath, m.line)
                  }
                  title="Klik untuk membuka file langsung dari server di baris ini"
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      width: '100%',
                      gap: 6
                    }}
                  >
                    <span style={{ fontWeight: 600, color: '#38bdf8', fontSize: 11.5 }}>
                      /{m.relativePath}:{m.line}
                    </span>
                    <span
                      style={{
                        fontSize: 9.5,
                        fontWeight: 700,
                        padding: '0px 5px',
                        borderRadius: 4,
                        background: badgeCol.bg,
                        color: badgeCol.fg,
                        flexShrink: 0
                      }}
                    >
                      {kind}
                    </span>
                  </div>
                  <div
                    style={{
                      fontFamily: 'Consolas, monospace',
                      fontSize: 11.5,
                      color: 'var(--text-secondary)',
                      width: '100%',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {m.lineText.trim()}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
};
