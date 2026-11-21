import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Code2,
  ExternalLink,
  FileWarning,
  FolderOpen,
  KeyRound,
  Play,
  RefreshCw,
  Server,
  ShieldAlert,
  X
} from 'lucide-react';
import type {
  ProjectSecurityFinding,
  ProjectSecurityScanReport,
  SecurityIssueCategory
} from '@shared/projectSecurityScanner';
import { useIdeStore } from '../store/useIdeStore';

export const EnterpriseScannerModal: React.FC = () => {
  const {
    securityScannerModalOpen,
    setSecurityScannerModalOpen,
    workspacePath,
    connections,
    selectedConnectionId,
    openFileInTab,
    openRemoteFileInTab,
    showToast
  } = useIdeStore();

  const [scope, setScope] = useState<'local' | 'remote'>(
    workspacePath ? 'local' : 'remote'
  );
  const [connId, setConnId] = useState<string>(selectedConnectionId || connections[0]?.id || '');
  const [scanning, setScanning] = useState(false);
  const [report, setReport] = useState<ProjectSecurityScanReport | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<'all' | SecurityIssueCategory>('all');

  useEffect(() => {
    if (securityScannerModalOpen) {
      if (!connId && (selectedConnectionId || connections[0]?.id)) {
        setConnId(selectedConnectionId || connections[0]?.id || '');
      }
      if (!workspacePath && connections.length > 0) {
        setScope('remote');
      }
    }
  }, [securityScannerModalOpen, connId, selectedConnectionId, connections, workspacePath]);

  const handleRunScan = async (): Promise<void> => {
    const targetConnId = connId || selectedConnectionId || connections[0]?.id;
    if (scope === 'local' && !workspacePath) {
      showToast('Buka folder proyek lokal terlebih dahulu atau pilih mode Server Remote (SFTP).');
      return;
    }
    if (scope === 'remote' && !targetConnId) {
      showToast('Pilih koneksi SFTP/FTP terlebih dahulu.');
      return;
    }
    setScanning(true);
    try {
      const res = await window.aptana.security.scanProject({
        scope,
        workspacePath: workspacePath || undefined,
        connectionId: targetConnId,
        maxFiles: 300
      });
      setReport(res);
    } catch (err) {
      showToast(`Gagal memindai keamanan proyek: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setScanning(false);
    }
  };

  const filteredFindings = useMemo(() => {
    if (!report) return [];
    if (categoryFilter === 'all') return report.findings;
    return report.findings.filter((f) => f.category === categoryFilter);
  }, [report, categoryFilter]);

  const handleJumpToFinding = async (f: ProjectSecurityFinding): Promise<void> => {
    const targetConnId = connId || selectedConnectionId || connections[0]?.id;
    setSecurityScannerModalOpen(false);
    if (scope === 'remote' && targetConnId) {
      await openRemoteFileInTab(targetConnId, f.relativePath, f.line);
      return;
    }
    if (workspacePath) {
      const sep = workspacePath.includes('\\') ? '\\' : '/';
      const fullPath = `${workspacePath.replace(/[/\\]+$/, '')}${sep}${f.relativePath.replace(/\//g, sep)}`;
      await openFileInTab(fullPath, f.relativePath, f.line);
    }
  };

  if (!securityScannerModalOpen) return null;

  const sevColor = (sev: ProjectSecurityFinding['severity']): string => {
    if (sev === 'critical') return '#ef4444';
    if (sev === 'high') return '#f97316';
    if (sev === 'medium') return '#eab308';
    return '#38bdf8';
  };

  return (
    <div className="modal-backdrop">
      <div
        className="modal-card"
        style={{
          width: 'min(1000px, 95vw)',
          minHeight: 480,
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {/* Header with generous inset padding & icon badge */}
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 9,
                background: 'rgba(239, 68, 68, 0.14)',
                border: '1px solid rgba(248, 113, 113, 0.35)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}
            >
              <ShieldAlert size={18} color="#f87171" />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--text-primary)' }}>
                Enterprise Security, PHP 8 Compatibility &amp; Broken-Include Scanner
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2 }}>
                Audit statis offline (0 kuota AI): SQL Injection, XSS, Hardcoded Key, Fungsi PHP 8 Dihapus, &amp; Include File Hilang
              </div>
            </div>
          </div>

          <button
            type="button"
            className="btn-modal-exit"
            onClick={() => setSecurityScannerModalOpen(false)}
            title="Keluar / Tutup Jendela"
          >
            <X size={14} />
            <span>Keluar</span>
          </button>
        </div>

        {/* Single-Row Aligned Target & Action Toolbar */}
        <div
          style={{
            padding: '12px 18px',
            borderBottom: '1px solid var(--border-subtle)',
            background: 'var(--bg-app)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', flex: '1 1 auto' }}>
            {/* Segmented Mode Toggle */}
            <div
              style={{
                display: 'inline-flex',
                padding: 3,
                borderRadius: 8,
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                gap: 3
              }}
            >
              <button
                type="button"
                className={`btn ${scope === 'local' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ padding: '5px 11px', fontSize: 12, borderRadius: 6 }}
                onClick={() => setScope('local')}
              >
                <FolderOpen size={13} />
                <span>Proyek Lokal</span>
              </button>
              <button
                type="button"
                className={`btn ${scope === 'remote' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ padding: '5px 11px', fontSize: 12, borderRadius: 6 }}
                onClick={() => setScope('remote')}
              >
                <Server size={13} />
                <span>Server Remote (SFTP)</span>
              </button>
            </div>

            {scope === 'remote' ? (
              <select
                className="form-input"
                style={{
                  width: 'auto',
                  minWidth: 235,
                  maxWidth: 320,
                  height: 34,
                  padding: '5px 10px',
                  fontSize: 12.5,
                  background: 'var(--bg-surface)'
                }}
                value={connId || selectedConnectionId || ''}
                onChange={(e) => setConnId(e.target.value)}
              >
                <option value="">-- Pilih Server SFTP/FTP --</option>
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    [{c.protocol.toUpperCase()}] {c.name}
                  </option>
                ))}
              </select>
            ) : (
              <div
                style={{
                  fontSize: 12,
                  color: workspacePath ? 'var(--text-secondary)' : '#fca5a5',
                  padding: '6px 10px',
                  borderRadius: 6,
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  maxWidth: 360,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
                title={workspacePath || 'Belum ada folder lokal dibuka'}
              >
                {workspacePath || 'Folder proyek lokal belum dibuka'}
              </div>
            )}
          </div>

          <button
            type="button"
            className="btn btn-primary"
            style={{ padding: '7px 14px', fontSize: 12.5, height: 34 }}
            disabled={scanning}
            onClick={() => void handleRunScan()}
          >
            {scanning ? <RefreshCw size={14} className="spin" /> : <Play size={14} />}
            <span>{scanning ? 'Memindai Kode Sumber...' : 'Mulai Audit Keamanan & Kesehatan'}</span>
          </button>
        </div>

        {/* Summary & Category Filter Bar */}
        {report && (
          <div
            style={{
              padding: '10px 18px',
              borderBottom: '1px solid var(--border-subtle)',
              background: 'var(--bg-surface)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 10
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 11.5 }}>
              <span style={{ padding: '3px 10px', borderRadius: 999, background: 'rgba(239, 68, 68, 0.18)', border: '1px solid rgba(239, 68, 68, 0.35)', color: '#fca5a5', fontWeight: 700 }}>
                Kritis: {report.counts.critical}
              </span>
              <span style={{ padding: '3px 10px', borderRadius: 999, background: 'rgba(249, 115, 22, 0.18)', border: '1px solid rgba(249, 115, 22, 0.35)', color: '#fdba74', fontWeight: 700 }}>
                Tinggi: {report.counts.high}
              </span>
              <span style={{ padding: '3px 10px', borderRadius: 999, background: 'rgba(234, 179, 8, 0.18)', border: '1px solid rgba(234, 179, 8, 0.35)', color: '#fde047', fontWeight: 700 }}>
                Sedang: {report.counts.medium}
              </span>
              <span style={{ padding: '3px 10px', borderRadius: 999, background: 'rgba(56, 189, 248, 0.15)', border: '1px solid rgba(56, 189, 248, 0.32)', color: '#7dd3fc', fontWeight: 700 }}>
                Info PHP 8: {report.counts.info}
              </span>
              <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>
                • {report.scannedFiles} file dipindai ({report.durationMs} ms)
              </span>
            </div>

            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {(
                [
                  ['all', 'Semua'],
                  ['sql-injection', 'SQL Injection'],
                  ['broken-include', 'Broken Include'],
                  ['xss', 'XSS'],
                  ['secret-leak', 'Kredensial'],
                  ['php8-compat', 'PHP 8']
                ] as Array<['all' | SecurityIssueCategory, string]>
              ).map(([cat, label]) => (
                <button
                  key={cat}
                  type="button"
                  className={`btn ${categoryFilter === cat ? 'btn-primary' : ''}`}
                  style={{ padding: '3px 9px', fontSize: 11.5 }}
                  onClick={() => setCategoryFilter(cat)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Main Content Area */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 18,
            display: 'flex',
            flexDirection: 'column',
            gap: 10
          }}
        >
          {scanning && (
            <div
              style={{
                flex: 1,
                minHeight: 240,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 12,
                color: 'var(--text-secondary)'
              }}
            >
              <RefreshCw size={26} className="spin" color="#38bdf8" />
              <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--text-primary)' }}>
                Sedang memindai kode sumber {scope === 'remote' ? 'melalui jalur batch SSH/SFTP' : 'di folder proyek lokal'}...
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Memeriksa pola SQL Injection, XSS, kredensial bocor, include hilang, dan kompatibilitas PHP 8
              </div>
            </div>
          )}

          {!report && !scanning && (
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                gap: 16,
                padding: '8px 4px'
              }}
            >
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
                  Siap Memindai Keamanan &amp; Kesehatan Kode ({scope === 'remote' ? 'Server Remote SFTP' : 'Proyek Lokal'})
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  Klik tombol <strong>Mulai Audit Keamanan &amp; Kesehatan</strong> di kanan atas untuk memeriksa 5 kategori risiko sekaligus tanpa kuota AI:
                </div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))',
                  gap: 10
                }}
              >
                {[
                  {
                    icon: <AlertOctagon size={16} color="#f87171" />,
                    title: 'SQL Injection',
                    desc: 'Deteksi interpolasi mentah $_GET / $_POST / $_REQUEST di dalam kueri SQL.'
                  },
                  {
                    icon: <FileWarning size={16} color="#fb923c" />,
                    title: 'Broken Include',
                    desc: 'Lacak require / include_once yang merujuk ke file PHP yang tidak ada.'
                  },
                  {
                    icon: <AlertTriangle size={16} color="#facc15" />,
                    title: 'Reflected XSS',
                    desc: 'Deteksi echo / print variabel input HTTP tanpa htmlspecialchars().'
                  },
                  {
                    icon: <KeyRound size={16} color="#f43f5e" />,
                    title: 'Secret & API Key',
                    desc: 'Temukan Private Key SSH/RSA atau API Key yang tertanam di kode sumber.'
                  },
                  {
                    icon: <Code2 size={16} color="#38bdf8" />,
                    title: 'Migrasi PHP 8',
                    desc: 'Tandai fungsi usang (mysql_*, ereg, split, create_function) yang dihapus di PHP 8.'
                  }
                ].map((card) => (
                  <div
                    key={card.title}
                    style={{
                      padding: '12px 13px',
                      borderRadius: 9,
                      background: 'var(--bg-app)',
                      border: '1px solid var(--border-subtle)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 700, fontSize: 12.5 }}>
                      {card.icon}
                      <span>{card.title}</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                      {card.desc}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {report && !scanning && filteredFindings.length === 0 && (
            <div
              style={{
                flex: 1,
                minHeight: 220,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8
              }}
            >
              <CheckCircle2 size={32} color="#34d399" />
              <div style={{ color: '#6ee7b7', fontWeight: 700, fontSize: 14 }}>
                Bersih! Tidak ditemukan temuan berisiko pada kategori ini.
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {report.scannedFiles} file telah diperiksa dalam {report.durationMs} ms.
              </div>
            </div>
          )}

          {!scanning &&
            filteredFindings.map((f) => (
              <div
                key={f.id}
                style={{
                  padding: '11px 14px',
                  borderRadius: 8,
                  background: 'var(--bg-app)',
                  borderLeft: `3px solid ${sevColor(f.severity)}`,
                  borderTop: '1px solid var(--border-subtle)',
                  borderRight: '1px solid var(--border-subtle)',
                  borderBottom: '1px solid var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                    {f.severity === 'critical' ? (
                      <AlertOctagon size={14} color="#ef4444" />
                    ) : (
                      <AlertTriangle size={14} color={sevColor(f.severity)} />
                    )}
                    <span style={{ fontWeight: 700, fontSize: 12.5 }}>{f.title}</span>
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 11.5,
                        padding: '1px 7px',
                        borderRadius: 5,
                        background: 'rgba(56, 189, 248, 0.12)',
                        color: '#7dd3fc'
                      }}
                    >
                      {f.relativePath}:{f.line}
                    </span>
                  </div>

                  <button
                    type="button"
                    className="btn"
                    style={{ padding: '4px 10px', fontSize: 11.5 }}
                    onClick={() => void handleJumpToFinding(f)}
                  >
                    <ExternalLink size={12} /> Lompat ke Baris {f.line}
                  </button>
                </div>

                <code
                  style={{
                    padding: '6px 10px',
                    borderRadius: 6,
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-subtle)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11.5,
                    color: '#fde68a',
                    overflowX: 'auto'
                  }}
                >
                  {f.snippet}
                </code>

                <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                  💡 <strong>Saran Perbaikan:</strong> {f.recommendation}
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
};
