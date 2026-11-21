import React, { useEffect, useState } from 'react';
import { Check, Copy, GitCompare, Play, Scale } from 'lucide-react';
import type { TableRowDiffReport } from '@shared/dbRowDiffEngine';
import { useIdeStore } from '../store/useIdeStore';

export const TableRowDiffPanel: React.FC = () => {
  const { dbProfiles, selectedDbProfileId, dbSchema, showToast } = useIdeStore();

  const [sourceProfId, setSourceProfId] = useState(selectedDbProfileId || dbProfiles[0]?.id || '');
  const [targetProfId, setTargetProfId] = useState(
    dbProfiles.find((p) => p.id !== selectedDbProfileId)?.id ||
      selectedDbProfileId ||
      dbProfiles[0]?.id ||
      ''
  );
  const [sourceDb, setSourceDb] = useState(dbSchema?.currentDatabase || '');
  const [targetDb, setTargetDb] = useState(dbSchema?.currentDatabase || '');
  const [tableName, setTableName] = useState(dbSchema?.tables[0]?.name || '');
  const [rowLimit, setRowLimit] = useState(1000);
  const [includeDelete, setIncludeDelete] = useState(false);
  const [running, setRunning] = useState(false);
  const [executingSync, setExecutingSync] = useState(false);
  const [report, setReport] = useState<TableRowDiffReport | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (dbSchema?.currentDatabase && !sourceDb) {
      setSourceDb(dbSchema.currentDatabase);
      setTargetDb(dbSchema.currentDatabase);
    }
    if (dbSchema?.tables[0]?.name && !tableName) {
      setTableName(dbSchema.tables[0].name);
    }
  }, [dbSchema, sourceDb, tableName]);

  const handleCompare = async (): Promise<void> => {
    if (!sourceProfId || !targetProfId || !tableName.trim()) {
      showToast('Pilih Profil Sumber, Profil Tujuan, dan Nama Tabel terlebih dahulu.');
      return;
    }
    setRunning(true);
    try {
      const res = await window.aptana.db.diffTableRows({
        sourceProfileId: sourceProfId,
        sourceDatabase: sourceDb.trim() || undefined,
        sourceTable: tableName.trim(),
        targetProfileId: targetProfId,
        targetDatabase: targetDb.trim() || undefined,
        targetTable: tableName.trim(),
        rowLimit,
        includeDeleteMissingInTarget: includeDelete
      });
      setReport(res);
    } catch (err) {
      showToast(`Gagal membandingkan baris: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunning(false);
    }
  };

  const handleExecuteSyncSql = async (): Promise<void> => {
    if (!report || !report.syncSql || report.syncSql.startsWith('-- Data identik')) return;
    const targetProf = dbProfiles.find((p) => p.id === targetProfId);
    const ok = window.confirm(
      `Jalankan skrip sinkronisasi baris ke "${targetProf?.name || targetProfId}" (${targetDb || 'default'})?\n` +
        `• +${report.onlyInSource.length} INSERT\n• ~${report.modified.length} UPDATE`
    );
    if (!ok) return;
    setExecutingSync(true);
    try {
      await window.aptana.db.queryMulti(
        targetProfId,
        report.syncSql,
        targetDb.trim() || undefined
      );
      showToast('✅ Sinkronisasi baris selesai dijalankan ke database tujuan!');
      await handleCompare();
    } catch (err) {
      showToast(`Gagal sinkronisasi SQL: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExecutingSync(false);
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, padding: 14, overflowY: 'auto' }}>
      <div
        style={{
          padding: 12,
          borderRadius: 8,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(185px, 1fr))',
          gap: 10,
          alignItems: 'end'
        }}
      >
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
            Profil Sumber (misal: Staging)
          </div>
          <select
            className="form-input"
            style={{ width: '100%' }}
            value={sourceProfId}
            onChange={(e) => setSourceProfId(e.target.value)}
          >
            {dbProfiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.engine.toUpperCase()})
              </option>
            ))}
          </select>
        </div>

        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
            DB Sumber
          </div>
          <input
            type="text"
            className="form-input"
            style={{ width: '100%' }}
            value={sourceDb}
            onChange={(e) => setSourceDb(e.target.value)}
            placeholder="Nama database sumber"
          />
        </div>

        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
            Profil Tujuan (misal: Production)
          </div>
          <select
            className="form-input"
            style={{ width: '100%' }}
            value={targetProfId}
            onChange={(e) => setTargetProfId(e.target.value)}
          >
            {dbProfiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.isProduction ? '🔴' : ''}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
            DB Tujuan
          </div>
          <input
            type="text"
            className="form-input"
            style={{ width: '100%' }}
            value={targetDb}
            onChange={(e) => setTargetDb(e.target.value)}
            placeholder="Nama database tujuan"
          />
        </div>

        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
            Nama Tabel Referensi
          </div>
          <input
            type="text"
            list="hmw-rowdiff-tables"
            className="form-input"
            style={{ width: '100%', fontFamily: 'var(--font-mono)' }}
            value={tableName}
            onChange={(e) => setTableName(e.target.value)}
            placeholder="mst_kbli / mst_menu"
          />
          <datalist id="hmw-rowdiff-tables">
            {(dbSchema?.tables ?? []).map((t) => (
              <option key={t.name} value={t.name} />
            ))}
          </datalist>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={includeDelete}
              onChange={(e) => setIncludeDelete(e.target.checked)}
            />
            Sertakan DELETE
          </label>
          <button
            type="button"
            className="btn btn-primary"
            disabled={running}
            onClick={() => void handleCompare()}
          >
            <GitCompare size={13} />
            {running ? 'Membandingkan...' : 'Bandingkan Baris'}
          </button>
        </div>
      </div>

      {!report && (
        <div style={{ padding: 36, textAlign: 'center', color: 'var(--text-muted)' }}>
          <Scale size={28} style={{ opacity: 0.5, marginBottom: 8 }} />
          <div>
            Bandingkan isi baris tabel referensi (misal: <code>mst_kbli</code>, <code>mst_provinsi</code>, <code>mst_menu</code>) berdasarkan Primary Key antara Staging &amp; Production, lalu hasilkan SQL <code>INSERT</code> / <code>UPDATE</code> otomatis!
          </div>
        </div>
      )}

      {report && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 12, minHeight: 360 }}>
          <div
            style={{
              padding: 12,
              borderRadius: 8,
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              overflowY: 'auto'
            }}
          >
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11.5 }}>
              <span style={{ padding: '2px 9px', borderRadius: 999, background: 'rgba(16, 185, 129, 0.16)', color: '#6ee7b7', fontWeight: 700 }}>
                + Baru di Sumber: {report.onlyInSource.length}
              </span>
              <span style={{ padding: '2px 9px', borderRadius: 999, background: 'rgba(234, 179, 8, 0.18)', color: '#fde047', fontWeight: 700 }}>
                ~ Berubah: {report.modified.length}
              </span>
              <span style={{ padding: '2px 9px', borderRadius: 999, background: 'rgba(239, 68, 68, 0.16)', color: '#fca5a5', fontWeight: 700 }}>
                - Hanya di Tujuan: {report.onlyInTarget.length}
              </span>
              <span style={{ color: 'var(--text-muted)' }}>
                • Identik: {report.identicalCount} baris (PK: {report.primaryKeys.join(', ')})
              </span>
            </div>

            {report.modified.slice(0, 40).map((m) => (
              <div
                key={m.pkKey}
                style={{
                  padding: '8px 10px',
                  borderRadius: 6,
                  background: 'rgba(15, 23, 42, 0.6)',
                  border: '1px solid rgba(234, 179, 8, 0.3)',
                  fontSize: 11.5
                }}
              >
                <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#fde047', marginBottom: 4 }}>
                  PK: {JSON.stringify(m.pkValues)}
                </div>
                {m.cellDiffs.map((cd) => (
                  <div key={cd.column} style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                    <span style={{ color: '#94a3b8' }}>{cd.column}: </span>
                    <span style={{ color: '#fca5a5', textDecoration: 'line-through' }}>
                      {JSON.stringify(cd.targetValue)}
                    </span>
                    {' → '}
                    <span style={{ color: '#6ee7b7' }}>{JSON.stringify(cd.sourceValue)}</span>
                  </div>
                ))}
              </div>
            ))}

            {report.onlyInSource.slice(0, 20).map((row, idx) => (
              <div
                key={idx}
                style={{
                  padding: '6px 10px',
                  borderRadius: 6,
                  background: 'rgba(16, 185, 129, 0.08)',
                  border: '1px solid rgba(16, 185, 129, 0.28)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  color: '#a7f3d0'
                }}
              >
                + INSERT: {JSON.stringify(row).slice(0, 140)}
              </div>
            ))}
          </div>

          <div
            style={{
              padding: 12,
              borderRadius: 8,
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 12 }}>Skrip SQL Sinkronisasi (INSERT / UPDATE)</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  className="btn"
                  style={{ padding: '3px 8px', fontSize: 11 }}
                  onClick={() => {
                    void navigator.clipboard.writeText(report.syncSql);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                >
                  {copied ? <Check size={11} /> : <Copy size={11} />} Salin SQL
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ padding: '3px 9px', fontSize: 11 }}
                  disabled={executingSync || report.syncSql.startsWith('-- Data identik')}
                  onClick={() => void handleExecuteSyncSql()}
                >
                  <Play size={11} />
                  {executingSync ? 'Menjalankan...' : 'Terapkan ke DB Tujuan'}
                </button>
              </div>
            </div>

            <textarea
              readOnly
              className="form-input"
              style={{
                flex: 1,
                minHeight: 280,
                fontFamily: 'var(--font-mono)',
                fontSize: 11.5,
                lineHeight: 1.5,
                resize: 'none'
              }}
              value={report.syncSql}
            />
          </div>
        </div>
      )}
    </div>
  );
};
