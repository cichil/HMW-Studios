import type { DbEngine } from './types';
import { formatSqlLiteralValue } from './sqlUndoBuilder';

export interface RowCellDiffItem {
  column: string;
  sourceValue: unknown;
  targetValue: unknown;
}

export interface RowDiffModifiedEntry {
  pkKey: string;
  pkValues: Record<string, unknown>;
  cellDiffs: RowCellDiffItem[];
  sourceRow: Record<string, unknown>;
}

export interface TableRowDiffReport {
  primaryKeys: string[];
  comparedColumns: string[];
  identicalCount: number;
  onlyInSource: Array<Record<string, unknown>>;
  modified: RowDiffModifiedEntry[];
  onlyInTarget: Array<Record<string, unknown>>;
  syncSql: string;
}

function quoteIdent(ident: string, engine: DbEngine): string {
  return engine === 'postgres'
    ? `"${ident.replace(/"/g, '""')}"`
    : `\`${ident.replace(/`/g, '``')}\``;
}

function normalizeComparableVal(v: unknown): string {
  if (v === null || v === undefined) return '__NULL__';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/**
 * Compares rows between a Source table (e.g. Staging) and Target table (e.g. Production)
 * keyed by Primary Key, and generates exact `INSERT` / `UPDATE` (and optional `DELETE`) SQL!
 */
export function diffTableRowsByPrimaryKey(opts: {
  sourceRows: Array<Record<string, unknown>>;
  targetRows: Array<Record<string, unknown>>;
  primaryKeys: string[];
  targetTable: string;
  targetDatabase?: string;
  targetEngine: DbEngine;
  includeDeleteMissingInTarget?: boolean;
}): TableRowDiffReport {
  const {
    sourceRows,
    targetRows,
    primaryKeys,
    targetTable,
    targetDatabase,
    targetEngine,
    includeDeleteMissingInTarget = false
  } = opts;

  const pks =
    primaryKeys.length > 0
      ? primaryKeys
      : Object.keys(sourceRows[0] ?? targetRows[0] ?? {}).slice(0, 1);

  const colSet = new Set<string>();
  for (const r of sourceRows) {
    for (const k of Object.keys(r)) colSet.add(k);
  }
  if (colSet.size === 0) {
    for (const r of targetRows) {
      for (const k of Object.keys(r)) colSet.add(k);
    }
  }
  const comparedColumns = Array.from(colSet);

  const makePkKey = (row: Record<string, unknown>): string =>
    pks.map((pk) => `${pk}=${normalizeComparableVal(row[pk])}`).join('|');

  const targetByPk = new Map<string, Record<string, unknown>>();
  for (const tr of targetRows) {
    targetByPk.set(makePkKey(tr), tr);
  }

  const seenTargetKeys = new Set<string>();
  const onlyInSource: Array<Record<string, unknown>> = [];
  const modified: RowDiffModifiedEntry[] = [];
  let identicalCount = 0;

  for (const sr of sourceRows) {
    const key = makePkKey(sr);
    const tr = targetByPk.get(key);
    if (!tr) {
      onlyInSource.push(sr);
      continue;
    }
    seenTargetKeys.add(key);

    const diffs: RowCellDiffItem[] = [];
    for (const col of comparedColumns) {
      if (tr[col] === undefined && sr[col] === undefined) continue;
      if (normalizeComparableVal(sr[col]) !== normalizeComparableVal(tr[col])) {
        diffs.push({
          column: col,
          sourceValue: sr[col],
          targetValue: tr[col]
        });
      }
    }

    if (diffs.length === 0) {
      identicalCount++;
    } else {
      const pkValues: Record<string, unknown> = {};
      for (const pk of pks) pkValues[pk] = sr[pk];
      modified.push({
        pkKey: key,
        pkValues,
        cellDiffs: diffs,
        sourceRow: sr
      });
    }
  }

  const onlyInTarget: Array<Record<string, unknown>> = [];
  for (const [key, tr] of targetByPk.entries()) {
    if (!seenTargetKeys.has(key)) {
      onlyInTarget.push(tr);
    }
  }

  // Generate Synchronization SQL (`INSERT` + `UPDATE` + optional `DELETE`)
  const qualifiedTbl =
    targetDatabase && targetEngine === 'mysql'
      ? `${quoteIdent(targetDatabase, targetEngine)}.${quoteIdent(targetTable, targetEngine)}`
      : quoteIdent(targetTable, targetEngine);

  const sqlLines: string[] = [
    `-- HMW Studio Enterprise Table Data Diff Sync Script`,
    `-- Tabel Tujuan: ${qualifiedTbl} (${onlyInSource.length} INSERT, ${modified.length} UPDATE${
      includeDeleteMissingInTarget ? `, ${onlyInTarget.length} DELETE` : ''
    })`
  ];

  for (const row of onlyInSource) {
    const cols = Object.keys(row);
    const colList = cols.map((c) => quoteIdent(c, targetEngine)).join(', ');
    const valList = cols.map((c) => formatSqlLiteralValue(row[c], targetEngine)).join(', ');
    sqlLines.push(`INSERT INTO ${qualifiedTbl} (${colList}) VALUES (${valList});`);
  }

  for (const mod of modified) {
    const setClause = mod.cellDiffs
      .map(
        (d) =>
          `${quoteIdent(d.column, targetEngine)} = ${formatSqlLiteralValue(
            d.sourceValue,
            targetEngine
          )}`
      )
      .join(', ');
    const whereClause = pks
      .map(
        (pk) =>
          `${quoteIdent(pk, targetEngine)} = ${formatSqlLiteralValue(
            mod.pkValues[pk],
            targetEngine
          )}`
      )
      .join(' AND ');
    sqlLines.push(`UPDATE ${qualifiedTbl} SET ${setClause} WHERE ${whereClause};`);
  }

  if (includeDeleteMissingInTarget) {
    for (const tr of onlyInTarget) {
      const whereClause = pks
        .map((pk) => `${quoteIdent(pk, targetEngine)} = ${formatSqlLiteralValue(tr[pk], targetEngine)}`)
        .join(' AND ');
      sqlLines.push(`DELETE FROM ${qualifiedTbl} WHERE ${whereClause};`);
    }
  }

  return {
    primaryKeys: pks,
    comparedColumns,
    identicalCount,
    onlyInSource,
    modified,
    onlyInTarget,
    syncSql: sqlLines.join('\n')
  };
}
