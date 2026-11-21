import type { DbColumnMeta, DbEngine, DbForeignKeyMeta, DbTableMeta } from './types';

export type DesignerBaseType =
  | 'INT'
  | 'BIGINT'
  | 'SMALLINT'
  | 'TINYINT'
  | 'VARCHAR'
  | 'CHAR'
  | 'TEXT'
  | 'LONGTEXT'
  | 'DECIMAL'
  | 'DOUBLE'
  | 'DATE'
  | 'DATETIME'
  | 'TIMESTAMP'
  | 'BOOLEAN'
  | 'JSON'
  | 'ENUM';

export interface TableColumnDraft {
  uid: string;
  originalName?: string;
  name: string;
  dataType: string;
  lengthOrValues: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  autoIncrement: boolean;
  defaultValue: string;
  comment: string;
}

export interface TableIndexDraft {
  uid: string;
  originalName?: string;
  name: string;
  unique: boolean;
  columns: string[];
}

export interface TableFkDraft {
  uid: string;
  originalName?: string;
  constraintName: string;
  column: string;
  referencedSchema?: string;
  referencedTable: string;
  referencedColumn: string;
  onDelete: 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'NO ACTION';
}

export interface TableDesignerDraft {
  mode: 'create' | 'alter';
  engine: DbEngine;
  schema?: string;
  tableName: string;
  originalTable?: DbTableMeta;
  columns: TableColumnDraft[];
  deletedColumns: string[];
  indexes: TableIndexDraft[];
  deletedIndexes: string[];
  foreignKeys: TableFkDraft[];
  deletedForeignKeys: string[];
}

export interface CompiledTableDesignResult {
  statements: string[];
  fullSql: string;
  hasDestructiveChanges: boolean;
  warnings: string[];
}

function makeUid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function quoteIdent(id: string, engine: DbEngine): string {
  const clean = id.trim();
  if (engine === 'postgres') {
    return `"${clean.replace(/"/g, '""')}"`;
  }
  return `\`${clean.replace(/`/g, '``')}\``;
}

function qualifyTable(tableName: string, schema: string | undefined, engine: DbEngine): string {
  if (schema && schema.trim()) {
    return `${quoteIdent(schema, engine)}.${quoteIdent(tableName, engine)}`;
  }
  return quoteIdent(tableName, engine);
}

function parseColumnTypeAndLength(col: DbColumnMeta): { dataType: string; lengthOrValues: string } {
  const raw = (col.columnType || col.dataType || 'VARCHAR(255)').trim();
  const parenMatch = raw.match(/^([A-Za-z0-9_ ]+?)\s*\((.+)\)/);
  if (parenMatch) {
    return {
      dataType: parenMatch[1].trim().toUpperCase(),
      lengthOrValues: parenMatch[2].trim()
    };
  }
  return {
    dataType: (col.dataType || raw).trim().toUpperCase(),
    lengthOrValues: ''
  };
}

export function createBlankTableDraft(engine: DbEngine, schema?: string): TableDesignerDraft {
  return {
    mode: 'create',
    engine,
    schema,
    tableName: 'tabel_baru',
    columns: [
      {
        uid: makeUid('col'),
        name: 'id',
        dataType: 'INT',
        lengthOrValues: engine === 'mysql' ? '11' : '',
        nullable: false,
        isPrimaryKey: true,
        autoIncrement: true,
        defaultValue: '',
        comment: 'Primary key otomatis'
      },
      {
        uid: makeUid('col'),
        name: 'nama',
        dataType: 'VARCHAR',
        lengthOrValues: '150',
        nullable: false,
        isPrimaryKey: false,
        autoIncrement: false,
        defaultValue: '',
        comment: ''
      },
      {
        uid: makeUid('col'),
        name: 'created_at',
        dataType: engine === 'postgres' ? 'TIMESTAMP' : 'DATETIME',
        lengthOrValues: '',
        nullable: true,
        isPrimaryKey: false,
        autoIncrement: false,
        defaultValue: 'CURRENT_TIMESTAMP',
        comment: ''
      }
    ],
    deletedColumns: [],
    indexes: [],
    deletedIndexes: [],
    foreignKeys: [],
    deletedForeignKeys: []
  };
}

