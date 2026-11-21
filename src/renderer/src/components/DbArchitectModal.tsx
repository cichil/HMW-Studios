import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Check,
  Copy,
  Database,
  FileSpreadsheet,
  GitCompare,
  KeyRound,
  Link2,
  Network,
  Play,
  RefreshCw,
  Scale,
  Search,
  Table2,
  X,
  ZoomIn,
  ZoomOut
} from 'lucide-react';
import type { DbSchemaSnapshot, DbTableMeta } from '@shared/types';
import {
  buildErDiagramGraph,
  diffDatabaseSchemas,
  type DbSchemaDiffResult
} from '@shared/dbSchemaTools';
import { useIdeStore } from '../store/useIdeStore';
import { VisualJoinBuilderPanel } from './VisualJoinBuilderPanel';
import { DataTransferPanel } from './DataTransferPanel';
import { TableRowDiffPanel } from './TableRowDiffPanel';

const CARD_WIDTH = 258;

export const DbArchitectModal: React.FC = () => {
  const {
    dbArchitectTab,
    setDbArchitectTab,
    openVisualJoinBuilder,
    dbProfiles,
    selectedDbProfileId,
    setSelectedDbProfileId,
    dbSchema,
    dbSchemaLoading,
    dbSchemaLoadingMessage,
    dbSchemaLoadingPercent,
    dbSchemaLoadingTargetDb,
    dbSchemaError,
    loadDbSchema,
    triggerSqlCodeLensAction,
    findReferencesForSymbol,
    showToast
  } = useIdeStore();

  // ER Diagram State
  const [erSelectedDb, setErSelectedDb] = useState<string>('');
  const [erFilter, setErFilter] = useState('');
  const [includeImplicit, setIncludeImplicit] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>(null);
  const [erJoinBasket, setErJoinBasket] = useState<
    Array<{ key: string; schema?: string; name: string }>
  >([]);

  const toggleErJoinBasket = (node: { key: string; schema?: string; name: string }): void => {
    setErJoinBasket((prev) => {
      if (prev.some((p) => p.key === node.key)) {
        return prev.filter((p) => p.key !== node.key);
      }
      return [...prev, { key: node.key, schema: node.schema, name: node.name }];
    });
  };

  // Schema Diff State
  const [srcProfileId, setSrcProfileId] = useState<string>('');
  const [srcDbName, setSrcDbName] = useState<string>('');
  const [srcSnapshot, setSrcSnapshot] = useState<DbSchemaSnapshot | null>(null);

  const [tgtProfileId, setTgtProfileId] = useState<string>('');
  const [tgtDbName, setTgtDbName] = useState<string>('');
  const [tgtSnapshot, setTgtSnapshot] = useState<DbSchemaSnapshot | null>(null);

  const [diffBusy, setDiffBusy] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [diffResult, setDiffResult] = useState<DbSchemaDiffResult | null>(null);
  const [copiedSql, setCopiedSql] = useState(false);

  useEffect(() => {
    if (dbArchitectTab === 'closed') return;
    if (dbSchema) {
      if (!erSelectedDb) {
        setErSelectedDb(dbSchema.currentDatabase || '__ALL__');
      }
      if (!srcProfileId) {
        setSrcProfileId(dbSchema.profileId);
        setSrcSnapshot(dbSchema);
        setSrcDbName(dbSchema.currentDatabase || dbSchema.databases[0] || '');
      }
      if (!tgtProfileId) {
        const secondProf = dbProfiles.find((p) => p.id !== dbSchema.profileId);
        if (secondProf) {
          setTgtProfileId(secondProf.id);
        } else {
          setTgtProfileId(dbSchema.profileId);
          setTgtSnapshot(dbSchema);
          const altDb =
            dbSchema.databases.find((d) => d !== dbSchema.currentDatabase) ??
            dbSchema.currentDatabase;
          setTgtDbName(altDb || '');
        }
      }
    } else if (selectedDbProfileId && !srcProfileId) {
      setSrcProfileId(selectedDbProfileId);
      setTgtProfileId(selectedDbProfileId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbArchitectTab, dbSchema]);

  useEffect(() => {
    if (dbArchitectTab !== 'diff' || !srcProfileId) return;
    if (dbSchema && dbSchema.profileId === srcProfileId) {
      setSrcSnapshot(dbSchema);
      if (!srcDbName || !dbSchema.databases.includes(srcDbName)) {
        setSrcDbName(dbSchema.currentDatabase || dbSchema.databases[0] || '');
      }
      return;
    }
    let cancelled = false;
    void window.aptana.db
      .introspect(srcProfileId)
      .then((snap) => {
        if (cancelled) return;
        setSrcSnapshot(snap);
        setSrcDbName(snap.currentDatabase || snap.databases[0] || '');
      })
      .catch((err) => {
        if (!cancelled) {
          setDiffError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbArchitectTab, srcProfileId]);

  useEffect(() => {
    if (dbArchitectTab !== 'diff' || !tgtProfileId) return;
    if (dbSchema && dbSchema.profileId === tgtProfileId) {
      setTgtSnapshot(dbSchema);
      if (!tgtDbName || !dbSchema.databases.includes(tgtDbName)) {
        const alt =
          dbSchema.databases.find((d) => d !== srcDbName) ??
          dbSchema.currentDatabase ??
          dbSchema.databases[0] ??
          '';
        setTgtDbName(alt);
      }
      return;
    }
    let cancelled = false;
    void window.aptana.db
      .introspect(tgtProfileId)
      .then((snap) => {
        if (cancelled) return;
        setTgtSnapshot(snap);
        setTgtDbName(snap.currentDatabase || snap.databases[0] || '');
      })
      .catch((err) => {
        if (!cancelled) {
          setDiffError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbArchitectTab, tgtProfileId]);

  const erTables = useMemo((): DbTableMeta[] => {
    if (!dbSchema) return [];
    const all = dbSchema.allTables ?? dbSchema.tables;
    const byDb =
      !erSelectedDb || erSelectedDb === '__ALL__'
        ? all
        : all.filter(
            (t) =>
              (t.schema ?? dbSchema.currentDatabase).toLowerCase() ===
              erSelectedDb.toLowerCase()
          );
    const q = erFilter.trim().toLowerCase();
    if (!q) return byDb;
    return byDb.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.columns.some((c) => c.name.toLowerCase().includes(q))
    );
  }, [dbSchema, erSelectedDb, erFilter]);

  const erGraph = useMemo(
    () => buildErDiagramGraph(erTables, { includeImplicit, maxNodes: 80 }),
    [erTables, includeImplicit]
  );

  const canvasBounds = useMemo(() => {
    let maxX = 960;
    let maxY = 580;
    for (const n of erGraph.nodes) {
      const estH = 54 + Math.min(n.columns.length, 10) * 21 + 24;
      if (n.x + CARD_WIDTH + 60 > maxX) maxX = n.x + CARD_WIDTH + 60;
      if (n.y + estH + 60 > maxY) maxY = n.y + estH + 60;
    }
    return { width: maxX, height: maxY };
  }, [erGraph.nodes]);

  const nodeMap = useMemo(() => {
    const m = new Map<string, (typeof erGraph.nodes)[number]>();
    for (const n of erGraph.nodes) {
      m.set(n.key, n);
    }
    return m;
  }, [erGraph.nodes]);

  if (dbArchitectTab === 'closed') return null;

  const extractTablesForSnapshotDb = (
    snap: DbSchemaSnapshot,
    dbName: string
  ): DbTableMeta[] => {
    const all = snap.allTables ?? snap.tables;
    if (!dbName) return snap.tables;
    const low = dbName.toLowerCase();
    const filtered = all.filter(
      (t) => (t.schema ?? snap.currentDatabase).toLowerCase() === low
    );
    return filtered;
  };

  const handleRunSchemaDiff = async (): Promise<void> => {
    if (!srcProfileId || !tgtProfileId) {
      showToast('Pilih profil database Sumber dan Target terlebih dahulu.');
      return;
    }
    setDiffBusy(true);
    setDiffError(null);
    try {
      const [freshSrc, freshTgt] = await Promise.all([
        srcSnapshot && srcSnapshot.profileId === srcProfileId
          ? Promise.resolve(srcSnapshot)
          : window.aptana.db.introspect(srcProfileId, srcDbName || undefined),
        tgtSnapshot && tgtSnapshot.profileId === tgtProfileId
          ? Promise.resolve(tgtSnapshot)
          : window.aptana.db.introspect(tgtProfileId, tgtDbName || undefined)
      ]);
      setSrcSnapshot(freshSrc);
      setTgtSnapshot(freshTgt);

      const finalSrcDb = srcDbName || freshSrc.currentDatabase;
      const finalTgtDb = tgtDbName || freshTgt.currentDatabase;
      const srcTables = extractTablesForSnapshotDb(freshSrc, finalSrcDb);
      const tgtTables = extractTablesForSnapshotDb(freshTgt, finalTgtDb);

      const result = diffDatabaseSchemas(
        `${freshSrc.profileName} / ${finalSrcDb}`,
        srcTables,
        `${freshTgt.profileName} / ${finalTgtDb}`,
        tgtTables,
        freshTgt.engine
      );
      setDiffResult(result);
    } catch (err) {
      setDiffError(err instanceof Error ? err.message : String(err));
    } finally {
      setDiffBusy(false);
    }
  };

  const handleCopyMigrationSql = async (): Promise<void> => {
    if (!diffResult?.migrationSql) return;
    await navigator.clipboard.writeText(diffResult.migrationSql);
    setCopiedSql(true);
    showToast('Script migrasi SQL disalin ke clipboard.');
    setTimeout(() => setCopiedSql(false), 2000);
  };

  return (
    <div
      className="modal-backdrop"
      style={{ zIndex: 1300 }}
    >
      <div
        className="modal-card"
        style={{
          width: 'min(1420px, 97vw)',
          height: 'min(890px, 95vh)',
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
          overflow: 'hidden'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header: Title & Status on left, Keluar strictly pinned in top-right corner */}
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', minWidth: 0, minHeight: 30 }}>
            <Database size={17} color="var(--accent)" style={{ flexShrink: 0 }} />
            <strong style={{ fontSize: 14 }}>HMW Database Architect</strong>

            {dbSchemaLoading ? (
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '3px 9px',
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 600,
                  background: 'rgba(56, 189, 248, 0.16)',
                  border: '1px solid rgba(56, 189, 248, 0.45)',
                  color: '#7dd3fc',
                  whiteSpace: 'nowrap'
                }}
                title={dbSchemaLoadingMessage ?? 'Sedang memuat database...'}
              >
                <RefreshCw size={12} className="spin" color="#38bdf8" />
                <span>
                  Memuat{dbSchemaLoadingTargetDb ? ` "${dbSchemaLoadingTargetDb}"` : ' DB'} (
                  {dbSchemaLoadingPercent}%)
                </span>
              </div>
            ) : dbSchemaError ? (
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '3px 9px',
                  borderRadius: 999,
                  fontSize: 11,
                  background: 'rgba(239, 68, 68, 0.16)',
                  border: '1px solid rgba(239, 68, 68, 0.45)',
                  color: '#fca5a5',
                  whiteSpace: 'nowrap'
                }}
                title={dbSchemaError}
              >
                <AlertTriangle size={12} />
                <span>Gagal Memuat DB</span>
                {selectedDbProfileId && (
                  <button
                    type="button"
                    className="btn"
                    style={{ padding: '1px 6px', fontSize: 10 }}
                    onClick={() => void loadDbSchema(selectedDbProfileId, undefined, true)}
                  >
                    Coba Lagi
                  </button>
                )}
              </div>
            ) : dbSchema ? (
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '3px 9px',
                  borderRadius: 999,
                  fontSize: 11,
                  background: 'rgba(16, 185, 129, 0.12)',
                  border: '1px solid rgba(16, 185, 129, 0.35)',
                  color: '#6ee7b7',
                  whiteSpace: 'nowrap'
                }}
              >
                <span>
                  ● <strong>{dbSchema.currentDatabase || dbSchema.profileName}</strong> (
                  {dbSchema.tables.length} tabel)
                </span>
              </div>
            ) : null}
          </div>

          <button
            type="button"
            className="btn-modal-exit"
            onClick={() => setDbArchitectTab('closed')}
            title="Keluar dari HMW Database Architect"
          >
            <X size={14} />
            <span>Keluar</span>
          </button>

          {dbSchemaLoading && (
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                height: 3,
                background: 'rgba(15, 23, 42, 0.5)',
                overflow: 'hidden'
              }}
            >
              <div
                style={{
                  width: `${Math.max(8, dbSchemaLoadingPercent)}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #38bdf8, #34d399)',
                  transition: 'width 0.22s ease'
                }}
              />
            </div>
          )}
        </div>

        {/* Navigation Tabs & Active Database Controls Sub-Toolbar */}
        <div className="modal-subbar">
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            <button
              type="button"
              className={dbArchitectTab === 'er' ? 'btn btn-accent' : 'btn'}
              style={{ padding: '4px 10px', fontSize: 11.5 }}
              onClick={() => setDbArchitectTab('er')}
            >
              <Network size={13} />
              <span>Visual ER Diagram</span>
            </button>
            <button
              type="button"
              className={dbArchitectTab === 'join' ? 'btn btn-accent' : 'btn'}
              style={{ padding: '4px 10px', fontSize: 11.5 }}
              onClick={() => setDbArchitectTab('join')}
            >
              <Link2 size={13} />
              <span>Visual Query Builder</span>
            </button>
            <button
              type="button"
              className={dbArchitectTab === 'diff' ? 'btn btn-accent' : 'btn'}
              style={{ padding: '4px 10px', fontSize: 11.5 }}
              onClick={() => setDbArchitectTab('diff')}
            >
              <GitCompare size={13} />
              <span>Schema Diff &amp; ALTER TABLE</span>
            </button>
            <button
              type="button"
              className={dbArchitectTab === 'sync' ? 'btn btn-accent' : 'btn'}
              style={{ padding: '4px 10px', fontSize: 11.5 }}
              onClick={() => setDbArchitectTab('sync')}
            >
              <RefreshCw size={13} />
              <span>Sync Isi Data (+ Masking)</span>
            </button>
            <button
              type="button"
              className={dbArchitectTab === 'rowdiff' ? 'btn btn-accent' : 'btn'}
              style={{ padding: '4px 10px', fontSize: 11.5 }}
              onClick={() => setDbArchitectTab('rowdiff')}
            >
              <Scale size={13} />
              <span>Data Diff (Baris PK)</span>
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {dbProfiles.length > 0 && (
              <select
                className="form-input"
                style={{ width: 'auto', fontSize: 11.5, padding: '3px 8px', minWidth: 170 }}
                title="Pilih Koneksi Profil Database Aktif"
                value={selectedDbProfileId ?? ''}
                disabled={dbSchemaLoading}
                onChange={(e) => {
                  const nextId = e.target.value || null;
                  setSelectedDbProfileId(nextId);
                  if (nextId) {
                    void loadDbSchema(nextId, undefined, false);
                  }
                }}
              >
                {dbProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.engine.toUpperCase()})
                  </option>
                ))}
              </select>
            )}

            {selectedDbProfileId && (
              <>
                <button
                  type="button"
                  className="btn"
                  style={{ padding: '4px 8px', fontSize: 11, whiteSpace: 'nowrap' }}
                  title="Ekspor Kamus Data SPBE / BAST siap cetak (.HTML / PDF)"
                  onClick={() => {
                    void window.aptana.db
                      .exportDataDictionary(selectedDbProfileId, {
                        database: dbSchema?.currentDatabase,
                        format: 'html'
                      })
                      .then((res) => {
                        if (!res.canceled) {
                          showToast(
                            `📘 Kamus Data HTML dibuat (${res.tableCount} tabel, ${res.columnCount} kolom)!`
                          );
                        }
                      })
                      .catch((err) =>
                        showToast(`Gagal ekspor Kamus Data: ${err instanceof Error ? err.message : String(err)}`)
                      );
                  }}
                >
                  <BookOpen size={12} color="#38bdf8" />
                  <span>Kamus .HTML</span>
                </button>

                <button
                  type="button"
                  className="btn"
                  style={{ padding: '4px 8px', fontSize: 11, whiteSpace: 'nowrap' }}
                  title="Ekspor Kamus Data Multi-Sheet (.XLSX)"
                  onClick={() => {
                    void window.aptana.db
                      .exportDataDictionary(selectedDbProfileId, {
                        database: dbSchema?.currentDatabase,
                        format: 'xlsx'
                      })
                      .then((res) => {
                        if (!res.canceled) {
                          showToast(
                            `📗 Kamus Data Excel Multi-Sheet dibuat (${res.tableCount} tabel)!`
                          );
                        }
                      })
                      .catch((err) =>
                        showToast(`Gagal ekspor Kamus Data: ${err instanceof Error ? err.message : String(err)}`)
                      );
                  }}
                >
                  <FileSpreadsheet size={12} color="#34d399" />
                  <span>Kamus .XLSX</span>
                </button>

                <button
                  type="button"
                  className="btn"
                  disabled={dbSchemaLoading}
                  style={{ padding: '4px 8px', fontSize: 11, whiteSpace: 'nowrap' }}
                  title="Paksa muat ulang skema langsung dari server database (melewati cache)"
                  onClick={() =>
                    void loadDbSchema(
                      selectedDbProfileId,
                      dbSchema?.currentDatabase || undefined,
                      true
                    )
                  }
                >
                  <RefreshCw size={12} className={dbSchemaLoading ? 'spin' : ''} />
                  <span>{dbSchemaLoading ? 'Memuat...' : 'Segarkan DB'}</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Body */}
        {dbArchitectTab === 'er' ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {/* ER Toolbar */}
            <div
              style={{
                padding: '8px 14px',
                borderBottom: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 10,
                background: 'var(--bg-surface)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>Database:</span>
                <select
                  className="form-input"
                  style={{ width: 205, fontSize: 12, padding: '4px 8px' }}
                  value={erSelectedDb}
                  disabled={dbSchemaLoading}
                  onChange={(e) => {
                    const nextDb = e.target.value;
                    setErSelectedDb(nextDb);
                    setSelectedNodeKey(null);
                    if (
                      nextDb &&
                      nextDb !== '__ALL__' &&
                      selectedDbProfileId &&
                      dbSchema?.currentDatabase?.toLowerCase() !== nextDb.toLowerCase()
                    ) {
                      void loadDbSchema(selectedDbProfileId, nextDb, false);
                    }
                  }}
                >
                  <option value="__ALL__">Semua Database ({(dbSchema?.allTables ?? dbSchema?.tables ?? []).length} tabel)</option>
                  {(dbSchema?.databases ?? []).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>

                <input
                  className="form-input"
                  style={{ width: 220, fontSize: 12, padding: '4px 9px' }}
                  placeholder="Filter nama tabel / kolom..."
                  value={erFilter}
                  onChange={(e) => setErFilter(e.target.value)}
                />

                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    fontSize: 11.5,
                    color: 'var(--text-secondary)',
                    cursor: 'pointer'
                  }}
                >
                  <input
                    type="checkbox"
                    checked={includeImplicit}
                    onChange={(e) => setIncludeImplicit(e.target.checked)}
                  />
                  <span>Deteksi Relasi Kunci Legacy (`kd_*`, `id_*`, `nip`)</span>
                </label>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5 }}>
                <span style={{ color: '#34d399' }}>
                  ● {erGraph.relations.filter((r) => r.kind === 'explicit-fk').length} FK Resmi
                </span>
                <span style={{ color: '#a78bfa' }}>
                  ● {erGraph.relations.filter((r) => r.kind === 'implicit-key').length} Relasi Kunci
                </span>
                <button
                  type="button"
                  className="btn"
                  style={{ padding: '3px 7px', fontSize: 11 }}
                  onClick={() => setZoom((z) => Math.max(0.6, Number((z - 0.15).toFixed(2))))}
                  title="Perkecil"
                >
                  <ZoomOut size={12} />
                </button>
                <span style={{ minWidth: 40, textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  className="btn"
                  style={{ padding: '3px 7px', fontSize: 11 }}
                  onClick={() => setZoom((z) => Math.min(1.5, Number((z + 0.15).toFixed(2))))}
                  title="Perbesar"
                >
                  <ZoomIn size={12} />
                </button>

                {erJoinBasket.length > 0 && (
                  <>
                    <button
                      type="button"
                      className="btn btn-accent"
                      style={{ padding: '4px 10px', fontSize: 11, marginLeft: 6 }}
                      onClick={() =>
                        openVisualJoinBuilder(
                          erJoinBasket.map(({ schema, name }) => ({ schema, name }))
                        )
                      }
                      title="Susun otomatis query SELECT ... LEFT JOIN ... ON ... dari tabel yang dipilih"
                    >
                      <Link2 size={12} />
                      <span>Buat Query JOIN ({erJoinBasket.length} Tabel)</span>
                    </button>
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: '3px 7px', fontSize: 10.5 }}
                      onClick={() => setErJoinBasket([])}
                    >
                      Reset
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* ER Interactive Canvas */}
            {dbSchemaLoading && (!dbSchema || erGraph.nodes.length === 0) ? (
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                  color: '#bae6fd',
                  fontSize: 13
                }}
              >
                <RefreshCw size={26} className="spin" color="#38bdf8" />
                <strong>
                  Sedang Memuat Database
                  {dbSchemaLoadingTargetDb ? ` "${dbSchemaLoadingTargetDb}"` : ''}... (
                  {dbSchemaLoadingPercent}%)
                </strong>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {dbSchemaLoadingMessage || 'Mengambil daftar tabel, kolom, & relasi Foreign Key...'}
                </span>
              </div>
            ) : !dbSchema || erGraph.nodes.length === 0 ? (
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-muted)',
                  fontSize: 13
                }}
              >
                {dbSchema
                  ? 'Tidak ada tabel yang cocok dengan filter saat ini.'
                  : 'Hubungkan profil database terlebih dahulu untuk melihat Visual ER Diagram.'}
              </div>
            ) : (
              <div
                style={{
                  flex: 1,
                  overflow: 'auto',
                  position: 'relative',
                  background:
                    'radial-gradient(circle at 1px 1px, rgba(148, 163, 184, 0.14) 1px, transparent 0)',
                  backgroundSize: '20px 20px'
                }}
                onClick={() => setSelectedNodeKey(null)}
              >
                <div
                  style={{
                    width: canvasBounds.width * zoom,
                    height: canvasBounds.height * zoom,
                    position: 'relative'
                  }}
                >
                  <div
                    style={{
                      width: canvasBounds.width,
                      height: canvasBounds.height,
                      transform: `scale(${zoom})`,
                      transformOrigin: '0 0',
                      position: 'relative'
                    }}
                  >
                    {/* SVG Curved Relation Edges */}
                    <svg
                      width={canvasBounds.width}
                      height={canvasBounds.height}
                      style={{
                        position: 'absolute',
                        inset: 0,
                        pointerEvents: 'none',
                        zIndex: 1
                      }}
                    >
                      <defs>
                        <marker
                          id="er-arrow-fk"
                          markerWidth="8"
                          markerHeight="8"
                          refX="7"
                          refY="4"
                          orient="auto"
                        >
                          <path d="M0,0 L8,4 L0,8 Z" fill="#34d399" />
                        </marker>
                        <marker
                          id="er-arrow-imp"
                          markerWidth="8"
                          markerHeight="8"
                          refX="7"
                          refY="4"
                          orient="auto"
                        >
                          <path d="M0,0 L8,4 L0,8 Z" fill="#a78bfa" />
                        </marker>
                      </defs>

                      {erGraph.relations.map((rel) => {
                        const fromKey = `${(rel.fromSchema ?? '').toLowerCase()}.${rel.fromTable.toLowerCase()}`;
                        const toKey = `${(rel.toSchema ?? '').toLowerCase()}.${rel.toTable.toLowerCase()}`;
                        const fromNode = nodeMap.get(fromKey);
                        const toNode = nodeMap.get(toKey);
                        if (!fromNode || !toNode) return null;

                        const fromColIdx = Math.max(
                          0,
                          Math.min(
                            9,
                            fromNode.columns.findIndex(
                              (c) => c.name.toLowerCase() === rel.fromColumn.toLowerCase()
                            )
                          )
                        );
                        const toColIdx = Math.max(
                          0,
                          Math.min(
                            9,
                            toNode.columns.findIndex(
                              (c) => c.name.toLowerCase() === rel.toColumn.toLowerCase()
                            )
                          )
                        );

                        const fromRight = fromNode.x <= toNode.x;
                        const x1 = fromRight ? fromNode.x + CARD_WIDTH : fromNode.x;
                        const y1 = fromNode.y + 52 + fromColIdx * 21;
                        const x2 = fromRight ? toNode.x : toNode.x + CARD_WIDTH;
                        const y2 = toNode.y + 52 + toColIdx * 21;
                        const dx = Math.max(48, Math.abs(x2 - x1) * 0.45);
                        const c1x = fromRight ? x1 + dx : x1 - dx;
                        const c2x = fromRight ? x2 - dx : x2 + dx;

                        const isHighlighted =
                          !selectedNodeKey ||
                          selectedNodeKey === fromKey ||
                          selectedNodeKey === toKey;

                        const stroke =
                          rel.kind === 'explicit-fk' ? '#34d399' : '#a78bfa';

                        return (
                          <path
                            key={rel.id}
                            d={`M ${x1} ${y1} C ${c1x} ${y1}, ${c2x} ${y2}, ${x2} ${y2}`}
                            fill="none"
                            stroke={stroke}
                            strokeWidth={
                              selectedNodeKey &&
                              (selectedNodeKey === fromKey || selectedNodeKey === toKey)
                                ? 2.4
                                : 1.5
                            }
                            strokeDasharray={rel.kind === 'implicit-key' ? '5 4' : undefined}
                            opacity={isHighlighted ? 0.88 : 0.16}
                            markerEnd={
                              rel.kind === 'explicit-fk'
                                ? 'url(#er-arrow-fk)'
                                : 'url(#er-arrow-imp)'
                            }
                          />
                        );
                      })}
                    </svg>

                    {/* Table Nodes */}
                    {erGraph.nodes.map((node) => {
                      const isSelected = selectedNodeKey === node.key;
                      const joinOrderIdx = erJoinBasket.findIndex((b) => b.key === node.key);
                      const inJoinBasket = joinOrderIdx >= 0;
                      const relatedCols = new Set(
                        erGraph.relations
                          .filter(
                            (r) =>
                              `${(r.fromSchema ?? '').toLowerCase()}.${r.fromTable.toLowerCase()}` ===
                                node.key ||
                              `${(r.toSchema ?? '').toLowerCase()}.${r.toTable.toLowerCase()}` ===
                                node.key
                          )
                          .flatMap((r) => [
                            r.fromColumn.toLowerCase(),
                            r.toColumn.toLowerCase()
                          ])
                      );

                      const qualifiedTbl =
                        node.schema &&
                        dbSchema &&
                        node.schema.toLowerCase() !== dbSchema.currentDatabase.toLowerCase()
                          ? `${node.schema}.${node.name}`
                          : node.name;

                      return (
                        <div
                          key={node.key}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (e.ctrlKey || e.metaKey) {
                              toggleErJoinBasket(node);
                            } else {
                              setSelectedNodeKey(isSelected ? null : node.key);
                            }
                          }}
                          style={{
                            position: 'absolute',
                            left: node.x,
                            top: node.y,
                            width: CARD_WIDTH,
                            borderRadius: 8,
                            background: 'var(--bg-elevated)',
                            border: inJoinBasket
                              ? '2px solid #34d399'
                              : isSelected
                                ? '2px solid var(--accent)'
                                : '1px solid var(--border-strong)',
                            boxShadow: inJoinBasket
                              ? '0 8px 26px rgba(52, 211, 153, 0.28)'
                              : isSelected
                                ? '0 8px 26px rgba(56, 189, 248, 0.25)'
                                : '0 4px 14px rgba(0,0,0,0.35)',
                            zIndex: inJoinBasket || isSelected ? 4 : 2,
                            overflow: 'hidden',
                            cursor: 'pointer'
                          }}
                        >
                          <div
                            style={{
                              padding: '6px 9px',
                              background: 'var(--bg-surface)',
                              borderBottom: '1px solid var(--border-subtle)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 4
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 5,
                                minWidth: 0,
                                flex: 1
                              }}
                            >
                              <Table2 size={13} color="var(--accent)" style={{ flexShrink: 0 }} />
                              <strong
                                style={{
                                  fontSize: 12,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap'
                                }}
                                title={qualifiedTbl}
                              >
                                {node.schema && erSelectedDb === '__ALL__'
                                  ? `${node.schema}.${node.name}`
                                  : node.name}
                              </strong>
                            </div>
                            <div style={{ display: 'flex', gap: 3 }}>
                              <button
                                type="button"
                                className="btn"
                                style={{
                                  padding: '1px 5px',
                                  fontSize: 9.5,
                                  color: inJoinBasket ? '#34d399' : undefined,
                                  borderColor: inJoinBasket ? 'rgba(52, 211, 153, 0.6)' : undefined
                                }}
                                title="Pilih tabel ini untuk dirakit ke Query JOIN (atau Ctrl+Klik kotak tabel)"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleErJoinBasket(node);
                                }}
                              >
                                {inJoinBasket ? `✓#${joinOrderIdx + 1}` : '+JOIN'}
                              </button>
                              <button
                                type="button"
                                className="btn"
                                style={{ padding: '1px 5px', fontSize: 9.5 }}
                                title="Lihat 100 baris data di SQL Runner"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDbArchitectTab('closed');
                                  triggerSqlCodeLensAction({
                                    mode: 'run',
                                    sqlTemplate: `SELECT * FROM ${qualifiedTbl} LIMIT 100;`,
                                    params: [],
                                    primaryTable: { schema: node.schema, table: node.name }
                                  });
                                }}
                              >
                                DATA
                              </button>
                              <button
                                type="button"
                                className="btn"
                                style={{ padding: '1px 5px', fontSize: 9.5 }}
                                title="Cari semua file PHP yang memakai tabel ini (Shift+F12)"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDbArchitectTab('closed');
                                  findReferencesForSymbol(node.name);
                                }}
                              >
                                <Search size={10} />
                              </button>
                            </div>
                          </div>

                          <div style={{ padding: '4px 8px' }}>
                            {node.columns.slice(0, 10).map((col) => {
                              const isFk = relatedCols.has(col.name.toLowerCase());
                              return (
                                <div
                                  key={col.name}
                                  style={{
                                    height: 21,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: 6,
                                    fontSize: 11,
                                    fontFamily: 'var(--font-mono)'
                                  }}
                                >
                                  <span
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 4,
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                      color: col.isPrimaryKey
                                        ? '#fbbf24'
                                        : isFk
                                          ? '#a78bfa'
                                          : 'var(--text-primary)'
                                    }}
                                  >
                                    {col.isPrimaryKey ? (
                                      <KeyRound size={10} color="#fbbf24" />
                                    ) : isFk ? (
                                      <Link2 size={10} color="#a78bfa" />
                                    ) : null}
                                    <span>{col.name}</span>
                                  </span>
                                  <span
                                    style={{
                                      color: 'var(--text-muted)',
                                      fontSize: 10,
                                      flexShrink: 0
                                    }}
                                  >
                                    {col.dataType}
                                  </span>
                                </div>
                              );
                            })}
                            {node.columns.length > 10 && (
                              <div
                                style={{
                                  fontSize: 10,
                                  color: 'var(--text-muted)',
                                  paddingTop: 2
                                }}
                              >
                                +{node.columns.length - 10} kolom lainnya...
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : dbArchitectTab === 'join' ? (
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <VisualJoinBuilderPanel />
          </div>
        ) : dbArchitectTab === 'sync' ? (
          <DataTransferPanel />
        ) : (
          /* TAB 3: Schema Diff & ALTER TABLE Migration Generator */
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              padding: 16,
              gap: 12,
              overflow: 'auto'
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto 1fr auto',
                gap: 10,
                alignItems: 'end',
                padding: 12,
                borderRadius: 8,
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)'
              }}
            >
              {/* Source */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: '#38bdf8' }}>
                  1. Database Sumber Acuan (Lokal / Dev)
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <select
                    className="form-input"
                    style={{ flex: 1, fontSize: 12 }}
                    value={srcProfileId}
                    onChange={(e) => setSrcProfileId(e.target.value)}
                  >
                    <option value="">-- Pilih Profil DB --</option>
                    {dbProfiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        [{p.engine.toUpperCase()}] {p.name}
                      </option>
                    ))}
                  </select>
                  <select
                    className="form-input"
                    style={{ flex: 1, fontSize: 12 }}
                    value={srcDbName}
                    onChange={(e) => setSrcDbName(e.target.value)}
                  >
                    {(srcSnapshot?.databases ?? []).map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ paddingBottom: 8, color: 'var(--text-muted)' }}>
                <ArrowRight size={18} />
              </div>

              {/* Target */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: '#34d399' }}>
                  2. Database Target Tujuan (Staging / Server Produksi)
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <select
                    className="form-input"
                    style={{ flex: 1, fontSize: 12 }}
                    value={tgtProfileId}
                    onChange={(e) => setTgtProfileId(e.target.value)}
                  >
                    <option value="">-- Pilih Profil DB --</option>
                    {dbProfiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        [{p.engine.toUpperCase()}] {p.name}
                      </option>
                    ))}
                  </select>
                  <select
                    className="form-input"
                    style={{ flex: 1, fontSize: 12 }}
                    value={tgtDbName}
                    onChange={(e) => setTgtDbName(e.target.value)}
                  >
                    {(tgtSnapshot?.databases ?? []).map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <button
                type="button"
                className="btn btn-primary"
                style={{ padding: '7px 14px', fontSize: 12 }}
                disabled={diffBusy || !srcProfileId || !tgtProfileId}
                onClick={() => void handleRunSchemaDiff()}
              >
                <RefreshCw size={13} className={diffBusy ? 'spin' : ''} />
                <span>{diffBusy ? 'Membandingkan...' : 'Bandingkan Skema'}</span>
              </button>
            </div>

            {diffError && (
              <div
                style={{
                  padding: '8px 12px',
                  borderRadius: 6,
                  background: 'rgba(239, 68, 68, 0.14)',
                  border: '1px solid rgba(239, 68, 68, 0.4)',
                  color: '#fca5a5',
                  fontSize: 12
                }}
              >
                {diffError}
              </div>
            )}

            {diffResult ? (
              <div
                style={{
                  flex: 1,
                  display: 'grid',
                  gridTemplateColumns: '1fr 1.2fr',
                  gap: 12,
                  minHeight: 0
                }}
              >
                {/* Summary & Column Diff List */}
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                    padding: 12,
                    borderRadius: 8,
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)',
                    overflow: 'auto'
                  }}
                >
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11.5 }}>
                    <span className="badge-pill" style={{ background: 'rgba(56,189,248,0.16)', color: '#38bdf8' }}>
                      +{diffResult.missingTablesInTarget.length} Tabel Baru
                    </span>
                    <span className="badge-pill" style={{ background: 'rgba(251,191,36,0.16)', color: '#fbbf24' }}>
                      {diffResult.columnDiffs.length} Perbedaan Kolom
                    </span>
                    <span className="badge-pill" style={{ background: 'rgba(52,211,153,0.16)', color: '#34d399' }}>
                      ✓ {diffResult.identicalTablesCount} Tabel Identik
                    </span>
                  </div>

                  {diffResult.missingTablesInTarget.length > 0 && (
                    <div>
                      <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 4 }}>
                        Tabel Belum Ada di Target ({diffResult.missingTablesInTarget.length}):
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {diffResult.missingTablesInTarget.map((t) => (
                          <code
                            key={t}
                            style={{
                              padding: '2px 7px',
                              borderRadius: 4,
                              background: 'var(--bg-surface)',
                              fontSize: 11,
                              color: '#38bdf8'
                            }}
                          >
                            + {t}
                          </code>
                        ))}
                      </div>
                    </div>
                  )}

                  {diffResult.columnDiffs.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <div style={{ fontSize: 11.5, fontWeight: 700 }}>
                        Rincian Perbedaan Kolom:
                      </div>
                      {diffResult.columnDiffs.map((cd, i) => (
                        <div
                          key={`${cd.table}-${cd.column}-${i}`}
                          style={{
                            padding: '6px 8px',
                            borderRadius: 5,
                            background: 'var(--bg-surface)',
                            border: '1px solid var(--border-subtle)',
                            fontSize: 11.5
                          }}
                        >
                          <div>
                            <strong>{cd.table}</strong>.<code>{cd.column}</code>{' '}
                            <span
                              style={{
                                fontSize: 10.5,
                                color:
                                  cd.kind === 'missing-in-target'
                                    ? '#38bdf8'
                                    : cd.kind === 'type-mismatch'
                                      ? '#fbbf24'
                                      : 'var(--text-muted)'
                              }}
                            >
                              (
                              {cd.kind === 'missing-in-target'
                                ? 'Kolom Baru'
                                : cd.kind === 'type-mismatch'
                                  ? 'Tipe Berbeda'
                                  : 'Hanya di Target'}
                              )
                            </span>
                          </div>
                          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2 }}>
                            {cd.sourceType ? `Sumber: ${cd.sourceType}` : ''}{' '}
                            {cd.targetType ? `→ Target: ${cd.targetType}` : ''}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    diffResult.missingTablesInTarget.length === 0 && (
                      <div style={{ color: '#34d399', fontSize: 12.5, paddingTop: 8 }}>
                        ✓ Seluruh tabel dan kolom antara Sumber dan Target sudah selaras!
                      </div>
                    )
                  )}
                </div>

                {/* Generated Migration SQL */}
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    padding: 12,
                    borderRadius: 8,
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)',
                    minHeight: 0
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8
                    }}
                  >
                    <strong style={{ fontSize: 12 }}>
                      Script Migrasi SQL Otomatis (`CREATE TABLE` / `ALTER TABLE`)
                    </strong>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: '3px 9px', fontSize: 11 }}
                        onClick={() => void handleCopyMigrationSql()}
                      >
                        {copiedSql ? <Check size={12} color="#34d399" /> : <Copy size={12} />}
                        <span>{copiedSql ? 'Tersalin' : 'Salin SQL'}</span>
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary"
                        style={{ padding: '3px 9px', fontSize: 11 }}
                        onClick={() => {
                          setDbArchitectTab('closed');
                          triggerSqlCodeLensAction({
                            mode: 'run',
                            sqlTemplate: diffResult.migrationSql,
                            params: [],
                            primaryTable: null
                          });
                        }}
                      >
                        <Play size={12} />
                        <span>Buka di SQL Runner</span>
                      </button>
                    </div>
                  </div>
                  <textarea
                    readOnly
                    value={diffResult.migrationSql}
                    style={{
                      flex: 1,
                      width: '100%',
                      resize: 'none',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 12,
                      padding: 10,
                      borderRadius: 6,
                      background: 'var(--bg-surface)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-subtle)',
                      lineHeight: 1.5
                    }}
                  />
                </div>
              </div>
            ) : (
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-muted)',
                  fontSize: 12.5
                }}
              >
                Pilih Database Sumber Acuan dan Database Target di atas, lalu klik{' '}
                <strong style={{ margin: '0 4px', color: 'var(--text-primary)' }}>
                  Bandingkan Skema
                </strong>{' '}
                untuk menghasilkan script <code>ALTER TABLE</code> otomatis.
              </div>
            )}
          </div>
        )}

        {dbArchitectTab === 'rowdiff' && <TableRowDiffPanel />}
      </div>
    </div>
  );
};
