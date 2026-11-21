import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  KeyRound,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
  Users,
  X
} from 'lucide-react';
import {
  buildRbacGrantSqlStatements,
  DB_PRIVILEGE_PRESETS,
  type DbRbacSnapshot
} from '@shared/dbRbacAnalyzer';
import { useIdeStore } from '../store/useIdeStore';

const ALL_PRIV_OPTIONS = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'CREATE',
  'ALTER',
  'DROP',
  'INDEX',
  'CREATE VIEW',
  'EXECUTE',
  'ALL PRIVILEGES'
];

function generateStrongPassword(len = 16): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*';
  let out = '';
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export const DbRbacModal: React.FC = () => {
  const {
    dbRbacModalOpen,
    setDbRbacModalOpen,
    dbProfiles,
    selectedDbProfileId,
    dbSchema,
    showToast
  } = useIdeStore();

  const [profileId, setProfileId] = useState<string>('');
  const [subTab, setSubTab] = useState<'users' | 'grant' | 'audit'>('users');
  const [snapshot, setSnapshot] = useState<DbRbacSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedUserIdx, setSelectedUserIdx] = useState(0);

  // Create / Grant form state
  const [username, setUsername] = useState('auditor_spbe');
  const [host, setHost] = useState('%');
  const [password, setPassword] = useState('');
  const [database, setDatabase] = useState('*');
  const [table, setTable] = useState('*');
  const [privileges, setPrivileges] = useState<string[]>(['SELECT']);
  const [withGrantOption, setWithGrantOption] = useState(false);
  const [createUserIfNotExists, setCreateUserIfNotExists] = useState(true);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!dbRbacModalOpen) return;
    const initialId = selectedDbProfileId || dbProfiles[0]?.id || '';
    setProfileId(initialId);
    if (dbSchema?.currentDatabase) {
      setDatabase(dbSchema.currentDatabase);
    }
  }, [dbRbacModalOpen, selectedDbProfileId, dbProfiles, dbSchema?.currentDatabase]);

  const activeProfile = useMemo(
    () => dbProfiles.find((p) => p.id === profileId) ?? null,
    [dbProfiles, profileId]
  );

  const loadRbac = async (id: string) => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const snap = await window.aptana.db.listUsersRbac(id);
      setSnapshot(snap);
      setSelectedUserIdx(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (dbRbacModalOpen && profileId) {
      void loadRbac(profileId);
    }
  }, [dbRbacModalOpen, profileId]);

  const previewStatements = useMemo(() => {
    if (!activeProfile) return [];
    try {
      return buildRbacGrantSqlStatements(
        {
          username: username || 'user_baru',
          host,
          password,
          database,
          table,
          privileges,
          withGrantOption,
          createUserIfNotExists
        },
        activeProfile.engine
      );
    } catch {
      return [];
    }
  }, [
    activeProfile,
    username,
    host,
    password,
    database,
    table,
    privileges,
    withGrantOption,
    createUserIfNotExists
  ]);

  if (!dbRbacModalOpen) return null;

  const criticalCount = snapshot?.findings.filter((f) => f.severity === 'critical').length ?? 0;
  const warnCount = snapshot?.findings.filter((f) => f.severity === 'warn').length ?? 0;
  const selectedUser = snapshot?.users[selectedUserIdx] ?? null;

  const togglePrivilege = (priv: string) => {
    setPrivileges((prev) => {
      if (priv === 'ALL PRIVILEGES') {
        return prev.includes('ALL PRIVILEGES') ? ['SELECT'] : ['ALL PRIVILEGES'];
      }
      const withoutAll = prev.filter((p) => p !== 'ALL PRIVILEGES');
      return withoutAll.includes(priv)
        ? withoutAll.filter((p) => p !== priv)
        : [...withoutAll, priv];
    });
  };

  const handleApplySql = async () => {
    if (!profileId || previewStatements.length === 0) return;
    setApplying(true);
    try {
      const res = await window.aptana.db.applyRbacSql(profileId, previewStatements);
      showToast(`✅ ${res.message}`);
      await loadRbac(profileId);
      setSubTab('users');
    } catch (err) {
      showToast(`Gagal menerapkan hak akses: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div
        className="modal-card"
        style={{
          width: 'min(1000px, 95vw)',
          minHeight: 500,
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 9,
                background: 'rgba(168, 85, 247, 0.14)',
                border: '1px solid rgba(192, 132, 252, 0.35)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}
            >
              <Users size={18} color="#c084fc" />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--text-primary)' }}>
                User, Role &amp; Privileges Manager (RBAC + Audit Keamanan)
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2 }}>
                Kelola akun MySQL/PostgreSQL, buat akun Read-Only Auditor SPBE dalam 3 klik, &amp; deteksi akun berbahaya (root@%, password kosong)
              </div>
            </div>
          </div>

          <button
            type="button"
            className="btn-modal-exit"
            onClick={() => setDbRbacModalOpen(false)}
            title="Keluar / Tutup Jendela"
          >
            <X size={14} />
            <span>Keluar</span>
          </button>
        </div>

        {/* Sub-Toolbar: Navigation Tabs + DB Selector */}
        <div className="modal-subbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`btn btn-xs ${subTab === 'users' ? 'btn-primary' : ''}`}
              onClick={() => setSubTab('users')}
            >
              <Users size={12} /> Daftar User ({snapshot?.users.length ?? 0})
            </button>
            <button
              type="button"
              className={`btn btn-xs ${subTab === 'grant' ? 'btn-primary' : ''}`}
              onClick={() => setSubTab('grant')}
            >
              <UserPlus size={12} /> Buat User &amp; Matriks Hak Akses
            </button>
            <button
              type="button"
              className={`btn btn-xs ${subTab === 'audit' ? 'btn-primary' : ''}`}
              onClick={() => setSubTab('audit')}
            >
              <ShieldAlert size={12} color={criticalCount > 0 ? '#f87171' : '#34d399'} /> Audit
              Keamanan ({criticalCount} Kritis • {warnCount} Peringatan)
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <select
              className="form-input"
              style={{ width: 'auto', height: 28, fontSize: 11.5, padding: '0 8px' }}
              value={profileId}
              onChange={(e) => setProfileId(e.target.value)}
            >
              {dbProfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.isProduction ? '🔴 ' : ''}
                  {p.name} ({p.engine.toUpperCase()})
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-xs"
              disabled={loading || !profileId}
              onClick={() => void loadRbac(profileId)}
            >
              <RefreshCw size={11} className={loading ? 'spin' : ''} /> Segarkan
            </button>
          </div>
        </div>

        <div className="modal-body">
          {error && (
            <div style={{ padding: 10, borderRadius: 7, background: 'rgba(239,68,68,0.14)', color: '#fca5a5', fontSize: 12 }}>
              {error}
            </div>
          )}

          {loading ? (
            <div style={{ padding: 28, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12.5 }}>
              ⏳ Memuat daftar user &amp; hak akses dari server database...
            </div>
          ) : subTab === 'users' && snapshot ? (
            <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 12, minHeight: 330, flex: 1 }}>
              {/* Left User List */}
              <div
                style={{
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 8,
                  overflowY: 'auto',
                  background: 'var(--bg-app)',
                  padding: 6,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4
                }}
              >
                {snapshot.users.map((u, idx) => (
                  <div
                    key={`${u.username}@${u.host}-${idx}`}
                    onClick={() => setSelectedUserIdx(idx)}
                    style={{
                      padding: '7px 9px',
                      borderRadius: 6,
                      cursor: 'pointer',
                      background: idx === selectedUserIdx ? 'rgba(56, 189, 248, 0.14)' : 'var(--bg-surface)',
                      border:
                        idx === selectedUserIdx
                          ? '1px solid rgba(56, 189, 248, 0.45)'
                          : '1px solid var(--border-subtle)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 6
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {u.username || '(anonim)'}
                        {snapshot.engine === 'mysql' && (
                          <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>@{u.host}</span>
                        )}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                        {u.isSuperuser ? '👑 SUPERUSER' : 'Standard'}
                        {u.hasEmptyPassword ? ' • ⚠️ Tanpa Password' : ''}
                        {u.accountLocked ? ' • 🔒 Terkunci' : ''}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Right Selected User Grants */}
              <div
                style={{
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 8,
                  padding: 12,
                  background: 'var(--bg-app)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10
                }}
              >
                {selectedUser ? (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ fontSize: 13.5, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                          {snapshot.engine === 'mysql'
                            ? `'${selectedUser.username}'@'${selectedUser.host}'`
                            : selectedUser.username}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                          Plugin: <code>{selectedUser.plugin || 'default'}</code> • Grant Option:{' '}
                          <strong>{selectedUser.hasGrantOption ? 'Ya' : 'Tidak'}</strong>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-xs"
                        onClick={() => {
                          setUsername(selectedUser.username);
                          setHost(selectedUser.host);
                          setCreateUserIfNotExists(false);
                          setSubTab('grant');
                        }}
                      >
                        <KeyRound size={11} /> Tambah Hak Akses (GRANT)
                      </button>
                    </div>

                    <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)' }}>
                      Daftar Hak Akses Aktif (SHOW GRANTS):
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto' }}>
                      {selectedUser.grants.length === 0 ? (
                        <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                          Tidak ada detail GRANT yang dapat dibaca (butuh hak akses admin/SELECT pada mysql.user).
                        </div>
                      ) : (
                        selectedUser.grants.map((g, i) => (
                          <pre
                            key={i}
                            style={{
                              margin: 0,
                              padding: '7px 9px',
                              borderRadius: 6,
                              background: 'var(--bg-surface)',
                              border: '1px solid var(--border-subtle)',
                              fontFamily: 'var(--font-mono)',
                              fontSize: 11,
                              whiteSpace: 'pre-wrap'
                            }}
                          >
                            {g}
                          </pre>
                        ))
                      )}
                    </div>
                  </>
                ) : (
                  <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                    Pilih salah satu akun di sebelah kiri.
                  </div>
                )}
              </div>
            </div>
          ) : subTab === 'grant' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Quick Preset Bar */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
                {DB_PRIVILEGE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className="btn"
                    style={{
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      padding: '8px 10px',
                      height: 'auto',
                      textAlign: 'left'
                    }}
                    onClick={() => setPrivileges([...preset.privileges])}
                  >
                    <strong style={{ fontSize: 11.5, color: 'var(--accent)' }}>{preset.label}</strong>
                    <span style={{ fontSize: 10.5, color: 'var(--text-muted)', fontWeight: 400, whiteSpace: 'normal' }}>
                      {preset.description}
                    </span>
                  </button>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 0.7fr 1.2fr 1fr 0.8fr', gap: 8 }}>
                <div>
                  <label className="form-label">Username</label>
                  <input className="form-input" value={username} onChange={(e) => setUsername(e.target.value)} />
                </div>
                <div>
                  <label className="form-label">Host IP</label>
                  <input
                    className="form-input"
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    placeholder="localhost / %"
                    disabled={activeProfile?.engine === 'postgres'}
                  />
                </div>
                <div>
                  <label className="form-label">Password</label>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <input
                      className="form-input"
                      type="text"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Kosongkan jika user sudah ada"
                    />
                    <button
                      type="button"
                      className="btn btn-xs"
                      title="Buat password kuat acak 16 karakter"
                      onClick={() => setPassword(generateStrongPassword(16))}
                    >
                      🎲
                    </button>
                  </div>
                </div>
                <div>
                  <label className="form-label">Database (* = semua)</label>
                  <input className="form-input" value={database} onChange={(e) => setDatabase(e.target.value)} />
                </div>
                <div>
                  <label className="form-label">Tabel (* = semua)</label>
                  <input className="form-input" value={table} onChange={(e) => setTable(e.target.value)} />
                </div>
              </div>

              <div>
                <label className="form-label">Matriks Hak Akses (Centang Hak yang Diberikan)</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {ALL_PRIV_OPTIONS.map((priv) => {
                    const active = privileges.includes(priv);
                    return (
                      <button
                        key={priv}
                        type="button"
                        className={`btn btn-xs ${active ? 'btn-primary' : ''}`}
                        onClick={() => togglePrivilege(priv)}
                      >
                        {active && <Check size={11} />} {priv}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 16, fontSize: 11.5 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={createUserIfNotExists}
                    onChange={(e) => setCreateUserIfNotExists(e.target.checked)}
                  />
                  Sertakan <code>CREATE USER IF NOT EXISTS</code>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={withGrantOption}
                    onChange={(e) => setWithGrantOption(e.target.checked)}
                  />
                  Tambahkan <code>WITH GRANT OPTION</code>
                </label>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <label className="form-label" style={{ margin: 0 }}>
                    Pratinjau SQL yang Akan Dijalankan:
                  </label>
                  <button
                    type="button"
                    className="btn btn-xs"
                    onClick={() => {
                      void navigator.clipboard?.writeText(previewStatements.join('\n'));
                      showToast('SQL RBAC disalin ke clipboard.');
                    }}
                  >
                    <Copy size={11} /> Salin SQL
                  </button>
                </div>
                <pre
                  style={{
                    margin: 0,
                    padding: 10,
                    borderRadius: 7,
                    background: 'var(--bg-app)',
                    border: '1px solid var(--border-subtle)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11.5,
                    whiteSpace: 'pre-wrap'
                  }}
                >
                  {previewStatements.join('\n') || '-- Lengkapi form di atas --'}
                </pre>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={applying || previewStatements.length === 0}
                  onClick={() => void handleApplySql()}
                >
                  <Play size={13} />
                  <span>{applying ? 'Menerapkan...' : 'Terapkan Hak Akses ke Server'}</span>
                </button>
              </div>
            </div>
          ) : snapshot ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {snapshot.findings.map((f) => {
                const isCrit = f.severity === 'critical';
                const isWarn = f.severity === 'warn';
                return (
                  <div
                    key={f.id}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 8,
                      background: isCrit
                        ? 'rgba(239, 68, 68, 0.12)'
                        : isWarn
                          ? 'rgba(245, 158, 11, 0.1)'
                          : 'rgba(16, 185, 129, 0.1)',
                      border: `1px solid ${
                        isCrit
                          ? 'rgba(248, 113, 113, 0.45)'
                          : isWarn
                            ? 'rgba(251, 191, 36, 0.4)'
                            : 'rgba(52, 211, 153, 0.4)'
                      }`,
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10
                    }}
                  >
                    {isCrit ? (
                      <ShieldAlert size={16} color="#f87171" style={{ flexShrink: 0, marginTop: 2 }} />
                    ) : isWarn ? (
                      <AlertTriangle size={16} color="#fbbf24" style={{ flexShrink: 0, marginTop: 2 }} />
                    ) : (
                      <ShieldCheck size={16} color="#34d399" style={{ flexShrink: 0, marginTop: 2 }} />
                    )}
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 700 }}>{f.title}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 3 }}>
                        Rekomendasi: {f.recommendation}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};
