import React, { useEffect, useMemo, useState } from 'react';
import {
  Code2,
  Eye,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  X,
  Zap
} from 'lucide-react';
import type { DbQueryResult, DbRoutineKind, DbRoutineSummary } from '@shared/types';
import { getRememberedDatabaseForProfile, useIdeStore } from '../store/useIdeStore';

function buildNewRoutineTemplate(kind: DbRoutineKind, engine: 'mysql' | 'postgres'): string {
  if (kind === 'VIEW') {
    return `CREATE OR REPLACE VIEW v_rekap_data AS\nSELECT *\nFROM nama_tabel\nLIMIT 100;`;
  }
  if (kind === 'PROCEDURE') {
    return engine === 'postgres'
      ? `CREATE OR REPLACE PROCEDURE sp_proses_data(p_id INT)\nLANGUAGE plpgsql\nAS $$\nBEGIN\n  -- Tulis logika prosedur di sini\nEND;\n$$;`
      : `CREATE PROCEDURE sp_proses_data(IN p_id INT)\nBEGIN\n  SELECT * FROM nama_tabel WHERE id = p_id;\nEND;`;
  }
  if (kind === 'FUNCTION') {
    return engine === 'postgres'
      ? `CREATE OR REPLACE FUNCTION fn_hitung_total(p_nilai NUMERIC)\nRETURNS NUMERIC\nLANGUAGE plpgsql\nAS $$\nBEGIN\n  RETURN COALESCE(p_nilai, 0);\nEND;\n$$;`
      : `CREATE FUNCTION fn_hitung_total(p_nilai DECIMAL(15,2))\nRETURNS DECIMAL(15,2)\nDETERMINISTIC\nBEGIN\n  RETURN COALESCE(p_nilai, 0);\nEND;`;
  }
  return engine === 'postgres'
    ? `-- Contoh Trigger PostgreSQL\nCREATE TRIGGER trg_audit_perubahan\nAFTER UPDATE ON nama_tabel\nFOR EACH ROW EXECUTE FUNCTION fn_audit();`
    : `CREATE TRIGGER trg_audit_perubahan\nAFTER UPDATE ON nama_tabel\nFOR EACH ROW\nBEGIN\n  -- Logika trigger\nEND;`;
}