export function createDraftFromExistingTable(
  table: DbTableMeta,
  engine: DbEngine,
  schema?: string
): TableDesignerDraft {
  const columns: TableColumnDraft[] = table.columns.map((c) => {
    const parsed = parseColumnTypeAndLength(c);
    const extraLower = (c.extra ?? '').toLowerCase();
    const defVal = c.defaultValue ?? '';
    const isAuto =
      extraLower.includes('auto_increment') ||
      extraLower.includes('identity') ||
      defVal.toLowerCase().includes('nextval(');
    return {
      uid: makeUid('col'),
      originalName: c.name,
      name: c.name,
      dataType: parsed.dataType,
      lengthOrValues: parsed.lengthOrValues,
      nullable: c.nullable,
      isPrimaryKey: c.isPrimaryKey,
      autoIncrement: isAuto,
      defaultValue: isAuto ? '' : defVal,
      comment: ''
    };
  });

  const foreignKeys: TableFkDraft[] = (table.foreignKeys ?? []).map((fk: DbForeignKeyMeta, i) => ({
    uid: makeUid('fk'),
    originalName: fk.constraintName || `fk_${table.name}_${i + 1}`,
    constraintName: fk.constraintName || `fk_${table.name}_${fk.column}`,
    column: fk.column,
    referencedSchema: fk.referencedSchema,
    referencedTable: fk.referencedTable,
    referencedColumn: fk.referencedColumn,
    onDelete: 'RESTRICT'
  }));

  return {
    mode: 'alter',
    engine,
    schema: table.schema || schema,
    tableName: table.name,
    originalTable: table,
    columns,
    deletedColumns: [],
    indexes: [],
    deletedIndexes: [],
    foreignKeys,
    deletedForeignKeys: []
  };
}

function formatSqlType(col: TableColumnDraft, engine: DbEngine): string {
  const upper = col.dataType.trim().toUpperCase() || 'VARCHAR';
  const len = col.lengthOrValues.trim();

  if (engine === 'postgres') {
    if (col.autoIncrement) {
      return upper === 'BIGINT' ? 'BIGSERIAL' : 'SERIAL';
    }
    if (upper === 'DATETIME') return 'TIMESTAMP';
    if (upper === 'LONGTEXT') return 'TEXT';
    if (upper === 'TINYINT') return 'SMALLINT';
    if (upper === 'DOUBLE') return 'DOUBLE PRECISION';
    if (upper === 'ENUM') return 'VARCHAR(100)';
    if ((upper === 'VARCHAR' || upper === 'CHAR' || upper === 'DECIMAL' || upper === 'NUMERIC') && len) {
      return `${upper}(${len})`;
    }
    if (upper === 'VARCHAR' && !len) return 'VARCHAR(255)';
    return upper;
  }

  // MySQL / MariaDB
  if (upper === 'VARCHAR' && !len) return 'VARCHAR(255)';
  if (upper === 'DECIMAL' && !len) return 'DECIMAL(15,2)';
  if (upper === 'ENUM' && !len) return "ENUM('Y','N')";
  if (
    len &&
    ['VARCHAR', 'CHAR', 'INT', 'BIGINT', 'SMALLINT', 'TINYINT', 'DECIMAL', 'ENUM'].includes(upper)
  ) {
    return `${upper}(${len})`;
  }
  return upper;
}

function formatDefaultClause(defaultValue: string): string {
  const trimmed = defaultValue.trim();
  if (!trimmed) return '';
  const upper = trimmed.toUpperCase();
  if (
    upper === 'NULL' ||
    upper === 'CURRENT_TIMESTAMP' ||
    upper === 'CURRENT_TIMESTAMP()' ||
    upper === 'NOW()' ||
    upper === 'TRUE' ||
    upper === 'FALSE' ||
    /^-?\d+(\.\d+)?$/.test(trimmed)
  ) {
    return ` DEFAULT ${trimmed}`;
  }
  return ` DEFAULT '${trimmed.replace(/'/g, "''")}'`;
}

