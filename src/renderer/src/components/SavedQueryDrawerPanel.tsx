import React, { useEffect, useMemo, useState } from 'react';
import {
  BookMarked,
  Clock,
  Download,
  FileCode2,
  Folder,
  Network,
  Play,
  Save,
  Search,
  Star,
  Trash2,
  Upload,
  X
} from 'lucide-react';
import type { SavedSqlQueryItem, SavedVisualQuerySpec } from '@shared/types';
import { useIdeStore } from '../store/useIdeStore';

export interface SavedQueryDrawerPanelProps {
  currentSql: string;
  currentVisualSpec?: SavedVisualQuerySpec;
  defaultNameHint?: string;
  activeSavedId?: string | null;
  onSaved?: (item: SavedSqlQueryItem) => void;
  onLoadSql?: (sql: string, item?: SavedSqlQueryItem) => void;
  onExecuteSql?: (sql: string, item?: SavedSqlQueryItem) => void;
  onLoadVisualSpec?: (item: SavedSqlQueryItem) => void;
  onClose?: () => void;
  compact?: boolean;
  fullHeight?: boolean;
  defaultShowSaveForm?: boolean;
}

export const SavedQueryDrawerPanel: React.FC<SavedQueryDrawerPanelProps> = ({
  currentSql,
  currentVisualSpec,
  defaultNameHint,
  activeSavedId,
  onSaved,
  onLoadSql,
  onExecuteSql,
  onLoadVisualSpec,
  onClose,
  compact = false,
  fullHeight = false,
  defaultShowSaveForm
}) => {
  const {
    savedSqlQueries,
    sqlQueryHistory,
    selectedDbProfileId,
    dbSchema,
    saveSqlQueryItem,
    deleteSavedSqlQueryItem,
    toggleFavoriteSavedQuery,
    exportSavedSqlQueries,
    importSavedSqlQueries,
    clearSqlExecutionHistory,
    openSavedQueryInVisualBuilder,
    showToast
  } = useIdeStore();

  const [tab, setTab] = useState<'saved' | 'history'>('saved');
  const [showSaveForm, setShowSaveForm] = useState<boolean>(
    defaultShowSaveForm !== undefined ? defaultShowSaveForm : !compact || savedSqlQueries.length === 0
  );
  const [queryName, setQueryName] = useState('');
  const [folderName, setFolderName] = useState('');
  const [isFavorite, setIsFavorite] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [selectedFolder, setSelectedFolder] = useState<string>('__ALL__');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (defaultShowSaveForm !== undefined) {
      setShowSaveForm(defaultShowSaveForm);
    }
  }, [defaultShowSaveForm]);

  const activeSavedItem = useMemo(
    () => (activeSavedId ? savedSqlQueries.find((q) => q.id === activeSavedId) ?? null : null),
    [activeSavedId, savedSqlQueries]
  );

  useEffect(() => {
    if (activeSavedItem) {
      setQueryName(activeSavedItem.name);
      setFolderName(activeSavedItem.folder ?? '');
      setIsFavorite(Boolean(activeSavedItem.isFavorite));
    } else if (defaultNameHint && !queryName) {
      setQueryName(defaultNameHint);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSavedItem?.id, defaultNameHint]);

  const folders = useMemo(() => {
    const set = new Set<string>();
    for (const q of savedSqlQueries) {
      if (q.folder?.trim()) set.add(q.folder.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [savedSqlQueries]);

  const filteredSaved = useMemo(() => {
    const needle = filterText.trim().toLowerCase();
    return savedSqlQueries.filter((q) => {
      if (selectedFolder !== '__ALL__' && (q.folder ?? '') !== selectedFolder) {
        return false;
      }
      if (!needle) return true;
      return (
        q.name.toLowerCase().includes(needle) ||
        (q.folder ?? '').toLowerCase().includes(needle) ||
        q.sql.toLowerCase().includes(needle)
      );
    });
  }, [savedSqlQueries, selectedFolder, filterText]);

  const handleSave = async (forceNew = false): Promise<void> => {
    const cleanSql = currentSql.trim();
    if (!cleanSql) {
      showToast('Isi query SQL masih kosong.');
      return;
    }
    const effectiveName =
      queryName.trim() ||
      defaultNameHint ||
      `Query ${new Date().toLocaleDateString('id-ID')} ${new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
      })}`;

    setSaving(true);
    try {
      const saved = await saveSqlQueryItem({
        id: forceNew ? undefined : activeSavedItem?.id,
        name: effectiveName,
        folder: folderName.trim() || undefined,
        sql: cleanSql,
        profileId: selectedDbProfileId ?? undefined,
        database: dbSchema?.currentDatabase || undefined,
        isFavorite,
        visualDiagramSpec: currentVisualSpec
      });
      setQueryName(saved.name);
      onSaved?.(saved);
    } catch (err) {
      showToast(`Gagal menyimpan query: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        padding: compact ? 8 : 11,
        borderRadius: 8,
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-strong)',
        display: 'flex',
        flexDirection: 'column',
        gap: 7
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 5, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
          <BookMarked size={13} color="var(--accent)" style={{ flexShrink: 0 }} />
          <strong
            style={{
              fontSize: 11.5,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {compact ? 'Pustaka Query' : 'Pustaka Query Tersimpan & Riwayat'}
          </strong>
          {currentVisualSpec && (
            <span
              className="badge"
              style={{ fontSize: 9.5, background: 'rgba(52, 211, 153, 0.16)', color: '#34d399' }}
            >
              + Visual 2D
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
          {compact && (
            <button
              type="button"
              className={`btn btn-xs ${showSaveForm ? 'btn-accent' : ''}`}
              style={{ padding: '2px 6px', fontSize: 10.5 }}
              onClick={() => setShowSaveForm((v) => !v)}
              title="Buka / tutup formulir simpan query SQL saat ini"
            >
              <Save size={10.5} /> {showSaveForm ? 'Tutup Form' : '+ Simpan'}
            </button>
          )}
          <button
            type="button"
            className="btn btn-xs"
            style={{ padding: compact ? '2px 5px' : undefined }}
            onClick={() => void importSavedSqlQueries()}
            title="Impor file Pustaka Query (.json)"
          >
            <Upload size={10.5} /> {!compact && 'Impor'}
          </button>
          <button
            type="button"
            className="btn btn-xs"
            style={{ padding: compact ? '2px 5px' : undefined }}
            disabled={savedSqlQueries.length === 0}
            onClick={() => void exportSavedSqlQueries()}
            title="Ekspor seluruh Pustaka Query ke file (.json)"
          >
            <Download size={10.5} /> {!compact && 'Ekspor'}
          </button>
          {onClose && (
            <button type="button" className="icon-btn" onClick={onClose} title="Tutup Pustaka">
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Save Current Query Form */}
      {showSaveForm && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 5,
            alignItems: 'center',
            padding: 7,
            borderRadius: 6,
            background: 'var(--bg-app)',
            border: '1px solid var(--border-subtle)'
          }}
        >
          <input
            className="form-input"
            style={{ flex: '1 1 130px', minWidth: 0, fontSize: 11.5, padding: '4px 7px' }}
            placeholder="Nama query (contoh: Cari rekom)..."
            value={queryName}
            onChange={(e) => setQueryName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleSave(!activeSavedItem);
              }
            }}
          />
          <input
            className="form-input"
            list="saved-query-folders-list"
            style={{ flex: compact ? '1 1 90px' : '0 0 130px', minWidth: 0, fontSize: 11.5, padding: '4px 7px' }}
            placeholder="Folder / Tag..."
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
          />
          <datalist id="saved-query-folders-list">
            {folders.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>

          <button
            type="button"
            className="icon-btn"
            style={{ color: isFavorite ? '#fbbf24' : 'var(--text-muted)', padding: 4 }}
            onClick={() => setIsFavorite((v) => !v)}
            title="Tandai sebagai Query Favorit (muncul paling atas & di Strip Query Cepat)"
          >
            <Star size={13} fill={isFavorite ? '#fbbf24' : 'none'} />
          </button>

          {activeSavedItem ? (
            <>
              <button
                type="button"
                className="btn btn-primary"
                style={{ padding: '4px 8px', fontSize: 11 }}
                disabled={saving}
                onClick={() => void handleSave(false)}
                title="Perbarui query tersimpan yang sedang aktif"
              >
                <Save size={11.5} /> Perbarui
              </button>
              <button
                type="button"
                className="btn"
                style={{ padding: '4px 8px', fontSize: 11 }}
                disabled={saving}
                onClick={() => void handleSave(true)}
                title="Simpan sebagai item query baru"
              >
                + Baru
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              style={{ padding: '4px 9px', fontSize: 11 }}
              disabled={saving}
              onClick={() => void handleSave(true)}
            >
              <Save size={11.5} /> Simpan Query
            </button>
          )}
        </div>
      )}

      {/* Mode Switcher + Search */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 5, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            type="button"
            className={`btn ${tab === 'saved' ? 'btn-accent' : ''}`}
            style={{ padding: '3px 7px', fontSize: 10.5 }}
            onClick={() => setTab('saved')}
          >
            <Star size={10.5} /> Tersimpan ({savedSqlQueries.length})
          </button>
          <button
            type="button"
            className={`btn ${tab === 'history' ? 'btn-accent' : ''}`}
            style={{ padding: '3px 7px', fontSize: 10.5 }}
            onClick={() => setTab('history')}
          >
            <Clock size={10.5} /> Riwayat ({sqlQueryHistory.length})
          </button>
        </div>

        {tab === 'saved' ? (
          <div style={{ position: 'relative', flex: '1 1 115px', minWidth: 0, maxWidth: compact ? '100%' : 220 }}>
            <Search
              size={11.5}
              style={{ position: 'absolute', left: 7, top: 6, color: 'var(--text-muted)' }}
            />
            <input
              className="form-input"
              style={{ padding: '3px 7px 3px 23px', fontSize: 11, width: '100%' }}
              placeholder="Cari nama / isi SQL..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
            />
          </div>
        ) : (
          sqlQueryHistory.length > 0 && (
            <button
              type="button"
              className="btn btn-xs"
              onClick={clearSqlExecutionHistory}
            >
              Bersihkan
            </button>
          )
        )}
      </div>

      {/* Folder Pills */}
      {tab === 'saved' && folders.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`island-scope-pill ${selectedFolder === '__ALL__' ? 'active' : ''}`}
            onClick={() => setSelectedFolder('__ALL__')}
          >
            Semua
          </button>
          {folders.map((f) => (
            <button
              key={f}
              type="button"
              className={`island-scope-pill ${selectedFolder === f ? 'active' : ''}`}
              onClick={() => setSelectedFolder(f)}
            >
              <Folder size={9.5} style={{ display: 'inline', marginRight: 3 }} />
              {f}
            </button>
          ))}
        </div>
      )}

      {/* List */}
      <div
        style={{
          maxHeight: fullHeight ? 'none' : compact ? 240 : 260,
          overflowY: fullHeight ? 'visible' : 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 5
        }}
      >
        {tab === 'saved' ? (
          filteredSaved.length === 0 ? (
            <div style={{ padding: 14, textAlign: 'center', fontSize: 11.5, color: 'var(--text-muted)' }}>
              {savedSqlQueries.length === 0 ? (
                <>
                  Belum ada query tersimpan. Klik <strong>+ Simpan</strong> di atas untuk menyimpan query favorit Anda.
                </>
              ) : (
                'Tidak ada query yang cocok dengan pencarian/folder.'
              )}
            </div>
          ) : (
            filteredSaved.map((q) => (
              <div
                key={q.id}
                onClick={() => onLoadSql?.(q.sql, q)}
                style={{
                  padding: '7px 8px',
                  borderRadius: 6,
                  cursor: onLoadSql ? 'pointer' : 'default',
                  background:
                    activeSavedId === q.id ? 'rgba(56, 189, 248, 0.12)' : 'var(--bg-app)',
                  border:
                    activeSavedId === q.id
                      ? '1px solid rgba(56, 189, 248, 0.45)'
                      : '1px solid var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  transition: 'border-color 0.12s ease, background 0.12s ease'
                }}
                title="Klik kartu untuk memuat SQL ke editor"
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 5, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, flex: '1 1 120px' }}>
                    <button
                      type="button"
                      className="icon-btn"
                      style={{ padding: 1, color: q.isFavorite ? '#fbbf24' : 'var(--text-muted)', flexShrink: 0 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        void toggleFavoriteSavedQuery(q.id);
                      }}
                      title="Toggle Favorit"
                    >
                      <Star size={11.5} fill={q.isFavorite ? '#fbbf24' : 'none'} />
                    </button>
                    <strong
                      style={{
                        fontSize: 11.5,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {q.name}
                    </strong>
                    {q.folder && (
                      <span className="badge" style={{ fontSize: 9.5, flexShrink: 0 }}>
                        {q.folder}
                      </span>
                    )}
                    {q.visualDiagramSpec && (
                      <span
                        className="badge"
                        style={{
                          fontSize: 9.5,
                          background: 'rgba(52, 211, 153, 0.16)',
                          color: '#34d399',
                          flexShrink: 0
                        }}
                      >
                        Visual 2D
                      </span>
                    )}
                  </div>

                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {q.visualDiagramSpec && (
                      <button
                        type="button"
                        className="btn btn-xs"
                        style={{ color: '#34d399', padding: '2px 6px' }}
                        onClick={() => {
                          if (onLoadVisualSpec) {
                            onLoadVisualSpec(q);
                          } else {
                            openSavedQueryInVisualBuilder(q);
                          }
                        }}
                        title="Buka diagram tabel & relasi query ini di Navicat Visual Query Builder"
                      >
                        <Network size={10.5} /> {!compact && 'Visual'}
                      </button>
                    )}
                    {onLoadSql && (
                      <button
                        type="button"
                        className="btn btn-xs"
                        style={{ padding: '2px 6px' }}
                        onClick={() => onLoadSql(q.sql, q)}
                        title="Muat SQL ke kotak editor"
                      >
                        <FileCode2 size={10.5} /> Muat
                      </button>
                    )}
                    {onExecuteSql && (
                      <button
                        type="button"
                        className="btn btn-primary btn-xs"
                        style={{ padding: '2px 7px' }}
                        onClick={() => onExecuteSql(q.sql, q)}
                        title="Jalankan query ini sekarang"
                      >
                        <Play size={10.5} /> Jalankan
                      </button>
                    )}
                    <button
                      type="button"
                      className="icon-btn"
                      style={{ color: '#fb7185', padding: 2 }}
                      onClick={() => void deleteSavedSqlQueryItem(q.id)}
                      title="Hapus query tersimpan"
                    >
                      <Trash2 size={11.5} />
                    </button>
                  </div>
                </div>

                <div
                  style={{
                    fontSize: 10.5,
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--text-muted)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}
                  title={q.sql}
                >
                  {q.sql.replace(/\s+/g, ' ')}
                </div>
              </div>
            ))
          )
        ) : sqlQueryHistory.length === 0 ? (
          <div style={{ padding: 14, textAlign: 'center', fontSize: 11.5, color: 'var(--text-muted)' }}>
            Belum ada riwayat eksekusi query pada sesi ini.
          </div>
        ) : (
          sqlQueryHistory.map((h) => (
            <div
              key={h.id}
              style={{
                padding: '6px 8px',
                borderRadius: 6,
                background: 'var(--bg-app)',
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                gap: 4
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <span style={{ fontSize: 10.5, color: 'var(--text-secondary)' }}>
                  {new Date(h.executedAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                  })}{' '}
                  • <strong>{h.rowCount}</strong> baris • {h.durationMs} ms
                  {h.database ? ` • ${h.database}` : ''}
                </span>
                <div style={{ display: 'flex', gap: 3 }}>
                  <button
                    type="button"
                    className="btn btn-xs"
                    style={{ padding: '2px 6px' }}
                    onClick={() => {
                      void saveSqlQueryItem({
                        name: `Query ${new Date(h.executedAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit'
                        })}`,
                        sql: h.sql,
                        profileId: h.profileId,
                        database: h.database
                      });
                      setTab('saved');
                    }}
                    title="Simpan permanen ke Pustaka Query"
                  >
                    <Save size={10} /> Simpan
                  </button>
                  {onLoadSql && (
                    <button
                      type="button"
                      className="btn btn-xs"
                      style={{ padding: '2px 6px' }}
                      onClick={() => onLoadSql(h.sql)}
                    >
                      Muat
                    </button>
                  )}
                  {onExecuteSql && (
                    <button
                      type="button"
                      className="btn btn-primary btn-xs"
                      style={{ padding: '2px 6px' }}
                      onClick={() => onExecuteSql(h.sql)}
                    >
                      <Play size={10} />
                    </button>
                  )}
                </div>
              </div>
              <div
                style={{
                  fontSize: 10.5,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text-muted)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}
                title={h.sql}
              >
                {h.sql.replace(/\s+/g, ' ')}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
