import React, { useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Bug,
  Copy,
  CornerDownRight,
  Play,
  Radio,
  Square,
  Terminal,
  Trash2
} from 'lucide-react';
import type { XdebugVariableItem } from '@shared/xdebugProtocol';
import { useIdeStore } from '../store/useIdeStore';

const VariableNodeView: React.FC<{ item: XdebugVariableItem; depth?: number }> = ({
  item,
  depth = 0
}) => {
  const [open, setOpen] = useState(depth === 0 && item.name.startsWith('$_'));
  const hasChildren = Boolean(item.children && item.children.length > 0);

  return (
    <div style={{ marginLeft: depth * 12, fontFamily: 'var(--font-mono)', fontSize: 11 }}>
      <div
        onClick={() => hasChildren && setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          padding: '2px 4px',
          borderRadius: 4,
          cursor: hasChildren ? 'pointer' : 'default'
        }}
      >
        <span style={{ color: 'var(--text-muted)', width: 10 }}>
          {hasChildren ? (open ? '▾' : '▸') : '•'}
        </span>
        <span style={{ color: '#7dd3fc', fontWeight: 700 }}>{item.name}</span>
        <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>({item.type})</span>
        <span style={{ color: '#fde68a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.value}
        </span>
      </div>
      {open &&
        item.children?.map((c, idx) => (
          <VariableNodeView key={`${c.fullname}-${idx}`} item={c} depth={depth + 1} />
        ))}
    </div>
  );
};

export const XdebugPanel: React.FC = () => {
  const {
    xdebugState,
    xdebugBreakpoints,
    xdebugLogs,
    xdebugEvalHistory,
    toggleXdebugBreakpoint,
    clearXdebugBreakpoints,
    clearXdebugLogs,
    workspacePath,
    connections,
    selectedConnectionId,
    showToast
  } = useIdeStore();

  const [port, setPort] = useState(xdebugState.port || 9003);
  const [remoteRoot, setRemoteRoot] = useState(xdebugState.pathMapping.remoteRoot || '/var/www/html');
  const [localRoot, setLocalRoot] = useState(
    xdebugState.pathMapping.localRoot || workspacePath || ''
  );
  const [varTab, setVarTab] = useState<'locals' | 'superglobals' | 'eval' | 'setup'>('locals');
  const [evalInput, setEvalInput] = useState('$_POST');

  const activeConn = connections.find((c) => c.id === selectedConnectionId) ?? null;
  const isPaused = xdebugState.status === 'break';

  const handleToggleListen = async (): Promise<void> => {
    try {
      if (xdebugState.listening) {
        await window.aptana.xdebug.stop();
        showToast('Xdebug DBGp Listener dihentikan.');
      } else {
        await window.aptana.xdebug.start(port, { remoteRoot, localRoot });
        await window.aptana.xdebug.syncBreakpoints(xdebugBreakpoints);
        showToast(`🪲 Xdebug Listener aktif di port ${port}!`);
      }
    } catch (err) {
      showToast(`Gagal Xdebug: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const phpIniSnippet = [
    '; Tambahkan di php.ini (Xdebug 3)',
    'zend_extension=xdebug',
    'xdebug.mode=debug',
    'xdebug.start_with_request=yes',
    `xdebug.client_host=127.0.0.1`,
    `xdebug.client_port=${port}`,
    'xdebug.idekey=HMWSTUDIO'
  ].join('\n');

  const sshReverseTunnelCmd = activeConn
    ? `ssh -R ${port}:127.0.0.1:${port} ${activeConn.username}@${activeConn.host} -p ${activeConn.port || 22}`
    : `ssh -R ${port}:127.0.0.1:${port} user@server-anda`;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      {/* Top Control Bar */}
      <div
        style={{
          padding: '6px 10px',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-surface)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 6
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`btn btn-xs ${xdebugState.listening ? '' : 'btn-primary'}`}
            style={
              xdebugState.listening
                ? {
                    borderColor: 'rgba(248, 113, 113, 0.5)',
                    color: '#fca5a5',
                    background: 'rgba(239, 68, 68, 0.14)'
                  }
                : undefined
            }
            onClick={() => void handleToggleListen()}
          >
            {xdebugState.listening ? <Square size={11} /> : <Radio size={11} />}
            <span>
              {xdebugState.listening ? `Stop Listen (:${xdebugState.port})` : `Listen Port ${port}`}
            </span>
          </button>

          <input
            type="number"
            className="form-input"
            style={{ width: 68, height: 24, padding: '0 6px', fontSize: 11 }}
            value={port}
            disabled={xdebugState.listening}
            onChange={(e) => setPort(Number(e.target.value) || 9003)}
            title="Port DBGp Xdebug 3 (Default: 9003)"
          />

          <span
            style={{
              padding: '2px 8px',
              borderRadius: 999,
              fontSize: 10.5,
              fontWeight: 700,
              background: isPaused
                ? 'rgba(245, 158, 11, 0.2)'
                : xdebugState.connected
                  ? 'rgba(16, 185, 129, 0.18)'
                  : 'var(--bg-elevated)',
              color: isPaused ? '#fde68a' : xdebugState.connected ? '#6ee7b7' : 'var(--text-muted)'
            }}
          >
            {isPaused
              ? `⏸ PAUSED: ${xdebugState.pausedFile?.split(/[/\\]/).pop()}:${xdebugState.pausedLine}`
              : xdebugState.connected
                ? '🟢 TERHUBUNG'
                : xdebugState.listening
                  ? '📡 MENUNGGU REQUEST PHP...'
                  : '⚪ IDLE'}
          </span>

          {/* Step Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 4 }}>
            <button
              type="button"
              className="btn btn-xs"
              disabled={!isPaused}
              onClick={() => void window.aptana.xdebug.continueRun()}
              title="Continue / Lanjutkan (F5)"
            >
              <Play size={11} color="#34d399" /> Continue
            </button>
            <button
              type="button"
              className="btn btn-xs"
              disabled={!isPaused}
              onClick={() => void window.aptana.xdebug.stepOver()}
              title="Step Over — Baris Berikutnya (F8)"
            >
              <CornerDownRight size={11} color="#38bdf8" /> Step Over
            </button>
            <button
              type="button"
              className="btn btn-xs"
              disabled={!isPaused}
              onClick={() => void window.aptana.xdebug.stepInto()}
              title="Step Into — Masuk Fungsi (F7)"
            >
              <ArrowDownToLine size={11} color="#a855f7" /> Step Into
            </button>
            <button
              type="button"
              className="btn btn-xs"
              disabled={!isPaused}
              onClick={() => void window.aptana.xdebug.stepOut()}
              title="Step Out — Keluar Fungsi"
            >
              <ArrowUpFromLine size={11} color="#fbbf24" /> Step Out
            </button>
            <button
              type="button"
              className="btn btn-xs"
              disabled={!xdebugState.connected}
              onClick={() => void window.aptana.xdebug.stopSession()}
              title="Hentikan Sesi Request Saat Ini"
            >
              <Square size={10} color="#f87171" /> Stop
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <input
            className="form-input"
            style={{ width: 130, height: 24, fontSize: 10.5, padding: '0 6px' }}
            placeholder="Remote root (/var/www)"
            value={remoteRoot}
            onChange={(e) => {
              setRemoteRoot(e.target.value);
              void window.aptana.xdebug.setPathMapping({ remoteRoot: e.target.value, localRoot });
            }}
            title="Path Mapping: Root folder di server remote Linux"
          />
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>↔</span>
          <input
            className="form-input"
            style={{ width: 130, height: 24, fontSize: 10.5, padding: '0 6px' }}
            placeholder="Local root (D:\...)"
            value={localRoot}
            onChange={(e) => {
              setLocalRoot(e.target.value);
              void window.aptana.xdebug.setPathMapping({ remoteRoot, localRoot: e.target.value });
            }}
            title="Path Mapping: Root folder proyek lokal Anda"
          />
        </div>
      </div>

      {/* 3-Column Inspector Body */}
      <div
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: '230px 1fr 260px',
          minHeight: 0,
          overflow: 'hidden'
        }}
      >
        {/* Col 1: Breakpoints & Call Stack */}
        <div
          style={{
            borderRight: '1px solid var(--border-subtle)',
            padding: 8,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 8
          }}
        >
          <div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: 10.5,
                fontWeight: 700,
                color: 'var(--text-secondary)',
                marginBottom: 4
              }}
            >
              <span>🔴 Breakpoints ({xdebugBreakpoints.length})</span>
              {xdebugBreakpoints.length > 0 && (
                <button
                  type="button"
                  className="icon-btn"
                  onClick={clearXdebugBreakpoints}
                  title="Hapus semua breakpoint"
                >
                  <Trash2 size={11} />
                </button>
              )}
            </div>
            {xdebugBreakpoints.length === 0 ? (
              <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                Klik pinggir kiri nomor baris pada file <code>.php</code> untuk memasang titik merah Breakpoint.
              </div>
            ) : (
              xdebugBreakpoints.map((bp) => (
                <div
                  key={bp.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 4,
                    padding: '3px 5px',
                    borderRadius: 4,
                    background: 'var(--bg-surface)',
                    marginBottom: 3,
                    fontSize: 10.5,
                    fontFamily: 'var(--font-mono)'
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {bp.filePath.split(/[/\\]/).pop()}:{bp.line}
                  </span>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => toggleXdebugBreakpoint(bp.filePath, bp.line)}
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              ))
            )}
          </div>

          <div>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>
              📚 Call Stack ({xdebugState.stack.length})
            </div>
            {xdebugState.stack.length === 0 ? (
              <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>Belum ada stack aktif.</div>
            ) : (
              xdebugState.stack.map((frame) => (
                <div
                  key={frame.level}
                  style={{
                    padding: '4px 6px',
                    borderRadius: 4,
                    background: frame.level === 0 ? 'rgba(245, 158, 11, 0.14)' : 'var(--bg-surface)',
                    border: '1px solid var(--border-subtle)',
                    marginBottom: 3,
                    fontSize: 10.5,
                    fontFamily: 'var(--font-mono)'
                  }}
                >
                  <div style={{ fontWeight: 700, color: '#fde68a' }}>
                    #{frame.level} {frame.where}
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>
                    {frame.filename.split(/[/\\]/).pop()}:{frame.lineno}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Col 2: Variables / Superglobals / Watch Eval / Setup */}
        <div
          style={{
            borderRight: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0
          }}
        >
          <div
            style={{
              padding: '4px 8px',
              borderBottom: '1px solid var(--border-subtle)',
              display: 'flex',
              gap: 4,
              background: 'var(--bg-elevated)'
            }}
          >
            <button
              type="button"
              className={`btn btn-xs ${varTab === 'locals' ? 'btn-primary' : ''}`}
              onClick={() => setVarTab('locals')}
            >
              Locals ({xdebugState.locals.length})
            </button>
            <button
              type="button"
              className={`btn btn-xs ${varTab === 'superglobals' ? 'btn-primary' : ''}`}
              onClick={() => setVarTab('superglobals')}
            >
              $_POST / $_SESSION ({xdebugState.superglobals.length})
            </button>
            <button
              type="button"
              className={`btn btn-xs ${varTab === 'eval' ? 'btn-primary' : ''}`}
              onClick={() => setVarTab('eval')}
            >
              <Terminal size={10} /> Eval / Watch
            </button>
            <button
              type="button"
              className={`btn btn-xs ${varTab === 'setup' ? 'btn-primary' : ''}`}
              onClick={() => setVarTab('setup')}
            >
              <Bug size={10} /> Panduan php.ini &amp; SSH Tunnel
            </button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
            {varTab === 'locals' && (
              xdebugState.locals.length === 0 ? (
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  Variabel lokal akan muncul otomatis saat eksekusi berhenti di Breakpoint.
                </div>
              ) : (
                xdebugState.locals.map((v, i) => <VariableNodeView key={`${v.name}-${i}`} item={v} />)
              )
            )}

            {varTab === 'superglobals' && (
              xdebugState.superglobals.length === 0 ? (
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  Superglobal (<code>$_GET</code>, <code>$_POST</code>, <code>$_SESSION</code>, <code>$_COOKIE</code>) akan tampil saat berhenti di Breakpoint.
                </div>
              ) : (
                xdebugState.superglobals.map((v, i) => (
                  <VariableNodeView key={`${v.name}-${i}`} item={v} />
                ))
              )
            )}

            {varTab === 'eval' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', gap: 5 }}>
                  <input
                    className="form-input"
                    style={{ flex: 1, height: 26, fontSize: 11.5, fontFamily: 'var(--font-mono)' }}
                    placeholder="Contoh: count($rows) atau $_SESSION['_nip']"
                    value={evalInput}
                    onChange={(e) => setEvalInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && isPaused) {
                        void window.aptana.xdebug.evalExpression(evalInput);
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-primary btn-xs"
                    disabled={!isPaused || !evalInput.trim()}
                    onClick={() => void window.aptana.xdebug.evalExpression(evalInput)}
                  >
                    Evaluasi
                  </button>
                </div>
                {xdebugEvalHistory.map((item, i) => (
                  <div
                    key={i}
                    style={{
                      padding: '5px 7px',
                      borderRadius: 5,
                      background: 'var(--bg-surface)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11
                    }}
                  >
                    <div style={{ color: '#7dd3fc' }}>&gt; {item.expr}</div>
                    <div style={{ color: '#6ee7b7', marginTop: 2 }}>{item.result}</div>
                  </div>
                ))}
              </div>
            )}

            {varTab === 'setup' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 11 }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                    <strong>1. Konfigurasi `php.ini` (Xdebug 3):</strong>
                    <button
                      type="button"
                      className="btn btn-xs"
                      onClick={() => {
                        void navigator.clipboard?.writeText(phpIniSnippet);
                        showToast('Konfigurasi php.ini Xdebug 3 disalin.');
                      }}
                    >
                      <Copy size={10} /> Salin
                    </button>
                  </div>
                  <pre
                    style={{
                      margin: 0,
                      padding: 7,
                      borderRadius: 5,
                      background: 'var(--bg-surface)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10.5
                    }}
                  >
                    {phpIniSnippet}
                  </pre>
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                    <strong>2. SSH Reverse Tunnel untuk Debug Server Remote Linux:</strong>
                    <button
                      type="button"
                      className="btn btn-xs"
                      onClick={() => {
                        void navigator.clipboard?.writeText(sshReverseTunnelCmd);
                        showToast('Perintah SSH Reverse Tunnel disalin.');
                      }}
                    >
                      <Copy size={10} /> Salin
                    </button>
                  </div>
                  <pre
                    style={{
                      margin: 0,
                      padding: 7,
                      borderRadius: 5,
                      background: 'var(--bg-surface)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10.5
                    }}
                  >
                    {sshReverseTunnelCmd}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Col 3: Live DBGp Log */}
        <div style={{ padding: 8, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: 10.5,
              fontWeight: 700,
              color: 'var(--text-secondary)'
            }}
          >
            <span>Log DBGp ({xdebugLogs.length})</span>
            <button type="button" className="icon-btn" onClick={clearXdebugLogs} title="Bersihkan log">
              <Trash2 size={11} />
            </button>
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
            {xdebugLogs.length === 0
              ? 'Klik "Listen Port 9003" untuk mulai mendengarkan sesi Xdebug PHP.'
              : xdebugLogs.join('\n')}
          </div>
        </div>
      </div>
    </div>
  );
};