function buildColumnDefSql(col: TableColumnDraft, engine: DbEngine): string {
  const sqlType = formatSqlType(col, engine);
  const nullSql = col.nullable && !col.isPrimaryKey ? ' NULL' : ' NOT NULL';
  const autoSql = engine === 'mysql' && col.autoIncrement ? ' AUTO_INCREMENT' : '';
  const defSql = col.autoIncrement ? '' : formatDefaultClause(col.defaultValue);
  const commentSql =
    engine === 'mysql' && col.comment.trim()
      ? ` COMMENT '${col.comment.trim().replace(/'/g, "''")}'`
      : '';
  return `${quoteIdent(col.name, engine)} ${sqlType}${nullSql}${defSql}${autoSql}${commentSql}`;
}

export function compileTableDesignerSql(draft: TableDesignerDraft): CompiledTableDesignResult {
  const warnings: string[] = [];
  const statements: string[] = [];
  let hasDestructiveChanges = false;
  const engine = draft.engine;
  const tableName = draft.tableName.trim();

  if (!tableName) {
    return {
      statements: [],
      fullSql: '-- Masukkan nama tabel terlebih dahulu',
      hasDestructiveChanges: false,
      warnings: ['Nama tabel tidak boleh kosong.']
    };
  }

  const validCols = draft.columns.filter((c) => c.name.trim().length > 0);
  if (validCols.length === 0) {
    return {
      statements: [],
      fullSql: '-- Tambahkan minimal 1 kolom pada tabel',
      hasDestructiveChanges: false,
      warnings: ['Tabel wajib memiliki minimal 1 kolom.']
    };
  }

  const targetQual = qualifyTable(tableName, draft.schema, engine);

  // MODE 1: CREATE TABLE
  if (draft.mode === 'create' || !draft.originalTable) {
    const lines: string[] = validCols.map((c) => `  ${buildColumnDefSql(c, engine)}`);
    const pkCols = validCols.filter((c) => c.isPrimaryKey).map((c) => quoteIdent(c.name, engine));
    if (pkCols.length > 0) {
      lines.push(`  PRIMARY KEY (${pkCols.join(', ')})`);
    }

    if (engine === 'mysql') {
      for (const idx of draft.indexes) {
        if (!idx.name.trim() || idx.columns.length === 0) continue;
        const colsSql = idx.columns.map((c) => quoteIdent(c, engine)).join(', ');
        lines.push(
          `  ${idx.unique ? 'UNIQUE KEY' : 'KEY'} ${quoteIdent(idx.name, engine)} (${colsSql})`
        );
      }
    }

    for (const fk of draft.foreignKeys) {
      if (!fk.column.trim() || !fk.referencedTable.trim() || !fk.referencedColumn.trim()) continue;
      const refTbl = qualifyTable(fk.referencedTable, fk.referencedSchema, engine);
      const cName = fk.constraintName.trim() || `fk_${tableName}_${fk.column}`;
      lines.push(
        `  CONSTRAINT ${quoteIdent(cName, engine)} FOREIGN KEY (${quoteIdent(fk.column, engine)}) REFERENCES ${refTbl} (${quoteIdent(fk.referencedColumn, engine)}) ON DELETE ${fk.onDelete}`
      );
    }

    const tail =
      engine === 'mysql' ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;' : ';';
    statements.push(`CREATE TABLE ${targetQual} (\n${lines.join(',\n')}\n)${tail}`);

    if (engine === 'postgres') {
      for (const idx of draft.indexes) {
        if (!idx.name.trim() || idx.columns.length === 0) continue;
        const colsSql = idx.columns.map((c) => quoteIdent(c, engine)).join(', ');
        statements.push(
          `CREATE ${idx.unique ? 'UNIQUE ' : ''}INDEX ${quoteIdent(idx.name, engine)} ON ${targetQual} (${colsSql});`
        );
      }
      for (const c of validCols) {
        if (c.comment.trim()) {
          statements.push(
            `COMMENT ON COLUMN ${targetQual}.${quoteIdent(c.name, engine)} IS '${c.comment.trim().replace(/'/g, "''")}';`
          );
        }
      }
    }

    return {
      statements,
      fullSql: statements.join('\n\n'),
      hasDestructiveChanges: false,
      warnings
    };
  }

  // MODE 2: ALTER EXISTING TABLE
  const orig = draft.originalTable;
  const origQual = qualifyTable(orig.name, draft.schema, engine);
  let activeQual = origQual;

  // 1. Table rename
  if (orig.name !== tableName) {
    if (engine === 'mysql') {
      statements.push(`RENAME TABLE ${origQual} TO ${targetQual};`);
    } else {
      statements.push(`ALTER TABLE ${origQual} RENAME TO ${quoteIdent(tableName, engine)};`);
    }
    activeQual = targetQual;
  }

  // 2. Dropped Foreign Keys first (before dropping columns)
  for (const fkName of draft.deletedForeignKeys) {
    hasDestructiveChanges = true;
    if (engine === 'mysql') {
      statements.push(`ALTER TABLE ${activeQual} DROP FOREIGN KEY ${quoteIdent(fkName, engine)};`);
    } else {
      statements.push(`ALTER TABLE ${activeQual} DROP CONSTRAINT ${quoteIdent(fkName, engine)};`);
    }
  }

  // 3. Dropped Indexes
  for (const idxName of draft.deletedIndexes) {
    if (engine === 'mysql') {
      statements.push(`ALTER TABLE ${activeQual} DROP INDEX ${quoteIdent(idxName, engine)};`);
    } else {
      const idxQual = draft.schema
        ? `${quoteIdent(draft.schema, engine)}.${quoteIdent(idxName, engine)}`
        : quoteIdent(idxName, engine);
      statements.push(`DROP INDEX IF EXISTS ${idxQual};`);
    }
  }

  // 4. Dropped Columns
  for (const droppedCol of draft.deletedColumns) {
    hasDestructiveChanges = true;
    warnings.push(`Kolom "${droppedCol}" akan dihapus permanen beserta seluruh datanya.`);
    statements.push(`ALTER TABLE ${activeQual} DROP COLUMN ${quoteIdent(droppedCol, engine)};`);
  }

  // Build map of original columns
  const origColMap = new Map<string, DbColumnMeta>();
  for (const oc of orig.columns) {
    origColMap.set(oc.name, oc);
  }

  // 5. Added & Modified / Renamed Columns
  for (let i = 0; i < validCols.length; i++) {
    const col = validCols[i];
    const prevColName = i > 0 ? validCols[i - 1].name : null;

    if (!col.originalName) {
      // Newly added column
      if (engine === 'mysql') {
        const posClause = prevColName
          ? ` AFTER ${quoteIdent(prevColName, engine)}`
          : ' FIRST';
        statements.push(
          `ALTER TABLE ${activeQual} ADD COLUMN ${buildColumnDefSql(col, engine)}${posClause};`
        );
      } else {
        statements.push(`ALTER TABLE ${activeQual} ADD COLUMN ${buildColumnDefSql(col, engine)};`);
      }
      continue;
    }

    const origMeta = origColMap.get(col.originalName);
    if (!origMeta) continue;

    const origParsed = parseColumnTypeAndLength(origMeta);
    const origAuto =
      (origMeta.extra ?? '').toLowerCase().includes('auto_increment') ||
      (origMeta.extra ?? '').toLowerCase().includes('identity') ||
      (origMeta.defaultValue ?? '').toLowerCase().includes('nextval(');
    const origDef = origAuto ? '' : (origMeta.defaultValue ?? '');

    const renamed = col.originalName !== col.name;
    const typeChanged =
      origParsed.dataType.toUpperCase() !== col.dataType.trim().toUpperCase() ||
      origParsed.lengthOrValues !== col.lengthOrValues.trim();
    const nullChanged = origMeta.nullable !== col.nullable;
    const autoChanged = origAuto !== col.autoIncrement;
    const defChanged = origDef !== col.defaultValue.trim();
    const commentAdded = Boolean(col.comment.trim());

    if (!renamed && !typeChanged && !nullChanged && !autoChanged && !defChanged && !commentAdded) {
      continue;
    }

    if (engine === 'mysql') {
      if (renamed) {
        statements.push(
          `ALTER TABLE ${activeQual} CHANGE COLUMN ${quoteIdent(col.originalName, engine)} ${buildColumnDefSql(col, engine)};`
        );
      } else {
        statements.push(
          `ALTER TABLE ${activeQual} MODIFY COLUMN ${buildColumnDefSql(col, engine)};`
        );
      }
    } else {
      // PostgreSQL
      if (renamed) {
        statements.push(
          `ALTER TABLE ${activeQual} RENAME COLUMN ${quoteIdent(col.originalName, engine)} TO ${quoteIdent(col.name, engine)};`
        );
      }
      const colIdent = quoteIdent(col.name, engine);
      if (typeChanged) {
        const pgType = formatSqlType(col, 'postgres').replace(/^BIGSERIAL$/, 'BIGINT').replace(/^SERIAL$/, 'INT');
        statements.push(`ALTER TABLE ${activeQual} ALTER COLUMN ${colIdent} TYPE ${pgType};`);
      }
      if (nullChanged) {
        statements.push(
          `ALTER TABLE ${activeQual} ALTER COLUMN ${colIdent} ${col.nullable ? 'DROP NOT NULL' : 'SET NOT NULL'};`
        );
      }
      if (defChanged) {
        if (!col.defaultValue.trim()) {
          statements.push(`ALTER TABLE ${activeQual} ALTER COLUMN ${colIdent} DROP DEFAULT;`);
        } else {
          statements.push(
            `ALTER TABLE ${activeQual} ALTER COLUMN ${colIdent} SET${formatDefaultClause(col.defaultValue)};`
          );
        }
      }
      if (commentAdded) {
        statements.push(
          `COMMENT ON COLUMN ${activeQual}.${colIdent} IS '${col.comment.trim().replace(/'/g, "''")}';`
        );
      }
    }
  }

  // 6. Primary Key diff
  const origPks = (orig.primaryKeys ?? []).join(',');
  const nextPks = validCols
    .filter((c) => c.isPrimaryKey)
    .map((c) => c.name)
    .join(',');
  if (origPks !== nextPks) {
    if (engine === 'mysql') {
      const pkParts: string[] = [];
      if (origPks) pkParts.push('DROP PRIMARY KEY');
      if (nextPks) {
        const pkList = validCols
          .filter((c) => c.isPrimaryKey)
          .map((c) => quoteIdent(c.name, engine))
          .join(', ');
        pkParts.push(`ADD PRIMARY KEY (${pkList})`);
      }
      if (pkParts.length > 0) {
        statements.push(`ALTER TABLE ${activeQual} ${pkParts.join(', ')};`);
      }
    }
  }

  // 7. New Indexes
  for (const idx of draft.indexes) {
    if (idx.originalName || !idx.name.trim() || idx.columns.length === 0) continue;
    const colsSql = idx.columns.map((c) => quoteIdent(c, engine)).join(', ');
    if (engine === 'mysql') {
      statements.push(
        `ALTER TABLE ${activeQual} ADD ${idx.unique ? 'UNIQUE INDEX' : 'INDEX'} ${quoteIdent(idx.name, engine)} (${colsSql});`
      );
    } else {
      statements.push(
        `CREATE ${idx.unique ? 'UNIQUE ' : ''}INDEX ${quoteIdent(idx.name, engine)} ON ${activeQual} (${colsSql});`
      );
    }
  }

  // 8. New Foreign Keys
  for (const fk of draft.foreignKeys) {
    if (fk.originalName || !fk.column.trim() || !fk.referencedTable.trim() || !fk.referencedColumn.trim()) {
      continue;
    }
    const refTbl = qualifyTable(fk.referencedTable, fk.referencedSchema, engine);
    const cName = fk.constraintName.trim() || `fk_${tableName}_${fk.column}`;
    statements.push(
      `ALTER TABLE ${activeQual} ADD CONSTRAINT ${quoteIdent(cName, engine)} FOREIGN KEY (${quoteIdent(fk.column, engine)}) REFERENCES ${refTbl} (${quoteIdent(fk.referencedColumn, engine)}) ON DELETE ${fk.onDelete};`
    );
  }

  return {
    statements,
    fullSql:
      statements.length > 0
        ? statements.join('\n\n')
        : '-- Belum ada perubahan struktur yang terdeteksi.',
    hasDestructiveChanges,
    warnings
  };
}
