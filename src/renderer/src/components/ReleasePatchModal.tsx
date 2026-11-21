import React, { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  CheckSquare,
  Clock,
  GitBranch,
  RefreshCw,
  Square,
  X
} from 'lucide-react';
import type { PatchCandidateFileDto } from '@shared/types';
import { useIdeStore } from '../store/useIdeStore';

export const ReleasePatchModal: React.FC = () => {
  const {
    releasePatchModalOpen,
    setReleasePatchModalOpen,
    workspacePath,
    gitStatus,
    openWorkspaceFolder,
    showToast
  } = useIdeStore();

  const [sourceMode, setSourceMode] = useState<'mtime' | 'git'>('mtime');
  const [sinceHours, setSinceHours] = useState<number>(24);
  const [candidates, setCandidates] = useState<PatchCandidateFileDto[]>([]);
  const [uncheckedPaths, setUncheckedPaths] = useState<Record<string, boolean>>({});
  const [releaseTitle, setReleaseTitle] = useState('Patch Perbaikan & Update Modul');
  const [migrationSql, setMigrationSql] = useState('');
  const [scanning, setScanning] = useState(false);
  const [building, setBuilding] = useState(false);

  const scanCandidates = async (): Promise<void> => {
    if (!workspacePath) return;
    setScanning(true);
    setUncheckedPaths({});
    try {
      if (sourceMode === 'git' && gitStatus?.isRepo) {
        const gitItems: PatchCandidateFileDto[] = gitStatus.changes
          .filter((c) => c.status !== 'D')
          .map((c) => ({
            relativePath: c.path.replace(/\\/g, '/'),
            sizeBytes: 0,
            mtimeMs: Date.now(),
            reason: `Git: ${c.status}`
          }));
        setCandidates(gitItems);
      } else {
        const list = await window.aptana.patch.scanModified(workspacePath, sinceHours);
        setCandidates(list);
      }
    } catch (err) {
      showToast(`Gagal memindai perubahan file: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => {
    if (!releasePatchModalOpen) return;
    if (gitStatus?.isRepo && gitStatus.changes.length > 0) {
      setSourceMode('git');
    } else {
      setSourceMode('mtime');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [releasePatchModalOpen]);

  useEffect(() => {
    if (releasePatchModalOpen && workspacePath) {
      void scanCandidates();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [releasePatchModalOpen, workspacePath, sourceMode, sinceHours]);

  const selectedRelPaths = useMemo(
    () => candidates.filter((c) => !uncheckedPaths[c.relativePath]).map((c) => c.relativePath),
    [candidates, uncheckedPaths]
  );

  if (!releasePatchModalOpen) return null;

  const handleBuildZip = async (): Promise<void> => {
    if (!workspacePath) {
      showToast('Buka folder proyek lokal terlebih dahulu.');
      return;
    }
    if (selectedRelPaths.length === 0) {
      showToast('Pilih minimal 1 file untuk dimasukkan ke Paket Rilis .zip.');
      return;
    }
    setBuilding(true);
    try {
      const res = await window.aptana.patch.buildZip({
        workspacePath,
        relativePaths: selectedRelPaths,
        releaseTitle,
        migrationSql
      });
      if (!res.canceled && res.filePath) {
        showToast(`📦 Paket Rilis (.zip) berhasil dibuat (${res.fileCount} file): ${res.filePath}`);
        setReleasePatchModalOpen(false);
      }
    } catch (err) {
      showToast(`Gagal membuat arsip .zip: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBuilding(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div
        className="modal-card"
        style={{
          width: 'min(780px, 95vw)',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
            <Archive size={18} color="#38bdf8" style={{ flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700 }}>
                📦 Pembuat Paket Rilis / Patch `.ZIP` Otomatis
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                Kemas hanya file yang berubah (utuh dengan struktur foldernya + catatan rilis + migrasi `.sql`) untuk dikirim ke server klien.
              </div>
            </div>
          </div>
          <button
            type="button"
            className="btn-modal-exit"
            onClick={() => setReleasePatchModalOpen(false)}
          >
            <X size={14} />
            <span>Keluar</span>
          </button>
        </div>

        <div className="modal-body" style={{ gap: 11 }}>
          {!workspacePath ? (
          <div style={{ padding: 24, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
              Buka folder proyek lokal terlebih dahulu untuk mengemas file perubahan menjadi paket `.zip`.
            </div>
            <button type="button" className="btn btn-primary" onClick={() => void openWorkspaceFolder()}>
              Buka Folder Proyek Lokal
            </button>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className={`btn ${sourceMode === 'mtime' ? 'btn-accent' : ''}`}
                  style={{ padding: '4px 10px', fontSize: 11.5 }}
                  onClick={() => setSourceMode('mtime')}
                >
                  <Clock size={12.5} /> Berdasarkan Waktu Modifikasi
                </button>
                {gitStatus?.isRepo && (
                  <button
                    type="button"
                    className={`btn ${sourceMode === 'git' ? 'btn-accent' : ''}`}
                    style={{ padding: '4px 10px', fontSize: 11.5 }}
                    onClick={() => setSourceMode('git')}
                  >
                    <GitBranch size={12.5} /> Perubahan Git ({gitStatus.changes.length})
                  </button>
                )}
              </div>

              {sourceMode === 'mtime' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>Rentang:</span>
                  <select
                    className="form-input"
                    style={{ width: 170, padding: '4px 8px', fontSize: 11.5 }}
                    value={sinceHours}
                    onChange={(e) => setSinceHours(Number(e.target.value))}
                  >
                    <option value={4}>4 Jam Terakhir</option>
                    <option value={12}>12 Jam Terakhir (Hari Ini)</option>
                    <option value={24}>24 Jam Terakhir</option>
                    <option value={72}>3 Hari Terakhir</option>
                    <option value={168}>7 Hari Terakhir</option>
                  </select>
                </div>
              )}
            </div>

            <div>
              <label className="form-label">Judul Rilis / Keterangan Patch</label>
              <input
                className="form-input"
                value={releaseTitle}
                onChange={(e) => setReleaseTitle(e.target.value)}
              />
            </div>

            {/* Candidate Files */}
            <div
              style={{
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-app)',
                maxHeight: 220,
                overflowY: 'auto',
                padding: 8,
                display: 'flex',
                flexDirection: 'column',
                gap: 4
              }}
            >
              {scanning ? (
                <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
                  Memindai file yang berubah...
                </div>
              ) : candidates.length === 0 ? (
                <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
                  Tidak ditemukan file yang dimodifikasi pada rentang waktu ini.
                </div>
              ) : (
                candidates.map((c) => {
                  const checked = !uncheckedPaths[c.relativePath];
                  return (
                    <div
                      key={c.relativePath}
                      onClick={() =>
                        setUncheckedPaths((prev) => ({
                          ...prev,
                          [c.relativePath]: !prev[c.relativePath]
                        }))
                      }
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        padding: '4px 7px',
                        borderRadius: 5,
                        cursor: 'pointer',
                        background: checked ? 'var(--bg-surface)' : 'transparent',
                        opacity: checked ? 1 : 0.55
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                        {checked ? (
                          <CheckSquare size={13} color="var(--accent)" />
                        ) : (
                          <Square size={13} color="var(--text-muted)" />
                        )}
                        <span
                          style={{
                            fontSize: 11.5,
                            fontFamily: 'var(--font-mono)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {c.relativePath}
                        </span>
                      </div>
                      <span style={{ fontSize: 10.5, color: 'var(--text-muted)', flexShrink: 0 }}>
                        {c.reason}
                      </span>
                    </div>
                  );
                })
              )}
            </div>

            <div>
              <label className="form-label">
                Lampirkan Script Migrasi SQL Opsional (disertakan otomatis sebagai `_sql_migrasi/migrasi_patch.sql`)
              </label>
              <textarea
                className="form-input"
                rows={3}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, resize: 'vertical' }}
                placeholder="-- Opsional: Tempel ALTER TABLE / INSERT referensi di sini..."
                value={migrationSql}
                onChange={(e) => setMigrationSql(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                Dipilih: <strong>{selectedRelPaths.length}</strong> dari {candidates.length} file
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn" onClick={() => setReleasePatchModalOpen(false)}>
                  Tutup
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={building || selectedRelPaths.length === 0}
                  onClick={() => void handleBuildZip()}
                >
                  {building ? <RefreshCw size={13} className="spin" /> : <Archive size={13} />}
                  <span>Buat Paket Rilis (.ZIP)</span>
                </button>
              </div>
            </div>
          </>
        )}
        </div>
      </div>
    </div>
  );
};
