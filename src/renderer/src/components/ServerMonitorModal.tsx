import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Clock,
  Copy,
  Cpu,
  Database,
  Gauge,
  HardDrive,
  RefreshCw,
  Server,
  ShieldAlert,
  Skull,
  Terminal,
  X
} from 'lucide-react';
import type { DbProcessItem, ServerHealthSnapshot } from '@shared/types';
import { buildServiceControlCommand } from '@shared/sshSnippetsCatalog';
import { useIdeStore } from '../store/useIdeStore';
import { MysqlWorkbenchDashboardPanel } from './MysqlWorkbenchDashboardPanel';
import { SshSnippetsPanel } from './SshSnippetsPanel';

type MonitorTab = 'mysql-dashboard' | 'health' | 'processlist' | 'crontab' | 'ssh-snippets';

export const ServerMonitorModal: React.FC = () => {
  const open = useIdeStore((s) => s.serverMonitorOpen);
  const initialTab = useIdeStore((s) => s.serverMonitorInitialTab);
  const setOpen = useIdeStore((s) => s.setServerMonitorOpen);
  const connections = useIdeStore((s) => s.connections);
  const selectedConnectionId = useIdeStore((s) => s.selectedConnectionId);
  const dbProfiles = useIdeStore((s) => s.dbProfiles);
  const selectedDbProfileId = useIdeStore((s) => s.selectedDbProfileId);
  const showToast = useIdeStore((s) => s.showToast);

  const [activeTab, setActiveTab] = useState<MonitorTab>('mysql-dashboard');
  const [targetConnId, setTargetConnId] = useState<string>('');
  const [targetDbId, setTargetDbId] = useState<string>('');
  const [autoRefresh, setAutoRefresh] = useState(false);

  const [health, setHealth] = useState<ServerHealthSnapshot | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);

  const [processes, setProcesses] = useState<DbProcessItem[]>([]);
  const [procLoading, setProcLoading] = useState(false);
  const [procError, setProcError] = useState<string | null>(null);
  const [procFilter, setProcFilter] = useState('');
  const [killingPid, setKillingPid] = useState<string | number | null>(null);

  useEffect(() => {
    if (!open) return;
    const defaultConn =
      selectedConnectionId ||
      connections.find((c) => c.protocol === 'sftp')?.id ||
      connections[0]?.id ||
      '';
    setTargetConnId((prev) => prev || defaultConn);

    const defaultDb = selectedDbProfileId || dbProfiles[0]?.id || '';
    setTargetDbId((prev) => prev || defaultDb);

    if (initialTab) {
      setActiveTab(initialTab);
    } else if (defaultDb) {
      setActiveTab('mysql-dashboard');
    } else if (defaultConn) {
      setActiveTab('health');
    }
  }, [open, initialTab, selectedConnectionId, connections, selectedDbProfileId, dbProfiles]);

  const loadHealth = useCallback(async (cid: string) => {
    if (!cid) return;
    setHealthLoading(true);
    setHealthError(null);
    try {
      const snap = await window.aptana.connections.inspectServerHealth(cid);
      setHealth(snap);
    } catch (err) {
      setHealthError(err instanceof Error ? err.message : String(err));
    } finally {
      setHealthLoading(false);
    }
  }, []);

  const loadProcesses = useCallback(async (dbId: string) => {
    if (!dbId) return;
    setProcLoading(true);
    setProcError(null);
    try {
      const list = await window.aptana.db.listProcesses(dbId);
      setProcesses(list);
    } catch (err) {
      setProcError(err instanceof Error ? err.message : String(err));
    } finally {
      setProcLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    if ((activeTab === 'health' || activeTab === 'crontab') && targetConnId) {
      void loadHealth(targetConnId);
    } else if (activeTab === 'processlist' && targetDbId) {
      void loadProcesses(targetDbId);
    }
  }, [open, activeTab, targetConnId, targetDbId, loadHealth, loadProcesses]);

  useEffect(() => {
    if (!open || !autoRefresh) return;
    const timer = setInterval(() => {
      if ((activeTab === 'health' || activeTab === 'crontab') && targetConnId) {
        void loadHealth(targetConnId);
      } else if (activeTab === 'processlist' && targetDbId) {
        void loadProcesses(targetDbId);
      }
    }, 8000);
    return () => clearInterval(timer);
  }, [open, autoRefresh, activeTab, targetConnId, targetDbId, loadHealth, loadProcesses]);

  if (!open) return null;

  const handleKillQuery = async (proc: DbProcessItem): Promise<void> => {
    if (!targetDbId) return;
    const ok = window.confirm(
      `Hentikan paksa (KILL) proses Database #${proc.id} milik "${proc.user}" (${proc.timeSec}s)?\n\nQuery: ${(proc.query || '(idle)').slice(0, 220)}`
    );
    if (!ok) return;
    setKillingPid(proc.id);
    try {
      const res = await window.aptana.db.killProcess(targetDbId, proc.id);
      showToast(res.message);
      await loadProcesses(targetDbId);
    } catch (err) {
      showToast(`Gagal KILL proses #${proc.id}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setKillingPid(null);
    }
  };

  const filteredProcs = processes.filter((p) => {
    const q = procFilter.trim().toLowerCase();
    if (!q) return true;
    return (
      String(p.id).includes(q) ||
      p.user.toLowerCase().includes(q) ||
      p.db.toLowerCase().includes(q) ||
      p.state.toLowerCase().includes(q) ||
      p.query.toLowerCase().includes(q)
    );
  });

  const fullDiskAlert = health?.disks.some((d) => d.usePercent >= 90);

  return (
    <div
      className="modal-backdrop"
      style={{ zIndex: 1350 }}
    >
      <div
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(1120px, 96vw)',
          minHeight: 540,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 9,
                background: 'rgba(56, 189, 248, 0.14)',
                border: '1px solid rgba(56, 189, 248, 0.35)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}
            >
              <Gauge size={18} color="#38bdf8" />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14.5 }}>
                MySQL Workbench Performance Dashboard &amp; Live Server Monitor
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2 }}>
                Grafik QPS / Traffic / InnoDB I/O, Buffer Pool Hit Ratio, Slow Digest SQL, Lock Waits, Storage, SSH Health &amp; Processlist
              </div>
            </div>
          </div>

          <button
            type="button"
            className="btn-modal-exit"
            onClick={() => setOpen(false)}
          >
            <X size={14} />
            <span>Keluar</span>
          </button>
        </div>

        {/* Navigation Tabs + Profile Selector */}
        <div className="modal-subbar">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              className={
                activeTab === 'mysql-dashboard' ? 'btn-primary btn-xs' : 'btn-secondary btn-xs'
              }
              onClick={() => setActiveTab('mysql-dashboard')}
            >
              <Gauge size={12} /> MySQL Performance Dashboard
            </button>
            <button
              className={
                activeTab === 'processlist' ? 'btn-primary btn-xs' : 'btn-secondary btn-xs'
              }
              onClick={() => setActiveTab('processlist')}
            >
              <Database size={12} /> DB Processlist &amp; Kill ({processes.length})
            </button>
            <button
              className={activeTab === 'health' ? 'btn-primary btn-xs' : 'btn-secondary btn-xs'}
              onClick={() => setActiveTab('health')}
            >
              <Server size={12} /> Kesehatan OS (SSH)
            </button>
            <button
              className={activeTab === 'crontab' ? 'btn-primary btn-xs' : 'btn-secondary btn-xs'}
              onClick={() => setActiveTab('crontab')}
            >
              <Clock size={12} /> Jadwal Crontab
            </button>
            <button
              className={activeTab === 'ssh-snippets' ? 'btn-primary btn-xs' : 'btn-secondary btn-xs'}
              onClick={() => setActiveTab('ssh-snippets')}
            >
              <Terminal size={12} /> SSH Snippets &amp; Multi-Exec
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {activeTab !== 'mysql-dashboard' && (
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  fontSize: 11,
                  color: 'var(--text-secondary)',
                  cursor: 'pointer'
                }}
              >
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                />
                Auto-Refresh (8d)
              </label>
            )}

            {activeTab === 'processlist' || activeTab === 'mysql-dashboard' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Database:</span>
              <select
                className="form-input"
                style={{ width: 'auto', height: 28, fontSize: 11.5, minWidth: 220, padding: '0 8px' }}
                value={targetDbId}
                onChange={(e) => setTargetDbId(e.target.value)}
              >
                <option value="">-- Pilih Profil Database --</option>
                {dbProfiles.map((db) => (
                  <option key={db.id} value={db.id}>
                    {db.isProduction ? '🔴 [PROD] ' : ''}
                    {db.name} ({db.engine.toUpperCase()} • {db.database || db.host})
                  </option>
                ))}
              </select>
              {activeTab === 'processlist' && (
                <button
                  className="btn-secondary btn-xs"
                  disabled={!targetDbId || procLoading}
                  onClick={() => void loadProcesses(targetDbId)}
                >
                  <RefreshCw size={12} className={procLoading ? 'spin' : ''} /> Segarkan
                </button>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Server SSH:</span>
              <select
                className="form-input"
                style={{ width: 'auto', height: 28, fontSize: 11.5, minWidth: 220, padding: '0 8px' }}
                value={targetConnId}
                onChange={(e) => setTargetConnId(e.target.value)}
              >
                <option value="">-- Pilih Koneksi SFTP / Server --</option>
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.isProduction ? '🔴 [PROD] ' : ''}
                    {c.name} ({c.protocol.toUpperCase()} • {c.host || 'lokal'})
                  </option>
                ))}
              </select>
              <button
                className="btn-secondary btn-xs"
                disabled={!targetConnId || healthLoading}
                onClick={() => void loadHealth(targetConnId)}
              >
                <RefreshCw size={12} className={healthLoading ? 'spin' : ''} /> Segarkan
              </button>
            </div>
            )}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>
          {activeTab === 'mysql-dashboard' && (
            <MysqlWorkbenchDashboardPanel targetDbId={targetDbId} />
          )}
          {activeTab === 'ssh-snippets' && (
            <SshSnippetsPanel
              connections={connections}
              initialConnectionId={targetConnId}
              onToast={showToast}
            />
          )}
          {activeTab === 'health' && (
            <>
              {!targetConnId && (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
                  Pilih atau tambahkan profil koneksi <strong>SFTP (SSH)</strong> untuk melihat
                  kesehatan server secara langsung.
                </div>
              )}
              {healthError && (
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    background: 'rgba(239, 68, 68, 0.12)',
                    border: '1px solid rgba(239, 68, 68, 0.35)',
                    color: '#fca5a5',
                    fontSize: 12,
                    marginBottom: 12
                  }}
                >
                  {healthError}
                </div>
              )}
              {health && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {fullDiskAlert && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '9px 12px',
                        borderRadius: 8,
                        background: 'rgba(239, 68, 68, 0.16)',
                        border: '1px solid rgba(239, 68, 68, 0.5)',
                        color: '#fecaca',
                        fontSize: 12,
                        fontWeight: 600
                      }}
                    >
                      <ShieldAlert size={16} />
                      PERINGATAN DISK HAMPIR PENUH (≥90%)! Partisi penuh dapat menyebabkan sesi
                      login PHP gagal &amp; tabel MySQL terkunci.
                    </div>
                  )}

                  {/* KPI Summary Grid */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
                      gap: 10
                    }}
                  >
                    <div
                      style={{
                        padding: 12,
                        borderRadius: 8,
                        background: 'var(--bg-elevated)',
                        border: '1px solid var(--border)'
                      }}
                    >
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        Hostname &amp; OS
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 700, marginTop: 3 }}>
                        {health.hostname}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                        {health.osInfo} • {health.latencyMs}ms
                      </div>
                    </div>

                    <div
                      style={{
                        padding: 12,
                        borderRadius: 8,
                        background: 'var(--bg-elevated)',
                        border: '1px solid var(--border)'
                      }}
                    >
                      <div
                        style={{
                          fontSize: 11,
                          color: 'var(--text-muted)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 5
                        }}
                      >
                        <Cpu size={12} /> CPU Cores &amp; Load Average
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 700, marginTop: 3 }}>
                        {health.cpuCores} Core • Load: {health.loadAvg}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                        Uptime: {health.uptimeText}
                      </div>
                    </div>

                    <div
                      style={{
                        padding: 12,
                        borderRadius: 8,
                        background: 'var(--bg-elevated)',
                        border: '1px solid var(--border)'
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontSize: 11,
                          color: 'var(--text-muted)'
                        }}
                      >
                        <span>Memori RAM</span>
                        <strong
                          style={{
                            color:
                              health.memUsedPercent >= 90
                                ? '#f87171'
                                : health.memUsedPercent >= 75
                                  ? '#fbbf24'
                                  : '#34d399'
                          }}
                        >
                          {health.memUsedPercent}%
                        </strong>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, marginTop: 3 }}>
                        {health.memUsedMb.toLocaleString()} /{' '}
                        {health.memTotalMb.toLocaleString()} MB
                      </div>
                      <div
                        style={{
                          marginTop: 6,
                          height: 6,
                          borderRadius: 999,
                          background: 'rgba(255,255,255,0.08)',
                          overflow: 'hidden'
                        }}
                      >
                        <div
                          style={{
                            width: `${Math.min(100, health.memUsedPercent)}%`,
                            height: '100%',
                            background:
                              health.memUsedPercent >= 90
                                ? '#ef4444'
                                : health.memUsedPercent >= 75
                                  ? '#f59e0b'
                                  : '#10b981'
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Services Status */}
                  <div>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        marginBottom: 6,
                        color: 'var(--text-secondary)'
                      }}
                    >
                      Status Layanan Utama (Web / PHP / Database / Cache)
                    </div>
                    {health.services.length === 0 ? (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        Tidak ada daemon standar terdeteksi atau akun SSH memiliki akses terbatas.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {health.services.map((svc) => (
                          <span
                            key={svc.name}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                              padding: '4px 10px',
                              borderRadius: 999,
                              fontSize: 11,
                              fontWeight: 600,
                              background: svc.active
                                ? 'rgba(16, 185, 129, 0.14)'
                                : 'rgba(239, 68, 68, 0.16)',
                              border: `1px solid ${
                                svc.active
                                  ? 'rgba(16, 185, 129, 0.4)'
                                  : 'rgba(239, 68, 68, 0.45)'
                              }`,
                              color: svc.active ? '#6ee7b7' : '#fca5a5'
                            }}
                          >
                            <span>{svc.active ? '●' : '✕'}</span>
                            <span>{svc.name}</span>
                            <button
                              type="button"
                              className="icon-btn"
                              style={{ padding: 2, marginLeft: 4 }}
                              title={`Reload service ${svc.name} (systemctl reload)`}
                              onClick={async () => {
                                if (!targetConnId) return;
                                const conn = connections.find((c) => c.id === targetConnId);
                                const ok = window.confirm(
                                  `Reload layanan "${svc.name}" di server ${conn?.isProduction ? '[PROD] ' : ''}${conn?.name || targetConnId}?`
                                );
                                if (!ok) return;
                                try {
                                  const cmd = buildServiceControlCommand(svc.name, 'reload');
                                  const res = await window.aptana.connections.runSshSnippetMulti(
                                    [targetConnId],
                                    cmd
                                  );
                                  const first = res[0];
                                  showToast(
                                    first?.ok
                                      ? `✅ Service ${svc.name} berhasil di-reload.`
                                      : `⚠️ Gagal reload ${svc.name}: ${first?.stderr || first?.stdout}`
                                  );
                                  void loadHealth(targetConnId);
                                } catch (err) {
                                  showToast(
                                    `Gagal kontrol service: ${err instanceof Error ? err.message : String(err)}`
                                  );
                                }
                              }}
                            >
                              <RefreshCw size={10} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Disk Partitions */}
                  <div>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        marginBottom: 6,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        color: 'var(--text-secondary)'
                      }}
                    >
                      <HardDrive size={13} /> Partisi Penyimpanan Disk (<code>df -h</code>)
                    </div>
                    {health.disks.length === 0 ? (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        Data partisi tidak tersedia pada koneksi ini.
                      </div>
                    ) : (
                      <div
                        style={{
                          border: '1px solid var(--border)',
                          borderRadius: 8,
                          overflow: 'hidden'
                        }}
                      >
                        <table
                          style={{
                            width: '100%',
                            borderCollapse: 'collapse',
                            fontSize: 12
                          }}
                        >
                          <thead>
                            <tr
                              style={{
                                background: 'var(--bg-elevated)',
                                textAlign: 'left',
                                color: 'var(--text-muted)'
                              }}
                            >
                              <th style={{ padding: '7px 10px' }}>Mount Point</th>
                              <th style={{ padding: '7px 10px' }}>Filesystem</th>
                              <th style={{ padding: '7px 10px' }}>Terpakai / Total</th>
                              <th style={{ padding: '7px 10px' }}>Sisa (Avail)</th>
                              <th style={{ padding: '7px 10px', width: 190 }}>Persentase</th>
                            </tr>
                          </thead>
                          <tbody>
                            {health.disks.map((d) => {
                              const barColor =
                                d.usePercent >= 90
                                  ? '#ef4444'
                                  : d.usePercent >= 80
                                    ? '#f59e0b'
                                    : '#10b981';
                              return (
                                <tr
                                  key={`${d.filesystem}-${d.mountPoint}`}
                                  style={{ borderTop: '1px solid var(--border)' }}
                                >
                                  <td style={{ padding: '7px 10px', fontWeight: 600 }}>
                                    <code>{d.mountPoint}</code>
                                  </td>
                                  <td
                                    style={{
                                      padding: '7px 10px',
                                      color: 'var(--text-muted)',
                                      fontFamily: 'var(--font-mono)',
                                      fontSize: 11
                                    }}
                                  >
                                    {d.filesystem}
                                  </td>
                                  <td style={{ padding: '7px 10px' }}>
                                    {d.used} / {d.size}
                                  </td>
                                  <td style={{ padding: '7px 10px', fontWeight: 600 }}>
                                    {d.avail}
                                  </td>
                                  <td style={{ padding: '7px 10px' }}>
                                    <div
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 8
                                      }}
                                    >
                                      <div
                                        style={{
                                          flex: 1,
                                          height: 7,
                                          borderRadius: 999,
                                          background: 'rgba(255,255,255,0.08)',
                                          overflow: 'hidden'
                                        }}
                                      >
                                        <div
                                          style={{
                                            width: `${Math.min(100, d.usePercent)}%`,
                                            height: '100%',
                                            background: barColor
                                          }}
                                        />
                                      </div>
                                      <span
                                        style={{
                                          fontSize: 11,
                                          fontWeight: 700,
                                          minWidth: 36,
                                          color: barColor
                                        }}
                                      >
                                        {d.usePercent}%
                                      </span>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {activeTab === 'processlist' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Cari PID, User, Database, State, atau potongan SQL..."
                  value={procFilter}
                  onChange={(e) => setProcFilter(e.target.value)}
                  style={{ flex: 1, height: 30, fontSize: 12 }}
                />
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  Menampilkan {filteredProcs.length} koneksi aktif
                </span>
              </div>

              {procError && (
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    background: 'rgba(239, 68, 68, 0.12)',
                    border: '1px solid rgba(239, 68, 68, 0.35)',
                    color: '#fca5a5',
                    fontSize: 12
                  }}
                >
                  {procError}
                </div>
              )}

              <div
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  overflow: 'auto',
                  maxHeight: '56vh'
                }}
              >
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr
                      style={{
                        background: 'var(--bg-elevated)',
                        textAlign: 'left',
                        color: 'var(--text-muted)'
                      }}
                    >
                      <th style={{ padding: '7px 10px' }}>PID</th>
                      <th style={{ padding: '7px 10px' }}>User / Host</th>
                      <th style={{ padding: '7px 10px' }}>DB</th>
                      <th style={{ padding: '7px 10px' }}>Durasi</th>
                      <th style={{ padding: '7px 10px' }}>Command / State</th>
                      <th style={{ padding: '7px 10px' }}>SQL Aktif</th>
                      <th style={{ padding: '7px 10px', textAlign: 'right' }}>Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProcs.length === 0 ? (
                      <tr>
                        <td
                          colSpan={7}
                          style={{
                            padding: 20,
                            textAlign: 'center',
                            color: 'var(--text-muted)'
                          }}
                        >
                          {targetDbId
                            ? 'Tidak ada proses query yang cocok.'
                            : 'Pilih profil Database di atas terlebih dahulu.'}
                        </td>
                      </tr>
                    ) : (
                      filteredProcs.map((p) => {
                        const isSlow = p.timeSec >= 10 && p.command.toLowerCase() !== 'sleep';
                        return (
                          <tr
                            key={String(p.id)}
                            style={{
                              borderTop: '1px solid var(--border)',
                              background: isSlow ? 'rgba(239, 68, 68, 0.08)' : undefined
                            }}
                          >
                            <td
                              style={{
                                padding: '7px 10px',
                                fontFamily: 'var(--font-mono)',
                                fontWeight: 700
                              }}
                            >
                              #{p.id}
                            </td>
                            <td style={{ padding: '7px 10px' }}>
                              <div style={{ fontWeight: 600 }}>{p.user}</div>
                              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                                {p.host}
                              </div>
                            </td>
                            <td style={{ padding: '7px 10px' }}>{p.db || '-'}</td>
                            <td
                              style={{
                                padding: '7px 10px',
                                fontWeight: 700,
                                color: isSlow
                                  ? '#f87171'
                                  : p.timeSec >= 3 && p.command.toLowerCase() !== 'sleep'
                                    ? '#fbbf24'
                                    : 'var(--text-primary)'
                              }}
                            >
                              {p.timeSec}s
                            </td>
                            <td style={{ padding: '7px 10px' }}>
                              <span style={{ fontWeight: 600 }}>{p.command}</span>
                              {p.state ? (
                                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                                  {p.state}
                                </div>
                              ) : null}
                            </td>
                            <td
                              style={{
                                padding: '7px 10px',
                                fontFamily: 'var(--font-mono)',
                                fontSize: 11,
                                maxWidth: 360,
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word'
                              }}
                            >
                              {p.query || <span style={{ color: 'var(--text-muted)' }}>(idle)</span>}
                            </td>
                            <td style={{ padding: '7px 10px', textAlign: 'right' }}>
                              <button
                                className="btn-secondary btn-xs"
                                disabled={killingPid === p.id}
                                onClick={() => void handleKillQuery(p)}
                                style={{
                                  color: '#fca5a5',
                                  borderColor: 'rgba(239, 68, 68, 0.4)'
                                }}
                                title={`Hentikan paksa proses #${p.id}`}
                              >
                                <Skull size={11} /> Kill
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'crontab' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
              >
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>
                  Isi <code>crontab -l</code> pada Server ({health?.hostname || '-'})
                </span>
                {health?.crontabText && (
                  <button
                    className="btn-secondary btn-xs"
                    onClick={() => {
                      void navigator.clipboard.writeText(health.crontabText);
                      showToast('Isi Crontab disalin ke clipboard.');
                    }}
                  >
                    <Copy size={11} /> Salin Crontab
                  </button>
                )}
              </div>
              <pre
                style={{
                  margin: 0,
                  padding: 12,
                  borderRadius: 8,
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                  lineHeight: 1.55,
                  whiteSpace: 'pre-wrap',
                  maxHeight: '55vh',
                  overflow: 'auto'
                }}
              >
                {health?.crontabText ||
                  (healthLoading
                    ? 'Memuat crontab dari server SSH...'
                    : '(Pilih koneksi SFTP untuk membaca crontab)')}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
