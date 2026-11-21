import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileCode2,
  FolderOpen,
  RefreshCw,
  Save,
  UploadCloud
} from 'lucide-react';
import type { ConnectionProfile, SyncDiffItem } from '@shared/types';
import {
  applyHunkLeftToRight,
  applyHunkRightToLeft,
  computeHunkDiff,
  type DiffHunk
} from '@shared/hunkDiffEngine';

interface FolderHunkDiffPanelProps {
  connection: ConnectionProfile;
  workspacePath: string;
  items: SyncDiffItem[];
  onToast: (msg: string) => void;
  onRefreshPlan: () => void;
}

export const FolderHunkDiffPanel: React.FC<FolderHunkDiffPanelProps> = ({
  connection,
  workspacePath,
  items,
  onToast,
  onRefreshPlan
}) => {
  const [selectedPath, setSelectedPath] = useState<string | null>(items[0]?.relativePath ?? null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [localText, setLocalText] = useState('');
  const [remoteText, setRemoteText] = useState('');
  const [localDirty, setLocalDirty] = useState(false);
  const [remoteDirty, setRemoteDirty] = useState(false);
  const [savingSide, setSavingSide] = useState<'local' | 'remote' | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const groupedByDir = useMemo(() => {
    const map = new Map<string, SyncDiffItem[]>();
    for (const it of items) {
      const parts = it.relativePath.split('/');
      const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '(root)';
      const arr = map.get(dir) ?? [];
      arr.push(it);
      map.set(dir, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [items]);

  const loadPair = async (item: SyncDiffItem): Promise<void> => {
    setSelectedPath(item.relativePath);
    setLoadingFile(true);
    setLoadError(null);
    setLocalDirty(false);
    setRemoteDirty(false);
    try {
      const absLocal = `${workspacePath.replace(/[\\/]+$/, '')}/${item.relativePath}`;
      const [locRes, remRes] = await Promise.all([
        item.status !== 'download-new'
          ? window.aptana.workspace.readFile(absLocal).then((r) => r.content).catch(() => '')
          : Promise.resolve(''),
        item.status !== 'upload-new'
          ? window.aptana.connections.readRemoteFile(connection.id, item.relativePath).catch(() => '')
          : Promise.resolve('')
      ]);
      setLocalText(locRes);
      setRemoteText(remRes);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingFile(false);
    }
  };

  const diffResult = useMemo(
    () => (selectedPath ? computeHunkDiff(localText, remoteText, 2) : null),
    [selectedPath, localText, remoteText]
  );

  const handlePushHunk = (hunk: DiffHunk): void => {
    const updatedRemote = applyHunkLeftToRight(localText, remoteText, hunk);
    setRemoteText(updatedRemote);
    setRemoteDirty(true);
    onToast(`→ Blok ${hunk.id} digabungkan ke buffer Remote — klik "Simpan ke Server" untuk menerapkan.`);
  };

  const handlePullHunk = (hunk: DiffHunk): void => {
    const updatedLocal = applyHunkRightToLeft(localText, remoteText, hunk);
    setLocalText(updatedLocal);
    setLocalDirty(true);
    onToast(`← Blok ${hunk.id} ditarik ke buffer Lokal — klik "Simpan Lokal" untuk menerapkan.`);
  };

  const handleSaveLocal = async (): Promise<void> => {
    if (!selectedPath) return;
    setSavingSide('local');
    try {
      const absLocal = `${workspacePath.replace(/[\\/]+$/, '')}/${selectedPath}`;
      await window.aptana.workspace.writeFile(absLocal, localText);
      setLocalDirty(false);
      onToast(`💾 File lokal "${selectedPath}" berhasil diperbarui!`);
      onRefreshPlan();
    } catch (err) {
      onToast(`Gagal simpan lokal: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSavingSide(null);
    }
  };

  const handleSaveRemote = async (): Promise<void> => {
    if (!selectedPath) return;
    if (connection.isProduction) {
      const ok = window.confirm(
        `Unggah hasil Hunk Merge "${selectedPath}" ke server PRODUKSI "${connection.name}"?`
      );
      if (!ok) return;
    }
    setSavingSide('remote');
    try {
      await window.aptana.connections.writeRemoteFile(connection.id, selectedPath, remoteText);
      setRemoteDirty(false);
      onToast(`☁ File remote "${selectedPath}" berhasil diperbarui di ${connection.name}!`);
      onRefreshPlan();
    } catch (err) {
      onToast(`Gagal simpan remote: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSavingSide(null);
    }
  };

  return (
    <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '260px 1fr', minHeight: 340, overflow: 'hidden' }}>
      {/* Left Pane: Folder Tree */}
      <div
        style={{
          borderRight: '1px solid var(--border-subtle)',
          overflowY: 'auto',
          padding: 10,
          background: 'var(--bg-app)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>
          Pohon Folder Berbeda ({items.length} file)
        </div>
        {groupedByDir.length === 0 ? (
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            Tidak ada file berbeda — klik Pindai Ulang.
          </div>
        ) : (
          groupedByDir.map(([dir, dirItems]) => (
            <div key={dir} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#7dd3fc'
                }}
              >
                <FolderOpen size={12} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {dir}
                </span>
              </div>
              {dirItems.map((it) => {
                const fileName = it.relativePath.split('/').pop() || it.relativePath;
                const active = selectedPath === it.relativePath;
                const badgeColor =
                  it.status === 'upload-new'
                    ? '#34d399'
                    : it.status === 'download-new'
                      ? '#38bdf8'
                      : '#fbbf24';
                return (
                  <button
                    key={it.relativePath}
                    type="button"
                    onClick={() => void loadPair(it)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 5,
                      padding: '5px 7px',
                      marginLeft: 10,
                      borderRadius: 5,
                      border: active
                        ? '1px solid var(--accent)'
                        : '1px solid var(--border-subtle)',
                      background: active ? 'rgba(56, 189, 248, 0.14)' : 'var(--bg-surface)',
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                      fontSize: 11,
                      textAlign: 'left'
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      <FileCode2 size={11} style={{ flexShrink: 0 }} />
                      {fileName}
                    </span>
                    <span style={{ fontSize: 9.5, fontWeight: 700, color: badgeColor, flexShrink: 0 }}>
                      {it.status === 'upload-new'
                        ? 'LOKAL'
                        : it.status === 'download-new'
                          ? 'SERVER'
                          : 'BEDA'}
                    </span>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>

      {/* Right Pane: Hunk-Level Selective Merge */}
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        <div
          style={{
            padding: '8px 14px',
            borderBottom: '1px solid var(--border-subtle)',
            background: 'var(--bg-surface)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8
          }}
        >
          <div style={{ fontSize: 11.5, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
            {selectedPath ? `📄 ${selectedPath}` : 'Pilih file di pohon folder kiri untuk Hunk Merge'}
            {diffResult && !diffResult.identical && (
              <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>
                ({diffResult.hunks.length} blok •{' '}
                <span style={{ color: '#f87171' }}>-{diffResult.removedLines}</span> /{' '}
                <span style={{ color: '#34d399' }}>+{diffResult.addedLines}</span>)
              </span>
            )}
          </div>

          {selectedPath && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                className={`btn btn-xs ${localDirty ? 'btn-primary' : ''}`}
                disabled={!localDirty || savingSide !== null}
                onClick={() => void handleSaveLocal()}
              >
                <Save size={11} /> {savingSide === 'local' ? 'Menyimpan...' : 'Simpan Lokal'}
              </button>
              <button
                type="button"
                className={`btn btn-xs ${remoteDirty ? 'btn-primary' : ''}`}
                disabled={!remoteDirty || savingSide !== null}
                onClick={() => void handleSaveRemote()}
              >
                <UploadCloud size={11} />{' '}
                {savingSide === 'remote' ? 'Mengunggah...' : 'Simpan ke Server'}
              </button>
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {!selectedPath ? (
            <div style={{ padding: 28, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
              Klik salah satu file pada pohon folder di sebelah kiri untuk membandingkan blok perubahan (Hunk Diff) antara <strong>Lokal</strong> ↔ <strong>Server {connection.name}</strong>.
            </div>
          ) : loadingFile ? (
            <div style={{ padding: 28, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
              <RefreshCw size={14} className="spin" /> Membaca isi file Lokal &amp; Server Remote...
            </div>
          ) : loadError ? (
            <div style={{ color: '#fca5a5', fontSize: 12 }}>{loadError}</div>
          ) : diffResult?.identical ? (
            <div
              style={{
                padding: 24,
                textAlign: 'center',
                color: '#34d399',
                fontSize: 12.5,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6
              }}
            >
              <Check size={20} />
              <strong>Isi file Lokal &amp; Server Remote sudah 100% identik!</strong>
            </div>
          ) : (
            diffResult?.hunks.map((hunk) => (
              <div
                key={hunk.id}
                style={{
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 8,
                  overflow: 'hidden',
                  background: 'var(--bg-app)'
                }}
              >
                <div
                  style={{
                    padding: '6px 10px',
                    background: 'var(--bg-elevated)',
                    borderBottom: '1px solid var(--border-subtle)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    fontSize: 11
                  }}
                >
                  <span style={{ fontFamily: 'var(--font-mono)', color: '#7dd3fc', fontWeight: 700 }}>
                    @@ Lokal L{hunk.leftStart + 1} ({hunk.leftCount} baris) ↔ Server L
                    {hunk.rightStart + 1} ({hunk.rightCount} baris) @@
                  </span>
                  <div style={{ display: 'flex', gap: 5 }}>
                    <button
                      type="button"
                      className="btn btn-xs"
                      style={{ color: '#38bdf8', borderColor: 'rgba(56, 189, 248, 0.45)' }}
                      onClick={() => handlePullHunk(hunk)}
                      title="Tarik blok versi Server Remote ke file Lokal"
                    >
                      <ArrowLeft size={11} /> Pull Blok ke Lokal
                    </button>
                    <button
                      type="button"
                      className="btn btn-xs"
                      style={{ color: '#34d399', borderColor: 'rgba(52, 211, 153, 0.45)' }}
                      onClick={() => handlePushHunk(hunk)}
                      title="Dorong blok versi Lokal ke file Server Remote"
                    >
                      Push Blok ke Server <ArrowRight size={11} />
                    </button>
                  </div>
                </div>

                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.5 }}>
                  {hunk.lines.map((line, lIdx) => {
                    const bg =
                      line.type === 'delete'
                        ? 'rgba(239, 68, 68, 0.14)'
                        : line.type === 'insert'
                          ? 'rgba(16, 185, 129, 0.14)'
                          : 'transparent';
                    const prefix =
                      line.type === 'delete' ? '−' : line.type === 'insert' ? '+' : ' ';
                    const prefixColor =
                      line.type === 'delete'
                        ? '#f87171'
                        : line.type === 'insert'
                          ? '#34d399'
                          : 'var(--text-muted)';
                    return (
                      <div
                        key={lIdx}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '42px 42px 18px 1fr',
                          padding: '0 8px',
                          background: bg,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-all'
                        }}
                      >
                        <span style={{ color: 'var(--text-muted)', fontSize: 10, userSelect: 'none' }}>
                          {line.leftLineNo ?? ''}
                        </span>
                        <span style={{ color: 'var(--text-muted)', fontSize: 10, userSelect: 'none' }}>
                          {line.rightLineNo ?? ''}
                        </span>
                        <span style={{ color: prefixColor, fontWeight: 700, userSelect: 'none' }}>
                          {prefix}
                        </span>
                        <span>{line.text}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
