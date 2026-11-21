import React, { useEffect, useState } from 'react';
import {
  Clock,
  FolderOpen,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  X
} from 'lucide-react';
import type { DbScheduleJob } from '@shared/types';
import { useIdeStore } from '../store/useIdeStore';

export const DbSchedulerModal: React.FC = () => {
  const {
    dbSchedulerModalOpen,
    setDbSchedulerModalOpen,
    dbProfiles,
    selectedDbProfileId,
    dbSchema,
    savedSqlQueries,
    workspacePath,
    showToast
  } = useIdeStore();

  const [jobs, setJobs] = useState<DbScheduleJob[]>([]);
  const [name, setName] = useState('Backup Otomatis Harian');
  const [kind, setKind] = useState<'sql-backup' | 'saved-query-xlsx'>('sql-backup');
  const [profileId, setProfileId] = useState(selectedDbProfileId ?? dbProfiles[0]?.id ?? '');
  const [databaseName, setDatabaseName] = useState(dbSchema?.currentDatabase ?? '');
  const [savedQueryId, setSavedQueryId] = useState(savedSqlQueries[0]?.id ?? '');
  const [scheduleType, setScheduleType] = useState<'daily' | 'interval'>('daily');
  const [dailyTimeHHMM, setDailyTimeHHMM] = useState('17:00');
  const [intervalMinutes, setIntervalMinutes] = useState(120);
  const [outputDir, setOutputDir] = useState(workspacePath ?? '');
  const [runningJobId, setRunningJobId] = useState<string | null>(null);

  const loadJobs = async (): Promise<void> => {
    const list = await window.aptana.db.listSchedules();
    setJobs(list);
  };

  useEffect(() => {
    if (!dbSchedulerModalOpen) return;
    if (selectedDbProfileId) setProfileId(selectedDbProfileId);
    if (dbSchema?.currentDatabase) setDatabaseName(dbSchema.currentDatabase);
    if (savedSqlQueries[0]?.id && !savedQueryId) setSavedQueryId(savedSqlQueries[0].id);
    void loadJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbSchedulerModalOpen]);

  if (!dbSchedulerModalOpen) return null;

  const handlePickFolder = async (): Promise<void> => {
    const picked = await window.aptana.workspace.selectFolder();
    if (picked) setOutputDir(picked);
  };

  const handleAddJob = async (): Promise<void> => {
    if (!profileId) {
      showToast('Pilih koneksi Database terlebih dahulu.');
      return;
    }
    if (!outputDir.trim()) {
      showToast('Pilih folder tujuan penyimpanan terlebih dahulu.');
      return;
    }
    if (kind === 'saved-query-xlsx' && !savedQueryId) {
      showToast('Simpan minimal 1 Query di Pustaka terlebih dahulu.');
      return;
    }
    try {
      await window.aptana.db.saveSchedule({
        name,
        kind,
        profileId,
        database: databaseName.trim() || undefined,
        savedQueryId: kind === 'saved-query-xlsx' ? savedQueryId : undefined,
        scheduleType,
        dailyTimeHHMM,
        intervalMinutes,
        outputDir: outputDir.trim(),
        enabled: true
      });
      await loadJobs();
      showToast('⏱️ Jadwal otomatis berhasil ditambahkan!');
    } catch (err) {
      showToast(`Gagal menyimpan jadwal: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleToggleEnabled = async (job: DbScheduleJob): Promise<void> => {
    await window.aptana.db.saveSchedule({
      ...job,
      enabled: !job.enabled
    });
    await loadJobs();
  };

  const handleRunNow = async (jobId: string): Promise<void> => {
    setRunningJobId(jobId);
    try {
      const updated = await window.aptana.db.runScheduleNow(jobId);
      await loadJobs();
      showToast(`✅ Eksekusi selesai: ${updated.lastOutputPath || updated.lastMessage}`);
    } catch (err) {
      await loadJobs();
      showToast(`Gagal menjalankan jadwal: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunningJobId(null);
    }
  };

  return (
    <div className="modal-backdrop">
      <div
        className="modal-card"
        style={{
          width: 'min(820px, 95vw)',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
            <Clock size={18} color="#fbbf24" style={{ flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700 }}>
                ⏱️ Penjadwal Otomatis Backup Database `.SQL` &amp; Export Query `.XLSX`
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                Berjalan otomatis di latar belakang selama HMW Studio aktif, atau jalankan instan kapan saja.
              </div>
            </div>
          </div>
          <button
            type="button"
            className="btn-modal-exit"
            onClick={() => setDbSchedulerModalOpen(false)}
          >
            <X size={14} />
            <span>Keluar</span>
          </button>
        </div>

        <div className="modal-body">
          {/* Add Form */}
        <div
          style={{
            padding: 12,
            borderRadius: 8,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: 8 }}>
            <div>
              <label className="form-label">Nama Tugas Terjadwal</label>
              <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="form-label">Jenis Tugas</label>
              <select
                className="form-input"
                value={kind}
                onChange={(e) => setKind(e.target.value as 'sql-backup' | 'saved-query-xlsx')}
              >
                <option value="sql-backup">Backup Struktur + Data (.SQL)</option>
                <option value="saved-query-xlsx">Export Query Tersimpan (.XLSX)</option>
              </select>
            </div>
            <div>
              <label className="form-label">Koneksi Database</label>
              <select
                className="form-input"
                value={profileId}
                onChange={(e) => setProfileId(e.target.value)}
              >
                {dbProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    [{p.engine.toUpperCase()}] {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <div>
              <label className="form-label">Nama Database / Schema</label>
              <input
                className="form-input"
                placeholder="contoh: sipegi"
                value={databaseName}
                onChange={(e) => setDatabaseName(e.target.value)}
              />
            </div>

            {kind === 'saved-query-xlsx' ? (
              <div>
                <label className="form-label">Pilih Query Tersimpan</label>
                <select
                  className="form-input"
                  value={savedQueryId}
                  onChange={(e) => setSavedQueryId(e.target.value)}
                >
                  <option value="">-- Pilih Query --</option>
                  {savedSqlQueries.map((sq) => (
                    <option key={sq.id} value={sq.id}>
                      {sq.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label className="form-label">Tipe Jadwal</label>
                <select
                  className="form-input"
                  value={scheduleType}
                  onChange={(e) => setScheduleType(e.target.value as 'daily' | 'interval')}
                >
                  <option value="daily">Harian pada Jam Tertentu</option>
                  <option value="interval">Berulang Setiap N Menit</option>
                </select>
              </div>
            )}

            <div>
              <label className="form-label">
                {scheduleType === 'daily' ? 'Jam Harian (HH:MM)' : 'Interval (Menit)'}
              </label>
              {scheduleType === 'daily' ? (
                <input
                  type="time"
                  className="form-input"
                  value={dailyTimeHHMM}
                  onChange={(e) => setDailyTimeHHMM(e.target.value)}
                />
              ) : (
                <input
                  type="number"
                  min={5}
                  className="form-input"
                  value={intervalMinutes}
                  onChange={(e) => setIntervalMinutes(Number(e.target.value))}
                />
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
            <div style={{ flex: 1 }}>
              <label className="form-label">Folder Tujuan Penyimpanan Otomatis</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  className="form-input"
                  placeholder="D:\BackupDatabase"
                  value={outputDir}
                  onChange={(e) => setOutputDir(e.target.value)}
                />
                <button type="button" className="btn" onClick={() => void handlePickFolder()}>
                  <FolderOpen size={13} /> Pilih Folder
                </button>
              </div>
            </div>
            <button type="button" className="btn btn-primary" onClick={() => void handleAddJob()}>
              <Plus size={13} /> Tambah Jadwal
            </button>
          </div>
        </div>

        {/* Jobs List */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {jobs.length === 0 ? (
            <div style={{ padding: 18, textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
              Belum ada jadwal backup / export otomatis yang didaftarkan.
            </div>
          ) : (
            jobs.map((j) => (
              <div
                key={j.id}
                style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <input
                      type="checkbox"
                      checked={j.enabled}
                      onChange={() => void handleToggleEnabled(j)}
                      title="Aktifkan / Nonaktifkan jadwal"
                    />
                    <strong style={{ fontSize: 12 }}>{j.name}</strong>
                    <span className="badge">
                      {j.kind === 'sql-backup' ? '.SQL Backup' : '.XLSX Query'}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                      {j.scheduleType === 'daily'
                        ? `Harian ${j.dailyTimeHHMM}`
                        : `Tiap ${j.intervalMinutes} menit`}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 10.5,
                      color: j.lastStatus === 'error' ? '#fda4af' : 'var(--text-muted)',
                      marginTop: 3,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    Folder: {j.outputDir}
                    {j.lastRunAt
                      ? ` • Terakhir: ${new Date(j.lastRunAt).toLocaleString('id-ID')} (${j.lastMessage || j.lastStatus})`
                      : ' • Belum pernah dijalankan'}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                  <button
                    type="button"
                    className="btn btn-xs"
                    disabled={runningJobId === j.id}
                    onClick={() => void handleRunNow(j.id)}
                    title="Uji / Jalankan Sekarang"
                  >
                    {runningJobId === j.id ? (
                      <RefreshCw size={11} className="spin" />
                    ) : (
                      <Play size={11} color="#34d399" />
                    )}
                    <span>Jalankan</span>
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    style={{ color: '#fb7185' }}
                    onClick={() => void window.aptana.db.deleteSchedule(j.id).then(loadJobs)}
                    title="Hapus jadwal"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))
          )}
          </div>
        </div>
      </div>
    </div>
  );
};
