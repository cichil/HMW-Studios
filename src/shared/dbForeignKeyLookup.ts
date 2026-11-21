import type { DbEngine, DbTableMeta } from './types';
import { formatSqlLiteral } from './dbSafeTransaction';

export interface ResolvedFkTarget {
  sourceColumn: string;
  targetSchema?: string;
  targetTable: string;
  targetColumn: string;
  isExplicitFk: boolean;
}

/**
 * Resolves a column in a table/query result to its parent reference table & primary key.
 * Checks explicit Foreign Keys first, then falls back to enterprise naming conventions
 * (e.g., `id_perusahaan` -> `perusahaan.id_perusahaan`, `kd_unitkerja` -> `mst_unitkerja.kd_unitkerja`).
 */
export function resolveForeignKeyTargetForColumn(args: {
  sourceTable?: DbTableMeta | null;
  columnName: string;
  allTables: DbTableMeta[];
  currentDatabase?: string;
}): ResolvedFkTarget | null {
  const { sourceTable, columnName, allTables, currentDatabase } = args;
  const colLow = columnName.toLowerCase();

  // 1. Explicit Foreign Key metadata from information_schema
  if (sourceTable?.foreignKeys && sourceTable.foreignKeys.length > 0) {
    const explicit = sourceTable.foreignKeys.find(
      (fk) => fk.column.toLowerCase() === colLow
    );
    if (explicit) {
      return {
        sourceColumn: columnName,
        targetSchema: explicit.referencedSchema || currentDatabase,
        targetTable: explicit.referencedTable,
        targetColumn: explicit.referencedColumn,
        isExplicitFk: true
      };
    }
  }

  // Avoid jumping from a table's own sole PK back onto itself
  if (
    sourceTable &&
    sourceTable.primaryKeys.length === 1 &&
    sourceTable.primaryKeys[0].toLowerCase() === colLow
  ) {
    return null;
  }

  // 2. Implicit Enterprise / Indonesian Legacy Convention Resolver
  // Match columns starting with id_, kd_, kode_, no_, nip, nik or ending with _id
  const looksLikeFk =
    /^(id|kd|kode|no)_[a-z0-9_]+$/i.test(colLow) ||
    /^[a-z0-9_]+_id$/i.test(colLow) ||
    colLow === 'nip' ||
    colLow === 'nik' ||
    colLow === 'nib';

  if (!looksLikeFk) return null;

  const currentDbLow = (currentDatabase || '').toLowerCase();
  const sourceNameLow = sourceTable?.name.toLowerCase() ?? '';

  // Extract entity stem: `id_perusahaan` -> `perusahaan`, `user_id` -> `user`, `kd_unitkerja` -> `unitkerja`
  const stem = colLow
    .replace(/^(id|kd|kode|no)_/, '')
    .replace(/_id$/, '');

  let best: { table: DbTableMeta; column: string; score: number } | null = null;

  for (const tbl of allTables) {
    if (tbl.kind !== 'table') continue;
    const tNameLow = tbl.name.toLowerCase();
    if (tNameLow === sourceNameLow && (tbl.schema || '').toLowerCase() === (sourceTable?.schema || currentDbLow).toLowerCase()) {
      continue;
    }

    const sameDbBonus =
      currentDbLow && (tbl.schema || '').toLowerCase() === currentDbLow ? 30 : 0;

    // Candidate A: Exact PK match (`id_perusahaan` is PK of `perusahaan` or `mst_perusahaan`)
    const exactPk = tbl.primaryKeys.find((pk) => pk.toLowerCase() === colLow);
    if (exactPk) {
      let score = 80 + sameDbBonus;
      if (tNameLow === stem || tNameLow === `mst_${stem}` || tNameLow === `ref_${stem}` || tNameLow === `tbl_${stem}`) {
        score += 40;
      } else if (tNameLow.includes(stem) && stem.length >= 3) {
        score += 20;
      }
      if (!best || score > best.score) {
        best = { table: tbl, column: exactPk, score };
      }
      continue;
    }

    // Candidate B: Laravel-style `user_id` -> `users.id` or `perusahaan_id` -> `perusahaan.id`
    if (colLow.endsWith('_id') && stem.length >= 2) {
      const hasIdPk = tbl.primaryKeys.find((pk) => pk.toLowerCase() === 'id');
      if (
        hasIdPk &&
        (tNameLow === stem ||
          tNameLow === `${stem}s` ||
          tNameLow === `${stem}es` ||
          tNameLow === `mst_${stem}`)
      ) {
        const score = 95 + sameDbBonus;
        if (!best || score > best.score) {
          best = { table: tbl, column: hasIdPk, score };
        }
      }
    }
  }

  if (!best) return null;
  return {
    sourceColumn: columnName,
    targetSchema: best.table.schema || currentDatabase,
    targetTable: best.table.name,
    targetColumn: best.column,
    isExplicitFk: false
  };
}

export function buildFkLookupSql(
  target: ResolvedFkTarget,
  cellValue: unknown,
  engine: DbEngine
): string {
  const q = (id: string) =>
    engine === 'postgres' ? `"${id.replace(/"/g, '""')}"` : `\`${id.replace(/`/g, '``')}\``;
  const qualTable = target.targetSchema
    ? `${q(target.targetSchema)}.${q(target.targetTable)}`
    : q(target.targetTable);
  const literal = formatSqlLiteral(cellValue, engine);
  return `SELECT * FROM ${qualTable} WHERE ${q(target.targetColumn)} = ${literal} LIMIT 20;`;
}
