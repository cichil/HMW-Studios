import type { DbEngine } from './types';

export type ExplainNodeSeverity = 'ok' | 'warn' | 'danger';

export interface VisualExplainNode {
  id: string;
  operation: string;
  table?: string;
  accessType?: string;
  severity: ExplainNodeSeverity;
  estimatedRows: number;
  filteredPct?: number;
  cost?: number;
  keyUsed?: string;
  possibleKeys?: string[];
  keyLength?: string;
  extraFlags: string[];
  warnings: string[];
  children: VisualExplainNode[];
}

export interface VisualExplainReport {
  engine: DbEngine;
  sql: string;
  format: 'json' | 'tabular';
  root: VisualExplainNode;
  totalCost: number;
  totalEstimatedRows: number;
  hasFullTableScan: boolean;
  hasFilesort: boolean;
  hasTempTable: boolean;
  healthScore: number; // 0-100
  summaryTips: string[];
  rawText: string;
  durationMs: number;
}

export interface ExplainBenchmarkSnapshot {
  id: string;
  label: string;
  capturedAt: string;
  durationMs: number;
  totalCost: number;
  totalEstimatedRows: number;
  healthScore: number;
  hasFullTableScan: boolean;
}

function classifyMysqlAccessType(accessType?: string, extraFlags: string[] = []): {
  severity: ExplainNodeSeverity;
  warnings: string[];
} {
  const acc = (accessType || '').toLowerCase();
  const warnings: string[] = [];
  let severity: ExplainNodeSeverity = 'ok';

  if (acc === 'all') {
    severity = 'danger';
    warnings.push('Full Table Scan (ALL) — membaca seluruh baris tabel tanpa index');
  } else if (acc === 'index') {
    severity = 'warn';
    warnings.push('Full Index Scan — memindai seluruh pohon index');
  } else if (acc === 'range' || acc === 'index_merge' || acc === 'fulltext') {
    severity = 'warn';
  }

  for (const flag of extraFlags) {
    const low = flag.toLowerCase();
    if (low.includes('temporary')) {
      severity = 'danger';
      warnings.push('Membuat Temporary Table sementara (berisiko spill ke disk)');
    }
    if (low.includes('filesort')) {
      if (severity !== 'danger') severity = 'warn';
      warnings.push('Using filesort — sorting tidak tercakup oleh index ORDER BY');
    }
    if (low.includes('join buffer') || low.includes('block nested loop')) {
      severity = 'danger';
      warnings.push('Join Buffer / Nested Loop tanpa index pada kolom JOIN');
    }
  }

  return { severity, warnings };
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseMysqlTableObject(
  tbl: Record<string, unknown>,
  idxRef: { next: number }
): VisualExplainNode {
  const id = `node-${idxRef.next++}`;
  const tableName = String(tbl.table_name ?? 'table');
  const accessType = tbl.access_type ? String(tbl.access_type) : undefined;
  const keyUsed = tbl.key ? String(tbl.key) : undefined;
  const possibleKeys = Array.isArray(tbl.possible_keys)
    ? tbl.possible_keys.map((x) => String(x))
    : undefined;
  const costInfo = (tbl.cost_info ?? {}) as Record<string, unknown>;
  const cost =
    costInfo.prefix_cost !== undefined
      ? num(costInfo.prefix_cost)
      : costInfo.eval_cost !== undefined || costInfo.read_cost !== undefined
        ? num(costInfo.read_cost) + num(costInfo.eval_cost)
        : undefined;

  const extraFlags: string[] = [];
  if (tbl.using_index) extraFlags.push('Using index (Covering)');
  if (tbl.using_MRR) extraFlags.push('Using MRR');
  if (tbl.using_join_buffer) extraFlags.push(`Using join buffer (${String(tbl.using_join_buffer)})`);
  if (tbl.attached_condition) extraFlags.push('Using where');

  const { severity, warnings } = classifyMysqlAccessType(accessType, extraFlags);
  const children: VisualExplainNode[] = [];

  if (tbl.materialized_from_subquery && typeof tbl.materialized_from_subquery === 'object') {
    const sub = tbl.materialized_from_subquery as Record<string, unknown>;
    if (sub.query_block && typeof sub.query_block === 'object') {
      children.push(parseMysqlQueryBlock(sub.query_block as Record<string, unknown>, idxRef));
    }
  }

  return {
    id,
    operation: accessType ? `${accessType.toUpperCase()} Scan` : 'Table Access',
    table: tableName,
    accessType,
    severity,
    estimatedRows: num(tbl.rows_examined_per_scan ?? tbl.rows_produced_per_join ?? tbl.rows),
    filteredPct: tbl.filtered !== undefined ? num(tbl.filtered) : undefined,
    cost: cost !== undefined ? Number(cost.toFixed(2)) : undefined,
    keyUsed,
    possibleKeys,
    keyLength: tbl.key_length ? String(tbl.key_length) : undefined,
    extraFlags,
    warnings,
    children
  };
}

function parseMysqlQueryBlock(
  qb: Record<string, unknown>,
  idxRef: { next: number }
): VisualExplainNode {
  const id = `node-${idxRef.next++}`;
  const costInfo = (qb.cost_info ?? {}) as Record<string, unknown>;
  const queryCost = costInfo.query_cost !== undefined ? num(costInfo.query_cost) : undefined;
  const extraFlags: string[] = [];
  const children: VisualExplainNode[] = [];

  let cursor: Record<string, unknown> = qb;
  // Unwrap ordering_operation / grouping_operation / duplicates_removal wrappers
  if (cursor.ordering_operation && typeof cursor.ordering_operation === 'object') {
    const ord = cursor.ordering_operation as Record<string, unknown>;
    if (ord.using_filesort) extraFlags.push('Using filesort');
    if (ord.using_temporary_table) extraFlags.push('Using temporary');
    cursor = ord;
  }
  if (cursor.grouping_operation && typeof cursor.grouping_operation === 'object') {
    const grp = cursor.grouping_operation as Record<string, unknown>;
    if (grp.using_filesort) extraFlags.push('Using filesort');
    if (grp.using_temporary_table) extraFlags.push('Using temporary');
    cursor = grp;
  }
  if (cursor.duplicates_removal && typeof cursor.duplicates_removal === 'object') {
    const dup = cursor.duplicates_removal as Record<string, unknown>;
    if (dup.using_temporary_table) extraFlags.push('Using temporary');
    cursor = dup;
  }

  if (Array.isArray(cursor.nested_loop)) {
    for (const item of cursor.nested_loop) {
      if (item && typeof item === 'object' && 'table' in item) {
        children.push(
          parseMysqlTableObject((item as Record<string, unknown>).table as Record<string, unknown>, idxRef)
        );
      }
    }
  } else if (cursor.table && typeof cursor.table === 'object') {
    children.push(parseMysqlTableObject(cursor.table as Record<string, unknown>, idxRef));
  } else if (cursor.union_result && typeof cursor.union_result === 'object') {
    const ur = cursor.union_result as Record<string, unknown>;
    extraFlags.push('Using temporary (UNION)');
    if (Array.isArray(ur.query_specifications)) {
      for (const qs of ur.query_specifications) {
        if (qs && typeof qs === 'object' && 'query_block' in qs) {
          children.push(
            parseMysqlQueryBlock(
              (qs as Record<string, unknown>).query_block as Record<string, unknown>,
              idxRef
            )
          );
        }
      }
    }
  }

  const { severity, warnings } = classifyMysqlAccessType(undefined, extraFlags);
  return {
    id,
    operation:
      qb.select_id !== undefined ? `Query Block #${String(qb.select_id)}` : 'Query Execution Plan',
    severity,
    estimatedRows: children.reduce((acc, c) => acc + c.estimatedRows, 0),
    cost: queryCost !== undefined ? Number(queryCost.toFixed(2)) : undefined,
    extraFlags,
    warnings,
    children
  };
}

function parsePostgresPlanNode(
  plan: Record<string, unknown>,
  idxRef: { next: number }
): VisualExplainNode {
  const id = `node-${idxRef.next++}`;
  const nodeType = String(plan['Node Type'] ?? 'Plan Node');
  const low = nodeType.toLowerCase();
  const tableName = plan['Relation Name'] ? String(plan['Relation Name']) : undefined;
  const indexName = plan['Index Name'] ? String(plan['Index Name']) : undefined;
  const rows = num(plan['Actual Rows'] ?? plan['Plan Rows']);
  const totalCost = plan['Total Cost'] !== undefined ? num(plan['Total Cost']) : undefined;
  const extraFlags: string[] = [];
  const warnings: string[] = [];
  let severity: ExplainNodeSeverity = 'ok';

  if (low.includes('seq scan')) {
    severity = rows > 500 ? 'danger' : 'warn';
    warnings.push('Sequential Scan (Full Table Scan) — pertimbangkan index pada kolom filter/JOIN');
  } else if (low.includes('sort')) {
    severity = 'warn';
    extraFlags.push('Sort Operation');
    if (plan['Sort Space Type'] === 'Disk') {
      severity = 'danger';
      warnings.push('External Disk Sort — menumpahkan proses sort ke disk');
    }
  } else if (low.includes('nested loop') && rows > 5000) {
    severity = 'warn';
    warnings.push('Nested Loop dengan estimasi baris besar');
  }

  if (plan['Filter']) {
    extraFlags.push(`Filter: ${String(plan['Filter']).slice(0, 60)}`);
  }

  const subPlans = Array.isArray(plan['Plans']) ? plan['Plans'] : [];
  const children = subPlans
    .filter((p): p is Record<string, unknown> => Boolean(p && typeof p === 'object'))
    .map((p) => parsePostgresPlanNode(p, idxRef));

  return {
    id,
    operation: nodeType,
    table: tableName,
    accessType: nodeType,
    severity,
    estimatedRows: rows,
    cost: totalCost !== undefined ? Number(totalCost.toFixed(2)) : undefined,
    keyUsed: indexName,
    extraFlags,
    warnings,
    children
  };
}

function summarizeTree(root: VisualExplainNode): {
  totalCost: number;
  totalEstimatedRows: number;
  hasFullTableScan: boolean;
  hasFilesort: boolean;
  hasTempTable: boolean;
  healthScore: number;
  summaryTips: string[];
} {
  let maxCost = root.cost ?? 0;
  let totalRows = 0;
  let hasFullTableScan = false;
  let hasFilesort = false;
  let hasTempTable = false;
  const tips = new Set<string>();

  const walk = (node: VisualExplainNode): void => {
    if ((node.cost ?? 0) > maxCost) maxCost = node.cost ?? 0;
    if (node.table) totalRows += node.estimatedRows;
    const acc = (node.accessType || '').toLowerCase();
    if (acc === 'all' || acc.includes('seq scan')) {
      hasFullTableScan = true;
      tips.add(
        `Tambahkan INDEX pada kolom WHERE / JOIN di tabel "${node.table || 'utama'}" untuk menghilangkan Full Table Scan.`
      );
    }
    for (const f of node.extraFlags) {
      const low = f.toLowerCase();
      if (low.includes('filesort')) {
        hasFilesort = true;
        tips.add('Sesuaikan composite index dengan urutan kolom ORDER BY untuk menghilangkan Using filesort.');
      }
      if (low.includes('temporary')) {
        hasTempTable = true;
        tips.add('Optimalkan GROUP BY / DISTINCT atau tambah index pendukung agar tidak membuat Temporary Table.');
      }
    }
    for (const child of node.children) walk(child);
  };
  walk(root);

  let score = 100;
  if (hasFullTableScan) score -= 35;
  if (hasTempTable) score -= 22;
  if (hasFilesort) score -= 15;
  if (totalRows > 50000) score -= 12;
  else if (totalRows > 10000) score -= 6;

  if (tips.size === 0) {
    tips.add('Rencana eksekusi sudah sangat baik — kueri memanfaatkan index dengan efisien.');
  }

  return {
    totalCost: Number(maxCost.toFixed(2)),
    totalEstimatedRows: totalRows || root.estimatedRows,
    hasFullTableScan,
    hasFilesort,
    hasTempTable,
    healthScore: Math.max(5, Math.min(100, score)),
    summaryTips: Array.from(tips)
  };
}

export function buildVisualExplainReport(args: {
  engine: DbEngine;
  sql: string;
  jsonPayload?: unknown;
  tabularRows?: Array<Record<string, unknown>>;
  durationMs: number;
}): VisualExplainReport {
  const idxRef = { next: 1 };

  // 1. JSON Format (MySQL EXPLAIN FORMAT=JSON or PostgreSQL EXPLAIN (FORMAT JSON))
  if (args.jsonPayload !== undefined && args.jsonPayload !== null) {
    let parsed: unknown = args.jsonPayload;
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        parsed = null;
      }
    }

    if (parsed && typeof parsed === 'object') {
      if (args.engine === 'postgres') {
        const arr = Array.isArray(parsed) ? parsed : [parsed];
        const first = arr[0] as Record<string, unknown> | undefined;
        const planObj =
          first && first.Plan && typeof first.Plan === 'object'
            ? (first.Plan as Record<string, unknown>)
            : (first ?? {});
        const root = parsePostgresPlanNode(planObj, idxRef);
        const summary = summarizeTree(root);
        return {
          engine: 'postgres',
          sql: args.sql,
          format: 'json',
          root,
          ...summary,
          rawText: JSON.stringify(parsed, null, 2),
          durationMs: args.durationMs
        };
      }

      const obj = parsed as Record<string, unknown>;
      if (obj.query_block && typeof obj.query_block === 'object') {
        const root = parseMysqlQueryBlock(obj.query_block as Record<string, unknown>, idxRef);
        const summary = summarizeTree(root);
        return {
          engine: 'mysql',
          sql: args.sql,
          format: 'json',
          root,
          ...summary,
          rawText: JSON.stringify(parsed, null, 2),
          durationMs: args.durationMs
        };
      }
    }
  }

  // 2. Tabular fallback (older MariaDB / MySQL classic EXPLAIN rows)
  const rows = args.tabularRows ?? [];
  const children: VisualExplainNode[] = rows.map((r) => {
    const extraRaw = String(r.Extra ?? r.extra ?? '');
    const extraFlags = extraRaw
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    const accessType = r.type ? String(r.type) : undefined;
    const { severity, warnings } = classifyMysqlAccessType(accessType, extraFlags);
    const possibleKeys = r.possible_keys
      ? String(r.possible_keys)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    return {
      id: `node-${idxRef.next++}`,
      operation: accessType ? `${accessType.toUpperCase()} Scan` : 'Table Access',
      table: String(r.table ?? 'table'),
      accessType,
      severity,
      estimatedRows: num(r.rows),
      filteredPct: r.filtered !== undefined ? num(r.filtered) : undefined,
      keyUsed: r.key ? String(r.key) : undefined,
      possibleKeys,
      keyLength: r.key_len ? String(r.key_len) : undefined,
      extraFlags,
      warnings,
      children: []
    };
  });

  const root: VisualExplainNode = {
    id: 'node-root',
    operation: 'Execution Plan (Tabular)',
    severity: children.some((c) => c.severity === 'danger')
      ? 'danger'
      : children.some((c) => c.severity === 'warn')
        ? 'warn'
        : 'ok',
    estimatedRows: children.reduce((acc, c) => acc + c.estimatedRows, 0),
    extraFlags: [],
    warnings: [],
    children
  };

  const summary = summarizeTree(root);
  return {
    engine: args.engine,
    sql: args.sql,
    format: 'tabular',
    root,
    ...summary,
    rawText: JSON.stringify(rows, null, 2),
    durationMs: args.durationMs
  };
}
