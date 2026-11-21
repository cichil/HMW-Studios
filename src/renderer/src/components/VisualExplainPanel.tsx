import React, { useState } from 'react';
import {
  AlertTriangle,
  Bookmark,
  CheckCircle2,
  GitBranch,
  Layers,
  RefreshCw,
  X
} from 'lucide-react';
import type {
  ExplainBenchmarkSnapshot,
  VisualExplainNode,
  VisualExplainReport
} from '@shared/mysqlExplainVisualizer';

interface VisualExplainPanelProps {
  report: VisualExplainReport | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onClose: () => void;
}

const severityColors = {
  danger: {
    border: 'rgba(248, 113, 113, 0.55)',
    bg: 'rgba(239, 68, 68, 0.12)',
    badgeBg: 'rgba(239, 68, 68, 0.25)',
    text: '#fca5a5'
  },
  warn: {
    border: 'rgba(251, 191, 36, 0.5)',
    bg: 'rgba(245, 158, 11, 0.1)',
    badgeBg: 'rgba(245, 158, 11, 0.22)',
    text: '#fde68a'
  },
  ok: {
    border: 'rgba(52, 211, 153, 0.45)',
    bg: 'rgba(16, 185, 129, 0.09)',
    badgeBg: 'rgba(16, 185, 129, 0.2)',
    text: '#6ee7b7'
  }
};

const ExplainTreeNodeCard: React.FC<{ node: VisualExplainNode; depth: number; maxCost: number }> = ({
  node,
  depth,
  maxCost
}) => {
  const palette = severityColors[node.severity];
  const costRatio =
    maxCost > 0 && node.cost !== undefined ? Math.min(100, Math.round((node.cost / maxCost) * 100)) : 0;

  return (
    <div style={{ marginLeft: depth > 0 ? 20 : 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div
        style={{
          padding: '8px 10px',
          borderRadius: 7,
          border: `1px solid ${palette.border}`,
          background: palette.bg,
          display: 'flex',
          flexDirection: 'column',
          gap: 5
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 6
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span
              style={{
                padding: '1px 7px',
                borderRadius: 999,
                background: palette.badgeBg,
                color: palette.text,
                fontSize: 10.5,
                fontWeight: 800
              }}
            >
              {node.operation}
            </span>
            {node.table && (
              <strong style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                {node.table}
              </strong>
            )}
            {node.keyUsed ? (
              <span
                style={{
                  fontSize: 10.5,
                  padding: '1px 6px',
                  borderRadius: 4,
                  background: 'rgba(56, 189, 248, 0.16)',
                  color: '#7dd3fc',
                  fontFamily: 'var(--font-mono)'
                }}
              >
                KEY: {node.keyUsed}
              </span>
            ) : node.table ? (
              <span
                style={{
                  fontSize: 10.5,
                  padding: '1px 6px',
                  borderRadius: 4,
                  background: 'rgba(239, 68, 68, 0.18)',
                  color: '#fca5a5'
                }}
              >
                TANPA INDEX
              </span>
            ) : null}
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-secondary)'
            }}
          >
            <span>
              Baris: <strong style={{ color: 'var(--text-primary)' }}>{node.estimatedRows.toLocaleString('id-ID')}</strong>
            </span>
            {node.filteredPct !== undefined && <span>Filter: {node.filteredPct}%</span>}
            {node.cost !== undefined && (
              <span>
                Cost: <strong style={{ color: palette.text }}>{node.cost}</strong>
              </span>
            )}
          </div>
        </div>

        {costRatio > 0 && (
          <div style={{ height: 4, borderRadius: 999, background: 'rgba(15, 23, 42, 0.55)', overflow: 'hidden' }}>
            <div
              style={{
                width: `${Math.max(4, costRatio)}%`,
                height: '100%',
                background: palette.text
              }}
            />
          </div>
        )}

        {node.extraFlags.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {node.extraFlags.map((flag, i) => (
              <span
                key={i}
                style={{
                  fontSize: 10,
                  padding: '1px 6px',
                  borderRadius: 4,
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-secondary)'
                }}
              >
                {flag}
              </span>
            ))}
          </div>
        )}

        {node.warnings.map((w, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 11,
              color: palette.text
            }}
          >
            <AlertTriangle size={11} style={{ flexShrink: 0 }} />
            <span>{w}</span>
          </div>
        ))}
      </div>

      {node.children.length > 0 && (
        <div
          style={{
            borderLeft: '2px dashed var(--border-subtle)',
            paddingLeft: 8,
            display: 'flex',
            flexDirection: 'column',
            gap: 6
          }}
        >
          {node.children.map((child) => (
            <ExplainTreeNodeCard key={child.id} node={child} depth={depth + 1} maxCost={maxCost} />
          ))}
        </div>
      )}
    </div>
  );
};

