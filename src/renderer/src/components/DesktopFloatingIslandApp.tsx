import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  ChevronDown,
  Cloud,
  ExternalLink,
  EyeOff,
  Globe,
  GripVertical,
  SaveAll,
  Search,
  Sparkles,
  TerminalSquare
} from 'lucide-react';
import type {
  DesktopIslandCommand,
  DesktopIslandSnapshot,
  IslandActivity,
  IslandTone
} from '@shared/types';

function toneColor(tone: IslandTone): string {
  switch (tone) {
    case 'sync':
      return '#38bdf8';
    case 'ai':
      return '#c084fc';
    case 'success':
      return '#22c55e';
    case 'error':
      return '#fb7185';
    case 'warning':
      return '#fbbf24';
    case 'command':
      return '#fb923c';
    case 'preview':
      return '#34d399';
    default:
      return '#94a3b8';
  }
}

export const DesktopFloatingIslandApp: React.FC = () => {
  const [snapshot, setSnapshot] = useState<DesktopIslandSnapshot | null>(null);
  const [liveOverride, setLiveOverride] = useState<IslandActivity | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [quickQuery, setQuickQuery] = useState('');
  const quickInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    document.documentElement.classList.add('desktop-island-mode');
    void window.aptana.island.getSnapshot().then((snap) => {
      if (snap) setSnapshot(snap);
    });

    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubSnap = window.aptana.island.onSnapshot((snap) => {
      setSnapshot(snap);
    });
    const unsubAct = window.aptana.island.onActivity((act) => {
      if (timer) clearTimeout(timer);
      setLiveOverride(act);
      if (!act.busy) {
        timer = setTimeout(() => {
          setLiveOverride((prev) => (prev?.id === act.id ? null : prev));
        }, act.tone === 'error' ? 6200 : 4200);
      }
    });

    return () => {
      if (timer) clearTimeout(timer);
      unsubSnap();
      unsubAct();
      document.documentElement.classList.remove('desktop-island-mode');
    };
  }, []);

  const toggleExpand = (next?: boolean): void => {
    const val = next ?? !expanded;
    setExpanded(val);
    void window.aptana.island.setExpanded(val);
  };

  const sendCmd = (cmd: DesktopIslandCommand, collapseAfter = true): void => {
    if (collapseAfter && expanded) {
      toggleExpand(false);
    }
    void window.aptana.island.dispatchCommand(cmd);
  };

  const activity = liveOverride ?? snapshot?.activeActivity ?? null;
  const phpErr = snapshot?.firstPhpError ?? null;
  const dirtyCount = snapshot?.dirtyCount ?? 0;
  const isConnError =
    Boolean(snapshot?.connectionName) && snapshot?.connectionStatus === 'error';

  const activeTone: IslandTone = activity
    ? activity.tone
    : phpErr || isConnError
      ? 'error'
      : dirtyCount > 0
        ? 'warning'
        : snapshot?.previewRunning
          ? 'preview'
          : snapshot?.connectionName
            ? 'sync'
            : 'neutral';

  const accent = toneColor(activeTone);

  return (
    <div className="desktop-island-shell">
      <div
        className={`desktop-island-pill ${activity ? 'is-live' : ''}`}
        style={{ '--island-accent': accent } as React.CSSProperties}
      >
        {/* Drag Handle */}
        <div
          className="desktop-island-drag"
          title="Geser posisi Dynamic Island di layar"
        >
          <GripVertical size={13} />
        </div>

        {/* Status Orb */}
        <div
          style={{ display: 'flex', alignItems: 'center', flexShrink: 0, cursor: 'pointer' }}
          onClick={() => toggleExpand()}
        >
          {activity?.busy || snapshot?.connectionStatus === 'connecting' ? (
            <span
              className="island-waveform"
              style={{ '--island-color': accent } as React.CSSProperties}
            >
              <i />
              <i />
              <i />
              <i />
            </span>
          ) : phpErr || isConnError || activity?.tone === 'error' ? (
            <AlertTriangle size={14} color="#fb7185" />
          ) : activity?.tone === 'ai' ? (
            <Sparkles size={14} color="#c084fc" />
          ) : activity ? (
            <CheckCircle2 size={14} color={accent} />
          ) : snapshot?.connectionName ? (
            <Cloud size={13.5} color="#38bdf8" />
          ) : (
            <span className="island-dot" style={{ background: accent }} />
          )}
        </div>

        {/* Center Morphing Text */}
        <div
          className="desktop-island-text"
          onClick={() => toggleExpand()}
          title="Klik untuk memperluas kontrol cepat HMW Studio"
        >
          {activity ? (
            <>
              <span
                className="dynamic-island-badge"
                style={{
                  color: accent,
                  borderColor: `${accent}44`,
                  background: `${accent}18`
                }}
              >
                {activity.badge}
              </span>
              <span className="desktop-island-title">{activity.title}</span>
            </>
          ) : (
            <>
              <span className="desktop-island-brand">
                {snapshot?.connectionName
                  ? `${snapshot.connectionName}${snapshot.keepSynchronized ? ' ⚡' : ''}`
                  : snapshot?.projectName || 'HMW Studio'}
              </span>
              {phpErr ? (
                <span className="dynamic-island-chip chip-error">
                  🔴 {phpErr.fileTitle}:{phpErr.line}
                </span>
              ) : isConnError ? (
                <span
                  className="dynamic-island-chip chip-error"
                  title={snapshot?.connectionError || 'Koneksi server gagal'}
                >
                  🔴 {snapshot?.connectionProtocol?.toUpperCase()} Tidak Konek
                </span>
              ) : dirtyCount > 0 ? (
                <span className="dynamic-island-chip chip-warn">
                  ● {dirtyCount} belum disimpan
                </span>
              ) : snapshot?.previewRunning ? (
                <span className="dynamic-island-chip chip-ok">
                  🟢 :{snapshot.previewPort}
                </span>
              ) : (
                <span className="dynamic-island-chip">
                  {snapshot?.frameworkBadge || 'Aktif'}
                </span>
              )}
            </>
          )}
        </div>

        {/* Contextual 1-Click Action */}
        {activity?.actionType && activity?.actionLabel ? (
          <button
            type="button"
            className={`desktop-island-cta ${activity.tone === 'error' ? 'cta-error' : ''}`}
            onClick={() => {
              if (activity.actionType === 'jump-error') {
                sendCmd({
                  type: 'jump-error',
                  tabId: activity.jumpTabId,
                  line: activity.jumpLine
                });
              } else {
                sendCmd({ type: activity.actionType } as DesktopIslandCommand);
              }
            }}
            title={activity.subtitle || activity.title}
          >
            {activity.actionLabel}
          </button>
        ) : phpErr ? (
          <button
            type="button"
            className="desktop-island-cta cta-error"
            onClick={() =>
              sendCmd({ type: 'jump-error', tabId: phpErr.tabId, line: phpErr.line })
            }
            title={`${phpErr.fileTitle} Baris ${phpErr.line}: ${phpErr.message}`}
          >
            Lompat :{phpErr.line}
          </button>
        ) : isConnError ? (
          <button
            type="button"
            className="desktop-island-cta cta-error"
            onClick={() => sendCmd({ type: 'edit-connection' })}
            title={snapshot?.connectionError || 'Perbaiki konfigurasi koneksi server'}
          >
            Edit Server
          </button>
        ) : dirtyCount > 0 ? (
          <button
            type="button"
            className="desktop-island-cta cta-warn"
            onClick={() => sendCmd({ type: 'save-all' }, false)}
            title="Simpan semua perubahan langsung ke server SFTP / disk tanpa meninggalkan Browser"
          >
            Simpan ({dirtyCount})
          </button>
        ) : (
          <button
            type="button"
            className="desktop-island-cta"
            onClick={() => sendCmd({ type: 'focus-ide' })}
            title="Buka & fokuskan jendela utama HMW Studio"
          >
            Buka IDE
          </button>
        )}

        {/* Search Quick Trigger */}
        <button
          type="button"
          className="desktop-island-chevron"
          onClick={() => {
            if (!expanded) {
              toggleExpand(true);
            }
            setTimeout(() => quickInputRef.current?.focus(), 40);
          }}
          title="Cari File / Isi Kode di HMW Studio"
        >
          <Search size={12.5} />
        </button>

        {/* Expand Toggle */}
        <button
          type="button"
          className="desktop-island-chevron"
          onClick={() => toggleExpand()}
          title={expanded ? 'Tutup panel cepat' : 'Buka panel kontrol cepat'}
        >
          <ChevronDown
            size={13}
            style={{
              transform: expanded ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.2s ease'
            }}
          />
        </button>
      </div>

      {expanded && (
        <div className="desktop-island-drawer">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: '#f8fafc' }}>
              HMW Studio • Kontrol Cepat & Pencarian Desktop
            </div>
            {snapshot?.gitBranch && (
              <span className="island-meta-pill">
                ⎇ {snapshot.gitBranch}
                {snapshot.gitChangeCount > 0 ? ` *${snapshot.gitChangeCount}` : ''}
              </span>
            )}
          </div>

          <form
            className="desktop-island-search-form"
            onSubmit={(e) => {
              e.preventDefault();
              sendCmd({
                type: 'island-search',
                query: quickQuery.trim(),
                mode: 'all'
              });
              setQuickQuery('');
            }}
          >
            <Search size={12.5} color="#38bdf8" style={{ flexShrink: 0 }} />
            <input
              ref={quickInputRef}
              type="text"
              className="desktop-island-search-input"
              placeholder="Cari nama file, @fungsi, atau isi kode di IDE..."
              value={quickQuery}
              onChange={(e) => setQuickQuery(e.target.value)}
            />
            <button
              type="submit"
              className="desktop-mini-link"
              title="Buka pencarian file & simbol di Dynamic Island IDE"
            >
              File
            </button>
            <button
              type="button"
              className="desktop-mini-link"
              onClick={() => {
                sendCmd({
                  type: 'island-search',
                  query: quickQuery.trim(),
                  mode: 'content'
                });
                setQuickQuery('');
              }}
              title="Cari teks ini di dalam isi kode (Grep) di Dynamic Island IDE"
            >
              Isi Kode
            </button>
          </form>

          {phpErr && (
            <div
              style={{
                padding: '6px 8px',
                borderRadius: 8,
                background: 'rgba(244, 63, 94, 0.14)',
                border: '1px solid rgba(251, 113, 133, 0.4)',
                fontSize: 11,
                color: '#fecdd3',
                marginBottom: 8,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              🔴 {phpErr.fileTitle}:{phpErr.line} — {phpErr.message}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 8 }}>
            <button
              type="button"
              className="desktop-drawer-btn"
              onClick={() => sendCmd({ type: 'focus-ide' })}
            >
              <ExternalLink size={12.5} color="#fb923c" />
              <span>Buka IDE</span>
            </button>
            <button
              type="button"
              className="desktop-drawer-btn"
              disabled={dirtyCount === 0}
              onClick={() => sendCmd({ type: 'save-all' }, false)}
            >
              <SaveAll size={12.5} color="#38bdf8" />
              <span>Simpan ({dirtyCount})</span>
            </button>
            <button
              type="button"
              className="desktop-drawer-btn"
              onClick={() => sendCmd({ type: 'open-sync' })}
            >
              <ArrowLeftRight size={12.5} color="#38bdf8" />
              <span>Visual Sync</span>
            </button>
            <button
              type="button"
              className="desktop-drawer-btn"
              onClick={() => sendCmd({ type: 'open-ai' })}
            >
              <Sparkles size={12.5} color="#c084fc" />
              <span>Gemini AI</span>
            </button>
            <button
              type="button"
              className="desktop-drawer-btn"
              onClick={() => sendCmd({ type: 'open-preview' })}
            >
              <Globe size={12.5} color="#34d399" />
              <span>
                {snapshot?.previewRunning ? `Reload :${snapshot.previewPort}` : 'Live Preview'}
              </span>
            </button>
            <button
              type="button"
              className="desktop-drawer-btn"
              onClick={() => sendCmd({ type: 'open-terminal' })}
            >
              <TerminalSquare size={12.5} color="#fbbf24" />
              <span>Terminal</span>
            </button>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingTop: 6,
              borderTop: '1px solid rgba(148, 163, 184, 0.16)',
              fontSize: 11
            }}
          >
            <span style={{ color: '#94a3b8' }}>
              Mode: {snapshot?.mode === 'always' ? 'Selalu Tampil' : 'Otomatis saat di luar IDE'}
            </span>
            <div style={{ display: 'flex', gap: 5 }}>
              {snapshot?.mode === 'always' ? (
                <button
                  type="button"
                  className="desktop-mini-link"
                  onClick={() => sendCmd({ type: 'set-mode', mode: 'auto' })}
                >
                  Ubah ke Otomatis
                </button>
              ) : (
                <button
                  type="button"
                  className="desktop-mini-link"
                  onClick={() => sendCmd({ type: 'set-mode', mode: 'always' }, false)}
                >
                  Sematkan Selalu
                </button>
              )}
              <button
                type="button"
                className="desktop-mini-link danger"
                onClick={() => sendCmd({ type: 'set-mode', mode: 'off' })}
                title="Nonaktifkan overlay mengambang (dapat dinyalakan lagi dari Dynamic Island di dalam IDE)"
              >
                <EyeOff size={11} />
                <span>Sembunyikan</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
