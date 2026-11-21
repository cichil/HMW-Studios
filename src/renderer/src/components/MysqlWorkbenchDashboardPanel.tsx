import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Database,
  Flame,
  Gauge,
  HardDrive,
  Lock,
  Pause,
  Play,
  RefreshCw,
  Search,
  Settings2,
  Skull,
  Zap
} from 'lucide-react';
import {
  computeMysqlRateDelta,
  type DbHealthSnapshot,
  type DbRealtimeRatePoint
} from '@shared/mysqlHealthAnalyzer';
import { useIdeStore } from '../store/useIdeStore';

type WorkbenchSubTab = 'advisories' | 'slow-sql' | 'locks' | 'storage';

const SparklineCard: React.FC<{
  title: string;
  primaryValue: string;
  secondaryLabel: string;
  points: number[];
  secondaryPoints?: number[];
  strokeColor: string;
  secondaryColor?: string;
}> = ({
  title,
  primaryValue,
  secondaryLabel,
  points,
  secondaryPoints,
  strokeColor,
  secondaryColor = '#34d399'
}) => {
  const w = 280;
  const h = 58;
  const allVals = [...points, ...(secondaryPoints ?? []), 1];
  const maxVal = Math.max(...allVals, 1);

  const buildPath = (arr: number[]): { line: string; area: string } => {
    if (arr.length === 0) {
      return { line: `M 0 ${h - 4} L ${w} ${h - 4}`, area: '' };
    }
    const padded = arr.length === 1 ? [arr[0], arr[0]] : arr;
    const stepX = w / Math.max(1, padded.length - 1);
    const coords = padded.map((v, idx) => {
      const x = Number((idx * stepX).toFixed(1));
      const y = Number((h - 5 - (Math.max(0, v) / maxVal) * (h - 12)).toFixed(1));
      return `${x},${y}`;
    });
    const line = `M ${coords.join(' L ')}`;
    const area = `${line} L ${w},${h} L 0,${h} Z`;
    return { line, area };
  };

  const mainPaths = buildPath(points);
  const secPaths = secondaryPoints ? buildPath(secondaryPoints) : null;

  return (
    <div
      style={{
        padding: '11px 13px',
        borderRadius: 9,
        background: 'var(--bg-app)',
        border: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minWidth: 0
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)' }}>
          {title}
        </span>
        <span style={{ fontSize: 15, fontWeight: 800, fontFamily: 'var(--font-mono)', color: strokeColor }}>
          {primaryValue}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${w} ${h}`}
        style={{
          width: '100%',
          height: 58,
          borderRadius: 6,
          background: 'rgba(15, 23, 42, 0.45)',
          overflow: 'hidden'
        }}
        preserveAspectRatio="none"
      >
        <line x1={0} y1={h / 2} x2={w} y2={h / 2} stroke="rgba(148,163,184,0.12)" strokeDasharray="3 3" />
        {mainPaths.area && (
          <path d={mainPaths.area} fill={strokeColor} fillOpacity={0.16} />
        )}
        {secPaths && (
          <path
            d={secPaths.line}
            fill="none"
            stroke={secondaryColor}
            strokeWidth={1.6}
            strokeDasharray="3 2"
          />
        )}
        <path d={mainPaths.line} fill="none" stroke={strokeColor} strokeWidth={2.1} />
      </svg>

      <div style={{ fontSize: 10.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
        {secondaryLabel}
      </div>
    </div>
  );
};

export const MysqlWorkbenchDashboardPanel: React.FC<{
  targetDbId: string;
}> = ({ targetDbId }) => {
  const { dbSchema, showToast } = useIdeStore();

  const [snapshot, setSnapshot] = useState<DbHealthSnapshot | null>(null);
  const [rateHistory, setRateHistory] = useState<DbRealtimeRatePoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [subTabLoading, setSubTabLoading] = useState(false);
  const [pollLatencyMs, setPollLatencyMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [livePolling, setLivePolling] = useState(true);
  const [subTab, setSubTab] = useState<WorkbenchSubTab>('advisories');
  const [loadedSubTabs, setLoadedSubTabs] = useState<Record<string, boolean>>({});
  const [varSearch, setVarSearch] = useState('');
  const [optimizingTable, setOptimizingTable] = useState<string | null>(null);
  const [killingPid, setKillingPid] = useState<number | null>(null);

  const prevSnapRef = useRef<DbHealthSnapshot | null>(null);
  const inFlightFastRef = useRef(false);

  const fetchSnapshot = useCallback(
    async (silent = false) => {
      if (!targetDbId || inFlightFastRef.current) return;
      inFlightFastRef.current = true;
      if (!silent) setLoading(true);
      setError(null);
      const t0 = performance.now();
      try {
        const activeDb =
          dbSchema?.profileId === targetDbId ? dbSchema.currentDatabase : undefined;
        const nextSnap = await window.aptana.db.inspectHealth(targetDbId, activeDb, 'fast');
        setPollLatencyMs(Math.max(1, Math.round(performance.now() - t0)));
        if (prevSnapRef.current && prevSnapRef.current.profileId === nextSnap.profileId) {
          const delta = computeMysqlRateDelta(prevSnapRef.current, nextSnap);
          if (delta) {
            setRateHistory((prev) => [...prev.slice(-29), delta]);
          }
        }
        prevSnapRef.current = nextSnap;
        // Merge previously fetched heavy sub-tab slices so fast 3s ticks keep them intact
        setSnapshot((prev) =>
          prev && prev.profileId === nextSnap.profileId
            ? {
                ...nextSnap,
                digestQueries: prev.digestQueries,
                lockWaits: prev.lockWaits,
                storageByDb: prev.storageByDb,
                largestTables: prev.largestTables
              }
            : nextSnap
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        inFlightFastRef.current = false;
        if (!silent) setLoading(false);
      }
    },
    [targetDbId, dbSchema]
  );

  const fetchSubTabData = useCallback(
    async (mode: 'slow-sql' | 'locks' | 'storage') => {
      if (!targetDbId) return;
      setSubTabLoading(true);
      try {
        const activeDb =
          dbSchema?.profileId === targetDbId ? dbSchema.currentDatabase : undefined;
        const detailSnap = await window.aptana.db.inspectHealth(targetDbId, activeDb, mode);
        setLoadedSubTabs((prev) => ({ ...prev, [mode]: true }));
        setSnapshot((prev) => {
          if (!prev) return detailSnap;
          return {
            ...prev,
            digestQueries: mode === 'slow-sql' ? detailSnap.digestQueries : prev.digestQueries,
            lockWaits: mode === 'locks' ? detailSnap.lockWaits : prev.lockWaits,
            storageByDb: mode === 'storage' ? detailSnap.storageByDb : prev.storageByDb,
            largestTables: mode === 'storage' ? detailSnap.largestTables : prev.largestTables
          };
        });
      } catch (err) {
        showToast(`Gagal memuat detail tab: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setSubTabLoading(false);
      }
    },
    [targetDbId, dbSchema, showToast]
  );

  // Reset history when switching DB profile & load fast telemetry immediately
  useEffect(() => {
    prevSnapRef.current = null;
    inFlightFastRef.current = false;
    setRateHistory([]);
    setSnapshot(null);
    setLoadedSubTabs({});
    if (!targetDbId) return undefined;
    let cancelled = false;
    void fetchSnapshot(false).then(() => {
      if (!cancelled) {
        setTimeout(() => {
          if (!cancelled) void fetchSnapshot(true);
        }, 1200);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [targetDbId, fetchSnapshot]);

  // Chained non-overlapping live poll loop (zero queue buildup!)
  useEffect(() => {
    if (!targetDbId || !livePolling) return undefined;
    let stopped = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    const scheduleNext = (): void => {
      timerId = setTimeout(() => {
        if (stopped) return;
        void fetchSnapshot(true).finally(() => {
          if (!stopped) scheduleNext();
        });
      }, 3000);
    };
    scheduleNext();
    return () => {
      stopped = true;
      if (timerId) clearTimeout(timerId);
    };
  }, [targetDbId, livePolling, fetchSnapshot]);

  // Lazy load sub-tab data only when user clicks that sub-tab!
  useEffect(() => {
    if (subTab === 'advisories' || !targetDbId) return;
    if (!loadedSubTabs[subTab]) {
      void fetchSubTabData(subTab);
    }
  }, [subTab, targetDbId, loadedSubTabs, fetchSubTabData]);

  const latestRate = rateHistory[rateHistory.length - 1] ?? null;

  const filteredVars = useMemo(() => {
    if (!snapshot) return [];
    const q = varSearch.trim().toLowerCase();
    if (!q) return snapshot.variables;
    return snapshot.variables.filter(
      (v) => v.name.toLowerCase().includes(q) || v.value.toLowerCase().includes(q)
    );
  }, [snapshot, varSearch]);

  const handleKillBlocker = async (pid: number): Promise<void> => {
    if (!targetDbId) return;
    if (!window.confirm(`Hentikan paksa (KILL) sesi pemblokir #${pid}?`)) return;
    setKillingPid(pid);
    try {
      const res = await window.aptana.db.killProcess(targetDbId, pid);
      showToast(res.message);
      await fetchSnapshot(true);
    } catch (err) {
      showToast(`Gagal KILL #${pid}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setKillingPid(null);
    }
  };

  const handleOptimizeTable = async (database: string, table: string): Promise<void> => {
    if (!targetDbId) return;
    if (
      !window.confirm(
        `Jalankan OPTIMIZE TABLE pada "${database}.${table}" untuk merapikan ruang fragmentasi?`
      )
    ) {
      return;
    }
    setOptimizingTable(`${database}.${table}`);
    try {
      const res = await window.aptana.db.optimizeTable(targetDbId, { database, table });
      showToast(`⚡ ${res.message}`);
      await fetchSnapshot(true);
    } catch (err) {
      showToast(`Gagal OPTIMIZE TABLE: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setOptimizingTable(null);
    }
  };

  if (!targetDbId) {
    return (
      <div style={{ padding: 36, textAlign: 'center', color: 'var(--text-muted)' }}>
        Pilih profil koneksi Database di kanan atas untuk membuka MySQL Performance Dashboard.
      </div>
    );
  }

  if (error && !snapshot) {
    return (
      <div
        style={{
          padding: 16,
          borderRadius: 8,
          background: 'rgba(239, 68, 68, 0.14)',
          border: '1px solid rgba(239, 68, 68, 0.4)',
          color: '#fca5a5',
          fontSize: 12.5
        }}
      >
        <strong>Gagal membaca telemetri MySQL:</strong> {error}
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div
        style={{
          minHeight: 260,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          color: 'var(--text-secondary)'
        }}
      >
        <RefreshCw size={24} className="spin" color="#38bdf8" />
        <div>Mengambil telemetri kesehatan database (SHOW GLOBAL STATUS &amp; performance_schema)...</div>
      </div>
    );
  }

  const bpColor =
    snapshot.bufferPool.hitRatioPct >= 98
      ? '#34d399'
      : snapshot.bufferPool.hitRatioPct >= 94
        ? '#fbbf24'
        : '#ef4444';
  const connColor =
    snapshot.connections.usagePct < 65
      ? '#38bdf8'
      : snapshot.connections.usagePct < 85
        ? '#fbbf24'
        : '#ef4444';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Top Server Identity & Live Stream Strip */}
      <div
        style={{
          padding: '10px 14px',
          borderRadius: 9,
          background: 'var(--bg-app)',
          border: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 10
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span
            style={{
              padding: '3px 9px',
              borderRadius: 999,
              background: livePolling ? 'rgba(16, 185, 129, 0.16)' : 'rgba(148, 163, 184, 0.14)',
              border: livePolling
                ? '1px solid rgba(52, 211, 153, 0.4)'
                : '1px solid var(--border-subtle)',
              color: livePolling ? '#6ee7b7' : 'var(--text-muted)',
              fontSize: 11,
              fontWeight: 700
            }}
          >
            {livePolling ? '● LIVE 3d' : '⏸ PAUSED'}
          </span>
          <span style={{ fontWeight: 700, fontSize: 13 }}>{snapshot.serverVersion}</span>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            • Uptime: <strong style={{ color: 'var(--text-secondary)' }}>{snapshot.uptimeLabel}</strong>
          </span>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            • Total Kueri: <strong style={{ color: 'var(--text-secondary)' }}>{snapshot.counters.questions.toLocaleString('id-ID')}</strong>
          </span>
          {pollLatencyMs !== null && (
            <span style={{ fontSize: 11, color: '#38bdf8', fontFamily: 'var(--font-mono)' }}>
              • ⚡ {pollLatencyMs} ms
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <button
            type="button"
            className={`btn ${livePolling ? 'btn-primary' : ''}`}
            style={{ padding: '4px 10px', fontSize: 11.5 }}
            onClick={() => setLivePolling((v) => !v)}
          >
            {livePolling ? <Pause size={12} /> : <Play size={12} />}
            <span>{livePolling ? 'Jeda Grafik Live' : 'Lanjutkan Live'}</span>
          </button>
          <button
            type="button"
            className="btn"
            style={{ padding: '4px 10px', fontSize: 11.5 }}
            disabled={loading || subTabLoading}
            onClick={() => {
              void fetchSnapshot(false);
              if (subTab !== 'advisories') {
                void fetchSubTabData(subTab);
              }
            }}
          >
            <RefreshCw size={12} className={loading || subTabLoading ? 'spin' : ''} />
            <span>Segarkan</span>
          </button>
        </div>
      </div>

      {/* ROW 1: 3 Live MySQL Workbench Sparkline Charts */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 10
        }}
      >
        <SparklineCard
          title="Queries Per Second (QPS)"
          primaryValue={`${latestRate ? latestRate.qps : 0} q/s`}
          secondaryLabel={`SELECT: ${latestRate?.selectPerSec ?? 0}/s • TULIS (I/U/D): ${latestRate?.writePerSec ?? 0}/s`}
          points={rateHistory.map((r) => r.qps)}
          secondaryPoints={rateHistory.map((r) => r.writePerSec)}
          strokeColor="#38bdf8"
          secondaryColor="#34d399"
        />

        <SparklineCard
          title="Lalu Lintas Jaringan DB (Traffic)"
          primaryValue={`${latestRate ? (latestRate.netInKbps + latestRate.netOutKbps).toFixed(1) : '0.0'} KB/s`}
          secondaryLabel={`Keluar (Result): ${latestRate?.netOutKbps ?? 0} KB/s • Masuk: ${latestRate?.netInKbps ?? 0} KB/s`}
          points={rateHistory.map((r) => r.netOutKbps)}
          secondaryPoints={rateHistory.map((r) => r.netInKbps)}
          strokeColor="#c084fc"
          secondaryColor="#38bdf8"
        />

        <SparklineCard
          title="InnoDB Disk I/O (Reads vs Writes)"
          primaryValue={`${latestRate ? (latestRate.innodbReadsPerSec + latestRate.innodbWritesPerSec).toFixed(1) : '0.0'} op/s`}
          secondaryLabel={`Disk Reads: ${latestRate?.innodbReadsPerSec ?? 0}/s • Disk Writes: ${latestRate?.innodbWritesPerSec ?? 0}/s`}
          points={rateHistory.map((r) => r.innodbWritesPerSec)}
          secondaryPoints={rateHistory.map((r) => r.innodbReadsPerSec)}
          strokeColor="#fb923c"
          secondaryColor="#facc15"
        />
      </div>

      {/* ROW 2: 4 Key MySQL Workbench Health Gauges */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(215px, 1fr))',
          gap: 10
        }}
      >
        {/* Gauge 1: InnoDB Buffer Pool */}
        <div
          style={{
            padding: '11px 13px',
            borderRadius: 9,
            background: 'var(--bg-app)',
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11.5, color: 'var(--text-secondary)', fontWeight: 600 }}>
              InnoDB Buffer Hit Ratio
            </span>
            <Gauge size={14} color={bpColor} />
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: bpColor, fontFamily: 'var(--font-mono)' }}>
            {snapshot.bufferPool.hitRatioPct}%
          </div>
          <div style={{ height: 5, borderRadius: 999, background: 'rgba(148,163,184,0.16)', overflow: 'hidden' }}>
            <div style={{ width: `${snapshot.bufferPool.usagePct}%`, height: '100%', background: bpColor }} />
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
            RAM Terpakai: <strong>{snapshot.bufferPool.usedMb} MB</strong> / {snapshot.bufferPool.sizeMb} MB ({snapshot.bufferPool.usagePct}%)
          </div>
        </div>

        {/* Gauge 2: Client Connections */}
        <div
          style={{
            padding: '11px 13px',
            borderRadius: 9,
            background: 'var(--bg-app)',
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11.5, color: 'var(--text-secondary)', fontWeight: 600 }}>
              Beban Koneksi Klien
            </span>
            <Activity size={14} color={connColor} />
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: connColor, fontFamily: 'var(--font-mono)' }}>
            {snapshot.connections.threadsConnected}{' '}
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)' }}>
              / {snapshot.connections.maxConnections}
            </span>
          </div>
          <div style={{ height: 5, borderRadius: 999, background: 'rgba(148,163,184,0.16)', overflow: 'hidden' }}>
            <div style={{ width: `${snapshot.connections.usagePct}%`, height: '100%', background: connColor }} />
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
            Aktif Running: <strong>{snapshot.connections.threadsRunning}</strong> • Puncak: {snapshot.connections.maxUsedConnections}
          </div>
        </div>

        {/* Gauge 3: Full Joins & Slow Queries */}
        <div
          style={{
            padding: '11px 13px',
            borderRadius: 9,
            background: 'var(--bg-app)',
            border:
              snapshot.bottlenecks.selectFullJoin > 0
                ? '1px solid rgba(249, 115, 22, 0.4)'
                : '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11.5, color: 'var(--text-secondary)', fontWeight: 600 }}>
              JOIN Tanpa Index &amp; Slow SQL
            </span>
            <Flame
              size={14}
              color={snapshot.bottlenecks.selectFullJoin > 0 ? '#fb923c' : '#34d399'}
            />
          </div>
          <div
            style={{
              fontSize: 20,
              fontWeight: 800,
              color: snapshot.bottlenecks.selectFullJoin > 0 ? '#fb923c' : '#34d399',
              fontFamily: 'var(--font-mono)'
            }}
          >
            {snapshot.bottlenecks.selectFullJoin.toLocaleString('id-ID')}{' '}
            <span style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--text-muted)' }}>
              Full Join
            </span>
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 'auto' }}>
            Slow Queries tercatat: <strong>{snapshot.bottlenecks.slowQueries.toLocaleString('id-ID')}</strong>
          </div>
        </div>

        {/* Gauge 4: Temp Disk Tables & Locks */}
        <div
          style={{
            padding: '11px 13px',
            borderRadius: 9,
            background: 'var(--bg-app)',
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11.5, color: 'var(--text-secondary)', fontWeight: 600 }}>
              Tmp Table di Disk &amp; Lock
            </span>
            <HardDrive size={14} color="#a855f7" />
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#c084fc', fontFamily: 'var(--font-mono)' }}>
            {snapshot.bottlenecks.tmpDiskRatioPct}%{' '}
            <span style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--text-muted)' }}>
              ke Disk
            </span>
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 'auto' }}>
            Tmp Disk: {snapshot.bottlenecks.tmpDiskTables.toLocaleString('id-ID')} • Lock Aktif:{' '}
            <strong style={{ color: snapshot.lockWaits.length > 0 ? '#f87171' : 'inherit' }}>
              {snapshot.lockWaits.length}
            </strong>
          </div>
        </div>
      </div>

      {/* ROW 3: Workbench Diagnostic Sub-Tabs */}
      <div
        style={{
          borderRadius: 10,
          background: 'var(--bg-app)',
          border: '1px solid var(--border-subtle)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        <div
          style={{
            padding: '9px 12px',
            background: 'var(--bg-elevated)',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flexWrap: 'wrap'
          }}
        >
          <button
            type="button"
            className={`btn ${subTab === 'advisories' ? 'btn-primary' : ''}`}
            style={{ padding: '5px 11px', fontSize: 12 }}
            onClick={() => setSubTab('advisories')}
          >
            <Settings2 size={13} />
            <span>Tuning Advisor &amp; Variabel ({snapshot.advisories.length})</span>
          </button>

          <button
            type="button"
            className={`btn ${subTab === 'slow-sql' ? 'btn-primary' : ''}`}
            style={{ padding: '5px 11px', fontSize: 12 }}
            onClick={() => setSubTab('slow-sql')}
          >
            <Flame size={13} />
            <span>Top Heavy / Slow SQL ({snapshot.digestQueries.length})</span>
          </button>

          <button
            type="button"
            className={`btn ${subTab === 'locks' ? 'btn-primary' : ''}`}
            style={{ padding: '5px 11px', fontSize: 12 }}
            onClick={() => setSubTab('locks')}
          >
            <Lock size={13} />
            <span>
              InnoDB Lock Waits ({snapshot.lockWaits.length})
              {snapshot.lockWaits.length > 0 ? ' 🔴' : ''}
            </span>
          </button>

          <button
            type="button"
            className={`btn ${subTab === 'storage' ? 'btn-primary' : ''}`}
            style={{ padding: '5px 11px', fontSize: 12 }}
            onClick={() => setSubTab('storage')}
          >
            <Database size={13} />
            <span>Storage, Index &amp; Fragmentasi ({snapshot.largestTables.length})</span>
          </button>
        </div>

        <div style={{ padding: 14 }}>
          {subTabLoading && subTab !== 'advisories' && (
            <div
              style={{
                padding: '10px 12px',
                marginBottom: 10,
                borderRadius: 7,
                background: 'rgba(56, 189, 248, 0.1)',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12,
                color: '#7dd3fc'
              }}
            >
              <RefreshCw size={13} className="spin" />
              <span>Memuat rincian tab ini dari server MySQL...</span>
            </div>
          )}

          {/* SUB-TAB 1: TUNING ADVISOR + SERVER VARIABLES */}
          {subTab === 'advisories' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {snapshot.advisories.map((adv) => {
                  const borderCol =
                    adv.severity === 'critical'
                      ? '#ef4444'
                      : adv.severity === 'warning'
                        ? '#f59e0b'
                        : '#22c55e';
                  return (
                    <div
                      key={adv.id}
                      style={{
                        padding: '10px 13px',
                        borderRadius: 8,
                        background: 'var(--bg-surface)',
                        borderLeft: `3px solid ${borderCol}`,
                        borderTop: '1px solid var(--border-subtle)',
                        borderRight: '1px solid var(--border-subtle)',
                        borderBottom: '1px solid var(--border-subtle)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 700, fontSize: 12.5 }}>
                          {adv.severity === 'critical' ? (
                            <AlertOctagon size={14} color="#ef4444" />
                          ) : adv.severity === 'warning' ? (
                            <AlertTriangle size={14} color="#f59e0b" />
                          ) : (
                            <CheckCircle2 size={14} color="#22c55e" />
                          )}
                          <span>{adv.title}</span>
                        </div>
                        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: '#7dd3fc' }}>
                          {adv.variableName} = {adv.currentValue}
                          {adv.recommendedValue ? ` → Saran: ${adv.recommendedValue}` : ''}
                        </span>
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                        {adv.explanation}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Variables Search Table */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: 12.5 }}>
                    Variabel Konfigurasi Utama Server ({filteredVars.length})
                  </span>
                  <div style={{ position: 'relative', width: 260 }}>
                    <Search
                      size={13}
                      style={{ position: 'absolute', left: 9, top: 9, color: 'var(--text-muted)' }}
                    />
                    <input
                      type="text"
                      className="form-input"
                      style={{ width: '100%', paddingLeft: 28, height: 32, fontSize: 11.5 }}
                      placeholder="Cari variabel (innodb_, max_, tmp_)..."
                      value={varSearch}
                      onChange={(e) => setVarSearch(e.target.value)}
                    />
                  </div>
                </div>

                <div style={{ maxHeight: 230, overflowY: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 7 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-surface)', textAlign: 'left' }}>
                        <th style={{ padding: '6px 10px' }}>Nama Variabel</th>
                        <th style={{ padding: '6px 10px' }}>Nilai Aktif</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredVars.map((v) => (
                        <tr key={v.name} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                          <td style={{ padding: '5px 10px', fontFamily: 'var(--font-mono)', color: '#7dd3fc' }}>
                            {v.name}
                          </td>
                          <td style={{ padding: '5px 10px', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
                            {v.value}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* SUB-TAB 2: TOP SLOW / HEAVY DIGEST QUERIES */}
          {subTab === 'slow-sql' && (
            <div>
              {snapshot.digestQueries.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                  {snapshot.performanceSchemaEnabled
                    ? 'Belum ada ringkasan kueri berat di performance_schema atau akun DB tidak memiliki akses SELECT ke performance_schema.'
                    : 'performance_schema sedang OFF pada server MySQL ini. Aktifkan performance_schema=ON di my.cnf untuk melacak Top Slow Digest SQL.'}
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-surface)', textAlign: 'left' }}>
                        <th style={{ padding: '7px 9px' }}>Pola SQL Digest</th>
                        <th style={{ padding: '7px 9px' }}>DB</th>
                        <th style={{ padding: '7px 9px', textAlign: 'right' }}>Eksekusi</th>
                        <th style={{ padding: '7px 9px', textAlign: 'right' }}>Rata-rata</th>
                        <th style={{ padding: '7px 9px', textAlign: 'right' }}>Total Waktu</th>
                        <th style={{ padding: '7px 9px', textAlign: 'right' }}>Rows Examined</th>
                        <th style={{ padding: '7px 9px' }}>Status Index</th>
                        <th style={{ padding: '7px 9px' }}>Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshot.digestQueries.map((dq, idx) => (
                        <tr key={idx} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                          <td
                            style={{
                              padding: '6px 9px',
                              fontFamily: 'var(--font-mono)',
                              maxWidth: 370,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap'
                            }}
                            title={dq.digestText}
                          >
                            {dq.digestText}
                          </td>
                          <td style={{ padding: '6px 9px', fontFamily: 'var(--font-mono)', color: '#7dd3fc' }}>
                            {dq.schemaName || '-'}
                          </td>
                          <td style={{ padding: '6px 9px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                            {dq.execCount.toLocaleString('id-ID')}
                          </td>
                          <td
                            style={{
                              padding: '6px 9px',
                              textAlign: 'right',
                              fontFamily: 'var(--font-mono)',
                              color: dq.avgLatencyMs >= 200 ? '#f87171' : '#fde047',
                              fontWeight: 700
                            }}
                          >
                            {dq.avgLatencyMs} ms
                          </td>
                          <td style={{ padding: '6px 9px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                            {dq.totalLatencyMs.toLocaleString('id-ID')} ms
                          </td>
                          <td style={{ padding: '6px 9px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                            {dq.rowsExamined.toLocaleString('id-ID')}
                          </td>
                          <td style={{ padding: '6px 9px' }}>
                            {dq.noIndexUsedCount > 0 ? (
                              <span
                                style={{
                                  padding: '1px 6px',
                                  borderRadius: 4,
                                  background: 'rgba(239, 68, 68, 0.2)',
                                  color: '#fca5a5',
                                  fontSize: 10,
                                  fontWeight: 700
                                }}
                              >
                                NO INDEX ({dq.noIndexUsedCount}x)
                              </span>
                            ) : (
                              <span style={{ color: '#6ee7b7', fontSize: 10.5 }}>✓ Pakai Index</span>
                            )}
                          </td>
                          <td style={{ padding: '6px 9px' }}>
                            <button
                              type="button"
                              className="btn"
                              style={{ padding: '2px 7px', fontSize: 10.5 }}
                              onClick={() => {
                                void navigator.clipboard.writeText(dq.digestText);
                                showToast('Pola SQL disalin ke clipboard.');
                              }}
                            >
                              <Copy size={11} /> Salin
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* SUB-TAB 3: INNODB LOCK WAITS */}
          {subTab === 'locks' && (
            <div>
              {snapshot.lockWaits.length === 0 ? (
                <div style={{ padding: 26, textAlign: 'center', color: '#6ee7b7', fontWeight: 600 }}>
                  ✅ Tidak ada transaksi terkunci (Deadlock / Row Lock Wait) pada saat ini.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {snapshot.lockWaits.map((lw, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 8,
                        background: 'var(--bg-surface)',
                        border: '1px solid rgba(239, 68, 68, 0.4)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 10,
                        flexWrap: 'wrap'
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 240 }}>
                        <div style={{ fontWeight: 700, color: '#fca5a5', fontSize: 12 }}>
                          ⏳ Thread #{lw.waitingPid} ({lw.waitingUser}) tertahan {lw.waitSec} detik
                          {lw.blockingPid ? ` — Diblokir oleh Thread #${lw.blockingPid} (${lw.blockingUser || 'user'})` : ''}
                        </div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)', marginTop: 3 }}>
                          Menunggu: {lw.waitingQuery}
                        </div>
                        {lw.blockingQuery && (
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#fde047', marginTop: 2 }}>
                            Pemblokir: {lw.blockingQuery}
                          </div>
                        )}
                      </div>

                      {lw.blockingPid && (
                        <button
                          type="button"
                          className="btn-danger-outline"
                          disabled={killingPid === lw.blockingPid}
                          onClick={() => void handleKillBlocker(lw.blockingPid!)}
                        >
                          <Skull size={13} />
                          <span>Kill Blocker #{lw.blockingPid}</span>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* SUB-TAB 4: STORAGE, INDEX & FRAGMENTATION */}
          {subTab === 'storage' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 12 }}>
              {/* Per-DB Summary */}
              <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ padding: '7px 10px', background: 'var(--bg-surface)', fontWeight: 700, fontSize: 12 }}>
                  Ukuran per Database (MB)
                </div>
                <div style={{ maxHeight: 280, overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                    <thead>
                      <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                        <th style={{ padding: '5px 8px' }}>Database</th>
                        <th style={{ padding: '5px 8px', textAlign: 'right' }}>Tabel</th>
                        <th style={{ padding: '5px 8px', textAlign: 'right' }}>Total MB</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshot.storageByDb.map((d) => (
                        <tr key={d.database} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                          <td style={{ padding: '5px 8px', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                            {d.database}
                          </td>
                          <td style={{ padding: '5px 8px', textAlign: 'right' }}>{d.tableCount}</td>
                          <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: '#7dd3fc' }}>
                            {d.totalMb.toLocaleString('id-ID')} MB
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Top Largest Tables */}
              <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ padding: '7px 10px', background: 'var(--bg-surface)', fontWeight: 700, fontSize: 12 }}>
                  Top 25 Tabel Terbesar (Data + Index + Fragmentasi)
                </div>
                <div style={{ maxHeight: 280, overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                    <thead>
                      <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                        <th style={{ padding: '5px 8px' }}>Tabel</th>
                        <th style={{ padding: '5px 8px', textAlign: 'right' }}>Data</th>
                        <th style={{ padding: '5px 8px', textAlign: 'right' }}>Index</th>
                        <th style={{ padding: '5px 8px', textAlign: 'right' }}>Frag</th>
                        <th style={{ padding: '5px 8px' }}>Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshot.largestTables.map((t) => {
                        const key = `${t.database}.${t.table}`;
                        return (
                          <tr key={key} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                            <td style={{ padding: '5px 8px', fontFamily: 'var(--font-mono)' }}>
                              <span style={{ color: 'var(--text-muted)' }}>{t.database}.</span>
                              <strong>{t.table}</strong>
                            </td>
                            <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                              {t.dataMb} MB
                            </td>
                            <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: '#c084fc' }}>
                              {t.indexMb} MB
                            </td>
                            <td
                              style={{
                                padding: '5px 8px',
                                textAlign: 'right',
                                fontFamily: 'var(--font-mono)',
                                color: t.freeMb >= 10 ? '#fbbf24' : 'var(--text-muted)'
                              }}
                            >
                              {t.freeMb} MB
                            </td>
                            <td style={{ padding: '5px 8px' }}>
                              <button
                                type="button"
                                className="btn"
                                style={{ padding: '2px 7px', fontSize: 10.5 }}
                                disabled={optimizingTable === key}
                                onClick={() => void handleOptimizeTable(t.database, t.table)}
                                title="Jalankan OPTIMIZE TABLE untuk merapikan ruang fragmentasi"
                              >
                                <Zap size={10} color="#34d399" />
                                {optimizingTable === key ? '...' : 'Optimize'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