export const VisualExplainPanel: React.FC<VisualExplainPanelProps> = ({
  report,
  loading,
  error,
  onRefresh,
  onClose
}) => {
  const [baseline, setBaseline] = useState<ExplainBenchmarkSnapshot | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  const scoreColor = !report
    ? 'var(--text-muted)'
    : report.healthScore >= 80
      ? '#34d399'
      : report.healthScore >= 55
        ? '#fbbf24'
        : '#f87171';

  const costImprovementPct =
    baseline && report && baseline.totalCost > 0
      ? Math.round(((baseline.totalCost - report.totalCost) / baseline.totalCost) * 100)
      : null;

  return (
    <div
      style={{
        padding: '10px 16px',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--bg-app)',
        display: 'flex',
        flexDirection: 'column',
        gap: 9,
        maxHeight: 330,
        overflowY: 'auto'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <GitBranch size={14} color="#38bdf8" />
          <strong style={{ fontSize: 12.5 }}>Visual EXPLAIN Execution Tree &amp; Query Profiler</strong>
          {report && (
            <span
              style={{
                padding: '2px 8px',
                borderRadius: 999,
                fontSize: 10.5,
                fontWeight: 800,
                background: 'var(--bg-elevated)',
                border: `1px solid ${scoreColor}`,
                color: scoreColor
              }}
            >
              Skor Rencana: {report.healthScore}/100 • Cost {report.totalCost} • {report.durationMs} ms
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {report && (
            <button
              type="button"
              className="btn btn-xs"
              title="Simpan skor & cost saat ini sebagai pembanding (Sebelum Tambah Index)"
              onClick={() =>
                setBaseline({
                  id: `base-${Date.now()}`,
                  label: 'Baseline Sebelum Optimasi',
                  capturedAt: new Date().toLocaleTimeString('id-ID'),
                  durationMs: report.durationMs,
                  totalCost: report.totalCost,
                  totalEstimatedRows: report.totalEstimatedRows,
                  healthScore: report.healthScore,
                  hasFullTableScan: report.hasFullTableScan
                })
              }
            >
              <Bookmark size={11} color="#fbbf24" />
              <span>{baseline ? 'Perbarui Baseline' : 'Simpan Baseline'}</span>
            </button>
          )}
          {report && (
            <button
              type="button"
              className="btn btn-xs"
              onClick={() => setShowRaw((v) => !v)}
            >
              <Layers size={11} /> {showRaw ? 'Tampilan Pohon' : 'JSON Mentah'}
            </button>
          )}
          <button type="button" className="btn btn-xs" disabled={loading} onClick={onRefresh}>
            <RefreshCw size={11} className={loading ? 'spin' : ''} /> Analisis Ulang
          </button>
          <button type="button" className="icon-btn" onClick={onClose} title="Tutup panel EXPLAIN">
            <X size={13} />
          </button>
        </div>
      </div>

      {baseline && report && (
        <div
          style={{
            padding: '6px 10px',
            borderRadius: 6,
            background: 'rgba(56, 189, 248, 0.09)',
            border: '1px solid rgba(56, 189, 248, 0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8,
            fontSize: 11
          }}
        >
          <span>
            📊 <strong>Perbandingan Sebelum vs Sesudah Index</strong> (Baseline {baseline.capturedAt}):
            Cost <code>{baseline.totalCost}</code> → <code>{report.totalCost}</code> • Baris{' '}
            <code>{baseline.totalEstimatedRows.toLocaleString('id-ID')}</code> →{' '}
            <code>{report.totalEstimatedRows.toLocaleString('id-ID')}</code> • Skor{' '}
            <strong>{baseline.healthScore}</strong> → <strong>{report.healthScore}</strong>
          </span>
          {costImprovementPct !== null && (
            <span
              style={{
                fontWeight: 800,
                color: costImprovementPct > 0 ? '#34d399' : costImprovementPct < 0 ? '#f87171' : '#94a3b8'
              }}
            >
              {costImprovementPct > 0
                ? `🚀 Cost turun ${costImprovementPct}%`
                : costImprovementPct < 0
                  ? `⚠️ Cost naik ${Math.abs(costImprovementPct)}%`
                  : 'Stabil (0%)'}
            </span>
          )}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 14, fontSize: 12, color: 'var(--text-muted)' }}>
          ⏳ Menjalankan <code>EXPLAIN FORMAT=JSON</code> pada server database...
        </div>
      ) : error ? (
        <div style={{ padding: 10, borderRadius: 6, background: 'rgba(239,68,68,0.14)', color: '#fca5a5', fontSize: 11.5 }}>
          Gagal menganalisis EXPLAIN: {error}
        </div>
      ) : !report ? (
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
          Klik <strong>Analisis Ulang</strong> untuk memvisualisasikan pohon rencana eksekusi query SELECT Anda.
        </div>
      ) : showRaw ? (
        <pre
          style={{
            margin: 0,
            padding: 10,
            borderRadius: 6,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            overflowX: 'auto'
          }}
        >
          {report.rawText}
        </pre>
      ) : (
        <>
          <ExplainTreeNodeCard node={report.root} depth={0} maxCost={Math.max(1, report.totalCost)} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {report.summaryTips.map((tip, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 11,
                  color: report.hasFullTableScan ? '#fde68a' : '#6ee7b7'
                }}
              >
                {report.hasFullTableScan ? <AlertTriangle size={11} /> : <CheckCircle2 size={11} />}
                <span>{tip}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
