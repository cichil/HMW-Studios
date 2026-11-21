import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Copy,
  Database,
  Download,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  ShieldCheck,
  Trash2,
  X
} from 'lucide-react';
import type { EnterpriseAuditEntry } from '@shared/types';
import { useIdeStore } from '../store/useIdeStore';

type AuditFilterTab = 'all' | 'production' | 'undoable' | 'sftp';

export const EnterpriseAuditModal: React.FC = () => {
  const {
    auditModalOpen,
    setAuditModalOpen,
    selectedDbProfileId,
    showToast
  } = useIdeStore();

  const [entries, setEntries] = useState<EnterpriseAuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterTab, setFilterTab] = useState<AuditFilterTab>('all');
  const [searchText, setSearchText] = useState('');
  const [undoingId, setUndoingId] = useState<string | null>(null);

  const loadAuditEntries = useCallback(async () => {
    setLoading(true);
    try {
      const list = await window.aptana.audit.list(500);
      setEntries(list);
    } catch (err) {
      showToast(`Gagal memuat log audit: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (auditModalOpen) {
      void loadAuditEntries();
    }
  }, [auditModalOpen, loadAuditEntries]);

  const filteredEntries = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return entries.filter((item) => {
      if (filterTab === 'production' && !item.isProduction) return false;
      if (filterTab === 'undoable' && !item.undoSql) return false;
      if (filterTab === 'sftp' && item.kind !== 'sftp-deploy') return false;
      if (!q) return true;
      return (
        item.summary.toLowerCase().includes(q) ||
        item.targetName.toLowerCase().includes(q) ||
        (item.tableOrPath ?? '').toLowerCase().includes(q) ||
        (item.database ?? '').toLowerCase().includes(q) ||
        (item.detail ?? '').toLowerCase().includes(q) ||
        (item.undoSql ?? '').toLowerCase().includes(q)
      );
    });
  }, [entries, filterTab, searchText]);

  const handleRunUndoSql = async (entry: EnterpriseAuditEntry): Promise<void> => {
    if (!entry.undoSql) return;
    const targetProfId = entry.profileId || selectedDbProfileId;
    if (!targetProfId) {
      showToast('Pilih profil Database terlebih dahulu untuk menjalankan SQL Undo.');
      return;
    }
    const ok = window.confirm(
      `Jalankan SQL Undo berikut pada "${entry.targetName}"?\n\n${entry.undoSql}`
    );
    if (!ok) return;

    setUndoingId(entry.id);
    try {
      await window.aptana.db.query(targetProfId, entry.undoSql, entry.database);
      showToast(`↩️ SQL Undo berhasil dijalankan pada ${entry.tableOrPath || entry.targetName}!`);
      await loadAuditEntries();
    } catch (err) {
      showToast(`Gagal menjalankan Undo SQL: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUndoingId(null);
    }
  };

  const handleExportJson = async (): Promise<void> => {
    const res = await window.aptana.audit.exportJson();
    if (!res.canceled && res.filePath) {
      showToast(`📤 Audit Log diekspor ke: ${res.filePath}`);
    }
  };

  const handleClear = async (): Promise<void> => {
    if (!window.confirm('Bersihkan seluruh riwayat Enterprise Audit Log lokal?')) return;
    await window.aptana.audit.clear();
    setEntries([]);
    showToast('Audit Log dibersihkan.');
  };

  if (!auditModalOpen) return null;

  return (
    <div className="modal-backdrop">
      <div
        className="modal-card"
        style={{
          width: 'min(980px, 95vw)',
          minHeight: 460,
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 9,
                background: 'rgba(16, 185, 129, 0.14)',
                border: '1px solid rgba(52, 211, 153, 0.35)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}
            >
              <ShieldCheck size={18} color="#34d399" />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--text-primary)' }}>
                Enterprise Audit Trail &amp; 1-Click SQL Undo
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2 }}>
                Rekam jejak otomatis mutasi data (UPDATE / DELETE / Import) &amp; SFTP Deploy lengkap dengan SQL pemulihan instan
              </div>
            </div>
          </div>

          <button
            type="button"
            className="btn-modal-exit"
            onClick={() => setAuditModalOpen(false)}
            title="Keluar / Tutup Jendela"
          >
            <X size={14} />
            <span>Keluar</span>
          </button>
        </div>

        <div className="modal-subbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {(
              [
                ['all', `Semua (${entries.length})`],
                ['production', `Produksi 🔴 (${entries.filter((e) => e.isProduction).length})`],
                ['undoable', `Ada Undo SQL ↩️ (${entries.filter((e) => Boolean(e.undoSql)).length})`],
                ['sftp', `SFTP Deploy (${entries.filter((e) => e.kind === 'sftp-deploy').length})`]
              ] as Array<[AuditFilterTab, string]>
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`btn ${filterTab === id ? 'btn-primary' : ''}`}
                style={{ padding: '5px 11px', fontSize: 12 }}
                onClick={() => setFilterTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', width: 240 }}>
              <Search
                size={13}
                style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-muted)' }}
              />
              <input
                type="text"
                className="form-input"
                style={{
                  paddingLeft: 30,
                  width: '100%',
                  height: 32,
                  fontSize: 12,
                  background: 'var(--bg-surface)'
                }}
                placeholder="Cari tabel, server, atau nilai lama..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
              />
            </div>
            <button type="button" className="btn" onClick={() => void loadAuditEntries()}>
              <RefreshCw size={13} /> Segarkan
            </button>
            <button type="button" className="btn" onClick={() => void handleExportJson()}>
              <Download size={13} /> Ekspor .JSON
            </button>
            <button type="button" className="btn" onClick={() => void handleClear()}>
              <Trash2 size={13} /> Bersihkan
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {loading ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
              Memuat catatan audit...
            </div>
          ) : filteredEntries.length === 0 ? (
            <div
              style={{
                flex: 1,
                minHeight: 220,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                color: 'var(--text-muted)',
                textAlign: 'center'
              }}
            >
              <ShieldCheck size={30} style={{ opacity: 0.45 }} />
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
                Belum ada aktivitas mutasi Database atau SFTP Deploy yang sesuai filter.
              </div>
              <div style={{ fontSize: 12 }}>
                Setiap perubahan sel (UPDATE), penghapusan baris (DELETE), impor Excel, dan simpan SFTP akan otomatis tercatat di sini lengkap dengan tombol Undo SQL.
              </div>
            </div>
          ) : (
            filteredEntries.map((item) => (
              <div
                key={item.id}
                style={{
                  padding: '12px 14px',
                  borderRadius: 8,
                  background: 'var(--bg-app)',
                  border: item.isProduction
                    ? '1px solid rgba(239, 68, 68, 0.4)'
                    : '1px solid var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                    {item.kind === 'sftp-deploy' ? (
                      <Server size={14} color="#38bdf8" />
                    ) : (
                      <Database size={14} color="#34d399" />
                    )}
                    <span style={{ fontWeight: 700, fontSize: 12.5 }}>{item.summary}</span>
                    <span
                      style={{
                        fontSize: 10.5,
                        padding: '1px 8px',
                        borderRadius: 999,
                        background: 'rgba(56, 189, 248, 0.14)',
                        color: '#7dd3fc'
                      }}
                    >
                      {item.targetName}
                      {item.database ? ` • ${item.database}` : ''}
                    </span>
                    {item.isProduction && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '1px 7px',
                          borderRadius: 999,
                          background: 'rgba(239, 68, 68, 0.2)',
                          color: '#fca5a5',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4
                        }}
                      >
                        <AlertTriangle size={10} /> PRODUKSI
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    {new Date(item.timestamp).toLocaleString('id-ID')}
                  </span>
                </div>

                {item.detail && (
                  <div
                    style={{
                      fontSize: 11.5,
                      color: 'var(--text-secondary)',
                      fontFamily: 'var(--font-mono)',
                      wordBreak: 'break-word'
                    }}
                  >
                    {item.detail}
                  </div>
                )}

                {item.undoSql && (
                  <div
                    style={{
                      marginTop: 2,
                      padding: '8px 11px',
                      borderRadius: 6,
                      background: 'var(--bg-surface)',
                      border: '1px solid rgba(52, 211, 153, 0.32)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      flexWrap: 'wrap'
                    }}
                  >
                    <code
                      style={{
                        fontSize: 11,
                        color: '#a7f3d0',
                        fontFamily: 'var(--font-mono)',
                        flex: 1,
                        minWidth: 220,
                        wordBreak: 'break-all'
                      }}
                    >
                      {item.undoSql}
                    </code>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: '4px 9px', fontSize: 11.5 }}
                        onClick={() => {
                          void navigator.clipboard.writeText(item.undoSql!);
                          showToast('SQL Undo disalin ke clipboard.');
                        }}
                      >
                        <Copy size={11} /> Salin SQL
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary"
                        style={{ padding: '4px 10px', fontSize: 11.5 }}
                        disabled={undoingId === item.id}
                        onClick={() => void handleRunUndoSql(item)}
                      >
                        <RotateCcw size={11} />
                        {undoingId === item.id ? 'Memulihkan...' : 'Jalankan SQL Undo'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
