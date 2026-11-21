import React, { useEffect, useMemo, useState } from 'react';
import { FlaskConical, Play, RefreshCw, X } from 'lucide-react';
import type { DbTableMeta } from '@shared/types';
import { buildSeedSqlStatements } from '@shared/dbSmartSeederEngine';
import { getRememberedDatabaseForProfile, useIdeStore } from '../store/useIdeStore';

export const DbSeederModal: React.FC = () => {
  const {
    dbSeederModalOpen,
    dbSeederTargetTable,
    closeDbSeeder,
    selectedDbProfileId,
    dbProfiles,
    dbSchema,
    showToast
  } = useIdeStore();

  const [selectedTableName, setSelectedTableName] = useState('');
  const [rowCount, setRowCount] = useState(25);
  const [fkPools, setFkPools] = useState<Record<string, unknown[]>>({});
  const [seeding, setSeeding] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const activeProfile = useMemo(
    () => dbProfiles.find((p) => p.id === selectedDbProfileId) ?? null,
    [dbProfiles, selectedDbProfileId]
  );

  const tables = useMemo<DbTableMeta[]>(
    () => (dbSchema?.tables ?? []).filter((t) => t.kind === 'table'),
    [dbSchema]
  );

  useEffect(() => {
    if (!dbSeederModalOpen) return;
    setErrorMsg(null);
    const initial = dbSeederTargetTable?.name || tables[0]?.name || '';
    setSelectedTableName(initial);
  }, [dbSeederModalOpen, dbSeederTargetTable?.name, tables]);

  const targetTable = useMemo(
    () => tables.find((t) => t.name === selectedTableName) ?? dbSeederTargetTable ?? null,
    [tables, selectedTableName, dbSeederTargetTable]
  );

  // Fetch up to 50 parent primary key values for any Foreign Key columns so relational constraints always pass!
  useEffect(() => {
    if (!dbSeederModalOpen || !selectedDbProfileId || !targetTable?.foreignKeys?.length) {
      setFkPools({});
      return;
    }
    let cancelled = false;
    const engine = dbSchema?.engine ?? activeProfile?.engine ?? 'mysql';
    const q = (id: string): string =>
      engine === 'postgres' ? `"${id.replace(/"/g, '""')}"` : `\`${id.replace(/`/g, '``')}\``;
    const activeDb =
      dbSchema?.currentDatabase || getRememberedDatabaseForProfile(selectedDbProfileId);

    void (async () => {
      const nextPools: Record<string, unknown[]> = {};
      for (const fk of targetTable.foreignKeys ?? []) {
        try {
          const refTbl = fk.referencedSchema
            ? `${q(fk.referencedSchema)}.${q(fk.referencedTable)}`
            : q(fk.referencedTable);
          const sql = `SELECT ${q(fk.referencedColumn)} AS val FROM ${refTbl} LIMIT 50`;
          const res = await window.aptana.db.query(selectedDbProfileId, sql, activeDb, 50);
          const vals = res.rows.map((r) => r.val).filter((v) => v !== null && v !== undefined);
          if (vals.length > 0) {
            nextPools[fk.column] = vals;
          }
        } catch {
          // Ignore unreachable FK table
        }
      }
      if (!cancelled) setFkPools(nextPools);
    })();

    return () => {
      cancelled = true;
    };
  }, [dbSeederModalOpen, selectedDbProfileId, targetTable, dbSchema?.engine, dbSchema?.currentDatabase, activeProfile?.engine]);

  const previewBundle = useMemo(() => {
    if (!targetTable) return null;
    const engine = dbSchema?.engine ?? activeProfile?.engine ?? 'mysql';
    return buildSeedSqlStatements({
      table: targetTable,
      schema: targetTable.schema || dbSchema?.currentDatabase,
      engine,
      rowCount,
      foreignKeyPools: fkPools
    });
  }, [targetTable, dbSchema?.engine, dbSchema?.currentDatabase, activeProfile?.engine, rowCount, fkPools]);

  if (!dbSeederModalOpen) return null;

  const handleRunSeed = async (): Promise<void> => {
    if (!selectedDbProfileId || !targetTable || !previewBundle) return;
    if (activeProfile?.isProduction) {
      if (
        !window.confirm(
          `⚠️ PERINGATAN PRODUKSI: Database "${activeProfile.name}" bertanda PRODUKSI!\nYakin ingin mengisi ${rowCount} baris data simulasi ke tabel "${targetTable.name}"?`
        )
      ) {
        return;
      }
    }

    setSeeding(true);
    setErrorMsg(null);
    try {
      const activeDb =
        targetTable.schema ||
        dbSchema?.currentDatabase ||
        getRememberedDatabaseForProfile(selectedDbProfileId);
      for (const stmt of previewBundle.statements) {
        await window.aptana.db.query(selectedDbProfileId, stmt, activeDb, 10);
      }
      showToast(`🧪 Berhasil mengisi ${rowCount} baris data uji Indonesia ke "${targetTable.name}"!`);
      closeDbSeeder();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div
        className="modal-card"
        style={{ width: 'min(860px, 95vw)', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
            <FlaskConical size={18} color="#34d399" style={{ flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700 }}>
                🧪 Smart Data Seeder Indonesia (Generator Data Uji Realistis)
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                Otomatis menghasilkan Nama Indonesia, NIP 18-digit, NIK, Email, No. HP, Nominal Rupiah, &amp; mencocokkan nilai Foreign Key induk.
              </div>
            </div>
          </div>
          <button type="button" className="btn-modal-exit" onClick={closeDbSeeder}>
            <X size={14} />
            <span>Keluar</span>
          </button>
        </div>

        <div className="modal-body">
          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 10 }}>
          <div>
            <label className="form-label">Tabel Tujuan Pengisian Data Uji</label>
            <select
              className="form-input"
              value={selectedTableName}
              onChange={(e) => setSelectedTableName(e.target.value)}
            >
              {tables.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name} ({t.columns.length} kolom)
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label">Jumlah Baris Simulasi</label>
            <select
              className="form-input"
              value={rowCount}
              onChange={(e) => setRowCount(Number(e.target.value))}
            >
              <option value={10}>10 baris</option>
              <option value={25}>25 baris</option>
              <option value={50}>50 baris</option>
              <option value={100}>100 baris</option>
              <option value={250}>250 baris</option>
              <option value={500}>500 baris</option>
            </select>
          </div>
        </div>

        {previewBundle && previewBundle.rows.length > 0 && (
          <div style={{ overflowX: 'auto', maxHeight: 260, border: '1px solid var(--border-subtle)', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ background: 'var(--bg-surface)' }}>
                  {previewBundle.columns.map((c) => (
                    <th key={c} style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' }}>
                      {c}
                      {fkPools[c] ? ' 🔗FK' : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewBundle.rows.slice(0, 6).map((row, idx) => (
                  <tr key={idx} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                    {previewBundle.columns.map((c) => (
                      <td key={c} style={{ padding: '5px 8px', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                        {String(row[c] ?? 'NULL')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {errorMsg && (
          <div style={{ padding: '8px 10px', borderRadius: 6, background: 'rgba(244, 63, 94, 0.14)', color: '#fecdd3', fontSize: 11.5 }}>
            {errorMsg}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" onClick={closeDbSeeder}>
            Batal
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={seeding || !targetTable}
            onClick={() => void handleRunSeed()}
          >
            {seeding ? <RefreshCw size={13} className="spin" /> : <Play size={13} />}
            <span>{seeding ? 'Mengisi Data...' : `Isi ${rowCount} Baris Data Uji Sekarang`}</span>
          </button>
          </div>
        </div>
      </div>
    </div>
  );
};
