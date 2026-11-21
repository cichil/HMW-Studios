import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  KeyRound,
  Link2,
  ListChecks,
  Play,
  Plus,
  Table2,
  Trash2,
  X
} from 'lucide-react';
import {
  compileTableDesignerSql,
  createBlankTableDraft,
  createDraftFromExistingTable,
  type DesignerBaseType,
  type TableColumnDraft,
  type TableDesignerDraft
} from '@shared/tableDesignerCompiler';
import { getRememberedDatabaseForProfile, useIdeStore } from '../store/useIdeStore';

const DATA_TYPES: DesignerBaseType[] = [
  'INT',
  'BIGINT',
  'SMALLINT',
  'TINYINT',
  'VARCHAR',
  'CHAR',
  'TEXT',
  'LONGTEXT',
  'DECIMAL',
  'DOUBLE',
  'DATE',
  'DATETIME',
  'TIMESTAMP',
  'BOOLEAN',
  'JSON',
  'ENUM'
];

export const TableDesignerModal: React.FC = () => {
  const {
    tableDesignerTarget,
    closeTableDesigner,
    selectedDbProfileId,
    dbProfiles,
    dbSchema,
    setDbSchema,
    pushIslandActivity,
    showToast
  } = useIdeStore();

  const [draft, setDraft] = useState<TableDesignerDraft | null>(null);
  const [activeTab, setActiveTab] = useState<'columns' | 'indexes' | 'fks'>('columns');
  const [executing, setExecuting] = useState(false);
  const [execError, setExecError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const activeProfile = useMemo(
    () => dbProfiles.find((p) => p.id === selectedDbProfileId) ?? null,
    [dbProfiles, selectedDbProfileId]
  );

  useEffect(() => {
    if (!tableDesignerTarget) {
      setDraft(null);
      setExecError(null);
      return;
    }
    const engine = dbSchema?.engine ?? activeProfile?.engine ?? 'mysql';
    const targetSchema = tableDesignerTarget.schema || dbSchema?.currentDatabase;
    if (tableDesignerTarget.mode === 'alter' && tableDesignerTarget.table) {
      setDraft(createDraftFromExistingTable(tableDesignerTarget.table, engine, targetSchema));
    } else {
      setDraft(createBlankTableDraft(engine, targetSchema));
    }
    setActiveTab('columns');
    setExecError(null);
  }, [tableDesignerTarget, dbSchema?.engine, dbSchema?.currentDatabase, activeProfile?.engine]);

  const compiled = useMemo(
    () => (draft ? compileTableDesignerSql(draft) : null),
    [draft]
  );

  const availableTables = useMemo(
    () => dbSchema?.allTables ?? dbSchema?.tables ?? [],
    [dbSchema]
  );

  if (!tableDesignerTarget || !draft || !compiled) return null;

  const updateCol = (uid: string, patch: Partial<TableColumnDraft>): void => {
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            columns: prev.columns.map((c) => (c.uid === uid ? { ...c, ...patch } : c))
          }
        : prev
    );
  };

  const addColumn = (): void => {
    const nextIdx = draft.columns.length + 1;
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            columns: [
              ...prev.columns,
              {
                uid: `col-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                name: `kolom_${nextIdx}`,
                dataType: 'VARCHAR',
                lengthOrValues: '150',
                nullable: true,
                isPrimaryKey: false,
                autoIncrement: false,
                defaultValue: '',
                comment: ''
              }
            ]
          }
        : prev
    );
  };

  const removeColumn = (col: TableColumnDraft): void => {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        columns: prev.columns.filter((c) => c.uid !== col.uid),
        deletedColumns: col.originalName
          ? [...prev.deletedColumns, col.originalName]
          : prev.deletedColumns
      };
    });
  };

  const moveColumn = (idx: number, dir: -1 | 1): void => {
    const target = idx + dir;
    if (target < 0 || target >= draft.columns.length) return;
    setDraft((prev) => {
      if (!prev) return prev;
      const copy = [...prev.columns];
      const [picked] = copy.splice(idx, 1);
      copy.splice(target, 0, picked);
      return { ...prev, columns: copy };
    });
  };

  const addIndex = (): void => {
    const firstCol = draft.columns[0]?.name || 'id';
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            indexes: [
              ...prev.indexes,
              {
                uid: `idx-${Date.now()}`,
                name: `idx_${prev.tableName}_${firstCol}`,
                unique: false,
                columns: [firstCol]
              }
            ]
          }
        : prev
    );
  };

  const addForeignKey = (): void => {
    const firstCol = draft.columns[0]?.name || 'id';
    const refTable = availableTables[0]?.name || '';
    const refCol = availableTables[0]?.columns[0]?.name || 'id';
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            foreignKeys: [
              ...prev.foreignKeys,
              {
                uid: `fk-${Date.now()}`,
                constraintName: `fk_${prev.tableName}_${firstCol}`,
                column: firstCol,
                referencedSchema: prev.schema,
                referencedTable: refTable,
                referencedColumn: refCol,
                onDelete: 'RESTRICT'
              }
            ]
          }
        : prev
    );
  };

  const handleApplyToDb = async (): Promise<void> => {
    if (!selectedDbProfileId) {
      showToast('Pilih koneksi Database terlebih dahulu.');
      return;
    }
    if (compiled.statements.length === 0) {
      showToast('Belum ada perubahan struktur untuk diterapkan.');
      return;
    }

    if (activeProfile?.isProduction || compiled.hasDestructiveChanges) {
      const msg = [
        activeProfile?.isProduction
          ? `⚠️ PERINGATAN PRODUKSI: Anda akan mengubah struktur tabel di database PRODUKSI "${activeProfile.name}"!`
          : '⚠️ Perubahan struktur ini mencakup penghapusan kolom/relasi.',
        ...compiled.warnings,
        '',
        `Eksekusi ${compiled.statements.length} statement DDL sekarang?`
      ].join('\n');
      if (!window.confirm(msg)) return;
    }

    setExecuting(true);
    setExecError(null);
    try {
      const targetDb =
        draft.schema ||
        dbSchema?.currentDatabase ||
        getRememberedDatabaseForProfile(selectedDbProfileId);

      for (const sql of compiled.statements) {
        await window.aptana.db.query(selectedDbProfileId, sql, targetDb, 10);
      }

      const freshSnap = await window.aptana.db.introspect(selectedDbProfileId, targetDb);
      setDbSchema(freshSnap);

      pushIslandActivity({
        id: `tbl-design-${Date.now()}`,
        tone: 'success',
        badge: draft.mode === 'create' ? 'CREATE TABLE' : 'ALTER TABLE',
        title: `Struktur tabel "${draft.tableName}" berhasil diterapkan`,
        subtitle: `${compiled.statements.length} statement DDL dieksekusi`,
        busy: false
      });
      showToast(
        draft.mode === 'create'
          ? `Tabel baru "${draft.tableName}" berhasil dibuat!`
          : `Perubahan struktur "${draft.tableName}" berhasil diterapkan!`
      );
      closeTableDesigner();
    } catch (err) {
      setExecError(err instanceof Error ? err.message : String(err));
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div
        className="modal-card"
        style={{
          width: 'min(1080px, 96vw)',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
          overflow: 'hidden'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
            <Table2 size={17} color="var(--accent)" style={{ flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700 }}>
                🛠️ Visual Table Designer —{' '}
                {draft.mode === 'create' ? 'Buat Tabel Baru' : `Ubah Struktur: ${draft.originalTable?.name}`}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                Engine: <strong>{draft.engine.toUpperCase()}</strong>
                {draft.schema ? ` • Database: ${draft.schema}` : ''}
                {activeProfile?.isProduction ? ' • 🔴 SERVER PRODUKSI' : ''}
              </div>
            </div>
          </div>

          <button type="button" className="btn-modal-exit" onClick={closeTableDesigner}>
            <X size={14} />
            <span>Keluar</span>
          </button>
        </div>

        {/* Table Name + Mode Tabs Bar */}
        <div
          style={{
            padding: '10px 16px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)' }}>
              Nama Tabel:
            </label>
            <input
              className="form-input"
              style={{ width: 230, fontWeight: 700, fontSize: 12.5, padding: '5px 9px' }}
              value={draft.tableName}
              onChange={(e) => setDraft({ ...draft, tableName: e.target.value })}
              placeholder="contoh: mst_pegawai"
            />
          </div>

          <div style={{ display: 'flex', gap: 5 }}>
            <button
              type="button"
              className={`btn ${activeTab === 'columns' ? 'btn-accent' : ''}`}
              style={{ padding: '5px 10px', fontSize: 11.5 }}
              onClick={() => setActiveTab('columns')}
            >
              <ListChecks size={13} />
              <span>Kolom ({draft.columns.length})</span>
            </button>
            <button
              type="button"
              className={`btn ${activeTab === 'indexes' ? 'btn-accent' : ''}`}
              style={{ padding: '5px 10px', fontSize: 11.5 }}
              onClick={() => setActiveTab('indexes')}
            >
              <KeyRound size={13} />
              <span>Indeks ({draft.indexes.length})</span>
            </button>
            <button
              type="button"
              className={`btn ${activeTab === 'fks' ? 'btn-accent' : ''}`}
              style={{ padding: '5px 10px', fontSize: 11.5 }}
              onClick={() => setActiveTab('fks')}
            >
              <Link2 size={13} />
              <span>Foreign Keys ({draft.foreignKeys.length})</span>
            </button>
          </div>
        </div>

        {/* Main Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {activeTab === 'columns' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                  Atur nama field, tipe data, panjang/nilai ENUM, Primary Key, Not Null, Auto Increment, dan Default.
                </span>
                <button type="button" className="btn btn-accent" style={{ padding: '4px 10px', fontSize: 11.5 }} onClick={addColumn}>
                  <Plus size={13} /> Tambah Kolom
                </button>
              </div>

              <div style={{ overflowX: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 8 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-surface)', textAlign: 'left' }}>
                      <th style={{ padding: '7px 8px', width: 58 }}>Urut</th>
                      <th style={{ padding: '7px 8px' }}>Nama Kolom</th>
                      <th style={{ padding: '7px 8px', width: 135 }}>Tipe Data</th>
                      <th style={{ padding: '7px 8px', width: 115 }}>Panjang / Nilai</th>
                      <th style={{ padding: '7px 8px', textAlign: 'center', width: 44 }} title="Primary Key">PK</th>
                      <th style={{ padding: '7px 8px', textAlign: 'center', width: 52 }} title="Boleh NULL">NULL</th>
                      <th style={{ padding: '7px 8px', textAlign: 'center', width: 52 }} title="Auto Increment">AI</th>
                      <th style={{ padding: '7px 8px', width: 135 }}>Default</th>
                      <th style={{ padding: '7px 8px' }}>Komentar</th>
                      <th style={{ padding: '7px 8px', width: 42 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.columns.map((col, idx) => (
                      <tr key={col.uid} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                        <td style={{ padding: '5px 6px' }}>
                          <div style={{ display: 'flex', gap: 2 }}>
                            <button
                              type="button"
                              className="icon-btn"
                              disabled={idx === 0}
                              onClick={() => moveColumn(idx, -1)}
                              title="Geser ke atas"
                            >
                              <ArrowUp size={12} />
                            </button>
                            <button
                              type="button"
                              className="icon-btn"
                              disabled={idx === draft.columns.length - 1}
                              onClick={() => moveColumn(idx, 1)}
                              title="Geser ke bawah"
                            >
                              <ArrowDown size={12} />
                            </button>
                          </div>
                        </td>
                        <td style={{ padding: '5px 6px' }}>
                          <input
                            className="form-input"
                            style={{ padding: '4px 7px', fontSize: 12, fontFamily: 'var(--font-mono)' }}
                            value={col.name}
                            onChange={(e) => updateCol(col.uid, { name: e.target.value })}
                          />
                        </td>
                        <td style={{ padding: '5px 6px' }}>
                          <select
                            className="form-input"
                            style={{ padding: '4px 6px', fontSize: 11.5 }}
                            value={col.dataType.toUpperCase()}
                            onChange={(e) => updateCol(col.uid, { dataType: e.target.value })}
                          >
                            {!DATA_TYPES.includes(col.dataType.toUpperCase() as DesignerBaseType) && (
                              <option value={col.dataType.toUpperCase()}>{col.dataType.toUpperCase()}</option>
                            )}
                            {DATA_TYPES.map((dt) => (
                              <option key={dt} value={dt}>
                                {dt}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td style={{ padding: '5px 6px' }}>
                          <input
                            className="form-input"
                            style={{ padding: '4px 7px', fontSize: 11.5, fontFamily: 'var(--font-mono)' }}
                            placeholder="255 / 15,2"
                            value={col.lengthOrValues}
                            onChange={(e) => updateCol(col.uid, { lengthOrValues: e.target.value })}
                          />
                        </td>
                        <td style={{ padding: '5px 6px', textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={col.isPrimaryKey}
                            onChange={(e) =>
                              updateCol(col.uid, {
                                isPrimaryKey: e.target.checked,
                                nullable: e.target.checked ? false : col.nullable
                              })
                            }
                          />
                        </td>
                        <td style={{ padding: '5px 6px', textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            disabled={col.isPrimaryKey}
                            checked={col.nullable && !col.isPrimaryKey}
                            onChange={(e) => updateCol(col.uid, { nullable: e.target.checked })}
                          />
                        </td>
                        <td style={{ padding: '5px 6px', textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={col.autoIncrement}
                            onChange={(e) => updateCol(col.uid, { autoIncrement: e.target.checked })}
                          />
                        </td>
                        <td style={{ padding: '5px 6px' }}>
                          <input
                            className="form-input"
                            style={{ padding: '4px 7px', fontSize: 11.5, fontFamily: 'var(--font-mono)' }}
                            placeholder="NULL / 0"
                            disabled={col.autoIncrement}
                            value={col.defaultValue}
                            onChange={(e) => updateCol(col.uid, { defaultValue: e.target.value })}
                          />
                        </td>
                        <td style={{ padding: '5px 6px' }}>
                          <input
                            className="form-input"
                            style={{ padding: '4px 7px', fontSize: 11.5 }}
                            placeholder="Keterangan..."
                            value={col.comment}
                            onChange={(e) => updateCol(col.uid, { comment: e.target.value })}
                          />
                        </td>
                        <td style={{ padding: '5px 6px', textAlign: 'center' }}>
                          <button
                            type="button"
                            className="icon-btn"
                            style={{ color: '#fb7185' }}
                            onClick={() => removeColumn(col)}
                            title="Hapus kolom"
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {activeTab === 'indexes' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                  Tambahkan Indeks (`INDEX` / `UNIQUE`) untuk mempercepat pencarian `WHERE` dan `JOIN`.
                </span>
                <button type="button" className="btn btn-accent" style={{ padding: '4px 10px', fontSize: 11.5 }} onClick={addIndex}>
                  <Plus size={13} /> Tambah Indeks
                </button>
              </div>
              {draft.indexes.length === 0 ? (
                <div style={{ padding: 18, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                  Belum ada indeks baru yang ditambahkan.
                </div>
              ) : (
                draft.indexes.map((idx) => (
                  <div
                    key={idx.uid}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1.2fr auto 1.6fr auto',
                      gap: 8,
                      alignItems: 'center',
                      padding: 8,
                      borderRadius: 7,
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border-subtle)'
                    }}
                  >
                    <input
                      className="form-input"
                      value={idx.name}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          indexes: draft.indexes.map((it) =>
                            it.uid === idx.uid ? { ...it, name: e.target.value } : it
                          )
                        })
                      }
                      placeholder="Nama indeks"
                    />
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5 }}>
                      <input
                        type="checkbox"
                        checked={idx.unique}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            indexes: draft.indexes.map((it) =>
                              it.uid === idx.uid ? { ...it, unique: e.target.checked } : it
                            )
                          })
                        }
                      />
                      UNIQUE
                    </label>
                    <input
                      className="form-input"
                      value={idx.columns.join(', ')}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          indexes: draft.indexes.map((it) =>
                            it.uid === idx.uid
                              ? {
                                  ...it,
                                  columns: e.target.value
                                    .split(',')
                                    .map((s) => s.trim())
                                    .filter(Boolean)
                                }
                              : it
                          )
                        })
                      }
                      placeholder="Kolom (pisahkan koma, mis: nip, kd_unitkerja)"
                    />
                    <button
                      type="button"
                      className="icon-btn"
                      style={{ color: '#fb7185' }}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          indexes: draft.indexes.filter((it) => it.uid !== idx.uid),
                          deletedIndexes: idx.originalName
                            ? [...draft.deletedIndexes, idx.originalName]
                            : draft.deletedIndexes
                        })
                      }
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'fks' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                  Atur relasi Foreign Key antar-tabel beserta aksi `ON DELETE`.
                </span>
                <button type="button" className="btn btn-accent" style={{ padding: '4px 10px', fontSize: 11.5 }} onClick={addForeignKey}>
                  <Plus size={13} /> Tambah Foreign Key
                </button>
              </div>
              {draft.foreignKeys.length === 0 ? (
                <div style={{ padding: 18, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                  Belum ada Foreign Key pada tabel ini.
                </div>
              ) : (
                draft.foreignKeys.map((fk) => {
                  const refTblMeta = availableTables.find((t) => t.name === fk.referencedTable);
                  return (
                    <div
                      key={fk.uid}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr 1.1fr 1fr 0.9fr auto',
                        gap: 6,
                        alignItems: 'center',
                        padding: 8,
                        borderRadius: 7,
                        background: 'var(--bg-surface)',
                        border: '1px solid var(--border-subtle)'
                      }}
                    >
                      <input
                        className="form-input"
                        value={fk.constraintName}
                        disabled={Boolean(fk.originalName)}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            foreignKeys: draft.foreignKeys.map((it) =>
                              it.uid === fk.uid ? { ...it, constraintName: e.target.value } : it
                            )
                          })
                        }
                        placeholder="Nama constraint"
                      />
                      <select
                        className="form-input"
                        value={fk.column}
                        disabled={Boolean(fk.originalName)}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            foreignKeys: draft.foreignKeys.map((it) =>
                              it.uid === fk.uid ? { ...it, column: e.target.value } : it
                            )
                          })
                        }
                      >
                        {draft.columns.map((c) => (
                          <option key={c.uid} value={c.name}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <select
                        className="form-input"
                        value={fk.referencedTable}
                        disabled={Boolean(fk.originalName)}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            foreignKeys: draft.foreignKeys.map((it) =>
                              it.uid === fk.uid ? { ...it, referencedTable: e.target.value } : it
                            )
                          })
                        }
                      >
                        <option value="">-- Tabel Referensi --</option>
                        {availableTables.map((t) => (
                          <option key={`${t.schema}.${t.name}`} value={t.name}>
                            {t.schema ? `${t.schema}.${t.name}` : t.name}
                          </option>
                        ))}
                      </select>
                      <input
                        className="form-input"
                        list={`fk-cols-${fk.uid}`}
                        value={fk.referencedColumn}
                        disabled={Boolean(fk.originalName)}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            foreignKeys: draft.foreignKeys.map((it) =>
                              it.uid === fk.uid ? { ...it, referencedColumn: e.target.value } : it
                            )
                          })
                        }
                        placeholder="Kolom tujuan"
                      />
                      <datalist id={`fk-cols-${fk.uid}`}>
                        {(refTblMeta?.columns ?? []).map((rc) => (
                          <option key={rc.name} value={rc.name} />
                        ))}
                      </datalist>
                      <select
                        className="form-input"
                        value={fk.onDelete}
                        disabled={Boolean(fk.originalName)}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            foreignKeys: draft.foreignKeys.map((it) =>
                              it.uid === fk.uid
                                ? { ...it, onDelete: e.target.value as typeof fk.onDelete }
                                : it
                            )
                          })
                        }
                      >
                        <option value="RESTRICT">ON DELETE RESTRICT</option>
                        <option value="CASCADE">ON DELETE CASCADE</option>
                        <option value="SET NULL">ON DELETE SET NULL</option>
                        <option value="NO ACTION">ON DELETE NO ACTION</option>
                      </select>
                      <button
                        type="button"
                        className="icon-btn"
                        style={{ color: '#fb7185' }}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            foreignKeys: draft.foreignKeys.filter((it) => it.uid !== fk.uid),
                            deletedForeignKeys: fk.originalName
                              ? [...draft.deletedForeignKeys, fk.originalName]
                              : draft.deletedForeignKeys
                          })
                        }
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* Live DDL Preview */}
          <div
            style={{
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-app)',
              padding: 10
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>
                📜 Pratinjau Otomatis SQL DDL ({compiled.statements.length} statement)
              </span>
              <button
                type="button"
                className="btn btn-xs"
                onClick={() => {
                  void navigator.clipboard?.writeText(compiled.fullSql);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                }}
              >
                {copied ? <Check size={11} /> : <Copy size={11} />}
                <span>{copied ? 'Disalin' : 'Salin SQL'}</span>
              </button>
            </div>
            <pre
              style={{
                margin: 0,
                maxHeight: 150,
                overflowY: 'auto',
                fontSize: 11.5,
                fontFamily: 'var(--font-mono)',
                color: '#7dd3fc',
                whiteSpace: 'pre-wrap'
              }}
            >
              {compiled.fullSql}
            </pre>
          </div>

          {compiled.warnings.length > 0 && (
            <div
              style={{
                padding: '8px 10px',
                borderRadius: 7,
                background: 'rgba(245, 158, 11, 0.14)',
                border: '1px solid rgba(251, 191, 36, 0.4)',
                color: '#fde68a',
                fontSize: 11.5,
                display: 'flex',
                alignItems: 'center',
                gap: 8
              }}
            >
              <AlertTriangle size={14} />
              <span>{compiled.warnings.join(' ')}</span>
            </div>
          )}

          {execError && (
            <div
              style={{
                padding: '8px 10px',
                borderRadius: 7,
                background: 'rgba(244, 63, 94, 0.14)',
                border: '1px solid rgba(251, 113, 133, 0.4)',
                color: '#fecdd3',
                fontSize: 11.5,
                fontFamily: 'var(--font-mono)'
              }}
            >
              Error Eksekusi DDL: {execError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '10px 16px',
            borderTop: '1px solid var(--border-subtle)',
            background: 'var(--bg-surface)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8
          }}
        >
          <button type="button" className="btn" onClick={closeTableDesigner}>
            Batal
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={executing || compiled.statements.length === 0}
            onClick={() => void handleApplyToDb()}
          >
            <Play size={13} />
            <span>
              {executing
                ? 'Menerapkan...'
                : draft.mode === 'create'
                  ? 'Buat Tabel Sekarang'
                  : `Terapkan Perubahan (${compiled.statements.length})`}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
