import React, { useEffect, useMemo, useState } from 'react';
import {
  Bookmark,
  BookmarkPlus,
  Box,
  Braces,
  CheckSquare,
  Code2,
  FastForward,
  FunctionSquare,
  Hash,
  ListTree,
  Palette,
  RefreshCw,
  Trash2,
  Variable
} from 'lucide-react';
import type { TodoCommentItem } from '@shared/types';
import {
  extractCodeOutline,
  type OutlineSymbolKind
} from '../languages/codeOutline';
import { useIdeStore } from '../store/useIdeStore';

function renderSymbolIcon(kind: OutlineSymbolKind): React.ReactNode {
  switch (kind) {
    case 'class':
      return <Box size={13} color="#fb923c" />;
    case 'method':
      return <FunctionSquare size={13} color="#38bdf8" />;
    case 'function':
      return <FunctionSquare size={13} color="#4ade80" />;
    case 'property':
      return <Variable size={13} color="#7dd3fc" />;
    case 'constant':
      return <Hash size={13} color="#facc15" />;
    case 'tag':
      return <Code2 size={13} color="#f97316" />;
    case 'selector':
      return <Palette size={13} color="#c084fc" />;
    case 'heading':
    default:
      return <Braces size={13} color="#94a3b8" />;
  }
}

