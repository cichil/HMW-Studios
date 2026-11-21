import type { DbColumnMeta, DbEngine, DbForeignKeyMeta, DbTableMeta } from './types';

export interface ErDiagramRelation {
  id: string;
  fromSchema?: string;
  fromTable: string;
  fromColumn: string;
  toSchema?: string;
  toTable: string;
  toColumn: string;
  kind: 'explicit-fk' | 'implicit-key';
  constraintName?: string;
}

export interface ErDiagramNode {
  key: string;
  name: string;
  schema?: string;
  kind: 'table' | 'view';
  rowEstimate?: number;
  columns: DbColumnMeta[];
  primaryKeys: string[];
  x: number;
  y: number;
}

export interface ErDiagramGraph {
  nodes: ErDiagramNode[];
  relations: ErDiagramRelation[];
}

function escapeSqlIdent(ident: string, engine: DbEngine): string {
  if (engine === 'postgres') {
    return `"${ident.replace(/"/g, '""')}"`;
  }
  return `\`${ident.replace(/`/g, '``')}\``;
}

function formatColumnDefinition(col: DbColumnMeta, engine: DbEngine): string {
  const quote = (s: string): string => escapeSqlIdent(s, engine);
  const typePart = col.columnType || col.dataType || 'VARCHAR(255)';
  const nullPart = col.nullable ? 'NULL' : 'NOT NULL';
  const extraPart =
    engine === 'mysql' && col.extra ? ` ${col.extra.toUpperCase()}` : '';
  const defaultPart =
    col.defaultValue !== undefined && col.defaultValue !== null
      ? ` DEFAULT ${
          /^(CURRENT_TIMESTAMP(?:\(\))?|NOW\(\)|NULL|true|false|-?\d+(?:\.\d+)?)$/i.test(
            String(col.defaultValue)
          )
            ? col.defaultValue
            : `'${String(col.defaultValue).replace(/'/g, "''")}'`
        }`
      : '';
  return `${quote(col.name)} ${typePart} ${nullPart}${defaultPart}${extraPart}`.trim();
}

export function buildCreateTableStatement(table: DbTableMeta, engine: DbEngine): string {
  const quote = (s: string): string => escapeSqlIdent(s, engine);
  const lines = table.columns.map((c) => `  ${formatColumnDefinition(c, engine)}`);
  if (table.primaryKeys.length > 0) {
    lines.push(`  PRIMARY KEY (${table.primaryKeys.map(quote).join(', ')})`);
  }
  return `CREATE TABLE ${quote(table.name)} (\n${lines.join(',\n')}\n);`;
}

const GENERIC_NON_FK_COLUMNS = new Set([
  'id',
  'nama',
  'name',
  'keterangan',
  'ket',
  'status',
  'aktif',
  'active',
  'created_at',
  'updated_at',
  'deleted_at',
  'tgl_input',
  'tgl_update',
  'tahun',
  'bulan',
  'tanggal',
  'tgl',
  'alamat',
  'email',
  'password',
  'username',
  'urut',
  'no_urut',
  'level',
  'tipe',
  'jenis'
]);

function looksMasterTable(tableName: string): number {
  const low = tableName.toLowerCase();
  if (/^(mst_|ms_|ref_|m_|master_|tb_mst_|tbl_mst_)/.test(low)) return 3;
  if (/^(users|pegawai|unitkerja|jabatan|satker|instansi|roles|permissions|categories|departments)$/.test(low)) {
    return 2;
  }
  return 0;
}

export function buildErDiagramGraph(
  tables: DbTableMeta[],
  options?: { includeImplicit?: boolean; maxNodes?: number }
): ErDiagramGraph {
  const includeImplicit = options?.includeImplicit ?? true;
  const maxNodes = options?.maxNodes ?? 80;
  const sliced = tables.slice(0, maxNodes);

  const byNameLower = new Map<string, DbTableMeta[]>();
  const byFullKeyLower = new Map<string, DbTableMeta>();

  for (const t of sliced) {
    const tLow = t.name.toLowerCase();
    const list = byNameLower.get(tLow) ?? [];
    list.push(t);
    byNameLower.set(tLow, list);
    const sLow = (t.schema ?? '').toLowerCase();
    byFullKeyLower.set(`${sLow}.${tLow}`, t);
  }

  const relations: ErDiagramRelation[] = [];
  const seenEdge = new Set<string>();

  const pushRelation = (rel: Omit<ErDiagramRelation, 'id'>): void => {
    if (
      rel.fromTable.toLowerCase() === rel.toTable.toLowerCase() &&
      (rel.fromSchema ?? '').toLowerCase() === (rel.toSchema ?? '').toLowerCase() &&
      rel.fromColumn.toLowerCase() === rel.toColumn.toLowerCase()
    ) {
      return;
    }
    const edgeKey = `${(rel.fromSchema ?? '').toLowerCase()}.${rel.fromTable.toLowerCase()}.${rel.fromColumn.toLowerCase()}->${(rel.toSchema ?? '').toLowerCase()}.${rel.toTable.toLowerCase()}.${rel.toColumn.toLowerCase()}`;
    if (seenEdge.has(edgeKey)) return;
    seenEdge.add(edgeKey);
    relations.push({
      id: edgeKey,
      ...rel
    });
  };

  // 1. Explicit Foreign Keys from information_schema
  for (const t of sliced) {
    for (const fk of t.foreignKeys ?? ([] as DbForeignKeyMeta[])) {
      const targetSchemaLow = (fk.referencedSchema ?? t.schema ?? '').toLowerCase();
      const targetTblLow = fk.referencedTable.toLowerCase();
      const targetTbl =
        byFullKeyLower.get(`${targetSchemaLow}.${targetTblLow}`) ??
        byNameLower.get(targetTblLow)?.[0];
      if (!targetTbl) continue;

      pushRelation({
        fromSchema: t.schema,
        fromTable: t.name,
        fromColumn: fk.column,
        toSchema: targetTbl.schema,
        toTable: targetTbl.name,
        toColumn: fk.referencedColumn,
        kind: 'explicit-fk',
        constraintName: fk.constraintName
      });
    }
  }

  // 2. Smart Implicit Key Detection for Legacy / MyISAM / Wisanggeni / Laravel schemas
  if (includeImplicit) {
    // Index candidate parent tables that expose a single PK (or master key column `kd_*`, `id_*`, `nip`)
    const parentByPkColumn = new Map<string, DbTableMeta[]>();
    for (const t of sliced) {
      if (t.kind === 'view') continue;
      if (t.primaryKeys.length === 1) {
        const pkLow = t.primaryKeys[0].toLowerCase();
        if (!GENERIC_NON_FK_COLUMNS.has(pkLow)) {
          const list = parentByPkColumn.get(pkLow) ?? [];
          list.push(t);
          parentByPkColumn.set(pkLow, list);
        }
      } else if (t.primaryKeys.length === 0 && looksMasterTable(t.name) > 0 && t.columns.length > 0) {
        const firstCol = t.columns[0].name.toLowerCase();
        if (/^(kd_|id_|kode_|nip$)/.test(firstCol)) {
          const list = parentByPkColumn.get(firstCol) ?? [];
          list.push(t);
          parentByPkColumn.set(firstCol, list);
        }
      }
    }

    for (const t of sliced) {
      for (const col of t.columns) {
        const colLow = col.name.toLowerCase();
        if (GENERIC_NON_FK_COLUMNS.has(colLow)) continue;
        // Skip if this column is already the sole PK of a master table itself
        const isSolePkHere = t.primaryKeys.length === 1 && t.primaryKeys[0].toLowerCase() === colLow;

        // Pattern A: Exact key-name match (`kd_unitkerja`, `id_pegawai`, `nip`) pointing to a master/PK table
        const sameKeyParents = parentByPkColumn.get(colLow) ?? [];
        if (sameKeyParents.length > 0) {
          const sortedParents = [...sameKeyParents]
            .filter(
              (p) =>
                !(
                  p.name.toLowerCase() === t.name.toLowerCase() &&
                  (p.schema ?? '').toLowerCase() === (t.schema ?? '').toLowerCase()
                )
            )
            .sort((a, b) => looksMasterTable(b.name) - looksMasterTable(a.name));

          const bestParent = sortedParents[0];
          if (bestParent && (!isSolePkHere || looksMasterTable(bestParent.name) > looksMasterTable(t.name))) {
            pushRelation({
              fromSchema: t.schema,
              fromTable: t.name,
              fromColumn: col.name,
              toSchema: bestParent.schema,
              toTable: bestParent.name,
              toColumn: bestParent.primaryKeys[0] ?? col.name,
              kind: 'implicit-key'
            });
            continue;
          }
        }

        // Pattern B: Laravel / convention `user_id` -> `users.id` or `pegawai_id` -> `pegawai.id` / `mst_pegawai.id`
        const suffixId = colLow.match(/^([a-z0-9_]+)_id$/);
        const prefixId = colLow.match(/^(?:id|kd)_([a-z0-9_]+)$/);
        const stem = suffixId?.[1] ?? prefixId?.[1];
        if (stem && stem.length >= 3) {
          const candidateNames = [
            stem,
            `${stem}s`,
            `${stem}es`,
            `mst_${stem}`,
            `ref_${stem}`,
            `m_${stem}`,
            `tb_${stem}`,
            `tbl_${stem}`
          ];
          let matchedParent: DbTableMeta | undefined;
          for (const cand of candidateNames) {
            const found = byNameLower.get(cand)?.[0];
            if (
              found &&
              !(
                found.name.toLowerCase() === t.name.toLowerCase() &&
                (found.schema ?? '').toLowerCase() === (t.schema ?? '').toLowerCase()
              )
            ) {
              matchedParent = found;
              break;
            }
          }
          if (matchedParent) {
            const targetPk =
              matchedParent.primaryKeys[0] ??
              matchedParent.columns.find((c) => c.name.toLowerCase() === colLow)?.name ??
              matchedParent.columns.find((c) => c.name.toLowerCase() === 'id')?.name;
            if (targetPk) {
              pushRelation({
                fromSchema: t.schema,
                fromTable: t.name,
                fromColumn: col.name,
                toSchema: matchedParent.schema,
                toTable: matchedParent.name,
                toColumn: targetPk,
                kind: 'implicit-key'
              });
            }
          }
        }
      }
    }
  }

  // Layout nodes cleanly in a responsive multi-column grid, placing connected master tables near the top-left
  const degreeMap = new Map<string, number>();
  for (const r of relations) {
    const fk = `${(r.fromSchema ?? '').toLowerCase()}.${r.fromTable.toLowerCase()}`;
    const tk = `${(r.toSchema ?? '').toLowerCase()}.${r.toTable.toLowerCase()}`;
    degreeMap.set(fk, (degreeMap.get(fk) ?? 0) + 1);
    degreeMap.set(tk, (degreeMap.get(tk) ?? 0) + 2);
  }

  const ordered = [...sliced].sort((a, b) => {
    const ka = `${(a.schema ?? '').toLowerCase()}.${a.name.toLowerCase()}`;
    const kb = `${(b.schema ?? '').toLowerCase()}.${b.name.toLowerCase()}`;
    const da = (degreeMap.get(ka) ?? 0) + looksMasterTable(a.name);
    const db = (degreeMap.get(kb) ?? 0) + looksMasterTable(b.name);
    if (db !== da) return db - da;
    return a.name.localeCompare(b.name);
  });

  const colsCount = Math.max(2, Math.min(4, Math.ceil(Math.sqrt(ordered.length))));
  const colHeights = new Array<number>(colsCount).fill(32);
  const CARD_WIDTH = 258;
  const H_GAP = 64;
  const V_GAP = 34;

  const nodes: ErDiagramNode[] = ordered.map((t, idx) => {
    const colIdx = idx % colsCount;
    const x = 32 + colIdx * (CARD_WIDTH + H_GAP);
    const y = colHeights[colIdx];
    const visibleColRows = Math.min(t.columns.length, 10);
    const estimatedCardHeight = 46 + visibleColRows * 21 + (t.columns.length > 10 ? 20 : 8);
    colHeights[colIdx] += estimatedCardHeight + V_GAP;

    return {
      key: `${(t.schema ?? '').toLowerCase()}.${t.name.toLowerCase()}`,
      name: t.name,
      schema: t.schema,
      kind: t.kind,
      rowEstimate: t.rowEstimate,
      columns: t.columns,
      primaryKeys: t.primaryKeys,
      x,
      y
    };
  });

  return { nodes, relations };
}

export interface DbColumnDiffItem {
  table: string;
  column: string;
  kind: 'missing-in-target' | 'extra-in-target' | 'type-mismatch';
  sourceType?: string;
  targetType?: string;
  alterSql?: string;
}

export interface DbSchemaDiffResult {
  sourceLabel: string;
  targetLabel: string;
  engine: DbEngine;
  missingTablesInTarget: string[];
  extraTablesInTarget: string[];
  columnDiffs: DbColumnDiffItem[];
  identicalTablesCount: number;
  migrationSql: string;
}

function normalizeColumnSignature(col: DbColumnMeta): string {
  return `${(col.columnType || col.dataType).trim().toLowerCase()}|${col.nullable ? 'null' : 'notnull'}`;
}

export function diffDatabaseSchemas(
  sourceLabel: string,
  sourceTables: DbTableMeta[],
  targetLabel: string,
  targetTables: DbTableMeta[],
  engine: DbEngine
): DbSchemaDiffResult {
  const quote = (s: string): string => escapeSqlIdent(s, engine);
  const srcOnlyTables = sourceTables.filter((t) => t.kind === 'table');
  const tgtOnlyTables = targetTables.filter((t) => t.kind === 'table');

  const targetByName = new Map<string, DbTableMeta>();
  for (const t of tgtOnlyTables) {
    targetByName.set(t.name.toLowerCase(), t);
  }
  const sourceNames = new Set(srcOnlyTables.map((t) => t.name.toLowerCase()));

  const missingTablesInTarget: string[] = [];
  const extraTablesInTarget: string[] = [];
  const columnDiffs: DbColumnDiffItem[] = [];
  const sqlBlocks: string[] = [
    `-- =========================================================`,
    `-- HMW Studio Schema Diff Migration (${engine.toUpperCase()})`,
    `-- Sumber Acuan : ${sourceLabel}`,
    `-- Target Tujuan: ${targetLabel}`,
    `-- =========================================================`,
    ``
  ];

  let identicalTablesCount = 0;

  for (const srcTbl of srcOnlyTables) {
    const tgtTbl = targetByName.get(srcTbl.name.toLowerCase());
    if (!tgtTbl) {
      missingTablesInTarget.push(srcTbl.name);
      sqlBlocks.push(`-- [TABEL BARU] ${srcTbl.name}`);
      sqlBlocks.push(buildCreateTableStatement(srcTbl, engine));
      sqlBlocks.push('');
      continue;
    }

    const tgtColMap = new Map<string, DbColumnMeta>();
    for (const c of tgtTbl.columns) {
      tgtColMap.set(c.name.toLowerCase(), c);
    }
    const srcColSet = new Set(srcTbl.columns.map((c) => c.name.toLowerCase()));

    let hasDiffOnTable = false;
    const tableAlterStmts: string[] = [];

    for (let i = 0; i < srcTbl.columns.length; i++) {
      const srcCol = srcTbl.columns[i];
      const tgtCol = tgtColMap.get(srcCol.name.toLowerCase());
      const prevCol = i > 0 ? srcTbl.columns[i - 1] : null;

      if (!tgtCol) {
        hasDiffOnTable = true;
        const posClause =
          engine === 'mysql'
            ? prevCol
              ? ` AFTER ${quote(prevCol.name)}`
              : ' FIRST'
            : '';
        const alterSql = `ALTER TABLE ${quote(tgtTbl.name)} ADD COLUMN ${formatColumnDefinition(srcCol, engine)}${posClause};`;
        columnDiffs.push({
          table: tgtTbl.name,
          column: srcCol.name,
          kind: 'missing-in-target',
          sourceType: `${srcCol.columnType}${srcCol.nullable ? ' NULL' : ' NOT NULL'}`,
          alterSql
        });
        tableAlterStmts.push(alterSql);
      } else if (normalizeColumnSignature(srcCol) !== normalizeColumnSignature(tgtCol)) {
        hasDiffOnTable = true;
        const alterSql =
          engine === 'postgres'
            ? `ALTER TABLE ${quote(tgtTbl.name)} ALTER COLUMN ${quote(srcCol.name)} TYPE ${srcCol.columnType || srcCol.dataType};`
            : `ALTER TABLE ${quote(tgtTbl.name)} MODIFY COLUMN ${formatColumnDefinition(srcCol, engine)};`;
        columnDiffs.push({
          table: tgtTbl.name,
          column: srcCol.name,
          kind: 'type-mismatch',
          sourceType: `${srcCol.columnType}${srcCol.nullable ? ' NULL' : ' NOT NULL'}`,
          targetType: `${tgtCol.columnType}${tgtCol.nullable ? ' NULL' : ' NOT NULL'}`,
          alterSql
        });
        tableAlterStmts.push(alterSql);
      }
    }

    for (const tgtCol of tgtTbl.columns) {
      if (!srcColSet.has(tgtCol.name.toLowerCase())) {
        hasDiffOnTable = true;
        columnDiffs.push({
          table: tgtTbl.name,
          column: tgtCol.name,
          kind: 'extra-in-target',
          targetType: `${tgtCol.columnType}${tgtCol.nullable ? ' NULL' : ' NOT NULL'}`
        });
      }
    }

    if (tableAlterStmts.length > 0) {
      sqlBlocks.push(`-- [PERUBAHAN KOLOM] ${tgtTbl.name}`);
      sqlBlocks.push(...tableAlterStmts);
      sqlBlocks.push('');
    }

    if (!hasDiffOnTable) {
      identicalTablesCount += 1;
    }
  }

  for (const tgtTbl of tgtOnlyTables) {
    if (!sourceNames.has(tgtTbl.name.toLowerCase())) {
      extraTablesInTarget.push(tgtTbl.name);
    }
  }

  const hasMigrationChanges =
    missingTablesInTarget.length > 0 ||
    columnDiffs.some((d) => Boolean(d.alterSql));

  if (!hasMigrationChanges) {
    sqlBlocks.push('-- Skema target sudah memiliki seluruh tabel & definisi kolom dari sumber acuan.');
  }

  if (extraTablesInTarget.length > 0) {
    sqlBlocks.push('');
    sqlBlocks.push(
      `-- Catatan: ${extraTablesInTarget.length} tabel hanya ada di target (tidak dihapus otomatis demi keamanan): ${extraTablesInTarget.join(', ')}`
    );
  }

  return {
    sourceLabel,
    targetLabel,
    engine,
    missingTablesInTarget,
    extraTablesInTarget,
    columnDiffs,
    identicalTablesCount,
    migrationSql: sqlBlocks.join('\n').trim()
  };
}
