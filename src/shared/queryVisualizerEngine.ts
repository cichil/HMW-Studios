export type ChartAggFunc = 'COUNT' | 'SUM' | 'AVG' | 'MAX' | 'MIN';
export type ChartVisualKind = 'bar' | 'line' | 'pie' | 'pivot';

export interface ChartSeriesPoint {
  label: string;
  value: number;
  percentage: number;
  rawCount: number;
}

export interface AggregatedChartResult {
  points: ChartSeriesPoint[];
  totalValue: number;
  maxValue: number;
  minValue: number;
}

export interface PivotTableResult {
  rowKeys: string[];
  colKeys: string[];
  cells: Record<string, Record<string, number>>;
  rowTotals: Record<string, number>;
  colTotals: Record<string, number>;
  grandTotal: number;
}

function toFiniteNumber(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;
  if (typeof val === 'bigint') return Number(val);
  const cleaned = String(val).trim().replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

export function inferBestChartAxes(
  columns: string[],
  rows: Array<Record<string, unknown>>
): {
  categoryCol: string;
  valueCol: string;
  aggFunc: ChartAggFunc;
  pivotColCandidate: string;
} {
  if (columns.length === 0) {
    return { categoryCol: '', valueCol: '', aggFunc: 'COUNT', pivotColCandidate: '' };
  }

  const sample = rows.slice(0, 30);
  const numericCols: string[] = [];
  const textCols: string[] = [];

  for (const col of columns) {
    const low = col.toLowerCase();
    // Avoid treating ID/NIP/Kode columns as numeric metrics to sum
    const isCodeLike =
      /(?:^|_)(?:id|nip|nik|npwp|kode|kd|no_hp|telp|tahun_lahir)(?:$|_)/.test(low) ||
      low.startsWith('kd_') ||
      low.startsWith('id_');

    let numericHits = 0;
    let nonNullHits = 0;
    for (const r of sample) {
      const v = r[col];
      if (v !== null && v !== undefined && v !== '') {
        nonNullHits++;
        if (toFiniteNumber(v) !== null) numericHits++;
      }
    }

    if (!isCodeLike && nonNullHits > 0 && numericHits >= Math.ceil(nonNullHits * 0.8)) {
      numericCols.push(col);
    } else {
      textCols.push(col);
    }
  }

  const categoryCol = textCols[0] ?? columns[0];
  const pivotColCandidate = textCols[1] ?? columns[Math.min(1, columns.length - 1)] ?? categoryCol;

  if (numericCols.length > 0) {
    return {
      categoryCol,
      valueCol: numericCols[0],
      aggFunc: 'SUM',
      pivotColCandidate
    };
  }

  return {
    categoryCol,
    valueCol: columns[0],
    aggFunc: 'COUNT',
    pivotColCandidate
  };
}

export function aggregateChartSeries(opts: {
  rows: Array<Record<string, unknown>>;
  categoryCol: string;
  valueCol?: string;
  aggFunc: ChartAggFunc;
  topN?: number;
  preserveOrder?: boolean;
}): AggregatedChartResult {
  const {
    rows,
    categoryCol,
    valueCol,
    aggFunc,
    topN = 14,
    preserveOrder = false
  } = opts;

  if (!categoryCol || rows.length === 0) {
    return { points: [], totalValue: 0, maxValue: 0, minValue: 0 };
  }

  const buckets = new Map<
    string,
    { sum: number; count: number; min: number; max: number }
  >();

  for (const row of rows) {
    const rawCat = row[categoryCol];
    const label =
      rawCat === null || rawCat === undefined || String(rawCat).trim() === ''
        ? '(Kosong)'
        : String(rawCat).trim();

    let bucket = buckets.get(label);
    if (!bucket) {
      bucket = { sum: 0, count: 0, min: Infinity, max: -Infinity };
      buckets.set(label, bucket);
    }

    if (aggFunc === 'COUNT') {
      bucket.count += 1;
      bucket.sum += 1;
      bucket.min = 1;
      bucket.max = bucket.count;
    } else {
      const num = valueCol ? toFiniteNumber(row[valueCol]) : null;
      if (num !== null) {
        bucket.count += 1;
        bucket.sum += num;
        if (num < bucket.min) bucket.min = num;
        if (num > bucket.max) bucket.max = num;
      }
    }
  }

  let computed: Array<{ label: string; value: number; rawCount: number }> = [];
  for (const [label, b] of buckets.entries()) {
    let val = 0;
    switch (aggFunc) {
      case 'COUNT':
        val = b.count;
        break;
      case 'SUM':
        val = b.sum;
        break;
      case 'AVG':
        val = b.count > 0 ? Number((b.sum / b.count).toFixed(2)) : 0;
        break;
      case 'MAX':
        val = b.max === -Infinity ? 0 : b.max;
        break;
      case 'MIN':
        val = b.min === Infinity ? 0 : b.min;
        break;
    }
    computed.push({ label, value: val, rawCount: b.count });
  }

  if (!preserveOrder) {
    computed.sort((a, b) => b.value - a.value);
  }

  if (computed.length > topN && (aggFunc === 'COUNT' || aggFunc === 'SUM')) {
    const head = computed.slice(0, topN - 1);
    const tail = computed.slice(topN - 1);
    const tailSum = tail.reduce((acc, it) => acc + it.value, 0);
    const tailCount = tail.reduce((acc, it) => acc + it.rawCount, 0);
    computed = [
      ...head,
      { label: `Lainnya (${tail.length})`, value: tailSum, rawCount: tailCount }
    ];
  } else if (computed.length > topN) {
    computed = computed.slice(0, topN);
  }

  const totalValue = computed.reduce((acc, it) => acc + Math.max(0, it.value), 0);
  const values = computed.map((c) => c.value);
  const maxValue = values.length > 0 ? Math.max(...values) : 0;
  const minValue = values.length > 0 ? Math.min(...values) : 0;

  const points: ChartSeriesPoint[] = computed.map((c) => ({
    label: c.label,
    value: c.value,
    rawCount: c.rawCount,
    percentage: totalValue > 0 ? Number(((Math.max(0, c.value) / totalValue) * 100).toFixed(1)) : 0
  }));

  return { points, totalValue, maxValue, minValue };
}

export function buildPivotMatrix(opts: {
  rows: Array<Record<string, unknown>>;
  rowCol: string;
  colCol: string;
  valueCol?: string;
  aggFunc: 'COUNT' | 'SUM' | 'AVG';
  maxCols?: number;
  maxRows?: number;
}): PivotTableResult {
  const {
    rows,
    rowCol,
    colCol,
    valueCol,
    aggFunc,
    maxCols = 12,
    maxRows = 50
  } = opts;

  const acc = new Map<string, Map<string, { sum: number; count: number }>>();
  const colSet = new Set<string>();

  for (const r of rows) {
    const rk =
      r[rowCol] === null || r[rowCol] === undefined || String(r[rowCol]).trim() === ''
        ? '(Kosong)'
        : String(r[rowCol]).trim();
    const ck =
      r[colCol] === null || r[colCol] === undefined || String(r[colCol]).trim() === ''
        ? '(Kosong)'
        : String(r[colCol]).trim();

    colSet.add(ck);
    let rMap = acc.get(rk);
    if (!rMap) {
      rMap = new Map();
      acc.set(rk, rMap);
    }
    let cell = rMap.get(ck);
    if (!cell) {
      cell = { sum: 0, count: 0 };
      rMap.set(ck, cell);
    }

    if (aggFunc === 'COUNT') {
      cell.count += 1;
      cell.sum += 1;
    } else {
      const n = valueCol ? toFiniteNumber(r[valueCol]) : null;
      if (n !== null) {
        cell.count += 1;
        cell.sum += n;
      }
    }
  }

  const colKeys = Array.from(colSet).sort((a, b) => a.localeCompare(b)).slice(0, maxCols);
  const rowKeys = Array.from(acc.keys()).sort((a, b) => a.localeCompare(b)).slice(0, maxRows);

  const cells: Record<string, Record<string, number>> = {};
  const rowTotals: Record<string, number> = {};
  const colTotals: Record<string, number> = {};
  let grandTotal = 0;

  for (const ck of colKeys) colTotals[ck] = 0;

  for (const rk of rowKeys) {
    cells[rk] = {};
    let rTotal = 0;
    const rMap = acc.get(rk);
    for (const ck of colKeys) {
      const c = rMap?.get(ck);
      let val = 0;
      if (c) {
        val =
          aggFunc === 'AVG'
            ? c.count > 0
              ? Number((c.sum / c.count).toFixed(2))
              : 0
            : c.sum;
      }
      cells[rk][ck] = val;
      rTotal += val;
      colTotals[ck] += val;
    }
    rowTotals[rk] = Number(rTotal.toFixed(2));
    grandTotal += rTotal;
  }

  return {
    rowKeys,
    colKeys,
    cells,
    rowTotals,
    colTotals,
    grandTotal: Number(grandTotal.toFixed(2))
  };
}
