import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  Download,
  LineChart,
  PieChart,
  TableProperties
} from 'lucide-react';
import {
  aggregateChartSeries,
  buildPivotMatrix,
  inferBestChartAxes,
  type ChartAggFunc,
  type ChartVisualKind
} from '@shared/queryVisualizerEngine';

const PALETTE = [
  '#38bdf8',
  '#34d399',
  '#c084fc',
  '#fbbf24',
  '#fb7185',
  '#60a5fa',
  '#a3e635',
  '#f472b6',
  '#2dd4bf',
  '#fb923c'
];

function fmtNum(val: number): string {
  return Number.isInteger(val)
    ? val.toLocaleString('id-ID')
    : val.toLocaleString('id-ID', { maximumFractionDigits: 2 });
}

export interface QueryChartPivotPanelProps {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  title?: string;
}

export const QueryChartPivotPanel: React.FC<QueryChartPivotPanelProps> = ({
  columns,
  rows,
  title = 'Visualisasi Grafik & Pivot'
}) => {
  const inferred = useMemo(() => inferBestChartAxes(columns, rows), [columns, rows]);

  const [kind, setKind] = useState<ChartVisualKind>('bar');
  const [categoryCol, setCategoryCol] = useState(inferred.categoryCol);
  const [pivotCol, setPivotCol] = useState(inferred.pivotColCandidate);
  const [valueCol, setValueCol] = useState(inferred.valueCol);
  const [aggFunc, setAggFunc] = useState<ChartAggFunc>(inferred.aggFunc);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    setCategoryCol(inferred.categoryCol);
    setPivotCol(inferred.pivotColCandidate);
    setValueCol(inferred.valueCol);
    setAggFunc(inferred.aggFunc);
  }, [inferred.categoryCol, inferred.pivotColCandidate, inferred.valueCol, inferred.aggFunc]);

  const chartData = useMemo(
    () =>
      aggregateChartSeries({
        rows,
        categoryCol,
        valueCol: aggFunc === 'COUNT' ? undefined : valueCol,
        aggFunc,
        topN: kind === 'pie' ? 8 : 14,
        preserveOrder: kind === 'line'
      }),
    [rows, categoryCol, valueCol, aggFunc, kind]
  );

  const pivotData = useMemo(() => {
    if (kind !== 'pivot' || !categoryCol || !pivotCol) return null;
    const pivotAgg: 'COUNT' | 'SUM' | 'AVG' =
      aggFunc === 'SUM' || aggFunc === 'AVG' ? aggFunc : 'COUNT';
    return buildPivotMatrix({
      rows,
      rowCol: categoryCol,
      colCol: pivotCol,
      valueCol: pivotAgg === 'COUNT' ? undefined : valueCol,
      aggFunc: pivotAgg
    });
  }, [kind, rows, categoryCol, pivotCol, valueCol, aggFunc]);

  const handleExportPng = (): void => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svgEl);
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const w = 820;
      const h = 340;
      const canvas = document.createElement('canvas');
      canvas.width = w * scale;
      canvas.height = h * scale;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.scale(scale, scale);
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const pngUrl = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = pngUrl;
        a.download = `grafik_${categoryCol || 'query'}_${Date.now()}.png`;
        a.click();
      }
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  return (
    <div
      style={{
        padding: 12,
        borderRadius: 8,
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10
      }}
    >
      {/* Controls Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          flexWrap: 'wrap'
        }}
      >
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            type="button"
            className={`btn ${kind === 'bar' ? 'btn-accent' : ''}`}
            style={{ padding: '4px 9px', fontSize: 11.5 }}
            onClick={() => setKind('bar')}
          >
            <BarChart3 size={13} /> Batang (Bar)
          </button>
          <button
            type="button"
            className={`btn ${kind === 'line' ? 'btn-accent' : ''}`}
            style={{ padding: '4px 9px', fontSize: 11.5 }}
            onClick={() => setKind('line')}
          >
            <LineChart size={13} /> Garis (Trend)
          </button>
          <button
            type="button"
            className={`btn ${kind === 'pie' ? 'btn-accent' : ''}`}
            style={{ padding: '4px 9px', fontSize: 11.5 }}
            onClick={() => setKind('pie')}
          >
            <PieChart size={13} /> Lingkaran (Pie)
          </button>
          <button
            type="button"
            className={`btn ${kind === 'pivot' ? 'btn-accent' : ''}`}
            style={{ padding: '4px 9px', fontSize: 11.5 }}
            onClick={() => setKind('pivot')}
          >
            <TableProperties size={13} /> Tabel Pivot
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            {kind === 'pivot' ? 'Baris:' : 'Sumbu X:'}
          </span>
          <select
            className="form-input"
            style={{ width: 135, padding: '3px 6px', fontSize: 11.5 }}
            value={categoryCol}
            onChange={(e) => setCategoryCol(e.target.value)}
          >
            {columns.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          {kind === 'pivot' && (
            <>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Kolom:</span>
              <select
                className="form-input"
                style={{ width: 135, padding: '3px 6px', fontSize: 11.5 }}
                value={pivotCol}
                onChange={(e) => setPivotCol(e.target.value)}
              >
                {columns.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </>
          )}

          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Fungsi:</span>
          <select
            className="form-input"
            style={{ width: 115, padding: '3px 6px', fontSize: 11.5 }}
            value={aggFunc}
            onChange={(e) => setAggFunc(e.target.value as ChartAggFunc)}
          >
            <option value="COUNT">COUNT (Baris)</option>
            <option value="SUM">SUM (Jumlah)</option>
            <option value="AVG">AVG (Rata-rata)</option>
            {kind !== 'pivot' && <option value="MAX">MAX (Tertinggi)</option>}
            {kind !== 'pivot' && <option value="MIN">MIN (Terendah)</option>}
          </select>

          {aggFunc !== 'COUNT' && (
            <>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Nilai:</span>
              <select
                className="form-input"
                style={{ width: 135, padding: '3px 6px', fontSize: 11.5 }}
                value={valueCol}
                onChange={(e) => setValueCol(e.target.value)}
              >
                {columns.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </>
          )}

          {kind !== 'pivot' && chartData.points.length > 0 && (
            <button
              type="button"
              className="btn btn-xs"
              onClick={handleExportPng}
              title="Simpan grafik ini sebagai gambar .PNG resolusi tinggi"
            >
              <Download size={11.5} /> Simpan .PNG
            </button>
          )}
        </div>
      </div>

      {/* Render Canvas */}
      {kind === 'pivot' ? (
        !pivotData || pivotData.rowKeys.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
            Tidak ada data untuk diringkas ke Tabel Pivot.
          </div>
        ) : (
          <div style={{ overflowX: 'auto', maxHeight: 300, border: '1px solid var(--border-subtle)', borderRadius: 6 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
              <thead>
                <tr style={{ background: 'var(--bg-app)' }}>
                  <th style={{ padding: '6px 9px', textAlign: 'left', borderBottom: '1px solid var(--border-subtle)' }}>
                    {categoryCol} \ {pivotCol}
                  </th>
                  {pivotData.colKeys.map((ck) => (
                    <th key={ck} style={{ padding: '6px 9px', textAlign: 'right', borderBottom: '1px solid var(--border-subtle)' }}>
                      {ck}
                    </th>
                  ))}
                  <th style={{ padding: '6px 9px', textAlign: 'right', borderBottom: '1px solid var(--border-subtle)', color: '#38bdf8' }}>
                    TOTAL
                  </th>
                </tr>
              </thead>
              <tbody>
                {pivotData.rowKeys.map((rk) => (
                  <tr key={rk} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '5px 9px', fontWeight: 600 }}>{rk}</td>
                    {pivotData.colKeys.map((ck) => (
                      <td key={ck} style={{ padding: '5px 9px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                        {fmtNum(pivotData.cells[rk]?.[ck] ?? 0)}
                      </td>
                    ))}
                    <td style={{ padding: '5px 9px', textAlign: 'right', fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#38bdf8' }}>
                      {fmtNum(pivotData.rowTotals[rk] ?? 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--border-strong)', background: 'var(--bg-app)', fontWeight: 700 }}>
                  <td style={{ padding: '6px 9px' }}>GRAND TOTAL</td>
                  {pivotData.colKeys.map((ck) => (
                    <td key={ck} style={{ padding: '6px 9px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                      {fmtNum(pivotData.colTotals[ck] ?? 0)}
                    </td>
                  ))}
                  <td style={{ padding: '6px 9px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: '#34d399' }}>
                    {fmtNum(pivotData.grandTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )
      ) : chartData.points.length === 0 ? (
        <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
          Pilih kolom metrik numerik atau gunakan fungsi <strong>COUNT (Baris)</strong>.
        </div>
      ) : (
        <div
          style={{
            borderRadius: 8,
            background: '#0f172a',
            border: '1px solid rgba(148, 163, 184, 0.2)',
            padding: 8,
            overflowX: 'auto'
          }}
        >
          <svg
            ref={svgRef}
            viewBox="0 0 820 320"
            style={{ width: '100%', height: 290, display: 'block', fontFamily: 'Segoe UI, Arial, sans-serif' }}
          >
            {/* Title */}
            <text x={24} y={24} fill="#e2e8f0" fontSize={13} fontWeight="bold">
              {title} — {aggFunc === 'COUNT' ? `Jumlah Baris per ${categoryCol}` : `${aggFunc}(${valueCol}) per ${categoryCol}`}
            </text>

            {kind === 'bar' && (() => {
              const pts = chartData.points;
              const chartLeft = 65;
              const chartRight = 795;
              const chartTop = 48;
              const chartBottom = 252;
              const plotW = chartRight - chartLeft;
              const plotH = chartBottom - chartTop;
              const maxV = Math.max(1, chartData.maxValue);
              const slotW = plotW / pts.length;
              const barW = Math.min(48, Math.max(12, slotW * 0.62));

              return (
                <g>
                  {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
                    const y = chartBottom - frac * plotH;
                    const labelVal = maxV * frac;
                    return (
                      <g key={frac}>
                        <line x1={chartLeft} y1={y} x2={chartRight} y2={y} stroke="#1e293b" strokeWidth={1} />
                        <text x={chartLeft - 8} y={y + 4} fill="#94a3b8" fontSize={10} textAnchor="end">
                          {fmtNum(Number(labelVal.toFixed(1)))}
                        </text>
                      </g>
                    );
                  })}

                  {pts.map((p, i) => {
                    const h = Math.max(2, (Math.max(0, p.value) / maxV) * plotH);
                    const x = chartLeft + i * slotW + (slotW - barW) / 2;
                    const y = chartBottom - h;
                    const col = PALETTE[i % PALETTE.length];
                    const shortLabel = p.label.length > 13 ? `${p.label.slice(0, 12)}…` : p.label;

                    return (
                      <g key={`${p.label}-${i}`}>
                        <title>{`${p.label}: ${fmtNum(p.value)} (${p.percentage}%)`}</title>
                        <rect x={x} y={y} width={barW} height={h} rx={4} fill={col} />
                        <text x={x + barW / 2} y={y - 6} fill="#cbd5e1" fontSize={10} fontWeight="bold" textAnchor="middle">
                          {fmtNum(p.value)}
                        </text>
                        <text
                          x={x + barW / 2}
                          y={chartBottom + 16}
                          fill="#94a3b8"
                          fontSize={10}
                          textAnchor="end"
                          transform={`rotate(-22, ${x + barW / 2}, ${chartBottom + 16})`}
                        >
                          {shortLabel}
                        </text>
                      </g>
                    );
                  })}
                </g>
              );
            })()}

            {kind === 'line' && (() => {
              const pts = chartData.points;
              const chartLeft = 65;
              const chartRight = 795;
              const chartTop = 48;
              const chartBottom = 252;
              const plotW = chartRight - chartLeft;
              const plotH = chartBottom - chartTop;
              const maxV = Math.max(1, chartData.maxValue);

              const coords = pts.map((p, i) => {
                const x =
                  pts.length === 1
                    ? chartLeft + plotW / 2
                    : chartLeft + (i / (pts.length - 1)) * plotW;
                const y = chartBottom - (Math.max(0, p.value) / maxV) * plotH;
                return { x, y, p };
              });

              const polyPoints = coords.map((c) => `${c.x},${c.y}`).join(' ');
              const areaPoints = `${coords[0].x},${chartBottom} ${polyPoints} ${coords[coords.length - 1].x},${chartBottom}`;

              return (
                <g>
                  {[0, 0.5, 1].map((frac) => {
                    const y = chartBottom - frac * plotH;
                    return (
                      <line key={frac} x1={chartLeft} y1={y} x2={chartRight} y2={y} stroke="#1e293b" strokeWidth={1} />
                    );
                  })}
                  <polygon points={areaPoints} fill="rgba(56, 189, 248, 0.16)" />
                  <polyline fill="none" stroke="#38bdf8" strokeWidth={2.5} points={polyPoints} />
                  {coords.map(({ x, y, p }, i) => (
                    <g key={`${p.label}-${i}`}>
                      <title>{`${p.label}: ${fmtNum(p.value)}`}</title>
                      <circle cx={x} cy={y} r={4.5} fill="#0f172a" stroke="#38bdf8" strokeWidth={2.5} />
                      <text x={x} y={y - 9} fill="#e2e8f0" fontSize={10} textAnchor="middle">
                        {fmtNum(p.value)}
                      </text>
                      <text x={x} y={chartBottom + 18} fill="#94a3b8" fontSize={10} textAnchor="middle">
                        {p.label.length > 11 ? `${p.label.slice(0, 10)}…` : p.label}
                      </text>
                    </g>
                  ))}
                </g>
              );
            })()}

            {kind === 'pie' && (() => {
              const cx = 220;
              const cy = 172;
              const r = 104;
              let startAngle = -Math.PI / 2;

              return (
                <g>
                  {chartData.points.map((p, i) => {
                    const frac = chartData.totalValue > 0 ? Math.max(0, p.value) / chartData.totalValue : 0;
                    const angle = frac * Math.PI * 2;
                    const endAngle = startAngle + angle;
                    const x1 = cx + r * Math.cos(startAngle);
                    const y1 = cy + r * Math.sin(startAngle);
                    const x2 = cx + r * Math.cos(endAngle);
                    const y2 = cy + r * Math.sin(endAngle);
                    const largeArc = angle > Math.PI ? 1 : 0;
                    const col = PALETTE[i % PALETTE.length];

                    const pathD =
                      chartData.points.length === 1
                        ? `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy}`
                        : `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;

                    startAngle = endAngle;

                    return (
                      <g key={`${p.label}-${i}`}>
                        <title>{`${p.label}: ${fmtNum(p.value)} (${p.percentage}%)`}</title>
                        <path d={pathD} fill={col} stroke="#0f172a" strokeWidth={2} />
                        {/* Legend row */}
                        <rect x={400} y={56 + i * 28} width={12} height={12} rx={3} fill={col} />
                        <text x={420} y={66 + i * 28} fill="#e2e8f0" fontSize={11.5}>
                          {p.label.slice(0, 28)} — {fmtNum(p.value)} ({p.percentage}%)
                        </text>
                      </g>
                    );
                  })}
                  <circle cx={cx} cy={cy} r={46} fill="#0f172a" />
                  <text x={cx} y={cy - 4} fill="#94a3b8" fontSize={10} textAnchor="middle">
                    TOTAL
                  </text>
                  <text x={cx} y={cy + 13} fill="#f8fafc" fontSize={12.5} fontWeight="bold" textAnchor="middle">
                    {fmtNum(chartData.totalValue)}
                  </text>
                </g>
              );
            })()}
          </svg>
        </div>
      )}
    </div>
  );
};
