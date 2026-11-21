import React, { useEffect, useState } from 'react';
import {
  BookmarkPlus,
  Cloud,
  FileClock,
  GitCompare,
  History,
  RefreshCw,
  RotateCcw,
  Trash2
} from 'lucide-react';
import type { FileHistoryEntry } from '@shared/types';
import { getTabHistoryKey, useIdeStore } from '../store/useIdeStore';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('id-ID', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  } catch {
    return iso;
  }
}

export const HistorySidebar: React.FC = () => {
  const {
    tabs,
    activeTabId,
    splitEditorOpen,
    secondaryTabId,
    focusedPane,
    historyRefreshTick,
    openDiffTab,
    restoreTabFromHistory,
    showToast
  } = useIdeStore();

  const targetTabId =
    splitEditorOpen && focusedPane === 'secondary' && secondaryTabId
      ? secondaryTabId
      : activeTabId;

  const targetTab = tabs.find((t) => t.id === targetTabId) ?? null;
  // Jika user sedang melihat tab diff dari riwayat, cari tab kode sumbernya agar timeline tetap tampil
  const resolvedCodeTab =
    targetTab?.kind === 'code'
      ? targetTab
      : tabs.find(
          (t) =>
            t.kind === 'code' &&
            targetTab &&
            t.relativePath === targetTab.relativePath &&
            t.remoteConnectionId === targetTab.remoteConnectionId
        ) ?? null;

  const fileKey = getTabHistoryKey(resolvedCodeTab);

  const [entries, setEntries] = useState<FileHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const loadEntries = async (): Promise<void> => {
    if (!fileKey) {
      setEntries([]);
      return;
    }
    setLoading(true);
    try {
      const list = await window.aptana.history.list(fileKey);
      setEntries(list);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileKey, historyRefreshTick]);

  const handleManualSnapshot = async (): Promise<void> => {
    if (!resolvedCodeTab || !fileKey) return;
    await window.aptana.history.record({
      fileKey,
      label: 'Checkpoint Manual',
      sourceKind: resolvedCodeTab.remoteConnectionId ? 'remote' : 'local',
      displayPath: resolvedCodeTab.filePath,
      connectionId: resolvedCodeTab.remoteConnectionId,
      relativePath: resolvedCodeTab.relativePath,
      content: resolvedCodeTab.content
    });
    await loadEntries();
    showToast(`Checkpoint backup disimpan untuk ${resolvedCodeTab.title}`);
  };

  const handleCompareDiff = async (entry: FileHistoryEntry): Promise<void> => {
    if (!resolvedCodeTab) return;
    try {
      const snapContent = await window.aptana.history.getContent(entry.id);
      const timeLabel = formatTimestamp(entry.timestamp);
      openDiffTab({
        id: `history-diff:${resolvedCodeTab.id}:${entry.id}`,
        title: `Backup (${timeLabel}) ↔ ${resolvedCodeTab.title}`,
        filePath: resolvedCodeTab.filePath,
        relativePath: resolvedCodeTab.relativePath,
        originalContent: snapContent,
        modifiedContent: resolvedCodeTab.content,
        diffLabel: `Backup [${entry.label} • ${timeLabel}] ↔ Isi Saat Ini (${resolvedCodeTab.relativePath})`,
        remoteConnectionId: resolvedCodeTab.remoteConnectionId,
        remoteConnectionName: resolvedCodeTab.remoteConnectionName
      });
    } catch (err) {
      showToast(
        `Gagal membaca isi backup: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };

  const handleRollback = async (entry: FileHistoryEntry): Promise<void> => {
    if (!resolvedCodeTab) return;
    const timeLabel = formatTimestamp(entry.timestamp);
    const ok = window.confirm(
      `Kembalikan (Rollback) isi editor "${resolvedCodeTab.title}" ke versi backup:\n• ${entry.label}\n• Waktu: ${timeLabel}?\n\n(Setelah dipulihkan ke editor, tekan Ctrl+S untuk menyimpannya ke ${
        resolvedCodeTab.remoteConnectionId ? 'server remote' : 'disk lokal'
      }.)`
    );
    if (!ok) return;
    try {
      const snapContent = await window.aptana.history.getContent(entry.id);
      restoreTabFromHistory(resolvedCodeTab.id, snapContent, timeLabel);
    } catch (err) {
      showToast(
        `Gagal memulihkan backup: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };

  const handleClearHistory = async (): Promise<void> => {
    if (!fileKey || !resolvedCodeTab || entries.length === 0) return;
    const ok = window.confirm(
      `Hapus seluruh ${entries.length} riwayat backup lokal untuk file "${resolvedCodeTab.title}"?`
    );
    if (!ok) return;
    await window.aptana.history.clear(fileKey);
    await loadEntries();
    showToast('Riwayat backup file dibersihkan.');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="sidebar-header">
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <History size={14} color="var(--accent)" />
          <span>Local History / Backup</span>
        </span>
        {resolvedCodeTab && (
          <div style={{ display: 'flex', gap: 3 }}>
            <button
              className="btn-ghost"
              style={{ border: 'none', padding: 3 }}
              title="Segarkan Timeline Backup"
              onClick={() => void loadEntries()}
            >
              <RefreshCw size={13} />
            </button>
            {entries.length > 0 && (
              <button
                className="btn-ghost"
                style={{ border: 'none', padding: 3 }}
                title="Bersihkan Riwayat Backup File Ini"
                onClick={() => void handleClearHistory()}
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        )}
      </div>

      {!resolvedCodeTab ? (
        <div style={{ padding: 14, color: 'var(--text-muted)', lineHeight: 1.55 }}>
          Buka file kode (lokal maupun <strong>Remote Server SFTP/FTPS</strong>) untuk melihat timeline backup otomatis dan melakukan <em>Diff</em> atau <em>Rollback</em>.
        </div>
      ) : (
        <>
          <div
            style={{
              padding: '9px 10px',
              borderBottom: '1px solid var(--border-subtle)',
              background: 'var(--bg-elevated)',
              display: 'flex',
              flexDirection: 'column',
              gap: 7
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                fontWeight: 700,
                color: 'var(--text-primary)'
              }}
            >
              {resolvedCodeTab.remoteConnectionId ? (
                <Cloud size={14} color="#38bdf8" />
              ) : (
                <FileClock size={14} color="var(--accent)" />
              )}
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {resolvedCodeTab.title}
              </span>
            </div>
            <div
              style={{
                fontSize: 11,
                color: 'var(--text-muted)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
              title={resolvedCodeTab.relativePath}
            >
              {resolvedCodeTab.remoteConnectionName
                ? `Server ${resolvedCodeTab.remoteConnectionName}: /${resolvedCodeTab.relativePath}`
                : resolvedCodeTab.relativePath}
            </div>
            <button
              className="btn"
              style={{ width: '100%', justifyContent: 'center', fontSize: 11.5 }}
              onClick={() => void handleManualSnapshot()}
            >
              <BookmarkPlus size={13} color="var(--accent)" />
              <span>Buat Checkpoint Backup Sekarang</span>
            </button>
          </div>

          <div className="sidebar-scroll" style={{ padding: 8 }}>
            {loading ? (
              <div style={{ padding: 8, color: 'var(--text-muted)' }}>
                Memuat riwayat versi...
              </div>
            ) : entries.length === 0 ? (
              <div style={{ padding: 8, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Belum ada snapshot tersimpan untuk file ini. Tekan <strong>Ctrl+S</strong> atau klik tombol <strong>Buat Checkpoint Backup Sekarang</strong>.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {entries.map((entry, idx) => (
                  <div
                    key={entry.id}
                    style={{
                      padding: '8px 9px',
                      borderRadius: 8,
                      background: 'var(--bg-elevated)',
                      border:
                        idx === 0
                          ? '1px solid var(--accent)'
                          : '1px solid var(--border-subtle)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 5
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 6
                      }}
                    >
                      <span
                        style={{
                          fontWeight: 700,
                          fontSize: 11.5,
                          color: idx === 0 ? 'var(--accent)' : 'var(--text-primary)'
                        }}
                      >
                        {entry.label}
                      </span>
                      {idx === 0 && (
                        <span
                          className="badge-pill"
                          style={{
                            fontSize: 9.5,
                            padding: '1px 6px',
                            background: 'var(--accent-soft)',
                            color: 'var(--accent)'
                          }}
                        >
                          TERBARU
                        </span>
                      )}
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: 11,
                        color: 'var(--text-muted)'
                      }}
                    >
                      <span>{formatTimestamp(entry.timestamp)}</span>
                      <span>{formatBytes(entry.size)}</span>
                    </div>

                    <div style={{ display: 'flex', gap: 5, marginTop: 2 }}>
                      <button
                        className="btn"
                        style={{ flex: 1, justifyContent: 'center', padding: '3px 6px', fontSize: 11 }}
                        onClick={() => void handleCompareDiff(entry)}
                        title="Lihat perbandingan berdampingan dengan kode saat ini"
                      >
                        <GitCompare size={12} />
                        <span>Diff</span>
                      </button>
                      <button
                        className="btn btn-accent"
                        style={{ flex: 1, justifyContent: 'center', padding: '3px 6px', fontSize: 11 }}
                        onClick={() => void handleRollback(entry)}
                        title="Pulihkan kode ke versi waktu ini"
                      >
                        <RotateCcw size={12} />
                        <span>Rollback</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
