import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  GitCompare,
  Pencil,
  Play,
  RefreshCw,
  Sparkles,
  X
} from 'lucide-react';
import type { SyncAction, SyncDiffItem, SyncMode, SyncPlan } from '@shared/types';
import { useIdeStore } from '../store/useIdeStore';
import { FolderHunkDiffPanel } from './FolderHunkDiffPanel';

export const SynchronizerModal: React.FC = () => {
  const {
    syncModalOpen,
    setSyncModalOpen,
    workspacePath,
    connections,
    selectedConnectionId,
    openConnectionModal,
    setRemoteConnectionStatus,
    openDiffTab,
    refreshTree,
    browseRemoteDir,
    remoteSubPath,
    setBottomPanel,
    geminiConfig,
    setActiveSidebar,
    setGeminiSubTab,
    showToast
  } = useIdeStore();

  const [mode, setMode] = useState<SyncMode>('bidirectional');
  const [viewMode, setViewMode] = useState<'list' | 'hunk-diff'>('list');
  const [plan, setPlan] = useState<SyncPlan | null>(null);
  const [items, setItems] = useState<SyncDiffItem[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [aiSummaryBusy, setAiSummaryBusy] = useState(false);
  const [aiSummaryText, setAiSummaryText] = useState<string | null>(null);

  const activeConn = connections.find((c) => c.id === selectedConnectionId) ?? null;

  const runCompare = async (selectedMode: SyncMode = mode): Promise<void> => {
    if (!workspacePath || !selectedConnectionId) return;
    setScanning(true);
    setScanError(null);
    setPlan(null);
    setItems([]);
    try {
      const generated = await window.aptana.sync.compare(
        selectedConnectionId,
        workspacePath,
        selectedMode
      );
      setPlan(generated);
      setItems(generated.items);
      setRemoteConnectionStatus('connected', null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setScanError(msg);
      setPlan(null);
      setItems([]);
      setRemoteConnectionStatus('error', msg);
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => {
    if (syncModalOpen && workspacePath && selectedConnectionId) {
      void runCompare(mode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncModalOpen]);

  if (!syncModalOpen) return null;

  const handleActionChange = (relPath: string, nextAction: SyncAction): void => {
    setItems((prev) =>
      prev.map((i) => (i.relativePath === relPath ? { ...i, action: nextAction } : i))
    );
  };

  const handlePreviewDiff = async (item: SyncDiffItem): Promise<void> => {
    if (!workspacePath || !selectedConnectionId) return;
    const sep = workspacePath.includes('\\') ? '\\' : '/';
    const localFullPath = `${workspacePath}${sep}${item.relativePath.replace(/\//g, sep)}`;

    let localContent = '';
    try {
      const localRes = await window.aptana.workspace.readFile(localFullPath);
      localContent = localRes.content;
    } catch {
      localContent = '';
    }

    let remoteContent = '';
    try {
      remoteContent = await window.aptana.connections.readRemoteFile(
        selectedConnectionId,
        item.relativePath
      );
    } catch {
      remoteContent = '';
    }

    openDiffTab({
      id: `sync-diff:${selectedConnectionId}:${item.relativePath}`,
      title: `Sync Diff: ${item.relativePath.split('/').pop()}`,
      filePath: localFullPath,
      relativePath: item.relativePath,
      originalContent: remoteContent,
      modifiedContent: localContent,
      diffLabel: `Remote (${activeConn?.name}) ↔ Lokal (${item.relativePath})`
    });
    setSyncModalOpen(false);
  };

  const handleExecute = async (): Promise<void> => {
    if (!workspacePath || !selectedConnectionId) return;
    const actionable = items.filter((i) => i.action !== 'skip');
    if (actionable.length === 0) {
      showToast('Tidak ada item yang dipilih untuk diunggah atau diunduh.');
      return;
    }

    setExecuting(true);
    setBottomPanel(true, 'transfers');
    try {
      const res = await window.aptana.sync.execute(
        selectedConnectionId,
        workspacePath,
        items
      );
      await refreshTree();
      await browseRemoteDir(remoteSubPath);
      showToast(
        `Sinkronisasi selesai dalam ${res.durationMs} ms (↑${res.uploaded} diunggah, ↓${res.downloaded} diunduh, ${res.failed} gagal).`
      );
      setSyncModalOpen(false);
    } catch (err) {
      showToast(`Sinkronisasi gagal: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExecuting(false);
    }
  };

  const statusColor = (status: SyncDiffItem['status']): string => {
    if (status.startsWith('upload')) return '#4ade80';
    if (status.startsWith('download')) return '#38bdf8';
    if (status === 'conflict') return '#ef4444';
    return 'var(--text-muted)';
  };

  return (
    <div className="modal-backdrop">
      <div
        className="modal-card"
        style={{ width: viewMode === 'hunk-diff' ? 'min(1080px, 95vw)' : 840, maxWidth: '95vw' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14.5, minHeight: 30, minWidth: 0 }}>
            <ArrowLeftRight size={17} color="var(--accent)" style={{ flexShrink: 0 }} />
            <span>
              HMW Visual Synchronizer — {activeConn?.name} ({activeConn?.protocol.toUpperCase()})
            </span>
          </div>
          <button
            type="button"
            className="btn-modal-exit"
            onClick={() => setSyncModalOpen(false)}
          >
            <X size={14} />
            <span>Keluar</span>
          </button>
        </div>

        <div
          style={{
            padding: '10px 18px',
            background: 'var(--bg-elevated)',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                type="button"
                className={`btn btn-xs ${viewMode === 'list' ? 'btn-primary' : ''}`}
                onClick={() => setViewMode('list')}
              >
                Daftar Sync ({items.length})
              </button>
              <button
                type="button"
                className={`btn btn-xs ${viewMode === 'hunk-diff' ? 'btn-primary' : ''}`}
                onClick={() => setViewMode('hunk-diff')}
                title="Bandingkan Pohon Folder Lokal ↔ Remote SFTP & Merge Per-Blok (Hunk-Level)"
              >
                <GitCompare size={12} /> Folder Diff &amp; Hunk Merge
              </button>
            </div>
            <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Mode Arah:</span>
            <select
              value={mode}
              onChange={(e) => {
                const next = e.target.value as SyncMode;
                setMode(next);
                void runCompare(next);
              }}
            >
              <option value="bidirectional">Bidirectional (Dua Arah Cerdas)</option>
              <option value="push">Push (Unggah Lokal → Remote)</option>
              <option value="pull">Pull (Unduh Remote → Lokal)</option>
            </select>

            <button
              className="btn"
              disabled={scanning}
              onClick={() => {
                setAiSummaryText(null);
                void runCompare(mode);
              }}
            >
              <RefreshCw size={13} />
              <span>Pindai Ulang</span>
            </button>

            {items.length > 0 && (
              <button
                className="btn"
                disabled={aiSummaryBusy || scanning}
                onClick={async () => {
                  if (!geminiConfig?.hasApiKey) {
                    setSyncModalOpen(false);
                    setActiveSidebar('ai');
                    setGeminiSubTab('settings');
                    showToast('Atur GEMINI_API_KEY Anda terlebih dahulu untuk ringkasan AI.');
                    return;
                  }
                  setAiSummaryBusy(true);
                  try {
                    const summaryLines = [
                      `Server Target: ${activeConn?.name} (${activeConn?.protocol.toUpperCase()})`,
                      `Mode Sinkronisasi: ${mode}`,
                      `Daftar Item (${items.length}):`,
                      ...items.map(
                        (it) =>
                          `- ${it.relativePath} | status=${it.status} | aksi=${it.action} | lokal=${it.localSize ?? '-'}B | remote=${it.remoteSize ?? '-'}B`
                      )
                    ];
                    const res = await window.aptana.ai.summarizeChanges({
                      mode: 'deploy-summary',
                      changesText: summaryLines.join('\n')
                    });
                    setAiSummaryText(res.summaryMarkdown);
                  } catch (err) {
                    showToast(
                      `Gagal meringkas perubahan: ${err instanceof Error ? err.message : String(err)}`
                    );
                  } finally {
                    setAiSummaryBusy(false);
                  }
                }}
              >
                <Sparkles size={13} color="#a855f7" />
                <span>
                  {aiSummaryBusy ? 'Meringkas...' : '✨ Ringkas Pra-Deploy AI'}
                </span>
              </button>
            )}
          </div>

          {plan && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              <strong>{items.length}</strong> berbeda • <strong>{plan.identicalCount}</strong> identik •{' '}
              <strong>{plan.ignoredCount}</strong> diabaikan
            </div>
          )}
        </div>

        {aiSummaryText && (
          <div
            style={{
              padding: '10px 18px',
              background: 'rgba(168, 85, 247, 0.09)',
              borderBottom: '1px solid rgba(168, 85, 247, 0.35)',
              fontSize: 12,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              maxHeight: 135,
              overflowY: 'auto'
            }}
          >
            <div style={{ fontWeight: 700, color: '#c084fc', marginBottom: 3 }}>
              ✨ Ringkasan Pra-Deploy Gemini AI:
            </div>
            {aiSummaryText}
          </div>
        )}

        {viewMode === 'hunk-diff' && activeConn && workspacePath && !scanning && !scanError ? (
          <FolderHunkDiffPanel
            connection={activeConn}
            workspacePath={workspacePath}
            items={items}
            onToast={showToast}
            onRefreshPlan={() => void runCompare(mode)}
          />
        ) : (
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 280, padding: '8px 18px' }}>
          {scanning ? (
            <div style={{ padding: 36, textAlign: 'center', color: 'var(--text-secondary)' }}>
              Menghubungi server <strong>{activeConn?.name}</strong> ({activeConn?.host}:{activeConn?.port}) dan membandingkan pohon file...
            </div>
          ) : scanError ? (
            <div
              style={{
                margin: '20px auto',
                maxWidth: 640,
                padding: '20px 22px',
                borderRadius: 12,
                background: 'rgba(244, 63, 94, 0.09)',
                border: '1px solid rgba(251, 113, 133, 0.45)',
                display: 'flex',
                flexDirection: 'column',
                gap: 12
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#fda4af', fontWeight: 700, fontSize: 14.5 }}>
                <AlertTriangle size={20} color="#fb7185" style={{ flexShrink: 0 }} />
                <span>
                  Gagal Terhubung ke Server {activeConn?.name} ({activeConn?.protocol.toUpperCase()})
                </span>
              </div>

              {activeConn && (
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  Target: <code>{activeConn.username ? `${activeConn.username}@` : ''}{activeConn.host}:{activeConn.port}</code> • Direktori Remote: <code>{activeConn.remotePath}</code>
                </div>
              )}

              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  background: 'var(--bg-app)',
                  border: '1px solid rgba(251, 113, 133, 0.28)',
                  color: '#fecdd3',
                  fontFamily: 'Consolas, monospace',
                  fontSize: 12,
                  lineHeight: 1.5,
                  wordBreak: 'break-word'
                }}
              >
                {scanError}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
                <button
                  type="button"
                  className="btn btn-accent"
                  onClick={() => void runCompare(mode)}
                >
                  <RefreshCw size={13.5} />
                  <span>Coba Hubungkan Ulang</span>
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setSyncModalOpen(false);
                    openConnectionModal(activeConn);
                  }}
                >
                  <Pencil size={13} color="var(--accent)" />
                  <span>Edit Konfigurasi Server</span>
                </button>
              </div>
            </div>
          ) : plan && items.length === 0 ? (
            <div style={{ padding: 36, textAlign: 'center', color: 'var(--success)', fontWeight: 600 }}>
              ✓ Semua file antara Workspace Lokal dan Server Remote sudah 100% sinkron!
            </div>
          ) : !plan ? (
            <div style={{ padding: 36, textAlign: 'center', color: 'var(--text-muted)' }}>
              Klik <strong>Pindai Ulang</strong> untuk memeriksa status sinkronisasi server remote.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr
                  style={{
                    textAlign: 'left',
                    color: 'var(--text-muted)',
                    borderBottom: '1px solid var(--border-subtle)'
                  }}
                >
                  <th style={{ padding: '8px 6px' }}>Path File</th>
                  <th style={{ padding: '8px 6px' }}>Status Deteksi</th>
                  <th style={{ padding: '8px 6px' }}>Ukuran (Lokal / Remote)</th>
                  <th style={{ padding: '8px 6px' }}>Aksi</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>Inspeksi</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.relativePath}
                    style={{ borderBottom: '1px solid var(--border-subtle)' }}
                  >
                    <td style={{ padding: '7px 6px', fontFamily: 'Consolas, monospace' }}>
                      {item.relativePath}
                    </td>
                    <td style={{ padding: '7px 6px' }}>
                      <span
                        className="badge-pill"
                        style={{
                          background: 'var(--bg-elevated)',
                          color: statusColor(item.status),
                          border: `1px solid ${statusColor(item.status)}`
                        }}
                      >
                        {item.status.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: '7px 6px', color: 'var(--text-secondary)' }}>
                      {item.localSize !== undefined ? `${item.localSize} B` : '—'} /{' '}
                      {item.remoteSize !== undefined ? `${item.remoteSize} B` : '—'}
                    </td>
                    <td style={{ padding: '7px 6px' }}>
                      <select
                        value={item.action}
                        onChange={(e) =>
                          handleActionChange(item.relativePath, e.target.value as SyncAction)
                        }
                      >
                        <option value="upload">↑ Upload ke Remote</option>
                        <option value="download">↓ Download ke Lokal</option>
                        <option value="skip">— Lewati (Skip)</option>
                      </select>
                    </td>
                    <td style={{ padding: '7px 6px', textAlign: 'right' }}>
                      <button
                        className="btn"
                        onClick={() => void handlePreviewDiff(item)}
                        title="Buka Side-by-Side Diff di Monaco Editor"
                      >
                        <GitCompare size={13} />
                        <span>Diff</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        )}

        <div
          style={{
            padding: '12px 18px',
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Tip: Konflik secara default disetel ke &ldquo;Lewati&rdquo; agar aman—klik <strong>Diff</strong> untuk memeriksa perbedaan baris.
          </span>

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => setSyncModalOpen(false)}>
              Tutup
            </button>
            <button
              className="btn btn-accent"
              disabled={scanning || executing || items.every((i) => i.action === 'skip')}
              onClick={() => void handleExecute()}
            >
              <Play size={14} />
              <span>{executing ? 'Menyinkronkan...' : 'Jalankan Sinkronisasi'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
