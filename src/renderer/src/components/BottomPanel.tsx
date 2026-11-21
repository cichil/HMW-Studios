import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import {
  Activity,
  Bug,
  ExternalLink,
  Play,
  Plus,
  Radar,
  RefreshCw,
  Server,
  Sparkles,
  Square,
  TerminalSquare,
  Trash2,
  X
} from 'lucide-react';
import type {
  LogSourceConfig,
  TerminalSessionInfo,
  TerminalShellKind
} from '@shared/types';
import { useIdeStore } from '../store/useIdeStore';
import { XdebugPanel } from './XdebugPanel';

interface ClientTerminalInstance {
  info: TerminalSessionInfo;
  term: Terminal;
  fitAddon: FitAddon;
  recentLog: string;
}

export const BottomPanel: React.FC = () => {
  const {
    bottomPanelOpen,
    activeBottomTab,
    setBottomPanel,
    workspacePath,
    connections,
    selectedConnectionId,
    transferLogs,
    commandOutputLines,
    serverLogEntries,
    logMonitorStatus,
    clearServerLogEntries,
    setLogMonitorStatus,
    pushServerLogEntries,
    openLogEntryLocation,
    geminiConfig,
    setActiveSidebar,
    setGeminiSubTab,
    xdebugState,
    xdebugBreakpoints,
    showToast
  } = useIdeStore();

  const [sessions, setSessions] = useState<TerminalSessionInfo[]>([]);
  const [activeTermId, setActiveTermId] = useState<string | null>(null);
  const [shellChoice, setShellChoice] = useState<TerminalShellKind>('default');
  const [aiDiagBusy, setAiDiagBusy] = useState(false);
  const [aiDiagReport, setAiDiagReport] = useState<string | null>(null);
  const [panelHeight, setPanelHeight] = useState<number>(() => {
    try {
      const saved = Number(window.localStorage.getItem('hmw.bottomPanelHeight'));
      if (Number.isFinite(saved) && saved >= 150 && saved <= 560) return saved;
    } catch {
      // ignore
    }
    return 240;
  });
  const [isResizingBottom, setIsResizingBottom] = useState(false);

  const handleStartResizeBottom = (e: React.MouseEvent): void => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = panelHeight;
    setIsResizingBottom(true);
    let latestH = startH;

    const onMove = (ev: MouseEvent): void => {
      const delta = startY - ev.clientY;
      latestH = Math.min(560, Math.max(150, Math.round(startH + delta)));
      setPanelHeight(latestH);
    };
    const onUp = (): void => {
      setIsResizingBottom(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      try {
        window.localStorage.setItem('hmw.bottomPanelHeight', String(latestH));
      } catch {
        // ignore
      }
      for (const inst of instancesRef.current.values()) {
        try {
          inst.fitAddon.fit();
        } catch {
          // ignore
        }
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Live Error Log controls
  const [logKind, setLogKind] = useState<'remote' | 'local'>(() =>
    selectedConnectionId ? 'remote' : 'local'
  );
  const [logFilePath, setLogFilePath] = useState('/var/log/apache2/error.log');
  const [detectedSources, setDetectedSources] = useState<LogSourceConfig[]>([]);
  const [detectingLogs, setDetectingLogs] = useState(false);
  const [logFilter, setLogFilter] = useState<'all' | 'errors' | 'warnings'>('all');

  const instancesRef = useRef<Map<string, ClientTerminalInstance>>(new Map());
  const mountMapRef = useRef<Map<string, HTMLDivElement>>(new Map());

  const activeConn = connections.find((c) => c.id === selectedConnectionId) ?? null;

  const spawnTerminal = async (kind: 'local' | 'ssh'): Promise<void> => {
    try {
      const info = await window.aptana.terminal.create({
        kind,
        shell: shellChoice,
        cwd: workspacePath ?? undefined,
        connectionId: kind === 'ssh' ? selectedConnectionId ?? undefined : undefined,
        cols: 110,
        rows: 24
      });

      const term = new Terminal({
        cursorBlink: true,
        fontSize: 12.5,
        fontFamily: "'Cascadia Code', Consolas, monospace",
        theme: {
          background: '#12151c',
          foreground: '#eef2f7',
          cursor: '#f97316'
        }
      });
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      term.onData((data) => {
        void window.aptana.terminal.write(info.id, data);
      });

      instancesRef.current.set(info.id, { info, term, fitAddon, recentLog: '' });
      setSessions((prev) => [...prev, info]);
      setActiveTermId(info.id);
    } catch (err) {
      showToast(
        `Gagal membuka sesi terminal: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };

  useEffect(() => {
    const unsubData = window.aptana.terminal.onData(({ id, data }) => {
      const inst = instancesRef.current.get(id);
      if (inst) {
        inst.term.write(data);
        const plain = data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
        inst.recentLog = (inst.recentLog + plain).slice(-4000);
      }
    });
    const unsubExit = window.aptana.terminal.onExit(({ id, exitCode }) => {
      instancesRef.current.get(id)?.term.writeln(
        `\r\n\x1b[90m[Sesi berakhir dengan kode ${exitCode}]\x1b[0m`
      );
    });

    return () => {
      unsubData();
      unsubExit();
      for (const inst of instancesRef.current.values()) {
        inst.term.dispose();
      }
      instancesRef.current.clear();
    };
  }, []);

  // Auto-open one initial local shell when terminal tab is visible
  useEffect(() => {
    if (bottomPanelOpen && activeBottomTab === 'terminal' && sessions.length === 0) {
      void spawnTerminal('local');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bottomPanelOpen, activeBottomTab]);

  // Mount & fit active xterm instance when activeTermId changes
  useEffect(() => {
    if (!activeTermId || activeBottomTab !== 'terminal' || !bottomPanelOpen) return;
    const inst = instancesRef.current.get(activeTermId);
    const hostEl = mountMapRef.current.get(activeTermId);
    if (!inst || !hostEl) return;

    if (!inst.term.element) {
      inst.term.open(hostEl);
    }

    const timer = setTimeout(() => {
      try {
        inst.fitAddon.fit();
        void window.aptana.terminal.resize(activeTermId, inst.term.cols, inst.term.rows);
      } catch {
        // Ignore transient zero-size container
      }
    }, 60);

    return () => clearTimeout(timer);
  }, [activeTermId, activeBottomTab, bottomPanelOpen, sessions.length]);

  const closeTerminalTab = async (id: string): Promise<void> => {
    await window.aptana.terminal.close(id);
    const inst = instancesRef.current.get(id);
    inst?.term.dispose();
    instancesRef.current.delete(id);
    mountMapRef.current.delete(id);

    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      if (activeTermId === id) {
        setActiveTermId(next[next.length - 1]?.id ?? null);
      }
      return next;
    });
  };

  const handleAutoDetectLogs = async (): Promise<void> => {
    setDetectingLogs(true);
    try {
      const found = await window.aptana.logs.autoDetectPaths(
        selectedConnectionId,
        workspacePath
      );
      setDetectedSources(found);
      if (found.length > 0) {
        setLogKind(found[0].kind);
        setLogFilePath(found[0].filePath);
        showToast(`Ditemukan ${found.length} file log aktif.`);
      } else {
        showToast('Tidak ditemukan lokasi log standar otomatis; silakan ketik path manual.');
      }
    } catch (err) {
      showToast(`Gagal deteksi log: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDetectingLogs(false);
    }
  };

  const handleToggleLiveLog = async (): Promise<void> => {
    try {
      if (logMonitorStatus.running) {
        const st = await window.aptana.logs.stop();
        setLogMonitorStatus(st);
        return;
      }
      if (!logFilePath.trim()) {
        showToast('Masukkan path file log terlebih dahulu.');
        return;
      }
      if (logKind === 'remote' && !selectedConnectionId) {
        showToast('Pilih koneksi SFTP/FTPS terlebih dahulu untuk memantau log remote.');
        return;
      }
      const cfg: LogSourceConfig = {
        kind: logKind,
        connectionId: logKind === 'remote' ? selectedConnectionId ?? undefined : undefined,
        filePath: logFilePath.trim(),
        pollIntervalMs: 3000
      };
      // Load initial snapshot first so user immediately sees recent lines
      const initial = await window.aptana.logs.readSnapshot(cfg).catch(() => []);
      if (initial.length > 0) {
        clearServerLogEntries();
        pushServerLogEntries(initial);
      }
      const st = await window.aptana.logs.start(cfg);
      setLogMonitorStatus(st);
      showToast(`Live Error Log aktif memantau: ${cfg.filePath}`);
    } catch (err) {
      showToast(`Gagal memulai monitor log: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleReadLogOnce = async (): Promise<void> => {
    if (!logFilePath.trim()) return;
    try {
      const cfg: LogSourceConfig = {
        kind: logKind,
        connectionId: logKind === 'remote' ? selectedConnectionId ?? undefined : undefined,
        filePath: logFilePath.trim()
      };
      const snap = await window.aptana.logs.readSnapshot(cfg);
      clearServerLogEntries();
      pushServerLogEntries(snap);
      showToast(`Memuat ${snap.length} baris log terbaru.`);
    } catch (err) {
      showToast(`Gagal membaca file log: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const filteredServerLogs = serverLogEntries.filter((e) => {
    if (logFilter === 'errors') return e.level === 'fatal' || e.level === 'error';
    if (logFilter === 'warnings') return e.level === 'warning';
    return true;
  });

  const hasFatalOrErrorLog = serverLogEntries.some(
    (e) => e.level === 'fatal' || e.level === 'error'
  );

  if (!bottomPanelOpen) return null;

  return (
    <section className="bottom-panel" style={{ height: panelHeight }}>
      <div
        className={`bottom-resizer ${isResizingBottom ? 'dragging' : ''}`}
        onMouseDown={handleStartResizeBottom}
        onDoubleClick={() => {
          setPanelHeight(240);
          try {
            window.localStorage.setItem('hmw.bottomPanelHeight', '240');
          } catch {
            // ignore
          }
        }}
        title="Seret atas/bawah untuk ubah tinggi panel (Klik 2x untuk reset)"
      />
      <div className="bottom-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            className={`btn-ghost ${activeBottomTab === 'terminal' ? 'btn' : ''}`}
            style={{ padding: '3px 8px' }}
            onClick={() => setBottomPanel(true, 'terminal')}
          >
            <TerminalSquare size={13} />
            <span>Terminal ({sessions.length})</span>
          </button>

          <button
            className={`btn-ghost ${activeBottomTab === 'transfers' ? 'btn' : ''}`}
            style={{ padding: '3px 8px' }}
            onClick={() => setBottomPanel(true, 'transfers')}
          >
            <span>Transfer Log ({transferLogs.length})</span>
          </button>

          <button
            className={`btn-ghost ${activeBottomTab === 'logs' ? 'btn' : ''}`}
            style={{ padding: '3px 8px', display: 'flex', alignItems: 'center', gap: 5 }}
            onClick={() => setBottomPanel(true, 'logs')}
          >
            <Activity
              size={13}
              color={
                logMonitorStatus.running
                  ? '#4ade80'
                  : hasFatalOrErrorLog
                    ? '#f87171'
                    : undefined
              }
            />
            <span>Live Error Log ({serverLogEntries.length})</span>
          </button>

          <button
            className={`btn-ghost ${activeBottomTab === 'xdebug' ? 'btn' : ''}`}
            style={{ padding: '3px 8px', display: 'flex', alignItems: 'center', gap: 5 }}
            onClick={() => setBottomPanel(true, 'xdebug')}
          >
            <Bug
              size={13}
              color={
                xdebugState.status === 'break'
                  ? '#fbbf24'
                  : xdebugState.listening
                    ? '#4ade80'
                    : undefined
              }
            />
            <span>
              Xdebug PHP
              {xdebugBreakpoints.length > 0 ? ` (${xdebugBreakpoints.length})` : ''}
            </span>
          </button>

          <button
            className={`btn-ghost ${activeBottomTab === 'output' ? 'btn' : ''}`}
            style={{ padding: '3px 8px' }}
            onClick={() => setBottomPanel(true, 'output')}
          >
            <span>Ruble Output</span>
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {activeBottomTab === 'terminal' && (
            <>
              <select
                value={shellChoice}
                onChange={(e) => setShellChoice(e.target.value as TerminalShellKind)}
                style={{ padding: '2px 6px', fontSize: 11.5 }}
              >
                <option value="default">PowerShell / Default</option>
                <option value="cmd">Command Prompt</option>
                <option value="git-bash">Git Bash</option>
                <option value="wsl">WSL Linux</option>
              </select>

              <button
                className="btn"
                style={{ padding: '2px 8px', fontSize: 11.5 }}
                onClick={() => void spawnTerminal('local')}
                title="Tambah Sesi Terminal Lokal"
              >
                <Plus size={12} />
                <span>Shell Baru</span>
              </button>

              {activeConn?.protocol === 'sftp' && (
                <button
                  className="btn btn-accent"
                  style={{ padding: '2px 8px', fontSize: 11.5 }}
                  onClick={() => void spawnTerminal('ssh')}
                  title={`Buka Konsol SSH Langsung ke ${activeConn.name}`}
                >
                  <Server size={12} />
                  <span>SSH: {activeConn.name}</span>
                </button>
              )}
            </>
          )}

          {(activeBottomTab === 'terminal' ||
            activeBottomTab === 'output' ||
            activeBottomTab === 'logs') && (
            <button
              className="btn"
              disabled={aiDiagBusy}
              style={{ padding: '2px 8px', fontSize: 11.5 }}
              title="Diagnosis error dengan Gemini AI"
              onClick={async () => {
                if (!geminiConfig?.hasApiKey) {
                  setActiveSidebar('ai');
                  setGeminiSubTab('settings');
                  showToast('Atur GEMINI_API_KEY terlebih dahulu pada panel Gemini AI.');
                  return;
                }
                const logSource =
                  activeBottomTab === 'terminal'
                    ? (activeTermId ? instancesRef.current.get(activeTermId)?.recentLog : '') || ''
                    : activeBottomTab === 'logs'
                      ? serverLogEntries
                          .slice(-30)
                          .map((e) => e.raw)
                          .join('\n')
                      : commandOutputLines.slice(-60).join('\n');

                if (!logSource.trim()) {
                  showToast('Belum ada output/log untuk dianalisis.');
                  return;
                }
                setAiDiagBusy(true);
                try {
                  const res = await window.aptana.ai.chat({
                    prompt: `Analisis log error server/terminal berikut secara singkat dalam Bahasa Indonesia, jelaskan akar penyebab error PHP/Apache/Laravel-nya, dan berikan solusi perbaikannya:\n\n\`\`\`text\n${logSource}\n\`\`\``
                  });
                  setAiDiagReport(res.text);
                } catch (err) {
                  showToast(
                    `Gagal menganalisis log: ${err instanceof Error ? err.message : String(err)}`
                  );
                } finally {
                  setAiDiagBusy(false);
                }
              }}
            >
              <Sparkles size={12} color="#a855f7" />
              <span>{aiDiagBusy ? 'Menganalisis...' : '✨ Diagnosis AI'}</span>
            </button>
          )}

          <button
            className="btn-ghost"
            style={{ border: 'none', padding: 3 }}
            onClick={() => setBottomPanel(false)}
            title="Sembunyikan Panel Bawah"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {aiDiagReport && (
        <div
          style={{
            padding: '7px 12px',
            background: 'rgba(168, 85, 247, 0.1)',
            borderBottom: '1px solid rgba(168, 85, 247, 0.4)',
            fontSize: 11.5,
            lineHeight: 1.45,
            maxHeight: 110,
            overflowY: 'auto',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 10
          }}
        >
          <div style={{ whiteSpace: 'pre-wrap' }}>
            <strong style={{ color: '#c084fc' }}>✨ Diagnosis Gemini AI: </strong>
            {aiDiagReport}
          </div>
          <button
            className="btn-ghost"
            style={{ padding: 2 }}
            onClick={() => setAiDiagReport(null)}
          >
            <X size={13} />
          </button>
        </div>
      )}

      {activeBottomTab === 'terminal' && (
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          {sessions.length > 1 && (
            <div
              style={{
                width: 155,
                borderRight: '1px solid var(--border-subtle)',
                padding: 6,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 4
              }}
            >
              {sessions.map((s) => (
                <div
                  key={s.id}
                  className={`tree-row ${s.id === activeTermId ? 'selected' : ''}`}
                  onClick={() => setActiveTermId(s.id)}
                >
                  <span
                    style={{
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {s.title}
                  </span>
                  <button
                    className="btn-ghost"
                    style={{ border: 'none', padding: 2 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      void closeTerminalTab(s.id);
                    }}
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{ flex: 1, position: 'relative', background: '#12151c', padding: 4 }}>
            {sessions.map((s) => (
              <div
                key={s.id}
                ref={(el) => {
                  if (el) mountMapRef.current.set(s.id, el);
                }}
                style={{
                  display: s.id === activeTermId ? 'block' : 'none',
                  width: '100%',
                  height: '100%'
                }}
              />
            ))}
          </div>
        </div>
      )}

      {activeBottomTab === 'transfers' && (
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '8px 12px',
            fontFamily: 'Consolas, monospace',
            fontSize: 12
          }}
        >
          {transferLogs.length === 0 ? (
            <div style={{ color: 'var(--text-muted)' }}>
              Belum ada aktivitas transfer SFTP / FTPS / Keep-Synchronized pada sesi ini.
            </div>
          ) : (
            transferLogs.map((log) => (
              <div
                key={log.id}
                style={{
                  padding: '4px 0',
                  borderBottom: '1px solid var(--border-subtle)',
                  display: 'flex',
                  gap: 10
                }}
              >
                <span style={{ color: 'var(--text-muted)' }}>
                  {new Date(log.timestamp).toLocaleTimeString()}
                </span>
                <span
                  style={{
                    color:
                      log.status === 'error'
                        ? 'var(--danger)'
                        : log.direction === 'upload'
                          ? 'var(--success)'
                          : 'var(--info)',
                    fontWeight: 700,
                    minWidth: 72
                  }}
                >
                  [{log.direction.toUpperCase()}]
                </span>
                <span style={{ color: 'var(--text-primary)' }}>{log.message}</span>
              </div>
            ))
          )}
        </div>
      )}

      {activeBottomTab === 'logs' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {/* Controls Bar */}
          <div
            style={{
              padding: '6px 10px',
              borderBottom: '1px solid var(--border-subtle)',
              background: 'var(--bg-elevated)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flexWrap: 'wrap'
            }}
          >
            <select
              value={logKind}
              onChange={(e) => setLogKind(e.target.value as 'remote' | 'local')}
              style={{ padding: '3px 6px', fontSize: 11.5 }}
            >
              <option value="remote">
                Server Remote {activeConn ? `(${activeConn.name})` : ''}
              </option>
              <option value="local">File Lokal</option>
            </select>

            <input
              value={logFilePath}
              onChange={(e) => setLogFilePath(e.target.value)}
              placeholder="/var/log/apache2/error.log atau storage/logs/laravel.log"
              style={{
                flex: 1,
                minWidth: 220,
                fontSize: 11.5,
                padding: '3px 8px',
                fontFamily: 'var(--font-mono)'
              }}
            />

            {detectedSources.length > 0 && (
              <select
                value=""
                onChange={(e) => {
                  const idx = Number(e.target.value);
                  const chosen = detectedSources[idx];
                  if (chosen) {
                    setLogKind(chosen.kind);
                    setLogFilePath(chosen.filePath);
                  }
                }}
                style={{ padding: '3px 6px', fontSize: 11 }}
              >
                <option value="">-- Pilih Hasil Deteksi ({detectedSources.length}) --</option>
                {detectedSources.map((src, i) => (
                  <option key={`${src.kind}:${src.filePath}`} value={i}>
                    [{src.kind.toUpperCase()}] {src.filePath}
                  </option>
                ))}
              </select>
            )}

            <button
              className="btn"
              style={{ padding: '3px 8px', fontSize: 11 }}
              disabled={detectingLogs}
              onClick={() => void handleAutoDetectLogs()}
              title="Cari otomatis error.log Apache/Nginx/PHP-FPM & storage/logs/laravel.log"
            >
              <Radar size={12} /> {detectingLogs ? 'Mencari...' : 'Deteksi Path'}
            </button>

            <button
              className="btn"
              style={{ padding: '3px 8px', fontSize: 11 }}
              onClick={() => void handleReadLogOnce()}
              title="Baca 120 baris terakhir sekarang"
            >
              <RefreshCw size={12} /> Baca Sekali
            </button>

            <button
              className={`btn ${logMonitorStatus.running ? '' : 'btn-primary'}`}
              style={{
                padding: '3px 9px',
                fontSize: 11.5,
                borderColor: logMonitorStatus.running ? '#ef4444' : undefined,
                color: logMonitorStatus.running ? '#fca5a5' : undefined
              }}
              onClick={() => void handleToggleLiveLog()}
            >
              {logMonitorStatus.running ? (
                <>
                  <Square size={11} /> Hentikan Live
                </>
              ) : (
                <>
                  <Play size={11} /> Pantau Live
                </>
              )}
            </button>

            <select
              value={logFilter}
              onChange={(e) => setLogFilter(e.target.value as 'all' | 'errors' | 'warnings')}
              style={{ padding: '3px 6px', fontSize: 11 }}
            >
              <option value="all">Semua Level</option>
              <option value="errors">Fatal &amp; Error</option>
              <option value="warnings">Warning</option>
            </select>

            <button
              className="icon-btn"
              title="Bersihkan Tampilan Log"
              onClick={clearServerLogEntries}
            >
              <Trash2 size={13} />
            </button>
          </div>

          {logMonitorStatus.lastError && (
            <div
              style={{
                padding: '5px 12px',
                background: 'rgba(239,68,68,0.14)',
                color: '#fca5a5',
                fontSize: 11.5
              }}
            >
              Error Pemantauan Log: {logMonitorStatus.lastError}
            </div>
          )}

          {/* Log Stream */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '6px 12px',
              fontFamily: 'Consolas, monospace',
              fontSize: 11.5
            }}
          >
            {filteredServerLogs.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', paddingTop: 6 }}>
                Klik <strong>Deteksi Path</strong> lalu <strong>Pantau Live</strong> untuk memantau{' '}
                <code>error.log</code> Apache/Nginx/PHP atau <code>laravel.log</code> secara real-time
                (termasuk notifikasi otomatis ke Dynamic Island saat terjadi Fatal Error).
              </div>
            ) : (
              filteredServerLogs.map((entry) => {
                const badgeColor =
                  entry.level === 'fatal'
                    ? '#ef4444'
                    : entry.level === 'error'
                      ? '#f87171'
                      : entry.level === 'warning'
                        ? '#fbbf24'
                        : '#38bdf8';

                return (
                  <div
                    key={entry.id}
                    style={{
                      padding: '4px 0',
                      borderBottom: '1px solid var(--border-subtle)',
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: 8
                    }}
                  >
                    <span
                      style={{
                        color: badgeColor,
                        fontWeight: 700,
                        minWidth: 56,
                        fontSize: 10.5
                      }}
                    >
                      [{entry.level.toUpperCase()}]
                    </span>
                    {entry.timestamp && (
                      <span style={{ color: 'var(--text-muted)', fontSize: 10.5, flexShrink: 0 }}>
                        {entry.timestamp}
                      </span>
                    )}
                    <span style={{ flex: 1, wordBreak: 'break-word', color: 'var(--text-primary)' }}>
                      {entry.message}
                    </span>
                    {entry.filePath && (
                      <button
                        className="btn"
                        style={{
                          padding: '1px 6px',
                          fontSize: 10.5,
                          flexShrink: 0,
                          color: '#38bdf8'
                        }}
                        onClick={() => void openLogEntryLocation(entry)}
                        title={`Buka ${entry.filePath} baris ${entry.line ?? 1}`}
                      >
                        <ExternalLink size={10} /> {entry.filePath.split(/[/\\]/).pop()}:
                        {entry.line ?? 1}
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {activeBottomTab === 'xdebug' && <XdebugPanel />}

      {activeBottomTab === 'output' && (
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '8px 12px',
            fontFamily: 'Consolas, monospace',
            fontSize: 12,
            whiteSpace: 'pre-wrap'
          }}
        >
          {commandOutputLines.length === 0 ? (
            <span style={{ color: 'var(--text-muted)' }}>
              Output dari perintah otomatisasi Rubles 2.0 akan tampil di sini.
            </span>
          ) : (
            commandOutputLines.join('\n')
          )}
        </div>
      )}
    </section>
  );
};
