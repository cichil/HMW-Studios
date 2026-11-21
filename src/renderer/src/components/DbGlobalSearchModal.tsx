import React, { useEffect, useState } from 'react';
import { Database, ExternalLink, Play, RefreshCw, Search, Table2, X } from 'lucide-react';
import type {
  DbValueSearchProgressEvent,
  DbValueSearchTableHit
} from '@shared/types';
import { useIdeStore } from '../store/useIdeStore';

export const DbGlobalSearchModal: React.FC = () => {
  const {
    dbGlobalSearchModalOpen,
    setDbGlobalSearchModalOpen,
    selectedDbProfileId,
    dbSchema,
    triggerSqlCodeLensAction,
    showToast
  } = useIdeStore();

  const [needle, setNeedle] = useState('');
  const [exactMatch, setExactMatch] = useState(false);
  const [searching, setSearching] = useState(false);
  const [progress, setProgress] = useState<DbValueSearchProgressEvent | null>(null);
  const [hits, setHits] = useState<DbValueSearchTableHit[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  useEffect(() => {
    if (!dbGlobalSearchModalOpen) return undefined;
    const unsub = window.aptana.db.onValueSearchProgress((evt) => {
      setProgress(evt);
    });
    return () => unsub();
  }, [dbGlobalSearchModalOpen]);

  const handleRunSearch = async (e?: React.FormEvent): Promise<void> => {
    e?.preventDefault();
    if (!selectedDbProfileId) {
      showToast('Hubungkan profil Database terlebih dahulu.');
      return;
    }
    if (!needle.trim()) {
      showToast('Masukkan nilai ID, NIP, NIB, email, atau teks yang ingin dicari.');
      return;
    }
    setSearching(true);
    setHasSearched(true);
    setHits([]);
    setProgress(null);
    try {
      const found = await window.aptana.db.searchValueAcrossDb(selectedDbProfileId, {
        database: dbSchema?.currentDatabase,
        needle: needle.trim(),
        exactMatch,
        maxTables: 900
      });
      setHits(found);
    } catch (err) {
      showToast(`Gagal memindai isi database: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSearching(false);
    }
  };

  const handleOpenHitInSqlRunner = (hit: DbValueSearchTableHit): void => {
    const safeNeedle = needle.trim().replace(/'/g, "''");
    const whereClause = hit.matchedColumns
      .map((col) =>
        exactMatch ? `${col} = '${safeNeedle}'` : `${col} LIKE '%${safeNeedle}%'`
      )
      .join(' OR ');
    const sql = `SELECT * FROM ${hit.table} WHERE ${whereClause || '1=1'} LIMIT 100;`;
    setDbGlobalSearchModalOpen(false);
    triggerSqlCodeLensAction({
      mode: 'run',
      sqlTemplate: sql,
      params: [],
      sourceTitle: `Global DB Hunter (${hit.table})`,
      primaryTable: { schema: hit.schema, table: hit.table }
    });
  };

  if (!dbGlobalSearchModalOpen) return null;

  const pct =
    progress && progress.totalTables > 0
      ? Math.round((progress.scannedTables / progress.totalTables) * 100)
      : 0;

  return (
    <div className="modal-backdrop">
      <div
        className="modal-card"
        style={{
          width: 'min(960px, 95vw)',
          minHeight: 460,
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 9,
                background: 'rgba(56, 189, 248, 0.14)',
                border: '1px solid rgba(56, 189, 248, 0.35)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}
            >
              <Database size={18} color="#38bdf8" />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--text-primary)' }}>
                Global Database Value Hunter ({dbSchema?.currentDatabase || 'Database Aktif'})
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2 }}>
                Lacak keberadaan ID perusahaan, NIP, NIB, email, atau kode transaksi di ratusan tabel sekaligus secara paralel
              </div>
            </div>
          </div>

          <button
            type="button"
            className="btn-modal-exit"
            onClick={() => setDbGlobalSearchModalOpen(false)}
            title="Keluar / Tutup Jendela"
          >
            <X size={14} />
            <span>Keluar</span>
          </button>
        </div>

        <form
          onSubmit={(ev) => void handleRunSearch(ev)}
          style={{
            padding: '12px 18px',
            borderBottom: '1px solid var(--border-subtle)',
            background: 'var(--bg-app)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap'
          }}
        >
          <div style={{ position: 'relative', flex: '1 1 320px' }}>
            <Search
              size={14}
              style={{ position: 'absolute', left: 11, top: 10, color: 'var(--text-muted)' }}
            />
            <input
              type="text"
              className="form-input"
              style={{
                width: '100%',
                height: 35,
                paddingLeft: 34,
                background: 'var(--bg-surface)'
              }}
              placeholder="Ketik nilai yang dicari (misal: 19850412..., NIB, id_perusahaan, email)..."
              value={needle}
              onChange={(e) => setNeedle(e.target.value)}
              autoFocus
            />
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            <input
              type="checkbox"
              checked={exactMatch}
              onChange={(e) => setExactMatch(e.target.checked)}
            />
            Pencocokan Persis (=)
          </label>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ height: 35, padding: '6px 14px' }}
            disabled={searching}
          >
            {searching ? <RefreshCw size={13} className="spin" /> : <Play size={13} />}
            <span>{searching ? 'Memindai Paralel...' : 'Cari di Seluruh Tabel'}</span>
          </button>
        </form>

        {searching && progress && (
          <div
            style={{
              padding: '10px 18px',
              background: 'rgba(56, 189, 248, 0.1)',
              borderBottom: '1px solid rgba(56, 189, 248, 0.3)',
              display: 'flex',
              flexDirection: 'column',
              gap: 6
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5 }}>
              <span>
                ⏳ Memindai tabel <strong>{progress.scannedTables}</strong> / {progress.totalTables} ({progress.currentTable})...
              </span>
              <span style={{ color: '#34d399', fontWeight: 700 }}>
                {progress.hitsSoFar} tabel cocok ({pct}%)
              </span>
            </div>
            <div style={{ height: 4, borderRadius: 999, background: 'rgba(15, 23, 42, 0.7)', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${Math.max(5, pct)}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #38bdf8, #34d399)',
                  transition: 'width 0.15s ease'
                }}
              />
            </div>
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {!searching && !hasSearched && (
            <div
              style={{
                flex: 1,
                minHeight: 220,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                color: 'var(--text-muted)',
                textAlign: 'center'
              }}
            >
              <Search size={30} style={{ opacity: 0.45 }} />
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
                Telusuri Nilai di Seluruh Tabel Sekaligus ({dbSchema?.tables.length ?? 0} tabel terdeteksi)
              </div>
              <div style={{ fontSize: 12, maxWidth: 580 }}>
                Masukkan ID perusahaan, NIP 18-digit, NIB, email, atau nomor dokumen di atas untuk menemukan seluruh tabel dan kolom tempat data tersebut tersimpan.
              </div>
            </div>
          )}

          {!searching && hasSearched && hits.length === 0 && (
            <div style={{ padding: 36, textAlign: 'center', color: 'var(--text-muted)' }}>
              Nilai &ldquo;{needle}&rdquo; tidak ditemukan pada tabel manapun di database ini.
            </div>
          )}

          {hits.map((hit) => (
            <div
              key={`${hit.schema ?? ''}.${hit.table}`}
              style={{
                padding: '12px 14px',
                borderRadius: 8,
                background: 'var(--bg-app)',
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                  <Table2 size={14} color="#38bdf8" />
                  <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', fontSize: 13 }}>
                    {hit.table}
                  </span>
                  <span
                    style={{
                      fontSize: 10.5,
                      padding: '1px 8px',
                      borderRadius: 999,
                      background: 'rgba(16, 185, 129, 0.15)',
                      color: '#6ee7b7'
                    }}
                  >
                    Kolom cocok: {hit.matchedColumns.join(', ')}
                  </span>
                </div>

                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ padding: '4px 10px', fontSize: 11.5 }}
                  onClick={() => handleOpenHitInSqlRunner(hit)}
                >
                  <ExternalLink size={12} /> Buka di SQL Runner
                </button>
              </div>

              {hit.sampleRows.length > 0 && (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-surface)', textAlign: 'left' }}>
                        {Object.keys(hit.sampleRows[0])
                          .slice(0, 8)
                          .map((col) => (
                            <th key={col} style={{ padding: '5px 8px', fontFamily: 'var(--font-mono)' }}>
                              {col}
                            </th>
                          ))}
                      </tr>
                    </thead>
                    <tbody>
                      {hit.sampleRows.slice(0, 3).map((r, rIdx) => (
                        <tr key={rIdx} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                          {Object.keys(hit.sampleRows[0])
                            .slice(0, 8)
                            .map((col) => (
                              <td
                                key={col}
                                style={{
                                  padding: '5px 8px',
                                  fontFamily: 'var(--font-mono)',
                                  color: hit.matchedColumns.includes(col) ? '#fde047' : 'var(--text-secondary)',
                                  fontWeight: hit.matchedColumns.includes(col) ? 700 : 400
                                }}
                              >
                                {String(r[col] ?? 'NULL').slice(0, 64)}
                              </td>
                            ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
