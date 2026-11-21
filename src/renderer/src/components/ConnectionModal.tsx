import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  Pencil,
  PlugZap,
  Plus,
  Server,
  ShieldCheck,
  Trash2,
  X
} from 'lucide-react';
import type {
  ConnectionAuthType,
  ConnectionProfile,
  ConnectionProtocol
} from '@shared/types';
import { useIdeStore } from '../store/useIdeStore';

const DEFAULT_IGNORES = ['.git', 'node_modules', '*.log', '.DS_Store'];

export const ConnectionModal: React.FC = () => {
  const {
    connectionModalOpen,
    editingConnection,
    openConnectionModal,
    closeConnectionModal,
    connections,
    selectedConnectionId,
    remoteSubPath,
    browseRemoteDir,
    refreshConnections,
    selectConnection,
    showToast
  } = useIdeStore();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [hasSavedSecret, setHasSavedSecret] = useState(false);
  const [name, setName] = useState('Server Baru');
  const [protocol, setProtocol] = useState<ConnectionProtocol>('sftp');
  const [host, setHost] = useState('');
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState('');
  const [remotePath, setRemotePath] = useState('/var/www/html');
  const [authType, setAuthType] = useState<ConnectionAuthType>('password');
  const [privateKeyPath, setPrivateKeyPath] = useState('');
  const [password, setPassword] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passive, setPassive] = useState(true);
  const [rejectUnauthorized, setRejectUnauthorized] = useState(false);
  const [keepSynchronized, setKeepSynchronized] = useState(false);
  const [isProduction, setIsProduction] = useState(false);
  const [ignoreText, setIgnoreText] = useState(DEFAULT_IGNORES.join(', '));
  const [testFeedback, setTestFeedback] = useState<{
    ok: boolean | null;
    text: string;
  } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadFormFromProfile = (conn: ConnectionProfile | null): void => {
    if (conn) {
      setEditingId(conn.id);
      setHasSavedSecret(Boolean(conn.hasSavedSecret));
      setName(conn.name);
      setProtocol(conn.protocol);
      setHost(conn.protocol === 'local' && conn.host === 'localhost' ? '' : conn.host);
      setPort(conn.port || (conn.protocol === 'sftp' ? 22 : 21));
      setUsername(conn.protocol === 'local' && conn.username === 'local' ? '' : conn.username);
      setRemotePath(conn.remotePath || '/');
      setAuthType(
        conn.protocol === 'local'
          ? 'password'
          : conn.authType === 'none'
            ? 'password'
            : conn.authType
      );
      setPrivateKeyPath(conn.privateKeyPath ?? '');
      setPassive(conn.passive ?? true);
      setRejectUnauthorized(conn.rejectUnauthorized ?? false);
      setKeepSynchronized(Boolean(conn.keepSynchronized));
      setIsProduction(Boolean(conn.isProduction));
      setIgnoreText(
        (conn.ignorePatterns?.length ? conn.ignorePatterns : DEFAULT_IGNORES).join(', ')
      );
    } else {
      setEditingId(null);
      setHasSavedSecret(false);
      setName('Server Baru');
      setProtocol('sftp');
      setHost('');
      setPort(22);
      setUsername('');
      setRemotePath('/var/www/html');
      setAuthType('password');
      setPrivateKeyPath('');
      setPassive(true);
      setRejectUnauthorized(false);
      setKeepSynchronized(false);
      setIsProduction(false);
      setIgnoreText(DEFAULT_IGNORES.join(', '));
    }
    setPassword('');
    setPassphrase('');
    setShowPassword(false);
    setTestFeedback(null);
    setConfirmDeleteId(null);
  };

  useEffect(() => {
    if (!connectionModalOpen) return;
    loadFormFromProfile(editingConnection);
  }, [connectionModalOpen, editingConnection?.id]);

  if (!connectionModalOpen) return null;

  const isEditing = Boolean(editingId);

  const handleProtocolChange = (next: ConnectionProtocol): void => {
    setProtocol(next);
    if (next === 'sftp') {
      if (port === 21 || !port) setPort(22);
    } else if (next === 'ftps' || next === 'ftp') {
      if (port === 22 || !port) setPort(21);
      if (authType === 'privateKey') setAuthType('password');
    }
  };

  const buildPayload = (overrideId?: string | null) => {
    const targetId = overrideId === undefined ? editingId : overrideId;
    return {
      profile: {
        id: targetId ?? undefined,
        name: name.trim() || 'Server Remote',
        protocol,
        host: protocol === 'local' ? 'localhost' : host.trim(),
        port: Number(port) || (protocol === 'sftp' ? 22 : 21),
        username: protocol === 'local' ? 'local' : username.trim(),
        remotePath: remotePath.trim() || '/',
        authType: protocol === 'local' ? ('none' as const) : authType,
        privateKeyPath:
          protocol === 'sftp' && authType === 'privateKey'
            ? privateKeyPath.trim() || undefined
            : undefined,
        passive,
        rejectUnauthorized,
        keepSynchronized,
        isProduction,
        ignorePatterns: ignoreText
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      },
      password: password || undefined,
      passphrase: passphrase || undefined
    };
  };

  const handleSave = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setSaving(true);
    try {
      const wasSameActive = Boolean(editingId && editingId === selectedConnectionId);
      const prevSubPath = remoteSubPath;

      const saved = await window.aptana.connections.save(buildPayload());
      await refreshConnections();

      if (wasSameActive) {
        await browseRemoteDir(prevSubPath);
      } else {
        await selectConnection(saved.id);
      }

      showToast(
        isEditing
          ? `Perubahan koneksi "${saved.name}" berhasil disimpan.`
          : `Koneksi baru "${saved.name}" berhasil ditambahkan.`
      );
      closeConnectionModal();
    } catch (err) {
      showToast(
        `Gagal menyimpan koneksi: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (): Promise<void> => {
    if (protocol !== 'local' && (!host.trim() || !username.trim())) {
      setTestFeedback({
        ok: false,
        text: 'Isi Host / Alamat IP dan Username terlebih dahulu sebelum menguji koneksi.'
      });
      return;
    }

    setSaving(true);
    setTestFeedback({ ok: null, text: 'Menguji koneksi ke server...' });
    try {
      const saved = await window.aptana.connections.save(buildPayload());
      setEditingId(saved.id);
      setHasSavedSecret(Boolean(saved.hasSavedSecret));
      setPassword('');
      setPassphrase('');
      openConnectionModal(saved);
      await refreshConnections();

      const res = await window.aptana.connections.test(saved.id);
      setTestFeedback({
        ok: res.ok,
        text: res.ok ? `✓ ${res.message}` : `✕ Gagal: ${res.message}`
      });
    } catch (err) {
      setTestFeedback({
        ok: false,
        text: `✕ Error: ${err instanceof Error ? err.message : String(err)}`
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDuplicate = (): void => {
    setEditingId(null);
    setHasSavedSecret(false);
    setName(`${name.trim() || 'Server'} (Salinan)`);
    setPassword('');
    setPassphrase('');
    setTestFeedback({
      ok: null,
      text: 'Mode Duplikat: masukkan password untuk salinan koneksi baru ini lalu klik Simpan.'
    });
  };

  const executeDelete = async (targetId: string): Promise<void> => {
    setSaving(true);
    try {
      const targetConn = connections.find((c) => c.id === targetId);
      const wasSelected = selectedConnectionId === targetId;
      const wasEditingThis = editingId === targetId;

      await window.aptana.connections.remove(targetId);
      await refreshConnections();

      const remaining = useIdeStore.getState().connections;
      if (wasSelected) {
        await selectConnection(remaining[0]?.id ?? null);
      }

      if (wasEditingThis) {
        if (remaining.length > 0) {
          openConnectionModal(remaining[0]);
        } else {
          openConnectionModal(null);
        }
      }

      setConfirmDeleteId(null);
      showToast(`Profil koneksi "${targetConn?.name ?? ''}" dihapus.`);
    } catch (err) {
      showToast(
        `Gagal menghapus koneksi: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div
        className="modal-card"
        style={{
          width: 820,
          maxWidth: '95vw',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Modal Header */}
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
            <PlugZap size={18} color="var(--accent)" style={{ flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14.5 }}>
                Manajer &amp; Konfigurasi Koneksi Server
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                Klik salah satu koneksi di sebelah kiri untuk mengedit atau menghapus, atau klik{' '}
                <strong>+ Koneksi Baru</strong>
              </div>
            </div>
          </div>
          <button
            type="button"
            className="btn-modal-exit"
            onClick={closeConnectionModal}
          >
            <X size={14} />
            <span>Keluar</span>
          </button>
        </div>

        {/* Split Body: Left Saved Connections List + Right Form */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '250px 1fr',
            flex: 1,
            minHeight: 0,
            overflow: 'hidden'
          }}
        >
          {/* LEFT PANE: Saved Connections Switcher */}
          <div
            style={{
              borderRight: '1px solid var(--border-subtle)',
              background: 'var(--bg-surface)',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0
            }}
          >
            <div
              style={{
                padding: '10px 12px',
                borderBottom: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 6
              }}
            >
              <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)' }}>
                DAFTAR KONEKSI ({connections.length})
              </span>
              <button
                type="button"
                className={`btn ${!isEditing ? 'btn-accent' : ''}`}
                style={{ padding: '3px 8px', fontSize: 11.5 }}
                onClick={() => {
                  openConnectionModal(null);
                  loadFormFromProfile(null);
                }}
                title="Buat Profil Koneksi Server Baru"
              >
                <Plus size={12} />
                <span>Koneksi Baru</span>
              </button>
            </div>

            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: 8,
                display: 'flex',
                flexDirection: 'column',
                gap: 6
              }}
            >
              {connections.length === 0 ? (
                <div
                  style={{
                    padding: 12,
                    fontSize: 12,
                    color: 'var(--text-muted)',
                    textAlign: 'center',
                    lineHeight: 1.5
                  }}
                >
                  Belum ada koneksi tersimpan. Isi formulir di sebelah kanan untuk menambahkan server.
                </div>
              ) : (
                connections.map((conn) => {
                  const isCurrentEdit = editingId === conn.id;
                  const isActiveTarget = selectedConnectionId === conn.id;
                  const isConfirmingDel = confirmDeleteId === conn.id;

                  return (
                    <div
                      key={conn.id}
                      onClick={() => {
                        openConnectionModal(conn);
                        loadFormFromProfile(conn);
                      }}
                      style={{
                        padding: '9px 10px',
                        borderRadius: 8,
                        cursor: 'pointer',
                        background: isCurrentEdit ? 'var(--accent-soft)' : 'var(--bg-elevated)',
                        border: `1px solid ${
                          isCurrentEdit ? 'var(--accent)' : 'var(--border-subtle)'
                        }`,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 4
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                            minWidth: 0,
                            fontWeight: 700,
                            fontSize: 12.5,
                            color: 'var(--text-primary)'
                          }}
                        >
                          <Server
                            size={12}
                            color={isCurrentEdit ? 'var(--accent)' : '#38bdf8'}
                            style={{ flexShrink: 0 }}
                          />
                          <span
                            style={{
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            {conn.name}
                          </span>
                          {conn.isProduction && (
                            <span
                              style={{
                                fontSize: 9.5,
                                fontWeight: 800,
                                padding: '1px 5px',
                                borderRadius: 4,
                                background: 'rgba(239, 68, 68, 0.2)',
                                border: '1px solid rgba(239, 68, 68, 0.5)',
                                color: '#fca5a5',
                                flexShrink: 0
                              }}
                            >
                              PROD
                            </span>
                          )}
                        </div>

                        <button
                          type="button"
                          className="btn-ghost"
                          style={{
                            border: 'none',
                            padding: 3,
                            color: 'var(--danger)',
                            flexShrink: 0
                          }}
                          title={`Hapus profil "${conn.name}"`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDeleteId(isConfirmingDel ? null : conn.id);
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>

                      <div
                        style={{
                          fontSize: 11,
                          color: 'var(--text-secondary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        [{conn.protocol.toUpperCase()}]{' '}
                        {conn.protocol === 'local'
                          ? conn.remotePath
                          : `${conn.username || 'user'}@${conn.host || '—'}:${conn.port}`}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                        {isActiveTarget && (
                          <span
                            className="badge-pill"
                            style={{
                              background: 'var(--accent)',
                              color: '#fff',
                              fontSize: 9.5,
                              padding: '1px 6px'
                            }}
                          >
                            AKTIF
                          </span>
                        )}
                        {conn.keepSynchronized && (
                          <span
                            className="badge-pill"
                            style={{ fontSize: 9.5, padding: '1px 6px' }}
                          >
                            ⚡ Auto-Sync
                          </span>
                        )}
                        {isCurrentEdit && (
                          <span
                            style={{
                              fontSize: 10,
                              color: 'var(--accent)',
                              fontWeight: 700
                            }}
                          >
                            • Sedang Diedit
                          </span>
                        )}
                      </div>

                      {isConfirmingDel && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            marginTop: 4,
                            padding: '6px 8px',
                            borderRadius: 6,
                            background: 'rgba(239, 68, 68, 0.14)',
                            border: '1px solid var(--danger)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 6,
                            fontSize: 11
                          }}
                        >
                          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                            Hapus koneksi ini?
                          </span>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button
                              type="button"
                              className="btn"
                              style={{
                                padding: '2px 7px',
                                fontSize: 11,
                                background: 'var(--danger)',
                                borderColor: 'var(--danger)',
                                color: '#fff'
                              }}
                              disabled={saving}
                              onClick={() => void executeDelete(conn.id)}
                            >
                              Hapus
                            </button>
                            <button
                              type="button"
                              className="btn"
                              style={{ padding: '2px 6px', fontSize: 11 }}
                              onClick={() => setConfirmDeleteId(null)}
                            >
                              Batal
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* RIGHT PANE: Editable Form */}
          <form
            onSubmit={(e) => void handleSave(e)}
            style={{
              padding: 18,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              overflowY: 'auto',
              minHeight: 0
            }}
          >
            {/* Mode Banner */}
            <div
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                background: isEditing ? 'var(--accent-soft)' : 'rgba(74, 222, 128, 0.1)',
                border: `1px solid ${isEditing ? 'var(--accent)' : 'rgba(74, 222, 128, 0.4)'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 700 }}>
                {isEditing ? (
                  <>
                    <Pencil size={13} color="var(--accent)" />
                    <span>Mengedit Koneksi: {editingConnection?.name ?? name}</span>
                  </>
                ) : (
                  <>
                    <Plus size={14} color="#4ade80" />
                    <span>Tambah Profil Koneksi Baru</span>
                  </>
                )}
              </div>

              {isEditing && (
                <div style={{ display: 'flex', gap: 6 }}>
                  {editingId && editingId !== selectedConnectionId && (
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: '3px 8px', fontSize: 11 }}
                      onClick={() => {
                        if (editingId) {
                          void selectConnection(editingId);
                          showToast(`Koneksi aktif dialihkan ke "${name}".`);
                        }
                      }}
                    >
                      Jadikan Aktif
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn"
                    style={{ padding: '3px 8px', fontSize: 11 }}
                    onClick={handleDuplicate}
                    title="Gandakan konfigurasi ini sebagai koneksi baru"
                  >
                    <Copy size={11} />
                    <span>Duplikat</span>
                  </button>
                </div>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.35fr 1fr', gap: 10 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Nama Koneksi</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Contoh: Intranew8 / Server Produksi"
                  required
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Protokol</span>
                <select
                  value={protocol}
                  onChange={(e) => handleProtocolChange(e.target.value as ConnectionProtocol)}
                >
                  <option value="sftp">SFTP (OpenSSH 9+ / Ed25519 / SHA2)</option>
                  <option value="ftps">FTPS (Explicit TLS 1.3)</option>
                  <option value="ftp">FTP Standar</option>
                  <option value="local">Folder Lokal / Network Share</option>
                </select>
              </label>
            </div>

            {protocol !== 'local' && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 0.8fr', gap: 10 }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                      Host / Alamat IP Server
                    </span>
                    <input
                      value={host}
                      onChange={(e) => setHost(e.target.value)}
                      placeholder="contoh: 192.168.1.10 atau deploy.domainanda.com"
                      required
                    />
                  </label>

                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Port</span>
                    <input
                      type="number"
                      min={1}
                      max={65535}
                      value={port}
                      onChange={(e) => setPort(Number(e.target.value))}
                      required
                    />
                  </label>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Username</span>
                    <input
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="root / ubuntu / deploy"
                      required
                    />
                  </label>

                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                      Metode Autentikasi
                    </span>
                    <select
                      value={authType}
                      onChange={(e) => setAuthType(e.target.value as ConnectionAuthType)}
                    >
                      <option value="password">Password</option>
                      {protocol === 'sftp' && (
                        <option value="privateKey">SSH Private Key (Ed25519 / RSA)</option>
                      )}
                    </select>
                  </label>
                </div>

                {authType === 'privateKey' && protocol === 'sftp' ? (
                  <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 10 }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                        Path File Private Key
                      </span>
                      <input
                        value={privateKeyPath}
                        onChange={(e) => setPrivateKeyPath(e.target.value)}
                        placeholder="C:\Users\nama\.ssh\id_ed25519"
                      />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                        Passphrase {hasSavedSecret ? '(✓ Tersimpan)' : '(Opsional)'}
                      </span>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={passphrase}
                        onChange={(e) => setPassphrase(e.target.value)}
                        placeholder={
                          hasSavedSecret
                            ? '•••••• (Kosongkan jika tetap)'
                            : 'Opsional'
                        }
                      />
                    </label>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between'
                      }}
                    >
                      <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                        Password Server (Dienkripsi via Credential Vault)
                      </span>
                      {hasSavedSecret && (
                        <span style={{ fontSize: 11, color: '#4ade80', fontWeight: 600 }}>
                          ✓ Password tersimpan (isi hanya jika ingin mengganti)
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        style={{ flex: 1 }}
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={
                          hasSavedSecret
                            ? '•••••••• (Kosongkan jika tidak ingin mengubah password)'
                            : 'Masukkan password server'
                        }
                      />
                      <button
                        type="button"
                        className="btn"
                        onClick={() => setShowPassword((v) => !v)}
                        title={showPassword ? 'Sembunyikan Password' : 'Lihat Password yang Diketik'}
                      >
                        {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>
                )}

                {(protocol === 'ftps' || protocol === 'ftp') && (
                  <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={passive}
                        onChange={(e) => setPassive(e.target.checked)}
                      />
                      <span>Mode Passive (PASV)</span>
                    </label>
                    {protocol === 'ftps' && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input
                          type="checkbox"
                          checked={rejectUnauthorized}
                          onChange={(e) => setRejectUnauthorized(e.target.checked)}
                        />
                        <span>Tolak Sertifikat TLS Self-Signed</span>
                      </label>
                    )}
                  </div>
                )}
              </>
            )}

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                {protocol === 'local'
                  ? 'Path Folder Target Sinkronisasi (Lokal / XAMPP / Network Drive)'
                  : 'Direktori Root Remote di Server'}
              </span>
              <input
                value={remotePath}
                onChange={(e) => setRemotePath(e.target.value)}
                placeholder={
                  protocol === 'local' ? 'C:\\xampp3\\htdocs\\intranew8' : '/var/www/html'
                }
                required
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                Pola File Diabaikan (pisahkan koma)
              </span>
              <input value={ignoreText} onChange={(e) => setIgnoreText(e.target.value)} />
            </label>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 10px',
                background: 'var(--bg-elevated)',
                borderRadius: 8,
                border: '1px solid var(--border-subtle)'
              }}
            >
              <input
                type="checkbox"
                checked={keepSynchronized}
                onChange={(e) => setKeepSynchronized(e.target.checked)}
              />
              <div>
                <div style={{ fontWeight: 600 }}>
                  Keep-Synchronized (Auto-Upload saat File Disimpan)
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                  Setiap kali Anda menekan Ctrl+S di editor, perubahan langsung diunggah ke koneksi ini.
                </div>
              </div>
            </label>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 10px',
                background: isProduction ? 'rgba(239, 68, 68, 0.1)' : 'var(--bg-elevated)',
                borderRadius: 8,
                border: `1px solid ${
                  isProduction ? 'rgba(239, 68, 68, 0.45)' : 'var(--border-subtle)'
                }`
              }}
            >
              <input
                type="checkbox"
                checked={isProduction}
                onChange={(e) => setIsProduction(e.target.checked)}
              />
              <div>
                <div style={{ fontWeight: 700, color: isProduction ? '#fca5a5' : undefined }}>
                  🔴 Tandai sebagai Server PRODUKSI (Pengaman Live Edit)
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                  Menampilkan banner peringatan merah saat mengedit file live dari server ini agar tidak tertukar dengan server lokal/staging.
                </div>
              </div>
            </label>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 11.5,
                color: 'var(--text-muted)'
              }}
            >
              <ShieldCheck size={14} color="#4ade80" />
              <span>Kredensial disimpan terenkripsi menggunakan OS Credential Vault (DPAPI).</span>
            </div>

            {testFeedback && (
              <div
                style={{
                  padding: '8px 10px',
                  borderRadius: 6,
                  background: 'var(--bg-elevated)',
                  border: `1px solid ${
                    testFeedback.ok === true
                      ? '#4ade80'
                      : testFeedback.ok === false
                        ? 'var(--danger)'
                        : 'var(--border-strong)'
                  }`,
                  color:
                    testFeedback.ok === true
                      ? '#4ade80'
                      : testFeedback.ok === false
                        ? '#fca5a5'
                        : 'var(--text-primary)',
                  fontSize: 12
                }}
              >
                {testFeedback.text}
              </div>
            )}

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: 4,
                gap: 8,
                flexWrap: 'wrap'
              }}
            >
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn"
                  disabled={saving}
                  onClick={() => void handleTest()}
                >
                  Uji Koneksi
                </button>

                {isEditing && editingId && confirmDeleteId !== editingId && (
                  <button
                    type="button"
                    className="btn"
                    style={{ color: 'var(--danger)' }}
                    disabled={saving}
                    onClick={() => setConfirmDeleteId(editingId)}
                  >
                    <Trash2 size={13} />
                    <span>Hapus</span>
                  </button>
                )}

                {isEditing && editingId && confirmDeleteId === editingId && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <button
                      type="button"
                      className="btn"
                      style={{
                        background: 'var(--danger)',
                        borderColor: 'var(--danger)',
                        color: '#fff'
                      }}
                      disabled={saving}
                      onClick={() => void executeDelete(editingId)}
                    >
                      Ya, Hapus
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setConfirmDeleteId(null)}
                    >
                      Batal
                    </button>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn" onClick={closeConnectionModal}>
                  Tutup
                </button>
                <button type="submit" className="btn btn-accent" disabled={saving}>
                  <CheckCircle2 size={14} />
                  <span>{isEditing ? 'Simpan Perubahan' : 'Simpan Koneksi Baru'}</span>
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
