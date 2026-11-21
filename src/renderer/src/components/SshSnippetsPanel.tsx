import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckSquare,
  Play,
  Plus,
  RefreshCw,
  ShieldAlert,
  Square,
  Terminal,
  Trash2
} from 'lucide-react';
import type { ConnectionProfile } from '@shared/types';
import {
  detectDangerousSshCommand,
  type MultiSshExecItemResult,
  type SshSnippetItem
} from '@shared/sshSnippetsCatalog';

interface SshSnippetsPanelProps {
  connections: ConnectionProfile[];
  initialConnectionId: string;
  onToast: (msg: string) => void;
}

export const SshSnippetsPanel: React.FC<SshSnippetsPanelProps> = ({
  connections,
  initialConnectionId,
  onToast
}) => {
  const sftpServers = useMemo(
    () => connections.filter((c) => c.protocol === 'sftp'),
    [connections]
  );

  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    initialConnectionId ? [initialConnectionId] : sftpServers[0] ? [sftpServers[0].id] : []
  );
  const [snippets, setSnippets] = useState<SshSnippetItem[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string>('Semua');
  const [commandText, setCommandText] = useState('');
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<MultiSshExecItemResult[]>([]);

  // Save custom snippet form
  const [saveOpen, setSaveOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  const loadSnippets = async (): Promise<void> => {
    try {
      const list = await window.aptana.connections.listSshSnippets();
      setSnippets(list);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    void loadSnippets();
  }, []);

  const toggleServer = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleRunCommand = async (cmdOverride?: string): Promise<void> => {
    const cmd = (cmdOverride ?? commandText).trim();
    if (!cmd) {
      onToast('Pilih snippet atau ketik perintah SSH terlebih dahulu.');
      return;
    }
    if (selectedIds.length === 0) {
      onToast('Centang minimal 1 server SSH target.');
      return;
    }

    const targets = sftpServers.filter((s) => selectedIds.includes(s.id));
    const hasProd = targets.some((t) => t.isProduction);
    const hazard = detectDangerousSshCommand(cmd);
    if (hasProd || hazard.dangerous) {
      const ok = window.confirm(
        `Jalankan perintah SSH pada ${targets.length} server (${targets
          .map((t) => (t.isProduction ? `[PROD] ${t.name}` : t.name))
          .join(', ')})?\n\nPerintah:\n${cmd}${
          hazard.reason ? `\n\n⚠️ Peringatan: ${hazard.reason}` : ''
        }`
      );
      if (!ok) return;
    }

    setRunning(true);
    try {
      const res = await window.aptana.connections.runSshSnippetMulti(selectedIds, cmd);
      setResults(res);
      const okCount = res.filter((r) => r.ok).length;
      onToast(`⚡ Multi-SSH selesai: ${okCount}/${res.length} server berhasil.`);
    } catch (err) {
      onToast(`Gagal menjalankan SSH: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunning(false);
    }
  };

  const filteredSnippets = useMemo(
    () =>
      categoryFilter === 'Semua'
        ? snippets
        : snippets.filter((s) => s.category === categoryFilter),
    [snippets, categoryFilter]
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Multi-Server Target Selector */}
      <div
        style={{
          padding: 10,
          borderRadius: 8,
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: 7
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
          <strong style={{ fontSize: 12 }}>
            🎯 Target Eksekusi Multi-Server SSH ({selectedIds.length}/{sftpServers.length} dipilih)
          </strong>
          <div style={{ display: 'flex', gap: 5 }}>
            <button
              type="button"
              className="btn btn-xs"
              onClick={() => setSelectedIds(sftpServers.map((s) => s.id))}
            >
              Pilih Semua
            </button>
            <button type="button" className="btn btn-xs" onClick={() => setSelectedIds([])}>
              Kosongkan
            </button>
          </div>
        </div>

        {sftpServers.length === 0 ? (
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            Belum ada profil koneksi SFTP (SSH). Tambahkan melalui Manajer Koneksi Server.
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {sftpServers.map((srv) => {
              const checked = selectedIds.includes(srv.id);
              return (
                <button
                  key={srv.id}
                  type="button"
                  className={`btn btn-xs ${checked ? 'btn-primary' : ''}`}
                  onClick={() => toggleServer(srv.id)}
                >
                  {checked ? <CheckSquare size={11} /> : <Square size={11} />}
                  <span>
                    {srv.isProduction ? '🔴 ' : ''}
                    {srv.name} ({srv.host})
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Main Split: Left Snippets Catalog | Right Command Runner & Outputs */}
      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 12 }}>
        {/* Left: Presets + Custom Snippets */}
        <div
          style={{
            border: '1px solid var(--border-subtle)',
            borderRadius: 8,
            background: 'var(--bg-app)',
            padding: 9,
            display: 'flex',
            flexDirection: 'column',
            gap: 7,
            maxHeight: 420,
            overflowY: 'auto'
          }}
        >
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {['Semua', 'Laravel / PHP', 'Web Server', 'Database & Cache', 'Disk & SSL', 'Custom'].map(
              (cat) => (
                <button
                  key={cat}
                  type="button"
                  className={`btn btn-xs ${categoryFilter === cat ? 'btn-primary' : ''}`}
                  onClick={() => setCategoryFilter(cat)}
                >
                  {cat}
                </button>
              )
            )}
          </div>

          {filteredSnippets.map((snip) => (
            <div
              key={snip.id}
              style={{
                padding: '7px 9px',
                borderRadius: 6,
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                gap: 4
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                <strong style={{ fontSize: 11.5 }}>
                  {snip.dangerous && <ShieldAlert size={11} color="#fbbf24" style={{ marginRight: 4 }} />}
                  {snip.name}
                </strong>
                <div style={{ display: 'flex', gap: 3 }}>
                  <button
                    type="button"
                    className="btn btn-xs"
                    onClick={() => setCommandText(snip.command)}
                    title="Muat ke kotak perintah"
                  >
                    Muat
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-xs"
                    disabled={running || selectedIds.length === 0}
                    onClick={() => {
                      setCommandText(snip.command);
                      void handleRunCommand(snip.command);
                    }}
                    title="Jalankan langsung ke server terpilih"
                  >
                    <Play size={10} />
                  </button>
                  {!snip.builtIn && (
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() =>
                        void window.aptana.connections.deleteSshSnippet(snip.id).then(setSnippets)
                      }
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{snip.description}</div>
            </div>
          ))}
        </div>

        {/* Right: Command Box + Multi-Server Output Results */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <div
            style={{
              padding: 10,
              borderRadius: 8,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: 7
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5 }}>
                <Terminal size={13} color="#38bdf8" /> Perintah SSH (Multi-Exec)
              </span>
              <button
                type="button"
                className="btn btn-xs"
                onClick={() => setSaveOpen((v) => !v)}
              >
                <Plus size={11} /> Simpan sebagai Snippet
              </button>
            </div>
            <textarea
              className="form-input"
              rows={3}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, resize: 'vertical' }}
              placeholder="Ketik perintah bash Linux atau klik 'Muat' dari katalog snippet di kiri..."
              value={commandText}
              onChange={(e) => setCommandText(e.target.value)}
            />

            {saveOpen && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <input
                  className="form-input"
                  style={{ flex: 1, fontSize: 11 }}
                  placeholder="Nama Snippet Baru"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
                <input
                  className="form-input"
                  style={{ flex: 1, fontSize: 11 }}
                  placeholder="Deskripsi singkat"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-primary btn-xs"
                  disabled={!newName.trim() || !commandText.trim()}
                  onClick={async () => {
                    const updated = await window.aptana.connections.saveSshSnippet({
                      name: newName,
                      category: 'Custom',
                      command: commandText,
                      description: newDesc || 'Snippet SSH kustom',
                      dangerous: detectDangerousSshCommand(commandText).dangerous
                    });
                    setSnippets(updated);
                    setNewName('');
                    setNewDesc('');
                    setSaveOpen(false);
                    onToast('Snippet SSH kustom berhasil disimpan.');
                  }}
                >
                  Simpan
                </button>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={running || !commandText.trim() || selectedIds.length === 0}
                onClick={() => void handleRunCommand()}
              >
                {running ? <RefreshCw size={13} className="spin" /> : <Play size={13} />}
                <span>
                  {running
                    ? 'Menjalankan di Server...'
                    : `Jalankan ke ${selectedIds.length} Server SSH`}
                </span>
              </button>
            </div>
          </div>

          {/* Output Cards per Server */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 280, overflowY: 'auto' }}>
            {results.map((r) => (
              <div
                key={r.connectionId}
                style={{
                  borderRadius: 7,
                  border: `1px solid ${r.ok ? 'rgba(52, 211, 153, 0.4)' : 'rgba(248, 113, 113, 0.5)'}`,
                  background: 'var(--bg-app)',
                  overflow: 'hidden'
                }}
              >
                <div
                  style={{
                    padding: '5px 10px',
                    background: 'var(--bg-surface)',
                    borderBottom: '1px solid var(--border-subtle)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 11.5,
                    fontWeight: 700
                  }}
                >
                  <span>
                    {r.isProduction ? '🔴 ' : ''}
                    {r.connectionName}
                  </span>
                  <span style={{ color: r.ok ? '#34d399' : '#f87171', fontFamily: 'var(--font-mono)' }}>
                    exit={r.exitCode} • {r.durationMs} ms
                  </span>
                </div>
                <pre
                  style={{
                    margin: 0,
                    padding: 9,
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    maxHeight: 160,
                    overflow: 'auto',
                    whiteSpace: 'pre-wrap'
                  }}
                >
                  {r.stdout || (r.stderr ? '' : '(Tidak ada output stdout)')}
                  {r.stderr ? `\n[STDERR]\n${r.stderr}` : ''}
                </pre>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
