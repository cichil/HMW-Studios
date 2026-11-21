import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Eye,
  Play,
  RefreshCw,
  ShieldCheck
} from 'lucide-react';
import type { DbSchemaSnapshot, DbTableMeta } from '@shared/types';
import {
  applyRowAnonymization,
  detectSensitiveColumnMasks,
  type ColumnMaskStrategy,
  type DataSyncWriteMode
} from '@shared/dbDataSyncEngine';
import { useIdeStore } from '../store/useIdeStore';

const MASK_LABELS: Record<ColumnMaskStrategy, string> = {
  none: 'Asli (Tanpa Masking)',
  'bcrypt-dummy': 'Hash Password Uji (bcrypt)',
  'masked-email': 'Email Simulasi (pengguna_N@simulasi.local)',
  'masked-phone': 'Samarkan Nomor HP (08120000xxxx)',
  'masked-digits': 'Samarkan NIK / Rekening',
  'masked-name': 'Samarkan Nama Orang',
  zero: 'Nolkan Angka (0)'
};

export const DataTransferPanel: React.FC = () => {
  const { dbProfiles, selectedDbProfileId, dbSchema, showToast } = useIdeStore();

  const [srcProfileId, setSrcProfileId] = useState(selectedDbProfileId ?? dbProfiles[0]?.id ?? '');
  const [srcDb, setSrcDb] = useState(dbSchema?.currentDatabase ?? '');
  const [srcSnap, setSrcSnap] = useState<DbSchemaSnapshot | null>(dbSchema);
  const [srcTable, setSrcTable] = useState('');
  const [whereClause, setWhereClause] = useState('');
  const [rowLimit, setRowLimit] = useState(1000);

  const [tgtProfileId, setTgtProfileId] = useState(() => {
    const other = dbProfiles.find((p) => p.id !== selectedDbProfileId);
    return other?.id ?? selectedDbProfileId ?? '';
  });
  const [tgtDb, setTgtDb] = useState('');
  const [tgtSnap, setTgtSnap] = useState<DbSchemaSnapshot | null>(null);
  const [tgtTable, setTgtTable] = useState('');
  const [writeMode, setWriteMode] = useState<DataSyncWriteMode>('upsert');

  const [anonymizeEnabled, setAnonymizeEnabled] = useState(false);
  const [columnMasks, setColumnMasks] = useState<Record<string, ColumnMaskStrategy>>({});

  const [sampleRows, setSampleRows] = useState<Array<Record<string, unknown>>>([]);
  const [loadingSample, setLoadingSample] = useState(false);
  const [loadingSrcSnap, setLoadingSrcSnap] = useState(false);
  const [loadingTgtSnap, setLoadingTgtSnap] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!srcProfileId) return;
    if (
      dbSchema &&
      dbSchema.profileId === srcProfileId &&
      (!srcDb || dbSchema.currentDatabase.toLowerCase() === srcDb.toLowerCase())
    ) {
      setSrcSnap(dbSchema);
      if (!srcDb) setSrcDb(dbSchema.currentDatabase);
      return;
    }
    let cancelled = false;
    setLoadingSrcSnap(true);
    void (async () => {
      const cached = await window.aptana.db
        .getCachedSchema(srcProfileId, srcDb || undefined)
        .catch(() => null);
      if (!cancelled && cached) {
        setSrcSnap(cached);
        if (!srcDb || !cached.databases.includes(srcDb)) {
          setSrcDb(cached.currentDatabase || cached.databases[0] || '');
        }
        setLoadingSrcSnap(false);
      }
      const s = await window.aptana.db.introspect(srcProfileId, srcDb || undefined);
      if (cancelled) return;
      setSrcSnap(s);
      if (!srcDb || !s.databases.includes(srcDb)) {
        setSrcDb(s.currentDatabase || s.databases[0] || '');
      }
    })()
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingSrcSnap(false);
      });
    return () => {
      cancelled = true;
    };
  }, [srcProfileId, dbSchema, srcDb]);

  useEffect(() => {
    if (!tgtProfileId) return;
    let cancelled = false;
    setLoadingTgtSnap(true);
    void (async () => {
      const cached = await window.aptana.db
        .getCachedSchema(tgtProfileId, tgtDb || undefined)
        .catch(() => null);
      if (!cancelled && cached) {
        setTgtSnap(cached);
        if (!tgtDb || !cached.databases.includes(tgtDb)) {
          setTgtDb(cached.currentDatabase || cached.databases[0] || '');
        }
        setLoadingTgtSnap(false);
      }
      const s = await window.aptana.db.introspect(tgtProfileId, tgtDb || undefined);
      if (cancelled) return;
      setTgtSnap(s);
      if (!tgtDb || !s.databases.includes(tgtDb)) {
        setTgtDb(s.currentDatabase || s.databases[0] || '');
      }
    })()
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingTgtSnap(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tgtProfileId, tgtDb]);

  const srcTables = useMemo<DbTableMeta[]>(() => {
    const all = srcSnap?.allTables ?? srcSnap?.tables ?? [];
    if (!srcDb) return all;
    return all.filter((t) => !t.schema || t.schema.toLowerCase() === srcDb.toLowerCase());
  }, [srcSnap, srcDb]);

  const tgtTables = useMemo<DbTableMeta[]>(() => {
    const all = tgtSnap?.allTables ?? tgtSnap?.tables ?? [];
    if (!tgtDb) return all;
    return all.filter((t) => !t.schema || t.schema.toLowerCase() === tgtDb.toLowerCase());
  }, [tgtSnap, tgtDb]);

  useEffect(() => {
    if (srcTables.length > 0 && !srcTables.some((t) => t.name === srcTable)) {
      const first = srcTables[0].name;
      setSrcTable(first);
      setTgtTable(first);
    }
  }, [srcTables, srcTable]);

  const selectedSrcMeta = useMemo(
    () => srcTables.find((t) => t.name === srcTable) ?? null,
    [srcTables, srcTable]
  );

  useEffect(() => {
    if (!selectedSrcMeta) return;
    const cols = selectedSrcMeta.columns.map((c) => c.name);
    setColumnMasks(detectSensitiveColumnMasks(cols));
    setSampleRows([]);
    setResultMsg(null);
    setErrorMsg(null);
  }, [selectedSrcMeta]);

  const handleLoadSample = async (): Promise<void> => {
    if (!srcProfileId || !srcTable) return;
    setLoadingSample(true);
    setErrorMsg(null);
    try {
      const srcEngine = srcSnap?.engine ?? 'mysql';
      const q = (id: string): string =>
        srcEngine === 'postgres' ? `"${id.replace(/"/g, '""')}"` : `\`${id.replace(/`/g, '``')}\``;
      const tblRef = srcDb ? `${q(srcDb)}.${q(srcTable)}` : q(srcTable);
      const cleanW = whereClause.trim().replace(/^WHERE\s+/i, '');
      const sql = `SELECT * FROM ${tblRef}${cleanW ? ` WHERE ${cleanW}` : ''} LIMIT 5`;
      const res = await window.aptana.db.query(srcProfileId, sql, srcDb || undefined, 5);
      setSampleRows(res.rows);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingSample(false);
    }
  };

  const previewMaskedSamples = useMemo(() => {
    if (!anonymizeEnabled) return sampleRows;
    return sampleRows.map((r, idx) => applyRowAnonymization(r, columnMasks, idx));
  }, [sampleRows, anonymizeEnabled, columnMasks]);

  const handleRunTransfer = async (): Promise<void> => {
    if (!srcProfileId || !tgtProfileId || !srcTable || !tgtTable) {
      showToast('Lengkapi pilihan tabel sumber dan tabel tujuan terlebih dahulu.');
      return;
    }

    const tgtProf = dbProfiles.find((p) => p.id === tgtProfileId);
    if (tgtProf?.isProduction || writeMode === 'truncate-insert') {
      const warn = tgtProf?.isProduction
        ? `⚠️ PERINGATAN PRODUKSI: Database tujuan "${tgtProf.name}" bertanda PRODUKSI!\nYakin ingin mentransfer data dari "${srcTable}" ke "${tgtTable}" (${writeMode.toUpperCase()})?`
        : `⚠️ Mode TRUNCATE + INSERT akan mengosongkan tabel tujuan "${tgtTable}" terlebih dahulu sebelum mengisi ulang.\nLanjutkan?`;
      if (!window.confirm(warn)) return;
    }

    setTransferring(true);
    setErrorMsg(null);
    setResultMsg(null);
    try {
      const effectiveMasks = anonymizeEnabled ? columnMasks : {};
      const res = await window.aptana.db.transferTableData({
        sourceProfileId: srcProfileId,
        sourceDatabase: srcDb || undefined,
        sourceTable: srcTable,
        whereClause: whereClause.trim() || undefined,
        rowLimit: rowLimit,
        targetProfileId: tgtProfileId,
        targetDatabase: tgtDb || undefined,
        targetTable: tgtTable,
        primaryKeys: selectedSrcMeta?.primaryKeys ?? [],
        writeMode,
        columnMasks: effectiveMasks
      });
      setResultMsg(
        `Berhasil mentransfer ${res.rowsRead} baris (${res.batchesExecuted} batch SQL) dalam ${res.durationMs} ms${
          res.maskedColumnCount > 0 ? ` dengan ${res.maskedColumnCount} kolom sensitif disamarkan` : ''
        }.`
      );
      showToast(`✅ Data Sync selesai: ${res.rowsRead} baris → ${tgtTable}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setTransferring(false);
    }
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Source -> Target Card */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto 1fr',
          gap: 12,
          alignItems: 'stretch'
        }}
      >
        {/* Source */}
        <div
          style={{
            padding: 12,
            borderRadius: 9,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#38bdf8' }}>
              📥 Sumber Data (Source)
            </div>
            {loadingSrcSnap && (
              <span style={{ fontSize: 10.5, color: '#7dd3fc', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <RefreshCw size={11} className="spin" /> Memuat DB Sumber...
              </span>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <div>
              <label className="form-label">Koneksi DB Sumber</label>
              <select
                className="form-input"
                value={srcProfileId}
                onChange={(e) => setSrcProfileId(e.target.value)}
              >
                {dbProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    [{p.engine.toUpperCase()}] {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label">Database / Schema</label>
              <select
                className="form-input"
                value={srcDb}
                onChange={(e) => setSrcDb(e.target.value)}
              >
                {(srcSnap?.databases ?? []).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.8fr', gap: 6 }}>
            <div>
              <label className="form-label">Tabel Sumber</label>
              <select
                className="form-input"
                value={srcTable}
                onChange={(e) => {
                  setSrcTable(e.target.value);
                  setTgtTable(e.target.value);
                }}
              >
                {srcTables.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name} ({t.columns.length} kolom)
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label">Batas Baris (Maks)</label>
              <select
                className="form-input"
                value={rowLimit}
                onChange={(e) => setRowLimit(Number(e.target.value))}
              >
                <option value={250}>250 baris</option>
                <option value={1000}>1.000 baris</option>
                <option value={5000}>5.000 baris</option>
                <option value={20000}>20.000 baris</option>
                <option value={50000}>50.000 baris</option>
              </select>
            </div>
          </div>

          <div>
            <label className="form-label">Filter WHERE Opsional (tanpa kata WHERE)</label>
            <input
              className="form-input"
              style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5 }}
              placeholder="contoh: status_aktif = 'Y' AND kd_unitkerja LIKE '02%'"
              value={whereClause}
              onChange={(e) => setWhereClause(e.target.value)}
            />
          </div>
        </div>

        {/* Arrow */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <ArrowRight size={22} color="var(--accent)" />
        </div>

        {/* Target */}
        <div
          style={{
            padding: 12,
            borderRadius: 9,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#34d399' }}>
              📤 Tujuan Sinkronisasi (Target)
            </div>
            {loadingTgtSnap && (
              <span style={{ fontSize: 10.5, color: '#6ee7b7', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <RefreshCw size={11} className="spin" /> Memuat DB Tujuan...
              </span>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <div>
              <label className="form-label">Koneksi DB Tujuan</label>
              <select
                className="form-input"
                value={tgtProfileId}
                onChange={(e) => setTgtProfileId(e.target.value)}
              >
                {dbProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    [{p.engine.toUpperCase()}] {p.name}
                    {p.isProduction ? ' 🔴PROD' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label">Database / Schema Tujuan</label>
              <select
                className="form-input"
                value={tgtDb}
                onChange={(e) => setTgtDb(e.target.value)}
              >
                {(tgtSnap?.databases ?? []).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="form-label">Tabel Tujuan</label>
            <input
              className="form-input"
              list="sync-tgt-tables"
              value={tgtTable}
              onChange={(e) => setTgtTable(e.target.value)}
            />
            <datalist id="sync-tgt-tables">
              {tgtTables.map((t) => (
                <option key={t.name} value={t.name} />
              ))}
            </datalist>
          </div>

          <div>
            <label className="form-label">Strategi Penulisan Baris</label>
            <select
              className="form-input"
              value={writeMode}
              onChange={(e) => setWriteMode(e.target.value as DataSyncWriteMode)}
            >
              <option value="upsert">
                UPSERT — Tambah Baru &amp; Perbarui Jika Primary Key Sudah Ada
              </option>
              <option value="insert-ignore">
                INSERT IGNORE — Hanya Tambah Baris Baru (Lewati Duplikat)
              </option>
              <option value="truncate-insert">
                TRUNCATE + INSERT — Kosongkan Tabel Tujuan Lalu Isi Ulang
              </option>
            </select>
          </div>
        </div>
      </div>

      {/* Smart Anonymizer */}
      <div
        style={{
          padding: 12,
          borderRadius: 9,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            <input
              type="checkbox"
              checked={anonymizeEnabled}
              onChange={(e) => setAnonymizeEnabled(e.target.checked)}
            />
            <ShieldCheck size={15} color="#c084fc" />
            <span>
              Aktifkan Smart Anonymizer (Samarkan Password, NIK, Email, &amp; No. HP saat tarik ke Lokal/Dev)
            </span>
          </label>
        </div>

        {anonymizeEnabled && selectedSrcMeta && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
              gap: 6,
              marginTop: 4,
              maxHeight: 165,
              overflowY: 'auto',
              paddingRight: 4
            }}
          >
            {selectedSrcMeta.columns.map((c) => {
              const cur = columnMasks[c.name] ?? 'none';
              return (
                <div
                  key={c.name}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 6,
                    padding: '4px 7px',
                    borderRadius: 6,
                    background: 'var(--bg-app)',
                    border:
                      cur !== 'none'
                        ? '1px solid rgba(192, 132, 252, 0.5)'
                        : '1px solid var(--border-subtle)'
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      fontFamily: 'var(--font-mono)',
                      fontWeight: 600,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                    title={c.name}
                  >
                    {c.name}
                  </span>
                  <select
                    className="form-input"
                    style={{ width: 135, padding: '2px 5px', fontSize: 10.5 }}
                    value={cur}
                    onChange={(e) =>
                      setColumnMasks((prev) => ({
                        ...prev,
                        [c.name]: e.target.value as ColumnMaskStrategy
                      }))
                    }
                  >
                    {Object.entries(MASK_LABELS).map(([k, lbl]) => (
                      <option key={k} value={k}>
                        {lbl}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Actions + Sample Preview */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <button
          type="button"
          className="btn"
          disabled={loadingSample || !srcTable}
          onClick={() => void handleLoadSample()}
        >
          {loadingSample ? <RefreshCw size={13} className="spin" /> : <Eye size={13} />}
          <span>Pratinjau 5 Baris Sampel {anonymizeEnabled ? '(+ Hasil Masking)' : ''}</span>
        </button>

        <button
          type="button"
          className="btn btn-primary"
          disabled={transferring || !srcTable || !tgtTable}
          onClick={() => void handleRunTransfer()}
        >
          {transferring ? <RefreshCw size={13} className="spin" /> : <Play size={13} />}
          <span>{transferring ? 'Menyinkronkan Data...' : 'Mulai Transfer & Sinkronisasi Data'}</span>
        </button>
      </div>

      {resultMsg && (
        <div
          style={{
            padding: '9px 12px',
            borderRadius: 8,
            background: 'rgba(34, 197, 94, 0.14)',
            border: '1px solid rgba(74, 222, 128, 0.45)',
            color: '#bbf7d0',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}
        >
          <CheckCircle2 size={15} />
          <span>{resultMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div
          style={{
            padding: '9px 12px',
            borderRadius: 8,
            background: 'rgba(244, 63, 94, 0.14)',
            border: '1px solid rgba(251, 113, 133, 0.45)',
            color: '#fecdd3',
            fontSize: 12,
            fontFamily: 'var(--font-mono)'
          }}
        >
          Gagal Transfer: {errorMsg}
        </div>
      )}

      {previewMaskedSamples.length > 0 && (
        <div style={{ overflowX: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ background: 'var(--bg-surface)' }}>
                {Object.keys(previewMaskedSamples[0]).map((col) => (
                  <th
                    key={col}
                    style={{
                      padding: '6px 8px',
                      borderBottom: '1px solid var(--border-subtle)',
                      textAlign: 'left',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {col}
                    {anonymizeEnabled && columnMasks[col] && columnMasks[col] !== 'none'
                      ? ' 🕵️'
                      : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewMaskedSamples.map((row, idx) => (
                <tr key={idx} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  {Object.keys(previewMaskedSamples[0]).map((col) => (
                    <td
                      key={col}
                      style={{
                        padding: '5px 8px',
                        fontFamily: 'var(--font-mono)',
                        whiteSpace: 'nowrap',
                        maxWidth: 240,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}
                    >
                      {row[col] === null || row[col] === undefined ? 'NULL' : String(row[col])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