export const DbRoutinesModal: React.FC = () => {
  const {
    dbRoutinesModalOpen,
    setDbRoutinesModalOpen,
    selectedDbProfileId,
    dbProfiles,
    dbSchema,
    showToast
  } = useIdeStore();

  const [routines, setRoutines] = useState<DbRoutineSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterKind, setFilterKind] = useState<DbRoutineKind | 'ALL'>('ALL');
  const [searchText, setSearchText] = useState('');
  const [selectedRoutine, setSelectedRoutine] = useState<DbRoutineSummary | null>(null);
  const [ddlText, setDdlText] = useState('');
  const [loadingDdl, setLoadingDdl] = useState(false);
  const [savingDdl, setSavingDdl] = useState(false);

  // Interactive CALL / Function execution state
  const [callParamValues, setCallParamValues] = useState<Record<string, string>>({});
  const [runningCall, setRunningCall] = useState(false);
  const [callResult, setCallResult] = useState<DbQueryResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const activeProfile = useMemo(
    () => dbProfiles.find((p) => p.id === selectedDbProfileId) ?? null,
    [dbProfiles, selectedDbProfileId]
  );
  const engine = dbSchema?.engine ?? activeProfile?.engine ?? 'mysql';
  const activeDb =
    dbSchema?.currentDatabase ||
    (selectedDbProfileId ? getRememberedDatabaseForProfile(selectedDbProfileId) : undefined);

  const loadList = async (): Promise<void> => {
    if (!selectedDbProfileId) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const list = await window.aptana.db.listRoutines(selectedDbProfileId, activeDb);
      setRoutines(list);
      if (list.length > 0 && !selectedRoutine) {
        void handleSelectRoutine(list[0]);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (dbRoutinesModalOpen) {
      void loadList();
    } else {
      setSelectedRoutine(null);
      setDdlText('');
      setCallResult(null);
      setErrorMsg(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbRoutinesModalOpen, selectedDbProfileId, activeDb]);

  const handleSelectRoutine = async (item: DbRoutineSummary): Promise<void> => {
    if (!selectedDbProfileId) return;
    setSelectedRoutine(item);
    setCallResult(null);
    setErrorMsg(null);
    const initParams: Record<string, string> = {};
    for (const p of item.params ?? []) {
      initParams[p.name] = '';
    }
    setCallParamValues(initParams);
    setLoadingDdl(true);
    try {
      const ddl = await window.aptana.db.getRoutineDdl(selectedDbProfileId, {
        kind: item.kind,
        name: item.name,
        database: item.schema || activeDb
      });
      setDdlText(ddl);
    } catch (err) {
      setDdlText(`-- Gagal memuat definisi: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoadingDdl(false);
    }
  };

  const handleApplyDdl = async (): Promise<void> => {
    if (!selectedDbProfileId || !ddlText.trim()) return;
    if (activeProfile?.isProduction) {
      if (
        !window.confirm(
          `⚠️ PERINGATAN PRODUKSI: Terapkan perubahan objek ${selectedRoutine?.kind ?? 'SQL'} ke database PRODUKSI "${activeProfile.name}"?`
        )
      ) {
        return;
      }
    }

    setSavingDdl(true);
    setErrorMsg(null);
    try {
      // Split optional `DROP ... IF EXISTS ...;` header from the `CREATE ...` body
      const dropMatch = ddlText.match(/^\s*(DROP\s+(?:VIEW|PROCEDURE|FUNCTION|TRIGGER)\s+IF\s+EXISTS[^;]+;)\s*([\s\S]+)$/i);
      if (dropMatch) {
        await window.aptana.db.query(selectedDbProfileId, dropMatch[1], activeDb, 10);
        await window.aptana.db.query(selectedDbProfileId, dropMatch[2], activeDb, 10);
      } else {
        await window.aptana.db.query(selectedDbProfileId, ddlText, activeDb, 10);
      }
      showToast('✅ Definisi View / Procedure / Function / Trigger berhasil diterapkan!');
      await loadList();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingDdl(false);
    }
  };

  const handleRunRoutine = async (): Promise<void> => {
    if (!selectedDbProfileId || !selectedRoutine) return;
    setRunningCall(true);
    setErrorMsg(null);
    try {
      const q = (id: string): string =>
        engine === 'postgres' ? `"${id.replace(/"/g, '""')}"` : `\`${id.replace(/`/g, '``')}\``;
      const qual = selectedRoutine.schema
        ? `${q(selectedRoutine.schema)}.${q(selectedRoutine.name)}`
        : q(selectedRoutine.name);

      let execSql = '';
      if (selectedRoutine.kind === 'VIEW') {
        execSql = `SELECT * FROM ${qual} LIMIT 100;`;
      } else {
        const args = (selectedRoutine.params ?? [])
          .filter((p) => p.mode !== 'OUT')
          .map((p) => {
            const raw = (callParamValues[p.name] ?? '').trim();
            if (!raw || raw.toUpperCase() === 'NULL') return 'NULL';
            if (/^-?\d+(\.\d+)?$/.test(raw)) return raw;
            return `'${raw.replace(/'/g, "''")}'`;
          })
          .join(', ');
        execSql =
          selectedRoutine.kind === 'PROCEDURE'
            ? `CALL ${qual}(${args});`
            : `SELECT ${qual}(${args}) AS hasil;`;
      }

      const res = await window.aptana.db.query(selectedDbProfileId, execSql, activeDb, 200);
      setCallResult(res);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setRunningCall(false);
    }
  };

  const filteredRoutines = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return routines.filter((r) => {
      if (filterKind !== 'ALL' && r.kind !== filterKind) return false;
      if (!q) return true;
      return r.name.toLowerCase().includes(q) || (r.targetTable ?? '').toLowerCase().includes(q);
    });
  }, [routines, filterKind, searchText]);

  if (!dbRoutinesModalOpen) return null;

  return (
    <div className="modal-backdrop">
      <div
        className="modal-card"
        style={{
          width: 'min(1080px, 96vw)',
          height: 'min(740px, 90vh)',
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
          overflow: 'hidden'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header: Title on left, Keluar strictly pinned in top-right corner */}
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
            <Code2 size={17} color="#c084fc" style={{ flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700 }}>
                ⚙️ Manajer &amp; Editor View, Stored Procedure, Function, &amp; Trigger
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                Database: <strong>{activeDb || '(Default)'}</strong> • Engine:{' '}
                <strong>{engine.toUpperCase()}</strong>
              </div>
            </div>
          </div>

          <button
            type="button"
            className="btn-modal-exit"
            onClick={() => setDbRoutinesModalOpen(false)}
          >
            <X size={14} />
            <span>Keluar</span>
          </button>
        </div>

        {/* Quick-Create Sub-Toolbar */}
        <div className="modal-subbar" style={{ justifyContent: 'flex-start' }}>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600 }}>
            Buat Cepat:
          </span>
          {(['VIEW', 'PROCEDURE', 'FUNCTION', 'TRIGGER'] as DbRoutineKind[]).map((k) => (
            <button
              key={k}
              type="button"
              className="btn btn-xs"
              onClick={() => {
                setSelectedRoutine({ name: `${k.toLowerCase()}_baru`, kind: k, schema: activeDb });
                setDdlText(buildNewRoutineTemplate(k, engine));
                setCallResult(null);
              }}
            >
              <Plus size={11} /> {k} Baru
            </button>
          ))}
        </div>

        {/* Body Split */}
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '290px 1fr', minHeight: 0 }}>
          {/* Left List */}
          <div
            style={{
              borderRight: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              background: 'var(--bg-surface)'
            }}
          >
            <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6, borderBottom: '1px solid var(--border-subtle)' }}>
              <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                {(['ALL', 'VIEW', 'PROCEDURE', 'FUNCTION', 'TRIGGER'] as const).map((fk) => (
                  <button
                    key={fk}
                    type="button"
                    className={`island-scope-pill ${filterKind === fk ? 'active' : ''}`}
                    onClick={() => setFilterKind(fk)}
                  >
                    {fk === 'ALL' ? `Semua (${routines.length})` : fk}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <Search size={12} style={{ position: 'absolute', left: 7, top: 7, color: 'var(--text-muted)' }} />
                  <input
                    className="form-input"
                    style={{ padding: '4px 7px 4px 24px', fontSize: 11.5 }}
                    placeholder="Cari nama objek..."
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                  />
                </div>
                <button type="button" className="btn btn-xs" onClick={() => void loadList()}>
                  <RefreshCw size={11.5} className={loading ? 'spin' : undefined} />
                </button>
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
              {filteredRoutines.length === 0 ? (
                <div style={{ padding: 16, textAlign: 'center', fontSize: 11.5, color: 'var(--text-muted)' }}>
                  {loading ? 'Memuat daftar objek...' : 'Belum ada View / Procedure / Function / Trigger.'}
                </div>
              ) : (
                filteredRoutines.map((r) => {
                  const isSel = selectedRoutine?.name === r.name && selectedRoutine?.kind === r.kind;
                  return (
                    <div
                      key={`${r.kind}:${r.schema}.${r.name}`}
                      onClick={() => void handleSelectRoutine(r)}
                      style={{
                        padding: '6px 8px',
                        borderRadius: 6,
                        cursor: 'pointer',
                        background: isSel ? 'var(--accent-soft)' : 'transparent',
                        border: isSel ? '1px solid var(--accent)' : '1px solid transparent'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                        <strong style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.name}
                        </strong>
                        <span className="badge" style={{ fontSize: 9 }}>
                          {r.kind}
                        </span>
                      </div>
                      {r.kind === 'TRIGGER' && r.targetTable && (
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                          {r.triggerTiming} {r.triggerEvent} → {r.targetTable}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right DDL Editor & Runner */}
          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0, overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700 }}>
                {selectedRoutine
                  ? `${selectedRoutine.kind}: ${selectedRoutine.name}`
                  : 'Pilih objek di sebelah kiri atau klik tombol "+ Baru"'}
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                {selectedRoutine && selectedRoutine.kind !== 'TRIGGER' && (
                  <button
                    type="button"
                    className="btn"
                    disabled={runningCall}
                    onClick={() => void handleRunRoutine()}
                  >
                    {selectedRoutine.kind === 'VIEW' ? <Eye size={13} /> : <Play size={13} />}
                    <span>
                      {selectedRoutine.kind === 'VIEW'
                        ? 'Lihat Isi View (100 Baris)'
                        : `Jalankan ${selectedRoutine.kind}`}
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={savingDdl || !ddlText.trim()}
                  onClick={() => void handleApplyDdl()}
                >
                  <Save size={13} />
                  <span>{savingDdl ? 'Menyimpan...' : 'Simpan & Terapkan ke DB'}</span>
                </button>
              </div>
            </div>

            {/* Parameter Inputs for Stored Procedure / Function */}
            {selectedRoutine &&
              (selectedRoutine.params?.length ?? 0) > 0 &&
              selectedRoutine.kind !== 'TRIGGER' && (
                <div
                  style={{
                    padding: 8,
                    borderRadius: 7,
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-subtle)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    flexWrap: 'wrap'
                  }}
                >
                  <Zap size={13} color="#fbbf24" />
                  <span style={{ fontSize: 11, fontWeight: 700 }}>Parameter Uji:</span>
                  {selectedRoutine.params!.map((p) => (
                    <div key={p.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <code style={{ fontSize: 10.5 }}>{p.name}</code>
                      <input
                        className="form-input"
                        style={{ width: 110, padding: '2px 6px', fontSize: 11 }}
                        placeholder={p.dataType}
                        value={callParamValues[p.name] ?? ''}
                        onChange={(e) =>
                          setCallParamValues((prev) => ({ ...prev, [p.name]: e.target.value }))
                        }
                      />
                    </div>
                  ))}
                </div>
              )}

            <textarea
              className="form-input"
              style={{
                flex: 1,
                minHeight: 240,
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                lineHeight: 1.5,
                resize: 'vertical'
              }}
              value={loadingDdl ? '-- Memuat definisi SQL dari server...' : ddlText}
              onChange={(e) => setDdlText(e.target.value)}
            />

            {errorMsg && (
              <div
                style={{
                  padding: '8px 10px',
                  borderRadius: 6,
                  background: 'rgba(244, 63, 94, 0.14)',
                  border: '1px solid rgba(251, 113, 133, 0.4)',
                  color: '#fecdd3',
                  fontSize: 11.5,
                  fontFamily: 'var(--font-mono)'
                }}
              >
                {errorMsg}
              </div>
            )}

            {callResult && (
              <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 6 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-surface)' }}>
                      {callResult.columns.map((c) => (
                        <th key={c} style={{ padding: '5px 8px', textAlign: 'left', borderBottom: '1px solid var(--border-subtle)' }}>
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {callResult.rows.map((row, idx) => (
                      <tr key={idx} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                        {callResult.columns.map((c) => (
                          <td key={c} style={{ padding: '4px 8px', fontFamily: 'var(--font-mono)' }}>
                            {row[c] === null || row[c] === undefined ? 'NULL' : String(row[c])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