const TODO_REGEX = /(?:\/\/|#|\/\*+|\<!--|--)\s*\b(TODO|FIXME|HACK|NOTE)\b[:\s-]*(.*)$/i;

export const OutlineSidebar: React.FC = () => {
  const {
    tabs,
    activeTabId,
    splitEditorOpen,
    secondaryTabId,
    focusedPane,
    workspacePath,
    bookmarks,
    toggleBookmarkAtLine,
    removeBookmark,
    clearBookmarks,
    jumpToBookmark,
    jumpToNextBookmark,
    jumpToTabLine,
    openFileInTab,
    openRemoteFileInTab
  } = useIdeStore();

  const [mode, setMode] = useState<'outline' | 'bookmarks'>('outline');
  const [filter, setFilter] = useState('');
  const [workspaceTodos, setWorkspaceTodos] = useState<TodoCommentItem[]>([]);
  const [scanningTodos, setScanningTodos] = useState(false);

  const targetTabId =
    splitEditorOpen && focusedPane === 'secondary' && secondaryTabId
      ? secondaryTabId
      : activeTabId;

  const targetTab = tabs.find((t) => t.id === targetTabId) ?? null;

  const symbols = useMemo(() => {
    if (!targetTab || targetTab.kind !== 'code') return [];
    return extractCodeOutline(targetTab.content, targetTab.language);
  }, [targetTab]);

  const filteredSymbols = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return symbols;
    return symbols.filter(
      (s) =>
        s.name.toLowerCase().includes(needle) ||
        (s.detail && s.detail.toLowerCase().includes(needle))
    );
  }, [symbols, filter]);

  const loadWorkspaceTodos = async (): Promise<void> => {
    if (!workspacePath) {
      setWorkspaceTodos([]);
      return;
    }
    setScanningTodos(true);
    try {
      const items = await window.aptana.workspace.scanTodos(workspacePath);
      setWorkspaceTodos(items);
    } catch {
      // Ignore
    } finally {
      setScanningTodos(false);
    }
  };

  useEffect(() => {
    if (mode === 'bookmarks') {
      void loadWorkspaceTodos();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, workspacePath]);

  // Combine workspace TODOs with live TODOs from open remote tabs
  const combinedTodos = useMemo(() => {
    const remoteItems: Array<TodoCommentItem & { connectionId?: string; tabId?: string }> = [];
    for (const t of tabs) {
      if (t.kind !== 'code' || !t.remoteConnectionId) continue;
      const lines = t.content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const m = TODO_REGEX.exec(lines[i]);
        if (m) {
          const tag = m[1].toUpperCase() as TodoCommentItem['tag'];
          remoteItems.push({
            filePath: t.filePath,
            relativePath: t.relativePath,
            line: i + 1,
            tag,
            text: (m[2] ?? '').replace(/\*+\/\s*$/, '').trim() || tag,
            connectionId: t.remoteConnectionId,
            tabId: t.id
          });
        }
      }
    }
    return [...remoteItems, ...workspaceTodos];
  }, [tabs, workspaceTodos]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="sidebar-header">
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <ListTree size={14} color="var(--accent)" />
          <span>Outline &amp; Bookmark</span>
        </span>
      </div>

      {/* Mode Switcher */}
      <div
        style={{
          padding: '8px 10px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 4
        }}
      >
        <button
          className={`btn ${mode === 'outline' ? 'btn-primary' : ''}`}
          style={{ justifyContent: 'center', fontSize: 11, padding: '4px 6px' }}
          onClick={() => setMode('outline')}
        >
          Struktur ({symbols.length})
        </button>
        <button
          className={`btn ${mode === 'bookmarks' ? 'btn-primary' : ''}`}
          style={{ justifyContent: 'center', fontSize: 11, padding: '4px 6px' }}
          onClick={() => setMode('bookmarks')}
        >
          Bookmark &amp; TODO ({bookmarks.length + combinedTodos.length})
        </button>
      </div>

      {mode === 'outline' ? (
        !targetTab || targetTab.kind !== 'code' ? (
          <div style={{ padding: 14, color: 'var(--text-muted)', lineHeight: 1.55 }}>
            Buka file kode (PHP, JS/TS, HTML, CSS, SQL, atau Markdown) untuk melihat daftar struktur{' '}
            <code>class</code>, <code>function</code>, <code>method</code>, dan elemen secara langsung.
          </div>
        ) : (
          <>
            <div
              style={{
                padding: '8px 10px',
                borderBottom: '1px solid var(--border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                gap: 6
              }}
            >
              <div
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: 'var(--text-secondary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {targetTab.title} ({targetTab.language.toUpperCase()})
              </div>
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter fungsi, class, elemen..."
                style={{ width: '100%', fontSize: 12 }}
              />
            </div>

            <div className="sidebar-scroll">
              {filteredSymbols.length === 0 ? (
                <div style={{ padding: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  {symbols.length === 0
                    ? 'Tidak ditemukan deklarasi class/function/landmark pada file ini.'
                    : 'Tidak ada simbol yang cocok dengan filter.'}
                </div>
              ) : (
                filteredSymbols.map((sym) => {
                  const isNearCursor = Math.abs(targetTab.cursorLine - sym.line) <= 2;
                  return (
                    <div
                      key={sym.id}
                      className={`tree-row ${isNearCursor ? 'selected' : ''}`}
                      style={{
                        paddingLeft: 8 + sym.depth * 14,
                        justifyContent: 'space-between',
                        gap: 6
                      }}
                      onClick={() => jumpToTabLine(targetTab.id, sym.line)}
                      title={`Lompat ke baris ${sym.line}`}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          minWidth: 0,
                          flex: 1
                        }}
                      >
                        {renderSymbolIcon(sym.kind)}
                        <span
                          style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            fontFamily: 'Consolas, monospace',
                            fontSize: 12
                          }}
                        >
                          {sym.name}
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: 10.5,
                          color: 'var(--text-muted)',
                          flexShrink: 0
                        }}
                      >
                        :{sym.line}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )
      ) : (
        <div
          className="sidebar-scroll"
          style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          {/* Section 1: Bookmarks */}
          <div
            style={{
              padding: 9,
              borderRadius: 6,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: 7
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <strong style={{ fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 5 }}>
                <Bookmark size={13} color="var(--accent)" /> Bookmark Baris ({bookmarks.length})
              </strong>
              <div style={{ display: 'flex', gap: 4 }}>
                {targetTab && targetTab.kind === 'code' && (
                  <button
                    className="icon-btn"
                    title="Tandai / Hapus Bookmark pada Baris Kursor Saat Ini (Ctrl+F2)"
                    onClick={() => toggleBookmarkAtLine(targetTab.id, targetTab.cursorLine)}
                  >
                    <BookmarkPlus size={13} />
                  </button>
                )}
                {bookmarks.length > 0 && (
                  <>
                    <button
                      className="icon-btn"
                      title="Lompat ke Bookmark Berikutnya (F2)"
                      onClick={() => void jumpToNextBookmark()}
                    >
                      <FastForward size={13} />
                    </button>
                    <button
                      className="icon-btn"
                      title="Hapus Semua Bookmark"
                      onClick={clearBookmarks}
                    >
                      <Trash2 size={13} />
                    </button>
                  </>
                )}
              </div>
            </div>

            {bookmarks.length === 0 ? (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.45 }}>
                Tekan <code>Ctrl+F2</code> di editor untuk menandai baris penting, dan <code>F2</code>{' '}
                untuk melompat antar file (Lokal &amp; Remote SFTP).
              </div>
            ) : (
              bookmarks.map((bm) => (
                <div
                  key={bm.id}
                  className="tree-row"
                  style={{
                    padding: '5px 7px',
                    borderRadius: 5,
                    border: '1px solid var(--border-subtle)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 6
                  }}
                  onClick={() => void jumpToBookmark(bm)}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        fontSize: 11.5,
                        fontWeight: 600,
                        color: bm.sourceKind === 'remote' ? '#38bdf8' : 'var(--accent)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {bm.sourceKind === 'remote' ? '☁ ' : ''}
                      {bm.relativePath}:{bm.line}
                    </div>
                    <div
                      style={{
                        fontSize: 10.5,
                        color: 'var(--text-muted)',
                        fontFamily: 'var(--font-mono)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {bm.label}
                    </div>
                  </div>
                  <button
                    className="icon-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeBookmark(bm.id);
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Section 2: TODO / FIXME Scanner */}
          <div
            style={{
              padding: 9,
              borderRadius: 6,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: 7
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <strong style={{ fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 5 }}>
                <CheckSquare size={13} color="#fcd34d" /> Daftar TODO &amp; FIXME (
                {combinedTodos.length})
              </strong>
              <button
                className="icon-btn"
                title="Pindai Ulang TODO / FIXME"
                disabled={scanningTodos}
                onClick={() => void loadWorkspaceTodos()}
              >
                <RefreshCw size={12} className={scanningTodos ? 'spin' : ''} />
              </button>
            </div>

            {combinedTodos.length === 0 ? (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.45 }}>
                Tidak ditemukan komentar <code>TODO</code>, <code>FIXME</code>, <code>HACK</code>, atau{' '}
                <code>NOTE</code> di workspace maupun tab remote yang sedang dibuka.
              </div>
            ) : (
              combinedTodos.map((td, idx) => {
                const tagColor =
                  td.tag === 'FIXME' || td.tag === 'HACK'
                    ? '#f87171'
                    : td.tag === 'TODO'
                      ? '#38bdf8'
                      : '#94a3b8';
                return (
                  <div
                    key={`${td.relativePath}:${td.line}:${idx}`}
                    className="tree-row"
                    style={{
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      gap: 2,
                      padding: '5px 7px',
                      borderRadius: 5,
                      border: '1px solid var(--border-subtle)'
                    }}
                    onClick={() => {
                      const maybeRemote = td as TodoCommentItem & { connectionId?: string };
                      if (maybeRemote.connectionId) {
                        void openRemoteFileInTab(
                          maybeRemote.connectionId,
                          td.relativePath,
                          td.line
                        );
                      } else {
                        void openFileInTab(td.filePath, td.relativePath, td.line);
                      }
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, width: '100%' }}>
                      <span
                        style={{
                          fontSize: 9.5,
                          fontWeight: 700,
                          padding: '1px 5px',
                          borderRadius: 4,
                          background: 'rgba(255,255,255,0.06)',
                          color: tagColor
                        }}
                      >
                        {td.tag}
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          flex: 1
                        }}
                      >
                        {td.relativePath}:{td.line}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: 'var(--text-secondary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        width: '100%'
                      }}
                    >
                      {td.text}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
