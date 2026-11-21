import React, { useEffect, useState } from 'react';
import {
  BookmarkPlus,
  Check,
  FileDown,
  FileUp,
  FolderKanban,
  FolderOpen,
  Lock,
  LogOut,
  Pencil,
  Save,
  Server,
  ShieldCheck,
  Trash2,
  X
} from 'lucide-react';
import type { SavedProject } from '@shared/types';
import { useIdeStore } from '../store/useIdeStore';

export const ProjectModal: React.FC = () => {
  const {
    projectModalOpen,
    setProjectModalOpen,
    projects,
    activeProjectId,
    workspacePath,
    connections,
    selectedConnectionId,
    remoteSubPath,
    tabs,
    saveCurrentProject,
    refreshProjects,
    openSavedProject,
    openProjectFromFile,
    deleteSavedProject,
    closeCurrentProject,
    refreshConnections,
    refreshDbProfiles,
    refreshSavedQueries,
    showToast
  } = useIdeStore();

  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;
  const activeConn = connections.find((c) => c.id === selectedConnectionId) ?? null;
  const codeTabsCount = tabs.filter((t) => t.kind === 'code').length;

  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [rowName, setRowName] = useState('');
  const [rowNotes, setRowNotes] = useState('');
  const [rowWorkspacePath, setRowWorkspacePath] = useState('');
  const [rowConnectionId, setRowConnectionId] = useState('');
  const [rowRemoteSubPath, setRowRemoteSubPath] = useState('');
  const [confirmDeleteProjId, setConfirmDeleteProjId] = useState<string | null>(null);

  // Phase 30 #9: Encrypted Team Workspace Bundle (.hmwpack)
  const [bundleOpen, setBundleOpen] = useState(false);
  const [bundlePassphrase, setBundlePassphrase] = useState('');
  const [bundleIncludeSecrets, setBundleIncludeSecrets] = useState(false);
  const [bundleBusy, setBundleBusy] = useState(false);

  const startEditRow = (proj: SavedProject): void => {
    setConfirmDeleteProjId(null);
    setEditingRowId(proj.id);
    setRowName(proj.name);
    setRowNotes(proj.notes ?? '');
    setRowWorkspacePath(proj.workspacePath ?? '');
    setRowConnectionId(proj.connectionId ?? '');
    setRowRemoteSubPath(proj.remoteSubPath ?? '');
  };

  const handleSaveRowEdit = async (proj: SavedProject): Promise<void> => {
    setBusy(true);
    try {
      await window.aptana.projects.save({
        id: proj.id,
        name: rowName.trim() || proj.name,
        notes: rowNotes.trim() || undefined,
        workspacePath: rowWorkspacePath.trim() || null,
        connectionId: rowConnectionId || null,
        remoteSubPath: rowRemoteSubPath.trim(),
        openTabs: proj.openTabs ?? [],
        activeTabKey: proj.activeTabKey ?? null,
        projectFilePath: proj.projectFilePath
      });
      await refreshProjects();
      setEditingRowId(null);
      showToast(`Data proyek "${rowName.trim() || proj.name}" diperbarui.`);
    } catch (err) {
      showToast(`Gagal mengedit proyek: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!projectModalOpen) {
      setEditingRowId(null);
      setConfirmDeleteProjId(null);
      return;
    }
    if (activeProject) {
      setName(activeProject.name);
      setNotes(activeProject.notes ?? '');
      return;
    }

    const suggested =
      workspacePath?.split(/[/\\]/).filter(Boolean).pop() ||
      (activeConn
        ? remoteSubPath
          ? `${activeConn.name} — ${remoteSubPath}`
          : activeConn.name
        : '');
    setName(suggested);
    setNotes('');
  }, [projectModalOpen, activeProject, workspacePath, activeConn, remoteSubPath]);

  if (!projectModalOpen) return null;

  const handleSave = async (opts: { asNew?: boolean; exportFile?: boolean }): Promise<void> => {
    setBusy(true);
    try {
      await saveCurrentProject({
        id: opts.asNew ? undefined : activeProject?.id,
        name: name.trim() || 'Proyek HMW Studio',
        notes: notes.trim() || undefined,
        exportFile: opts.exportFile
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div
        className="modal-card"
        style={{ width: 700, maxWidth: '94vw' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
            <FolderKanban size={18} color="var(--accent)" style={{ flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14.5 }}>
                Manajer Proyek — HMW Studio
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                Simpan proyek (folder lokal, server remote, &amp; tab terbuka) agar dapat dibuka kembali kapan saja
              </div>
            </div>
          </div>

          <button
            type="button"
            className="btn-modal-exit"
            onClick={() => setProjectModalOpen(false)}
          >
            <X size={14} />
            <span>Keluar</span>
          </button>
        </div>

        <div style={{ padding: 18, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Top Card: Save Current Workspace/Remote Session */}
          <div
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 10,
              padding: 14,
              display: 'flex',
              flexDirection: 'column',
              gap: 10
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--accent)' }}>
              {activeProject
                ? `Simpan / Perbarui Proyek Aktif: "${activeProject.name}"`
                : 'Simpan Sesi Saat Ini sebagai Proyek'}
            </div>

            <div
              style={{
                fontSize: 11.5,
                color: 'var(--text-secondary)',
                display: 'flex',
                flexWrap: 'wrap',
                gap: 12
              }}
            >
              <span>
                📁 <strong>Lokal:</strong>{' '}
                {workspacePath ? workspacePath : 'Tidak ada (Proyek Remote)'}
              </span>
              <span>
                🌐 <strong>Remote:</strong>{' '}
                {activeConn
                  ? `${activeConn.name}:/${remoteSubPath}`
                  : 'Tanpa koneksi remote'}
              </span>
              <span>
                📄 <strong>Tab Terbuka:</strong> {codeTabsCount} file
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 10 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                  Nama Proyek
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Contoh: Aplikasi Rekomendasi Aju"
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                  Catatan / Keterangan (Opsional)
                </label>
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Contoh: Server produksi PHP 8"
                  style={{ width: '100%' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 2 }}>
              <button
                type="button"
                className="btn btn-accent"
                disabled={busy || (!workspacePath && !selectedConnectionId && codeTabsCount === 0)}
                onClick={() => void handleSave({ asNew: false, exportFile: false })}
              >
                <Save size={14} />
                <span>{activeProject ? 'Simpan Perubahan Proyek' : 'Simpan Proyek'}</span>
              </button>

              {activeProject && (
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => void handleSave({ asNew: true, exportFile: false })}
                >
                  <BookmarkPlus size={14} />
                  <span>Simpan sebagai Proyek Baru</span>
                </button>
              )}

              <button
                type="button"
                className="btn"
                disabled={busy || (!workspacePath && !selectedConnectionId && codeTabsCount === 0)}
                onClick={() => void handleSave({ asNew: false, exportFile: true })}
                title="Simpan juga ke file .hmwproj di komputer Anda"
              >
                <FileDown size={14} />
                <span>Simpan ke File (.hmwproj)...</span>
              </button>
            </div>
          </div>

          {/* Bottom Section: Saved Projects List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8
              }}
            >
              <span style={{ fontWeight: 700, fontSize: 13 }}>
                Daftar Proyek Tersimpan ({projects.length})
              </span>

              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void openProjectFromFile()}
                >
                  <FileUp size={13} />
                  <span>Buka File Proyek (.hmwproj)...</span>
                </button>

                {(activeProjectId || workspacePath || tabs.length > 0) && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => void closeCurrentProject()}
                    title="Tutup proyek saat ini dan kembali ke layar awal"
                  >
                    <LogOut size={13} />
                    <span>Tutup Proyek Aktif</span>
                  </button>
                )}
              </div>
            </div>

            {projects.length === 0 ? (
              <div
                style={{
                  padding: 18,
                  textAlign: 'center',
                  color: 'var(--text-muted)',
                  border: '1px dashed var(--border-subtle)',
                  borderRadius: 8
                }}
              >
                Belum ada proyek tersimpan. Buka folder lokal atau pilih koneksi server remote, lalu klik{' '}
                <strong>Simpan Proyek</strong> di atas agar dapat dibuka kembali kapan saja.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {projects.map((proj) => {
                  const isCurrent = proj.id === activeProjectId;
                  const linkedConn = connections.find((c) => c.id === proj.connectionId);
                  const isEditingThis = editingRowId === proj.id;
                  const isConfirmingDel = confirmDeleteProjId === proj.id;

                  return (
                    <div
                      key={proj.id}
                      style={{
                        padding: '11px 13px',
                        borderRadius: 9,
                        background: isCurrent ? 'var(--accent-soft)' : 'var(--bg-elevated)',
                        border: `1px solid ${
                          isCurrent ? 'var(--accent)' : 'var(--border-subtle)'
                        }`,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 10
                      }}
                    >
                      {isEditingThis ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            void handleSaveRowEdit(proj);
                          }}
                          style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
                        >
                          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 8 }}>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                Nama Proyek
                              </span>
                              <input
                                autoFocus
                                value={rowName}
                                onChange={(e) => setRowName(e.target.value)}
                                required
                              />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                Catatan (Opsional)
                              </span>
                              <input
                                value={rowNotes}
                                onChange={(e) => setRowNotes(e.target.value)}
                              />
                            </label>
                          </div>

                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: '1.2fr 1fr 0.8fr',
                              gap: 8
                            }}
                          >
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                Folder Lokal (Kosongkan jika Remote Murni)
                              </span>
                              <input
                                value={rowWorkspacePath}
                                onChange={(e) => setRowWorkspacePath(e.target.value)}
                                placeholder="D:\Projects\Aplikasi"
                              />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                Koneksi Server Remote
                              </span>
                              <select
                                value={rowConnectionId}
                                onChange={(e) => setRowConnectionId(e.target.value)}
                              >
                                <option value="">— Tanpa Server Remote —</option>
                                {connections.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    [{c.protocol.toUpperCase()}] {c.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                Subfolder Remote
                              </span>
                              <input
                                value={rowRemoteSubPath}
                                onChange={(e) => setRowRemoteSubPath(e.target.value)}
                                placeholder="contoh: modul"
                              />
                            </label>
                          </div>

                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                            <button
                              type="button"
                              className="btn"
                              onClick={() => setEditingRowId(null)}
                            >
                              Batal
                            </button>
                            <button type="submit" className="btn btn-accent" disabled={busy}>
                              <Check size={13} />
                              <span>Simpan Edit Proyek</span>
                            </button>
                          </div>
                        </form>
                      ) : (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 12
                          }}
                        >
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span
                                style={{
                                  fontWeight: 700,
                                  fontSize: 13.5,
                                  color: 'var(--text-primary)'
                                }}
                              >
                                {proj.name}
                              </span>
                              {isCurrent && (
                                <span
                                  className="badge-pill"
                                  style={{
                                    background: 'var(--accent)',
                                    color: '#fff'
                                  }}
                                >
                                  AKTIF
                                </span>
                              )}
                              {proj.notes && (
                                <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                                  — {proj.notes}
                                </span>
                              )}
                            </div>

                            <div
                              style={{
                                marginTop: 5,
                                fontSize: 11.5,
                                color: 'var(--text-secondary)',
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: 12
                              }}
                            >
                              {proj.workspacePath && (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  <FolderOpen size={12} color="#38bdf8" />
                                  {proj.workspacePath}
                                </span>
                              )}
                              {linkedConn && (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  <Server size={12} color="var(--accent)" />
                                  [{linkedConn.protocol.toUpperCase()}] {linkedConn.name}:/
                                  {proj.remoteSubPath}
                                </span>
                              )}
                              <span>{proj.openTabs?.length ?? 0} tab tersimpan</span>
                            </div>
                          </div>

                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              flexShrink: 0
                            }}
                          >
                            <button
                              type="button"
                              className={`btn ${isCurrent ? '' : 'btn-accent'}`}
                              onClick={() => void openSavedProject(proj.id)}
                            >
                              <span>{isCurrent ? 'Muat Ulang' : 'Buka Proyek'}</span>
                            </button>

                            <button
                              type="button"
                              className="btn-ghost"
                              style={{ padding: 6 }}
                              title="Edit Nama, Folder, atau Koneksi Proyek Ini"
                              onClick={() => startEditRow(proj)}
                            >
                              <Pencil size={14} />
                            </button>

                            {isConfirmingDel ? (
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button
                                  type="button"
                                  className="btn"
                                  style={{
                                    padding: '4px 8px',
                                    fontSize: 11,
                                    background: 'var(--danger)',
                                    borderColor: 'var(--danger)',
                                    color: '#fff'
                                  }}
                                  onClick={() => {
                                    setConfirmDeleteProjId(null);
                                    void deleteSavedProject(proj.id);
                                  }}
                                >
                                  Hapus
                                </button>
                                <button
                                  type="button"
                                  className="btn"
                                  style={{ padding: '4px 7px', fontSize: 11 }}
                                  onClick={() => setConfirmDeleteProjId(null)}
                                >
                                  Batal
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                className="btn-ghost"
                                style={{ padding: 6, color: 'var(--danger)' }}
                                title="Hapus dari daftar proyek tersimpan"
                                onClick={() => setConfirmDeleteProjId(proj.id)}
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Phase 30 #9: Encrypted Team Workspace Bundle (.hmwpack) */}
          <div
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid rgba(56, 189, 248, 0.35)',
              borderRadius: 10,
              padding: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 9
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <Lock size={15} color="#38bdf8" />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 12.5 }}>
                    🔐 Paket Onboarding Tim Terenkripsi (<code>.hmwpack</code> • AES-256-GCM)
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    Bagikan seluruh profil SFTP, Database, Saved SQL, Koleksi HTTP &amp; SSH Snippets dalam 1 file aman ke rekan tim.
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-xs"
                onClick={() => setBundleOpen((v) => !v)}
              >
                {bundleOpen ? 'Tutup Panel' : 'Ekspor / Impor .hmwpack'}
              </button>
            </div>

            {bundleOpen && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <input
                    type="password"
                    className="form-input"
                    style={{ flex: 1, minWidth: 200, fontSize: 12 }}
                    placeholder="Passphrase enkripsi (minimal 4 karakter)..."
                    value={bundlePassphrase}
                    onChange={(e) => setBundlePassphrase(e.target.value)}
                  />
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={bundleIncludeSecrets}
                      onChange={(e) => setBundleIncludeSecrets(e.target.checked)}
                    />
                    Sertakan Password (terenkripsi AES-256)
                  </label>
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={bundleBusy || bundlePassphrase.trim().length < 4}
                    onClick={async () => {
                      setBundleBusy(true);
                      try {
                        const res = await window.aptana.bundle.exportHmwPack({
                          passphrase: bundlePassphrase,
                          includeConnections: true,
                          includeDbProfiles: true,
                          includeSavedQueries: true,
                          includeHttpCollections: true,
                          includeSshSnippets: true,
                          includeSecrets: bundleIncludeSecrets
                        });
                        if (!res.canceled && res.counts) {
                          showToast(
                            `🔐 .hmwpack dibuat (${res.counts.connections} SFTP, ${res.counts.dbProfiles} DB, ${res.counts.savedQueries} SQL, ${res.counts.httpRequests} HTTP)!`
                          );
                        }
                      } catch (err) {
                        showToast(`Gagal ekspor .hmwpack: ${err instanceof Error ? err.message : String(err)}`);
                      } finally {
                        setBundleBusy(false);
                      }
                    }}
                  >
                    <ShieldCheck size={13} /> Ekspor Paket Tim (.hmwpack)
                  </button>

                  <button
                    type="button"
                    className="btn"
                    disabled={bundleBusy || bundlePassphrase.trim().length < 4}
                    onClick={async () => {
                      setBundleBusy(true);
                      try {
                        const res = await window.aptana.bundle.importHmwPack(bundlePassphrase);
                        if (!res.canceled && res.imported) {
                          await Promise.all([
                            refreshConnections(),
                            refreshDbProfiles(),
                            refreshSavedQueries()
                          ]);
                          showToast(
                            `✅ Impor .hmwpack sukses (+${res.imported.connections} SFTP, +${res.imported.dbProfiles} DB, +${res.imported.savedQueries} SQL, +${res.imported.httpRequests} HTTP, +${res.imported.sshSnippets} SSH)!`
                          );
                        }
                      } catch (err) {
                        showToast(`Gagal impor .hmwpack: ${err instanceof Error ? err.message : String(err)}`);
                      } finally {
                        setBundleBusy(false);
                      }
                    }}
                  >
                    <FileUp size={13} /> Impor Paket Tim (.hmwpack)
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
