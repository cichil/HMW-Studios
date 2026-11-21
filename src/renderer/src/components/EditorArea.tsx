import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  Bookmark,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Columns2,
  Compass,
  FileUp,
  FlaskConical,
  FolderKanban,
  FolderOpen,
  GitCompare,
  History,
  ListTree,
  MoreHorizontal,
  Pencil,
  Radio,
  Save,
  Server,
  ShieldAlert,
  Sparkles,
  Star,
  TerminalSquare,
  Wand2,
  X,
  Zap
} from 'lucide-react';
import {
  findModuleCompanions,
  inspectPhpFileDependencies,
  type PhpFileDependencyReport
} from '@shared/moduleCompanion';
import { ensureMonacoInitialized, getMonacoSuggestOptions, monaco } from '../themes/monacoSetup';
import { applySqlAndSecurityDiagnosticsToModel } from '../languages/phpIntelliSense';
import {
  buildCompanionCandidatesFromStore,
  getCanonicalTabKey,
  normalizeRemoteRelPath,
  registerLiveTabBufferReader,
  useIdeStore,
  type EditorTab
} from '../store/useIdeStore';
import type { CodeAnalysisWorkerResponse } from '../workers/codeAnalysis.worker';
import { HmwLogo } from './HmwLogo';

const MAX_WARM_MONACO_MODELS = 12;
const warmMonacoModels = new Map<string, monaco.editor.ITextModel>();

function acquireWarmTabModel(
  tab: EditorTab,
  pane: 'primary' | 'secondary',
  protectedKeys: Set<string>
): monaco.editor.ITextModel {
  const poolKey = `${pane}:${tab.id}`;
  const existing = warmMonacoModels.get(poolKey);
  if (existing && !existing.isDisposed()) {
    warmMonacoModels.delete(poolKey);
    warmMonacoModels.set(poolKey, existing);
    if (existing.getLanguageId() !== tab.language) {
      monaco.editor.setModelLanguage(existing, tab.language);
    }
    if (existing.getValue() !== tab.content) {
      existing.setValue(tab.content);
    }
    return existing;
  }

  const created = monaco.editor.createModel(tab.content, tab.language);
  warmMonacoModels.set(poolKey, created);

  if (warmMonacoModels.size > MAX_WARM_MONACO_MODELS) {
    for (const [k, mdl] of warmMonacoModels.entries()) {
      if (warmMonacoModels.size <= MAX_WARM_MONACO_MODELS) break;
      if (k === poolKey || protectedKeys.has(k)) continue;
      warmMonacoModels.delete(k);
      if (!mdl.isDisposed()) {
        mdl.dispose();
      }
    }
  }

  return created;
}

function pruneClosedTabModels(openTabIds: Set<string>): void {
  for (const [k, mdl] of warmMonacoModels.entries()) {
    const colonIdx = k.indexOf(':');
    const tabId = colonIdx >= 0 ? k.slice(colonIdx + 1) : k;
    if (!openTabIds.has(tabId)) {
      warmMonacoModels.delete(k);
      if (!mdl.isDisposed()) {
        mdl.dispose();
      }
    }
  }
}

const MonacoCodeEditorView: React.FC<{
  tab: EditorTab;
  pane: 'primary' | 'secondary';
}> = ({ tab, pane }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const decorationsRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const blameDecRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const activeTabRef = useRef<EditorTab>(tab);
  activeTabRef.current = tab;

  const {
    updateTabContent,
    updateTabCursor,
    setFocusedPane,
    setInlineAiBarOpen,
    setSelectedEditorText,
    setTabPhpDiagnostics,
    bookmarks,
    xdebugBreakpoints,
    xdebugState,
    toggleXdebugBreakpoint,
    theme,
    suggestMode
  } = useIdeStore();

  useEffect(() => {
    ensureMonacoInitialized();
    if (!containerRef.current) return;

    const stNow = useIdeStore.getState();
    const protectedKeys = new Set<string>();
    if (stNow.activeTabId) protectedKeys.add(`primary:${stNow.activeTabId}`);
    if (stNow.secondaryTabId) protectedKeys.add(`secondary:${stNow.secondaryTabId}`);
    const warmModel = acquireWarmTabModel(tab, pane, protectedKeys);

    const editor = monaco.editor.create(containerRef.current, {
      model: warmModel,
      theme,
      readOnly: false,
      automaticLayout: true,
      fontSize: 13.5,
      fontFamily: "'Cascadia Code', 'JetBrains Mono', Consolas, monospace",
      glyphMargin: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      tabSize: 2,
      colorDecorators: true,
      bracketPairColorization: { enabled: true },
      ...getMonacoSuggestOptions(stNow.suggestMode, tab.language === 'sql' ? 'sql' : 'code'),
      padding: { top: 10 }
    });

    let phpLintTimer: ReturnType<typeof setTimeout> | null = null;
    const schedulePhpLint = (code: string): void => {
      const lowerPath = (activeTabRef.current.filePath || activeTabRef.current.title || '').toLowerCase();
      if (activeTabRef.current.language !== 'php' || lowerPath.endsWith('.blade.php')) {
        setTabPhpDiagnostics(activeTabRef.current.id, []);
        const mdl = editor.getModel();
        if (mdl && !mdl.isDisposed()) {
          monaco.editor.setModelMarkers(mdl, 'hmw-php-linter', []);
        }
        return;
      }
      if (phpLintTimer) clearTimeout(phpLintTimer);
      phpLintTimer = setTimeout(() => {
        void window.aptana.php
          .lint(code)
          .then((res) => {
            setTabPhpDiagnostics(activeTabRef.current.id, res.diagnostics);
            const mdl = editor.getModel();
            if (!mdl || mdl.isDisposed()) return;
            const markers: monaco.editor.IMarkerData[] = res.diagnostics.map((d) => ({
              severity:
                d.severity === 'error'
                  ? monaco.MarkerSeverity.Error
                  : monaco.MarkerSeverity.Warning,
              message: d.message,
              startLineNumber: Math.min(d.line, mdl.getLineCount()),
              startColumn: 1,
              endLineNumber: Math.min(d.line, mdl.getLineCount()),
              endColumn: mdl.getLineMaxColumn(Math.min(d.line, mdl.getLineCount()))
            }));
            monaco.editor.setModelMarkers(mdl, 'hmw-php-linter', markers);
          })
          .catch(() => {
            // Ignore background lint errors
          });
      }, 350);
    };

    let sqlSchemaLintTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleSqlSchemaLint = (): void => {
      const mdl = editor.getModel();
      if (!mdl || mdl.isDisposed()) return;
      const lang = activeTabRef.current.language;
      if (lang !== 'php' && lang !== 'sql') {
        monaco.editor.setModelMarkers(mdl, 'hmw-sql-schema', []);
        monaco.editor.setModelMarkers(mdl, 'hmw-sql-security', []);
        monaco.editor.setModelMarkers(mdl, 'hmw-php-vars', []);
        return;
      }
      if (sqlSchemaLintTimer) clearTimeout(sqlSchemaLintTimer);
      sqlSchemaLintTimer = setTimeout(() => {
        const liveMdl = editor.getModel();
        if (!liveMdl || liveMdl.isDisposed()) return;
        const liveLang = activeTabRef.current.language;
        if (liveLang === 'php' || liveLang === 'sql') {
          applySqlAndSecurityDiagnosticsToModel(liveMdl, liveLang);
        }
      }, 220);
    };

    if (tab.language === 'php') {
      schedulePhpLint(tab.content);
    }
    if (tab.language === 'php' || tab.language === 'sql') {
      const initMdl = editor.getModel();
      if (initMdl && !initMdl.isDisposed()) {
        applySqlAndSecurityDiagnosticsToModel(initMdl, tab.language);
      }
    }

    const unregisterLiveBuffer = registerLiveTabBufferReader(pane, tab.id, () =>
      editor.getValue()
    );

    const actSave = editor.addAction({
      id: 'hmw.saveActiveFile',
      label: 'Simpan File (Ctrl+S)',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      contextMenuGroupId: '1_modification',
      contextMenuOrder: 1.0,
      run: () => {
        void useIdeStore.getState().saveTab(activeTabRef.current.id);
      }
    });

    const actInlineAi = editor.addAction({
      id: 'hmw.inlineGeminiAi',
      label: 'Edit & Refactor dengan Gemini AI (Ctrl+I)',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI],
      contextMenuGroupId: '1_modification',
      contextMenuOrder: 1.1,
      run: () => {
        const sel = editor.getSelection();
        const mdl = editor.getModel();
        if (sel && mdl && !sel.isEmpty()) {
          setSelectedEditorText(mdl.getValueInRange(sel));
        }
        setInlineAiBarOpen(true);
      }
    });

    const actFormat = editor.addAction({
      id: 'hmw.formatActiveCode',
      label: 'Rapikan / Format Kode (Shift+Alt+F)',
      keybindings: [monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF],
      contextMenuGroupId: '1_modification',
      contextMenuOrder: 1.2,
      run: () => {
        useIdeStore.getState().formatTabContent(activeTabRef.current.id);
      }
    });

    const actPhpScratchpad = editor.addAction({
      id: 'hmw.openPhpScratchpad',
      label: 'Uji Kode di PHP Scratchpad / Tinker (Ctrl+Shift+Enter)',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter],
      contextMenuGroupId: '1_modification',
      contextMenuOrder: 1.3,
      run: () => {
        const sel = editor.getSelection();
        const mdl = editor.getModel();
        const selText = sel && mdl && !sel.isEmpty() ? mdl.getValueInRange(sel) : undefined;
        useIdeStore.getState().openPhpScratchpad(selText);
      }
    });

    const actGoToDef = editor.addAction({
      id: 'hmw.goToDefinition',
      label: 'Lompat ke Definisi / Buka File Include (F12)',
      keybindings: [monaco.KeyCode.F12],
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1.0,
      run: () => {
        const pos = editor.getPosition();
        const mdl = editor.getModel();
        if (!pos || !mdl) return;
        const lineText = mdl.getLineContent(pos.lineNumber);
        const word = mdl.getWordAtPosition(pos)?.word ?? null;
        void useIdeStore
          .getState()
          .navigatePhpDefinition(activeTabRef.current.id, lineText, pos.column, word)
          .then((handled) => {
            if (!handled) {
              useIdeStore
                .getState()
                .showToast('Definisi simbol atau file include tidak ditemukan pada posisi kursor.');
            }
          });
      }
    });

    const actFindReferences = editor.addAction({
      id: 'hmw.findReferences',
      label: 'Lacak Semua Pemakaian Fungsi / Tabel Database (Shift+F12)',
      keybindings: [monaco.KeyMod.Shift | monaco.KeyCode.F12],
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1.05,
      run: () => {
        const mdl = editor.getModel();
        const sel = editor.getSelection();
        const pos = editor.getPosition();
        if (!mdl) return;
        let symbol = '';
        if (sel && !sel.isEmpty()) {
          symbol = mdl.getValueInRange(sel).trim();
        }
        if (!symbol && pos) {
          symbol = mdl.getWordAtPosition(pos)?.word ?? '';
        }
        if (!symbol) {
          useIdeStore.getState().showToast('Arahkan kursor pada nama fungsi, class, atau tabel database.');
          return;
        }
        const scopeHint = activeTabRef.current.remoteConnectionId ? 'remote' : undefined;
        useIdeStore.getState().findReferencesForSymbol(symbol, scopeHint);
      }
    });

    const actCompareCounterpart = editor.addAction({
      id: 'hmw.compareCounterpart',
      label: 'Bandingkan File Lokal ↔ Server Remote SFTP (Ctrl+Alt+D)',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyD],
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1.3,
      run: () => {
        void useIdeStore.getState().compareTabWithCounterpart(activeTabRef.current.id);
      }
    });

    const actSwitchCompanion = editor.addAction({
      id: 'hmw.switchModuleCompanion',
      label: 'Pindah ke File Pasangan Modul Berikutnya (_idx / _form / _save) (Alt+O)',
      keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.KeyO],
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1.35,
      run: () => {
        void useIdeStore.getState().switchModuleCompanion();
      }
    });

    const actToggleBookmark = editor.addAction({
      id: 'hmw.toggleBookmark',
      label: 'Pasang / Hapus Bookmark Baris (Ctrl+F2)',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.F2],
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1.1,
      run: () => {
        const pos = editor.getPosition();
        const mdl = editor.getModel();
        if (!pos || !mdl) return;
        useIdeStore
          .getState()
          .toggleBookmarkAtLine(
            activeTabRef.current.id,
            pos.lineNumber,
            mdl.getLineContent(pos.lineNumber)
          );
      }
    });

    const actNextBookmark = editor.addAction({
      id: 'hmw.nextBookmark',
      label: 'Lompat ke Bookmark Berikutnya (F2)',
      keybindings: [monaco.KeyCode.F2],
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1.2,
      run: () => {
        void useIdeStore.getState().jumpToNextBookmark();
      }
    });

    const actSmartRename = editor.addAction({
      id: 'hmw.smartRenameSymbol',
      label: '✏️ Smart Rename Simbol Lintas File (Alt+R)',
      keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.KeyR],
      contextMenuGroupId: '1_modification',
      contextMenuOrder: 1.4,
      run: () => {
        const mdl = editor.getModel();
        if (!mdl) return;
        const sel = editor.getSelection();
        const pos = editor.getPosition();
        let sym = '';
        if (sel && !sel.isEmpty()) {
          sym = mdl.getValueInRange(sel).trim();
        }
        if (!sym && pos) {
          const lineText = mdl.getLineContent(pos.lineNumber);
          const w = mdl.getWordAtPosition(pos);
          if (w) {
            const charBefore = w.startColumn > 1 ? lineText[w.startColumn - 2] : '';
            sym = charBefore === '$' ? `$${w.word}` : charBefore === '.' ? `.${w.word}` : w.word;
          }
        }
        useIdeStore.getState().openSmartRefactor({
          mode: 'rename',
          initialSymbol: sym,
          tabId: activeTabRef.current.id
        });
      }
    });

    const actExtractSelection = editor.addAction({
      id: 'hmw.extractSelection',
      label: '📦 Pecah Seleksi ke Fungsi / File Include Baru... (Ctrl+Shift+R)',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyR],
      contextMenuGroupId: '1_modification',
      contextMenuOrder: 1.5,
      run: () => {
        const mdl = editor.getModel();
        const sel = editor.getSelection();
        if (!mdl || !sel || sel.isEmpty()) {
          useIdeStore
            .getState()
            .showToast('Blok / pilih potongan kode terlebih dahulu untuk dipecah ke Fungsi atau File Include.');
          return;
        }
        useIdeStore.getState().openSmartRefactor({
          mode: 'extract',
          selectedCode: mdl.getValueInRange(sel),
          selectionRange: {
            startLineNumber: sel.startLineNumber,
            startColumn: sel.startColumn,
            endLineNumber: sel.endLineNumber,
            endColumn: sel.endColumn
          },
          tabId: activeTabRef.current.id
        });
      }
    });

    const subMouseDown = editor.onMouseDown((e) => {
      // Phase 30 #5: Click left glyph margin to toggle red Xdebug Breakpoint
      if (
        e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN &&
        e.target.position
      ) {
        const curTab = activeTabRef.current;
        const targetPath = curTab.remoteConnectionId ? curTab.relativePath : curTab.filePath;
        if (targetPath) {
          useIdeStore.getState().toggleXdebugBreakpoint(targetPath, e.target.position.lineNumber);
        }
        return;
      }

      if ((e.event.ctrlKey || e.event.metaKey) && e.event.leftButton && e.target.position) {
        const mdl = editor.getModel();
        if (!mdl) return;
        const pos = e.target.position;
        const lineText = mdl.getLineContent(pos.lineNumber);
        const word = mdl.getWordAtPosition(pos)?.word ?? null;
        void useIdeStore
          .getState()
          .navigatePhpDefinition(activeTabRef.current.id, lineText, pos.column, word)
          .then((handled) => {
            if (handled) {
              e.event.preventDefault();
            }
          });
      }
    });

    decorationsRef.current = editor.createDecorationsCollection([]);
    blameDecRef.current = editor.createDecorationsCollection([]);

    let blameTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleInlineBlame = (lineNumber: number): void => {
      if (blameTimer) clearTimeout(blameTimer);
      blameDecRef.current?.clear();
      const curTab = activeTabRef.current;
      const st = useIdeStore.getState();
      if (curTab.remoteConnectionId || !st.workspacePath || !st.gitStatus?.isRepo) {
        return;
      }
      blameTimer = setTimeout(() => {
        const ws = useIdeStore.getState().workspacePath;
        const liveTab = activeTabRef.current;
        if (!ws || liveTab.remoteConnectionId) return;
        void window.aptana.git
          .blameLine(ws, liveTab.relativePath, lineNumber)
          .then((info) => {
            const mdl = editor.getModel();
            const posNow = editor.getPosition();
            if (!info || !mdl || mdl.isDisposed() || posNow?.lineNumber !== lineNumber) {
              return;
            }
            const maxCol = mdl.getLineMaxColumn(lineNumber);
            const cleanSummary =
              info.summary.length > 56 ? `${info.summary.slice(0, 56)}…` : info.summary;
            blameDecRef.current?.set([
              {
                range: new monaco.Range(lineNumber, maxCol, lineNumber, maxCol),
                options: {
                  after: {
                    content: `    ⎇ ${info.author} (${info.relativeTime}) — ${cleanSummary}`,
                    inlineClassName: 'hmw-git-blame-inline'
                  }
                }
              }
            ]);
          })
          .catch(() => {});
      }, 380);
    };

    scheduleInlineBlame(tab.cursorLine || 1);

    const subFocus = editor.onDidFocusEditorText(() => {
      setFocusedPane(pane);
    });

    const subSel = editor.onDidChangeCursorSelection((e) => {
      const mdl = editor.getModel();
      if (!mdl) return;
      if (e.selection.isEmpty()) {
        setSelectedEditorText('');
      } else {
        setSelectedEditorText(mdl.getValueInRange(e.selection));
      }
    });

    if (tab.cursorLine > 1) {
      editor.setPosition({ lineNumber: tab.cursorLine, column: tab.cursorCol || 1 });
      editor.revealLineInCenter(tab.cursorLine);
    }

    const subChange = editor.onDidChangeModelContent(() => {
      const val = editor.getValue();
      if (val !== activeTabRef.current.content) {
        updateTabContent(activeTabRef.current.id, val);
      }
      schedulePhpLint(val);
      scheduleSqlSchemaLint();
    });

    const subCursor = editor.onDidChangeCursorPosition((e) => {
      updateTabCursor(activeTabRef.current.id, e.position.lineNumber, e.position.column);
      scheduleInlineBlame(e.position.lineNumber);
    });

    editorRef.current = editor;

    return () => {
      if (phpLintTimer) clearTimeout(phpLintTimer);
      if (sqlSchemaLintTimer) clearTimeout(sqlSchemaLintTimer);
      if (blameTimer) clearTimeout(blameTimer);
      unregisterLiveBuffer();
      decorationsRef.current?.clear();
      decorationsRef.current = null;
      blameDecRef.current?.clear();
      blameDecRef.current = null;
      actSave.dispose();
      actInlineAi.dispose();
      actFormat.dispose();
      actPhpScratchpad.dispose();
      actGoToDef.dispose();
      actFindReferences.dispose();
      actCompareCounterpart.dispose();
      actSwitchCompanion.dispose();
      actToggleBookmark.dispose();
      actNextBookmark.dispose();
      actSmartRename.dispose();
      actExtractSelection.dispose();
      subMouseDown.dispose();
      subFocus.dispose();
      subSel.dispose();
      subChange.dispose();
      subCursor.dispose();
      // Detach model before editor.dispose() so LRU pool controls model lifecycle cleanly
      editor.setModel(null);
      editor.dispose();
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id]);

  useEffect(() => {
    const editor = editorRef.current;
    const dec = decorationsRef.current;
    if (!editor || !dec) return;
    const model = editor.getModel();
    if (!model || model.isDisposed()) return;

    const tabKey = getCanonicalTabKey(tab);
    const maxLine = model.getLineCount();
    const nextDecorations: monaco.editor.IModelDeltaDecoration[] = bookmarks
      .filter((b) => b.fileKey === tabKey && b.line >= 1 && b.line <= maxLine)
      .map((b) => ({
        range: new monaco.Range(b.line, 1, b.line, 1),
        options: {
          isWholeLine: true,
          className: 'hmw-bookmark-line',
          hoverMessage: { value: `🔖 **Bookmark Baris ${b.line}**: \`${b.label}\`` }
        }
      }));

    // Xdebug Breakpoint Red Dots in Glyph Margin
    const tabPathNorm = (tab.remoteConnectionId ? tab.relativePath : tab.filePath)
      .replace(/\\/g, '/')
      .toLowerCase();
    for (const bp of xdebugBreakpoints) {
      const bpNorm = bp.filePath.replace(/\\/g, '/').toLowerCase();
      if (bpNorm === tabPathNorm && bp.line >= 1 && bp.line <= maxLine) {
        nextDecorations.push({
          range: new monaco.Range(bp.line, 1, bp.line, 1),
          options: {
            isWholeLine: false,
            glyphMarginClassName: 'hmw-xdebug-bp-glyph',
            glyphMarginHoverMessage: { value: `🔴 **Xdebug Breakpoint Baris ${bp.line}** (Klik untuk hapus)` }
          }
        });
      }
    }

    // Active Paused Xdebug Line Highlight
    if (
      xdebugState.status === 'break' &&
      xdebugState.pausedFile &&
      xdebugState.pausedLine &&
      xdebugState.pausedLine >= 1 &&
      xdebugState.pausedLine <= maxLine
    ) {
      const pausedNorm = xdebugState.pausedFile.replace(/\\/g, '/').toLowerCase();
      if (pausedNorm === tabPathNorm || pausedNorm.endsWith('/' + tab.title.toLowerCase())) {
        nextDecorations.push({
          range: new monaco.Range(xdebugState.pausedLine, 1, xdebugState.pausedLine, 1),
          options: {
            isWholeLine: true,
            className: 'hmw-xdebug-paused-line',
            glyphMarginClassName: 'hmw-xdebug-paused-glyph'
          }
        });
        editor.revealLineInCenter(xdebugState.pausedLine);
      }
    }

    dec.set(nextDecorations);
  }, [bookmarks, xdebugBreakpoints, xdebugState.status, xdebugState.pausedFile, xdebugState.pausedLine, tab]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel();
    if (model && !model.isDisposed() && editor.getValue() !== tab.content) {
      const pos = editor.getPosition();
      editor.pushUndoStop();
      model.pushEditOperations(
        [],
        [{ range: model.getFullModelRange(), text: tab.content }],
        () => null
      );
      editor.pushUndoStop();
      if (pos) {
        const safeLine = Math.min(pos.lineNumber, model.getLineCount());
        const safeCol = Math.min(pos.column, model.getLineMaxColumn(safeLine));
        editor.setPosition({ lineNumber: safeLine, column: safeCol });
      }
    }
  }, [tab.content]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel();
    if (model && !model.isDisposed() && model.getLanguageId() !== tab.language) {
      monaco.editor.setModelLanguage(model, tab.language);
    }
  }, [tab.language]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.updateOptions(
      getMonacoSuggestOptions(suggestMode, tab.language === 'sql' ? 'sql' : 'code')
    );
  }, [suggestMode, tab.language]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !tab.jumpToken) return;
    const model = editor.getModel();
    const safeLine = model ? Math.min(tab.cursorLine, model.getLineCount()) : tab.cursorLine;
    editor.setPosition({ lineNumber: safeLine, column: 1 });
    editor.revealLineInCenter(safeLine);
    editor.focus();
  }, [tab.jumpToken, tab.cursorLine]);

  return <div ref={containerRef} style={{ flex: 1, width: '100%', minHeight: 0 }} />;
};

const MonacoDiffEditorView: React.FC<{ tab: EditorTab }> = ({ tab }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const activeTabRef = useRef<EditorTab>(tab);
  activeTabRef.current = tab;

  const { theme, suggestMode, updateTabContent, updateTabCursor, closeTab, setActiveTab, showToast } =
    useIdeStore();

  useEffect(() => {
    ensureMonacoInitialized();
    if (!containerRef.current) return;

    const originalModel = monaco.editor.createModel(
      tab.originalContent ?? '',
      tab.language
    );
    const modifiedModel = monaco.editor.createModel(tab.content, tab.language);

    const diffEditor = monaco.editor.createDiffEditor(containerRef.current, {
      theme,
      automaticLayout: true,
      originalEditable: false,
      readOnly: false,
      renderSideBySide: true,
      fontSize: 13,
      fontFamily: "'Cascadia Code', 'JetBrains Mono', Consolas, monospace",
      ...getMonacoSuggestOptions(suggestMode, tab.language === 'sql' ? 'sql' : 'code'),
      minimap: { enabled: false }
    });

    diffEditor.setModel({
      original: originalModel,
      modified: modifiedModel
    });

    const modifiedEditor = diffEditor.getModifiedEditor();
    const unregisterLiveBuffer = registerLiveTabBufferReader('diff', tab.id, () =>
      modifiedEditor.getValue()
    );
    const actSave = modifiedEditor.addAction({
      id: 'hmw.saveDiffFile',
      label: 'Simpan Perubahan Diff (Ctrl+S)',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      contextMenuGroupId: '1_modification',
      contextMenuOrder: 1.0,
      run: () => {
        void useIdeStore.getState().saveTab(activeTabRef.current.id);
      }
    });

    const subChange = modifiedEditor.onDidChangeModelContent(() => {
      const val = modifiedEditor.getValue();
      if (val !== activeTabRef.current.content) {
        updateTabContent(activeTabRef.current.id, val);
      }
    });

    const subCursor = modifiedEditor.onDidChangeCursorPosition((e) => {
      updateTabCursor(activeTabRef.current.id, e.position.lineNumber, e.position.column);
    });

    return () => {
      unregisterLiveBuffer();
      actSave.dispose();
      subChange.dispose();
      subCursor.dispose();
      diffEditor.dispose();
      originalModel.dispose();
      modifiedModel.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id, tab.originalContent, tab.language, theme]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {tab.diffLabel && (
        <div
          style={{
            padding: '5px 12px',
            background: 'var(--bg-elevated)',
            borderBottom: '1px solid var(--border-subtle)',
            fontSize: 11.5,
            color: 'var(--text-secondary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <GitCompare size={13} color="var(--accent)" />
            <span>{tab.diffLabel} — Panel kanan dapat langsung diedit (Ctrl+S untuk simpan)</span>
          </div>
          {tab.applyTargetTabId && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                className="btn btn-accent"
                style={{ padding: '2px 8px', fontSize: 11 }}
                onClick={() => {
                  const targetId = tab.applyTargetTabId!;
                  updateTabContent(targetId, tab.content);
                  closeTab(tab.id);
                  setActiveTab(targetId);
                  showToast('✨ Perubahan AI diterapkan ke editor. Tekan Ctrl+S untuk menyimpan.');
                }}
              >
                <Check size={12} />
                <span>Terapkan ke File Asli</span>
              </button>
              <button
                type="button"
                className="btn"
                style={{ padding: '2px 7px', fontSize: 11 }}
                onClick={() => {
                  const targetId = tab.applyTargetTabId!;
                  closeTab(tab.id);
                  setActiveTab(targetId);
                }}
              >
                Batal
              </button>
            </div>
          )}
        </div>
      )}
      <div ref={containerRef} style={{ flex: 1, width: '100%', minHeight: 0 }} />
    </div>
  );
};

export const EditorArea: React.FC = () => {
  const {
    tabs,
    activeTabId,
    splitEditorOpen,
    secondaryTabId,
    focusedPane,
    setActiveTab,
    setSecondaryTab,
    toggleSplitEditor,
    closeSplitEditor,
    formatTabContent,
    setActiveSidebar,
    closeTab,
    saveTab,
    projects,
    activeProjectId,
    connections,
    setProjectModalOpen,
    openSavedProject,
    openProjectFromFile,
    openWorkspaceFolder,
    createAndOpenDemoProject,
    openConnectionModal,
    setBottomPanel,
    geminiConfig,
    setGeminiSubTab,
    inlineAiBarOpen,
    setInlineAiBarOpen,
    selectedEditorText,
    phpDiagnosticsByTab,
    applyAiCodeToTab,
    compareTabWithCounterpart,
    openPhpScratchpad,
    sendTabToHttpTester,
    findReferencesForSymbol,
    navigatePhpDefinition,
    openFileInTab,
    openRemoteFileInTab,
    jumpToTabLine,
    fileTree,
    remoteEntries,
    remoteFilesIndexByConn,
    refreshRemoteFilesIndex,
    selectedConnectionId,
    workspacePath,
    pinnedFiles,
    togglePinActiveTab,
    openSmartRefactor,
    setDocsModalOpen,
    showToast
  } = useIdeStore();

  const [inlinePrompt, setInlinePrompt] = useState('');
  const [inlineBusy, setInlineBusy] = useState(false);
  const [fixingLintBusy, setFixingLintBusy] = useState(false);
  const [fixingLocalBusy, setFixingLocalBusy] = useState(false);
  const [fixingLintElapsed, setFixingLintElapsed] = useState(0);
  const fixErrorRunIdRef = useRef(0);
  const [depsPopoverOpen, setDepsPopoverOpen] = useState(false);
  const [multiDeployOpen, setMultiDeployOpen] = useState(false);
  const [multiDeployTargets, setMultiDeployTargets] = useState<Record<string, boolean>>({});
  const [multiDeployBusy, setMultiDeployBusy] = useState(false);
  const [allTabsMenuOpen, setAllTabsMenuOpen] = useState(false);
  const [editorToolsMenuOpen, setEditorToolsMenuOpen] = useState(false);
  const tabsStripRef = useRef<HTMLDivElement | null>(null);

  const duplicateBaseNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of tabs) {
      const cleanName = (t.relativePath.split(/[/\\]/).pop() || t.title).toLowerCase();
      counts.set(cleanName, (counts.get(cleanName) ?? 0) + 1);
    }
    const dupes = new Set<string>();
    for (const [k, v] of counts) {
      if (v > 1) dupes.add(k);
    }
    return dupes;
  }, [tabs]);

  useEffect(() => {
    if (!activeTabId || !tabsStripRef.current) return;
    const el = tabsStripRef.current.querySelector<HTMLElement>(
      `[data-editor-tab-id="${CSS.escape(activeTabId)}"]`
    );
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [activeTabId, tabs.length]);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const secondaryTab =
    splitEditorOpen
      ? tabs.find((t) => t.id === secondaryTabId) ?? activeTab
      : null;

  const activeDiagnostics =
    activeTab && activeTab.kind === 'code'
      ? phpDiagnosticsByTab[activeTab.id] ?? []
      : [];

  const activeRemoteConn = useMemo(
    () =>
      activeTab?.remoteConnectionId
        ? connections.find((c) => c.id === activeTab.remoteConnectionId) ?? null
        : null,
    [activeTab?.remoteConnectionId, connections]
  );

  useEffect(() => {
    if (
      activeTab?.kind === 'code' &&
      activeTab.remoteConnectionId &&
      !remoteFilesIndexByConn[activeTab.remoteConnectionId]?.length
    ) {
      void refreshRemoteFilesIndex(activeTab.remoteConnectionId, false);
    }
  }, [activeTab?.id, activeTab?.kind, activeTab?.remoteConnectionId, remoteFilesIndexByConn, refreshRemoteFilesIndex]);

  const moduleCompanions = useMemo(() => {
    if (!activeTab || activeTab.kind !== 'code') return [];
    const candidates = buildCompanionCandidatesFromStore({
      fileTree,
      connections,
      selectedConnectionId: activeTab.remoteConnectionId ?? selectedConnectionId,
      remoteEntries,
      remoteFilesIndexByConn,
      tabs
    });
    return findModuleCompanions(
      activeTab.relativePath,
      activeTab.remoteConnectionId ? 'remote' : 'local',
      candidates
    );
  }, [
    activeTab,
    fileTree,
    connections,
    selectedConnectionId,
    remoteEntries,
    remoteFilesIndexByConn,
    tabs
  ]);

  const [phpFileDeps, setPhpFileDeps] = useState<PhpFileDependencyReport | null>(null);
  const analysisWorkerRef = useRef<Worker | null>(null);
  const analysisReqSeqRef = useRef(0);

  useEffect(() => {
    pruneClosedTabModels(new Set(tabs.map((t) => t.id)));
  }, [tabs]);

  useEffect(() => {
    if (typeof Worker === 'undefined') return undefined;
    try {
      const worker = new Worker(
        new URL('../workers/codeAnalysis.worker.ts', import.meta.url),
        { type: 'module' }
      );
      worker.onmessage = (ev: MessageEvent<CodeAnalysisWorkerResponse>) => {
        if (ev.data.reqId === analysisReqSeqRef.current) {
          setPhpFileDeps(ev.data.deps);
        }
      };
      analysisWorkerRef.current = worker;
      return () => {
        worker.terminate();
        analysisWorkerRef.current = null;
      };
    } catch {
      return undefined;
    }
  }, []);

  useEffect(() => {
    if (!activeTab || activeTab.kind !== 'code' || activeTab.language !== 'php') {
      setPhpFileDeps(null);
      return undefined;
    }
    const reqId = ++analysisReqSeqRef.current;
    const worker = analysisWorkerRef.current;
    if (worker && activeTab.content.length > 4096) {
      const timer = setTimeout(() => {
        worker.postMessage({
          reqId,
          tabId: activeTab.id,
          code: activeTab.content
        });
      }, 260);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => {
      setPhpFileDeps(inspectPhpFileDependencies(activeTab.content));
    }, 120);
    return () => clearTimeout(timer);
  }, [activeTab?.id, activeTab?.kind, activeTab?.language, activeTab?.content]);

  const handleRunMultiDeploy = async (): Promise<void> => {
    if (!activeTab || activeTab.kind !== 'code') return;
    const targetIds = Object.entries(multiDeployTargets)
      .filter(([, checked]) => checked)
      .map(([cid]) => cid);
    if (targetIds.length === 0) {
      showToast('Pilih minimal 1 server tujuan untuk Multi-Deploy.');
      return;
    }
    const prodConns = connections.filter(
      (c) => targetIds.includes(c.id) && c.isProduction
    );
    if (prodConns.length > 0) {
      const ok = window.confirm(
        `Anda akan mengunggah "${activeTab.relativePath}" ke ${targetIds.length} server, termasuk SERVER PRODUKSI:\n- ${prodConns
          .map((p) => `${p.name} (${p.host})`)
          .join('\n- ')}\n\nLanjutkan Multi-Deploy sekarang?`
      );
      if (!ok) return;
    }

    setMultiDeployBusy(true);
    try {
      const cleanRel = normalizeRemoteRelPath(activeTab.relativePath);
      const res = await window.aptana.connections.broadcastWriteFile(
        targetIds,
        cleanRel,
        activeTab.content
      );
      setMultiDeployOpen(false);
      if (res.failed.length === 0) {
        showToast(
          `Multi-Deploy selesai: "${cleanRel}" berhasil dikirim ke ${res.succeeded.length} server.`
        );
      } else {
        showToast(
          `Multi-Deploy selesai sebagian: ${res.succeeded.length} sukses, ${res.failed.length} gagal (${res.failed[0]?.error}).`
        );
      }
    } catch (err) {
      showToast(`Multi-Deploy gagal: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setMultiDeployBusy(false);
    }
  };

  const runInlineAiTransform = async (
    instructionText: string,
    previewDiffFirst: boolean
  ): Promise<void> => {
    if (!activeTab || activeTab.kind !== 'code') return;
    if (!instructionText.trim() || inlineBusy) return;
    if (!geminiConfig?.hasApiKey) {
      setActiveSidebar('ai');
      setGeminiSubTab('settings');
      showToast('Atur GEMINI_API_KEY Anda terlebih dahulu pada panel Gemini AI.');
      return;
    }

    setInlineBusy(true);
    try {
      const hasSelection =
        selectedEditorText.trim().length > 0 &&
        activeTab.content.includes(selectedEditorText);

      const res = await window.aptana.ai.inlineTransform({
        selectedCode: hasSelection ? selectedEditorText : '',
        fullFileContent: activeTab.content,
        instruction: instructionText.trim(),
        language: activeTab.language,
        fileName: activeTab.relativePath
      });

      const updatedFull = hasSelection
        ? activeTab.content.replace(selectedEditorText, res.transformedCode)
        : res.transformedCode;

      await applyAiCodeToTab(
        activeTab.id,
        updatedFull,
        `Inline AI: ${instructionText.slice(0, 36)}`,
        previewDiffFirst
      );
      setInlineAiBarOpen(false);
      setInlinePrompt('');
      showToast(`✨ ${res.explanation}`);
    } catch (err) {
      showToast(`Gagal menjalankan Edit AI: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setInlineBusy(false);
    }
  };

  const handleCancelFixPhpError = (): void => {
    fixErrorRunIdRef.current++;
    setFixingLintBusy(false);
    setFixingLintElapsed(0);
    showToast('Perbaikan error AI dibatalkan.');
  };

  const handleOneClickLocalFixPhpError = async (): Promise<void> => {
    if (
      !activeTab ||
      activeTab.kind !== 'code' ||
      activeDiagnostics.length === 0 ||
      fixingLocalBusy ||
      fixingLintBusy
    ) {
      return;
    }
    setFixingLocalBusy(true);
    try {
      const res = await window.aptana.php.autoFixLocal(activeTab.content);
      if (res.fixed && res.fixedCode && res.fixedCode !== activeTab.content) {
        await applyAiCodeToTab(
          activeTab.id,
          res.fixedCode,
          'Perbaikan Instan Lokal (Offline php -l)',
          true
        );
        showToast(
          `⚡ Diperbaiki offline (${res.durationMs} ms, lolos php -l): ${res.explanation}`
        );
      } else {
        showToast(res.explanation);
      }
    } catch (err) {
      showToast(
        `Perbaikan lokal gagal: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setFixingLocalBusy(false);
    }
  };

  const handleOneClickFixPhpError = async (): Promise<void> => {
    if (!activeTab || activeTab.kind !== 'code' || activeDiagnostics.length === 0 || fixingLintBusy) {
      return;
    }
    if (!geminiConfig?.hasApiKey) {
      setActiveSidebar('ai');
      setGeminiSubTab('settings');
      showToast('Atur GEMINI_API_KEY Anda terlebih dahulu untuk memperbaiki error otomatis.');
      return;
    }

    const runId = ++fixErrorRunIdRef.current;
    setFixingLintBusy(true);
    setFixingLintElapsed(0);
    const secTimer = window.setInterval(() => {
      setFixingLintElapsed((s) => s + 1);
    }, 1000);
    try {
      const errSummary = activeDiagnostics
        .map((d) => `Baris ${d.line}: ${d.message}`)
        .join('\n');
      const res = await window.aptana.ai.fixError({
        code: activeTab.content,
        errorText: errSummary,
        language: activeTab.language,
        fileName: activeTab.relativePath
      });
      if (fixErrorRunIdRef.current !== runId) {
        return;
      }
      await applyAiCodeToTab(
        activeTab.id,
        res.fixedCode,
        'Perbaikan Error Sintaks PHP',
        true
      );
      showToast(`✨ Perbaikan disiapkan: ${res.explanation}`);
    } catch (err) {
      if (fixErrorRunIdRef.current === runId) {
        showToast(`Gagal memperbaiki error: ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      window.clearInterval(secTimer);
      if (fixErrorRunIdRef.current === runId) {
        setFixingLintBusy(false);
        setFixingLintElapsed(0);
      }
    }
  };

  if (tabs.length === 0 || !activeTab) {
    return (
      <div className="editor-pane">
        <div className="welcome-screen">
          <div className="welcome-inner">
          <div style={{ textAlign: 'center', maxWidth: 660 }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
              <HmwLogo size={68} glow />
            </div>
            <h1 style={{ fontSize: 27, fontWeight: 800, letterSpacing: -0.4, marginBottom: 6 }}>
              HMW <span style={{ color: 'var(--accent)' }}>Studio</span>
            </h1>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.55, fontSize: 13 }}>
              IDE pengembangan web, PHP 8, Laravel &amp; Blade, kerangka kerja Wisanggeni, serta server remote modern. Mendukung penyimpanan dan pembukaan kembali proyek, pengeditan langsung di server SFTP/FTPS, Google Gemini AI Studio, serta Terminal ConPTY/SSH.
            </p>
            <div
              style={{
                marginTop: 10,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                flexWrap: 'wrap',
                fontSize: 11.5,
                color: 'var(--text-muted)'
              }}
            >
              <span>
                Developer: <strong style={{ color: 'var(--text-primary)' }}>Hermawan Wiryana</strong>
              </span>
              <span>•</span>
              <span>21 November 2026</span>
              <button
                type="button"
                className="btn btn-xs"
                style={{ padding: '2px 8px', fontSize: 11, color: '#38bdf8' }}
                onClick={() => setDocsModalOpen(true)}
                title="Buka Dokumentasi & Panduan Lengkap Fitur (F1)"
              >
                <BookOpen size={11.5} /> Dokumentasi Fitur (F1)
              </button>
            </div>
          </div>

          {/* Saved Projects Quick-Reopen Section */}
          <div style={{ width: '100%', maxWidth: 840 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 10
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 700 }}>
                <FolderKanban size={16} color="var(--accent)" />
                <span>Proyek Tersimpan ({projects.length})</span>
              </div>

              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn" onClick={() => setProjectModalOpen(true)}>
                  <Bookmark size={13} color="var(--accent)" />
                  <span>Simpan / Kelola Proyek</span>
                </button>
                <button className="btn" onClick={() => void openProjectFromFile()}>
                  <FileUp size={13} />
                  <span>Buka File .hmwproj</span>
                </button>
              </div>
            </div>

            {projects.length === 0 ? (
              <div
                style={{
                  padding: '12px 16px',
                  borderRadius: 10,
                  background: 'var(--bg-surface)',
                  border: '1px dashed var(--border-subtle)',
                  color: 'var(--text-muted)',
                  fontSize: 12.5
                }}
              >
                Belum ada proyek tersimpan. Buka folder lokal atau hubungkan ke server remote, lalu klik tombol{' '}
                <strong>Simpan Proyek</strong> di bilah atas agar proyek selalu siap dibuka kembali.
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                  gap: 10
                }}
              >
                {projects.slice(0, 6).map((proj) => {
                  const isCurrent = proj.id === activeProjectId;
                  const conn = connections.find((c) => c.id === proj.connectionId);
                  return (
                    <div
                      key={proj.id}
                      className="welcome-card"
                      style={{
                        padding: 13,
                        borderColor: isCurrent ? 'var(--accent)' : undefined
                      }}
                      onClick={() => void openSavedProject(proj.id)}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 6
                        }}
                      >
                        <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                          {proj.name}
                        </span>
                        {isCurrent && (
                          <span
                            className="badge-pill"
                            style={{ background: 'var(--accent)', color: '#fff' }}
                          >
                            AKTIF
                          </span>
                        )}
                      </div>

                      {proj.workspacePath && (
                        <div
                          style={{
                            fontSize: 11.5,
                            color: 'var(--text-secondary)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          <FolderOpen size={12} color="#38bdf8" />
                          <span>{proj.workspacePath}</span>
                        </div>
                      )}

                      {conn && (
                        <div
                          style={{
                            fontSize: 11.5,
                            color: 'var(--text-secondary)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5
                          }}
                        >
                          <Server size={12} color="var(--accent)" />
                          <span>
                            [{conn.protocol.toUpperCase()}] {conn.name}:/{proj.remoteSubPath}
                          </span>
                        </div>
                      )}

                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        Klik untuk membuka ({proj.openTabs?.length ?? 0} file tab tersimpan)
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="welcome-grid">
            <div className="welcome-card" onClick={() => void openWorkspaceFolder()}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#38bdf8', fontWeight: 700 }}>
                <FolderOpen size={17} />
                <span>Buka Folder Proyek Lokal</span>
              </div>
              <p style={{ color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.5 }}>
                Buka repositori aplikasi web Anda dan simpan sebagai Proyek HMW Studio agar siap dibuka kembali kapan saja.
              </p>
            </div>

            <div className="welcome-card" onClick={() => openConnectionModal(null)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#4ade80', fontWeight: 700 }}>
                <ArrowLeftRight size={17} />
                <span>Konfigurasi SFTP / FTPS Sync</span>
              </div>
              <p style={{ color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.5 }}>
                Hubungkan proyek ke server OpenSSH 9+ (Ed25519/SHA2), FTPS TLS 1.3, atau kelola file &amp; folder langsung di server.
              </p>
            </div>

            <div className="welcome-card" onClick={() => void createAndOpenDemoProject()}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--accent)', fontWeight: 700 }}>
                <Sparkles size={17} />
                <span>Buat Proyek Demo Modern</span>
              </div>
              <p style={{ color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.5 }}>
                Hasilkan proyek sampel lengkap (HTML5, CSS Grid, ES2025 JS, PHP 8 API) untuk menguji Editor &amp; Live Preview.
              </p>
            </div>

            <div className="welcome-card" onClick={() => setBottomPanel(true, 'terminal')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#fbbf24', fontWeight: 700 }}>
                <TerminalSquare size={17} />
                <span>Terminal Lokal &amp; SSH</span>
              </div>
              <p style={{ color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.5 }}>
                Jalankan PowerShell, CMD, Git Bash, WSL, atau buka sesi konsol SSH langsung ke server deployment proyek.
              </p>
            </div>
          </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="editor-pane">
      {/* ROW 1: Dedicated Full-Width Open File Tabs Bar (Never Covered by Action Buttons!) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'stretch',
          background: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border-subtle)',
          minHeight: 36,
          position: 'relative'
        }}
      >
        <div
          ref={tabsStripRef}
          className="tabs-strip"
          style={{ flex: 1, borderBottom: 'none', minWidth: 0 }}
          onWheel={(e) => {
            if (tabsStripRef.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
              tabsStripRef.current.scrollLeft += e.deltaY;
            }
          }}
        >
          {tabs.map((tab) => {
            const isDirty = tab.content !== tab.savedContent;
            const isActive = tab.id === activeTab.id;
            const cleanBaseName =
              tab.kind === 'diff'
                ? tab.title
                : tab.relativePath.split(/[/\\]/).pop() ||
                  tab.title.replace(/^\[[^\]]+\]\s*/, '');
            const relParts = tab.relativePath.replace(/\\/g, '/').split('/').filter(Boolean);
            const parentDirHint =
              relParts.length > 1 && duplicateBaseNames.has(cleanBaseName.toLowerCase())
                ? relParts[relParts.length - 2]
                : null;

            return (
              <div
                key={tab.id}
                data-editor-tab-id={tab.id}
                className={`editor-tab ${isActive ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
                onAuxClick={(e) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    closeTab(tab.id);
                  }
                }}
                title={
                  tab.remoteConnectionName
                    ? `Remote [${tab.remoteConnectionName}]: /${normalizeRemoteRelPath(tab.relativePath)} (Klik tengah untuk tutup)`
                    : `${tab.relativePath} (Klik tengah untuk tutup)`
                }
              >
                {tab.kind === 'diff' ? (
                  <GitCompare size={13} color="var(--accent)" style={{ flexShrink: 0 }} />
                ) : tab.remoteConnectionId ? (
                  <Cloud size={13} color="#38bdf8" style={{ flexShrink: 0 }} />
                ) : null}

                <span
                  style={{
                    fontWeight: isActive ? 600 : 500,
                    color: isActive ? 'var(--text-primary)' : undefined
                  }}
                >
                  {cleanBaseName}
                </span>

                {parentDirHint && (
                  <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                    ({parentDirHint})
                  </span>
                )}

                {tab.remoteConnectionName && tab.kind !== 'diff' && (
                  <span
                    style={{
                      fontSize: 9.5,
                      padding: '1px 5px',
                      borderRadius: 4,
                      background: 'rgba(56, 189, 248, 0.12)',
                      color: '#7dd3fc',
                      fontWeight: 600
                    }}
                  >
                    {tab.remoteConnectionName}
                  </span>
                )}

                {isDirty && <span className="dirty-dot" title="Belum disimpan (Ctrl+S)" />}
                {isActive && isDirty && (
                  <button
                    className="btn-ghost"
                    style={{ border: 'none', padding: 2 }}
                    title="Simpan File (Ctrl+S)"
                    onClick={(e) => {
                      e.stopPropagation();
                      void saveTab(tab.id);
                    }}
                  >
                    <Save size={12} />
                  </button>
                )}
                <button
                  className="btn-ghost"
                  style={{ border: 'none', padding: 2 }}
                  title="Tutup Tab"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                >
                  <X size={13} />
                </button>
              </div>
            );
          })}
        </div>

        {/* Compact Right End of Tab Row: Scroll Arrows + All Open Tabs Dropdown + Split */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            padding: '0 6px',
            borderLeft: '1px solid var(--border-subtle)',
            background: 'var(--bg-surface)',
            flexShrink: 0,
            position: 'relative'
          }}
        >
          {tabs.length > 3 && (
            <>
              <button
                type="button"
                className="icon-btn"
                style={{ padding: 3 }}
                title="Geser daftar tab ke kiri"
                onClick={() => {
                  if (tabsStripRef.current) tabsStripRef.current.scrollLeft -= 220;
                }}
              >
                <ChevronLeft size={13} />
              </button>
              <button
                type="button"
                className="icon-btn"
                style={{ padding: 3 }}
                title="Geser daftar tab ke kanan"
                onClick={() => {
                  if (tabsStripRef.current) tabsStripRef.current.scrollLeft += 220;
                }}
              >
                <ChevronRight size={13} />
              </button>
            </>
          )}

          <button
            type="button"
            className="btn-ghost"
            style={{
              padding: '3px 7px',
              fontSize: 11,
              color: allTabsMenuOpen ? 'var(--accent)' : undefined
            }}
            title="Lihat daftar seluruh tab file yang sedang terbuka"
            onClick={() => setAllTabsMenuOpen((v) => !v)}
          >
            <span>{tabs.length} Tab</span>
            <ChevronDown size={12} />
          </button>

          <button
            type="button"
            className="btn-ghost"
            style={{
              padding: '3px 7px',
              fontSize: 11,
              color: splitEditorOpen ? 'var(--accent)' : undefined,
              borderColor: splitEditorOpen ? 'var(--accent)' : undefined
            }}
            title="Split Editor Berdampingan Kiri & Kanan (Ctrl+\)"
            onClick={() => toggleSplitEditor()}
          >
            <Columns2 size={13} />
            <span>Split</span>
          </button>

          {allTabsMenuOpen && (
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 4px)',
                right: 6,
                width: 'min(390px, 90vw)',
                maxHeight: 360,
                overflowY: 'auto',
                padding: 8,
                borderRadius: 8,
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-strong)',
                boxShadow: '0 14px 32px rgba(0, 0, 0, 0.55)',
                zIndex: 1250,
                display: 'flex',
                flexDirection: 'column',
                gap: 4
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '2px 4px 6px',
                  borderBottom: '1px solid var(--border-subtle)',
                  fontSize: 11.5
                }}
              >
                <strong>Daftar Tab Terbuka ({tabs.length})</strong>
                <div style={{ display: 'flex', gap: 4 }}>
                  {tabs.length > 1 && (
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: '2px 6px', fontSize: 10 }}
                      onClick={() => {
                        for (const t of tabs) {
                          if (t.id !== activeTab.id && t.content === t.savedContent) {
                            closeTab(t.id);
                          }
                        }
                        setAllTabsMenuOpen(false);
                      }}
                      title="Tutup semua tab lain yang sudah tersimpan"
                    >
                      Tutup Lainnya
                    </button>
                  )}
                  <button
                    type="button"
                    className="icon-btn"
                    style={{ padding: 2 }}
                    onClick={() => setAllTabsMenuOpen(false)}
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>

              {tabs.map((t) => {
                const dirty = t.content !== t.savedContent;
                const active = t.id === activeTab.id;
                const cleanName =
                  t.kind === 'diff'
                    ? t.title
                    : t.relativePath.split(/[/\\]/).pop() ||
                      t.title.replace(/^\[[^\]]+\]\s*/, '');
                return (
                  <div
                    key={t.id}
                    onClick={() => {
                      setActiveTab(t.id);
                      setAllTabsMenuOpen(false);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      padding: '5px 8px',
                      borderRadius: 6,
                      cursor: 'pointer',
                      background: active ? 'var(--accent-soft)' : 'transparent',
                      border: active
                        ? '1px solid rgba(249, 115, 22, 0.35)'
                        : '1px solid transparent'
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          fontSize: 12,
                          fontWeight: active ? 700 : 500,
                          color: 'var(--text-primary)'
                        }}
                      >
                        {t.remoteConnectionId ? (
                          <Cloud size={12} color="#38bdf8" style={{ flexShrink: 0 }} />
                        ) : null}
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {cleanName}
                        </span>
                        {dirty && <span className="dirty-dot" />}
                      </div>
                      <div
                        style={{
                          fontSize: 10.5,
                          color: 'var(--text-muted)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {t.remoteConnectionName ? `[${t.remoteConnectionName}] ` : ''}
                        {t.relativePath}
                      </div>
                    </div>

                    <button
                      type="button"
                      className="icon-btn"
                      style={{ padding: 3 }}
                      title="Tutup tab ini"
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(t.id);
                      }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Production Server Live Edit Guardrail Banner */}
      {activeTab.kind === 'code' && activeRemoteConn?.isProduction && (
        <div
          style={{
            padding: '5px 12px',
            background: 'rgba(220, 38, 38, 0.18)',
            borderBottom: '1px solid rgba(239, 68, 68, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            fontSize: 11.5,
            color: '#fecaca'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 700 }}>
            <ShieldAlert size={14} color="#f87171" />
            <span>
              🔴 SERVER PRODUKSI LIVE ({activeRemoteConn.name} • {activeRemoteConn.host}) — Menekan
              Ctrl+S akan langsung mengubah file aktif di server produksi!
            </span>
          </div>
          <button
            type="button"
            className="btn"
            style={{ padding: '2px 8px', fontSize: 10.5 }}
            onClick={() => void compareTabWithCounterpart(activeTab.id)}
          >
            Bandingkan Diff Dulu
          </button>
        </div>
      )}

      {/* ROW 2: Slim Unified File Path / Modul (Alt+O) & Editor Action Toolbar (Wraps Cleanly, Never Covers Tabs!) */}
      <div
        style={{
          padding: '4px 10px',
          background: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '4px 10px',
          flexWrap: 'wrap',
          fontSize: 11,
          position: 'relative'
        }}
      >
        {/* Left: Breadcrumb Path + Module Companion Switcher (Alt+O) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
          <span
            style={{
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
              fontSize: 10.5,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 360,
              cursor: 'pointer'
            }}
            title="Klik untuk menyalin path file aktif"
            onClick={() => {
              void navigator.clipboard?.writeText(activeTab.relativePath);
              showToast(`Path disalin: ${activeTab.relativePath}`);
            }}
          >
            {activeTab.remoteConnectionName ? `☁️ ${activeTab.remoteConnectionName}: ` : '📄 '}
            {activeTab.relativePath}
          </span>

          {activeTab.kind === 'code' && moduleCompanions.length > 1 && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>• ⇄ Modul:</span>
              {moduleCompanions.map((comp) => (
                <button
                  key={`${comp.source}:${comp.connectionId ?? 'loc'}:${comp.relativePath}`}
                  type="button"
                  className={comp.isCurrent ? 'btn btn-primary' : 'btn'}
                  style={{ padding: '1px 6px', fontSize: 10.5 }}
                  title={`${comp.relativePath} (Alt+O)`}
                  onClick={() => {
                    if (comp.isCurrent) return;
                    if (comp.source === 'remote' && comp.connectionId) {
                      void openRemoteFileInTab(comp.connectionId, comp.relativePath);
                    } else if (comp.localPath) {
                      void openFileInTab(comp.localPath, comp.relativePath);
                    }
                  }}
                >
                  {comp.roleLabel}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right: Ultra-Clean Primary Actions + Collapsible Tools Dropdown */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 3,
            flexWrap: 'wrap'
          }}
        >
          <button
            className={activeTab.content !== activeTab.savedContent ? 'btn btn-accent' : 'btn-ghost'}
            style={{ padding: '3px 7px', fontSize: 11 }}
            title="Simpan File Aktif (Ctrl+S)"
            onClick={() => void saveTab(activeTab.id)}
          >
            <Save size={12.5} />
            <span>Simpan</span>
          </button>

          {activeTab.kind === 'code' && (
            <button
              className="btn-ghost"
              style={{
                padding: '3px 7px',
                fontSize: 11,
                color: inlineAiBarOpen ? '#a855f7' : undefined,
                borderColor: inlineAiBarOpen ? '#a855f7' : undefined
              }}
              title="Inline Edit & Refactor dengan Gemini AI (Ctrl+I)"
              onClick={() => setInlineAiBarOpen(!inlineAiBarOpen)}
            >
              <Sparkles size={12.5} color="#a855f7" />
              <span>Edit AI</span>
            </button>
          )}

          {activeTab.kind === 'code' &&
            (selectedConnectionId || activeTab.remoteConnectionId || workspacePath) && (
              <button
                className="btn-ghost"
                style={{ padding: '3px 7px', fontSize: 11 }}
                title="1-Klik Bandingkan File Lokal ↔ Server Remote SFTP (Ctrl+Alt+D)"
                onClick={() => void compareTabWithCounterpart(activeTab.id)}
              >
                <ArrowLeftRight size={12.5} color="#38bdf8" />
                <span>Diff Server</span>
              </button>
            )}

          <button
            className="btn-ghost"
            style={{ padding: '3px 7px', fontSize: 11 }}
            title="Rapikan / Format Kode (Shift+Alt+F)"
            onClick={() => formatTabContent()}
          >
            <Wand2 size={12.5} color="var(--accent)" />
            <span>Rapikan</span>
          </button>

          {phpFileDeps && (
            <button
              type="button"
              className="btn-ghost"
              style={{
                padding: '3px 7px',
                fontSize: 11,
                borderColor: depsPopoverOpen ? 'var(--accent)' : undefined
              }}
              onClick={() => {
                setEditorToolsMenuOpen(false);
                setMultiDeployOpen(false);
                setDepsPopoverOpen((v) => !v);
              }}
              title="Lihat peta file include, tabel DB yang dibaca/diubah, fungsi, & input superglobal file PHP ini"
            >
              <Compass size={12} color="#38bdf8" />
              <span>
                Alur (
                {phpFileDeps.includes.length +
                  phpFileDeps.readTables.length +
                  phpFileDeps.writeTables.length}
                )
              </span>
            </button>
          )}

          {/* Grouped Secondary Editor Tools Dropdown */}
          {(() => {
            const isTabPinned =
              activeTab.kind === 'code' &&
              pinnedFiles.some(
                (p) =>
                  p.key ===
                  (activeTab.remoteConnectionId
                    ? `remote:${activeTab.remoteConnectionId}:${normalizeRemoteRelPath(activeTab.relativePath)}`
                    : `local:${activeTab.filePath}`)
              );
            return (
              <div style={{ position: 'relative' }}>
                <button
                  type="button"
                  className={editorToolsMenuOpen || multiDeployOpen ? 'btn btn-accent' : 'btn-ghost'}
                  style={{ padding: '3px 7px', fontSize: 11 }}
                  title="Alat Editor Lainnya (Uji HTTP, Tinker, Multi-Deploy, Pin, Rename, Outline, Riwayat)"
                  onClick={() => {
                    setDepsPopoverOpen(false);
                    if (multiDeployOpen) {
                      setMultiDeployOpen(false);
                      return;
                    }
                    setEditorToolsMenuOpen((v) => !v);
                  }}
                >
                  <MoreHorizontal size={13} />
                  <span>Alat</span>
                  {isTabPinned && (
                    <Star size={10} fill="#fbbf24" color="#fbbf24" />
                  )}
                  <ChevronDown size={11} />
                </button>

                {editorToolsMenuOpen && (
                  <div className="menu-dropdown">
                    {activeTab.kind === 'code' && activeTab.language === 'php' && (
                      <>
                        <button
                          type="button"
                          className="menu-dropdown-item"
                          onClick={() => {
                            setEditorToolsMenuOpen(false);
                            sendTabToHttpTester(activeTab.id);
                          }}
                        >
                          <FlaskConical size={14} color="#34d399" />
                          <span>Uji Endpoint di HTTP Tester</span>
                        </button>
                        <button
                          type="button"
                          className="menu-dropdown-item"
                          onClick={() => {
                            setEditorToolsMenuOpen(false);
                            openPhpScratchpad(selectedEditorText);
                          }}
                        >
                          <Zap size={14} color="#fbbf24" />
                          <span>PHP Tinker / Scratchpad</span>
                        </button>
                      </>
                    )}

                    {activeTab.kind === 'code' && connections.length > 0 && (
                      <button
                        type="button"
                        className="menu-dropdown-item"
                        onClick={() => {
                          setEditorToolsMenuOpen(false);
                          if (Object.keys(multiDeployTargets).length === 0) {
                            const init: Record<string, boolean> = {};
                            for (const c of connections) {
                              init[c.id] =
                                c.id === activeTab.remoteConnectionId || c.id === selectedConnectionId;
                            }
                            setMultiDeployTargets(init);
                          }
                          setMultiDeployOpen(true);
                        }}
                      >
                        <Radio size={14} color="#38bdf8" />
                        <span>Multi-Server Broadcast Deploy</span>
                      </button>
                    )}

                    {activeTab.kind === 'code' && (
                      <>
                        <button
                          type="button"
                          className="menu-dropdown-item"
                          style={{ color: isTabPinned ? '#fbbf24' : undefined }}
                          onClick={() => {
                            setEditorToolsMenuOpen(false);
                            togglePinActiveTab(activeTab.id);
                          }}
                        >
                          <Star size={14} fill={isTabPinned ? '#fbbf24' : 'none'} color={isTabPinned ? '#fbbf24' : 'var(--text-secondary)'} />
                          <span>{isTabPinned ? 'Lepas Pin Favorit' : 'Pin File ke Favorit'}</span>
                        </button>
                        <button
                          type="button"
                          className="menu-dropdown-item"
                          onClick={() => {
                            setEditorToolsMenuOpen(false);
                            openSmartRefactor({
                              mode: 'rename',
                              initialSymbol: selectedEditorText.trim().split(/\s+/)[0] || '',
                              tabId: activeTab.id
                            });
                          }}
                        >
                          <Pencil size={14} color="#38bdf8" />
                          <span>Smart Rename Simbol</span>
                          <span className="menu-dropdown-kbd">Alt+R</span>
                        </button>
                      </>
                    )}

                    <div className="menu-dropdown-sep" />

                    <button
                      type="button"
                      className="menu-dropdown-item"
                      onClick={() => {
                        setEditorToolsMenuOpen(false);
                        setActiveSidebar('outline');
                      }}
                    >
                      <ListTree size={14} color="var(--text-secondary)" />
                      <span>Buka Code Outline</span>
                    </button>
                    <button
                      type="button"
                      className="menu-dropdown-item"
                      onClick={() => {
                        setEditorToolsMenuOpen(false);
                        setActiveSidebar('history');
                      }}
                    >
                      <History size={14} color="var(--text-secondary)" />
                      <span>Riwayat Backup / Rollback</span>
                    </button>
                  </div>
                )}

                {multiDeployOpen && activeTab.kind === 'code' && connections.length > 0 && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 'calc(100% + 6px)',
                      right: 0,
                      width: 300,
                      padding: 10,
                      borderRadius: 8,
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-strong)',
                      boxShadow: '0 12px 28px rgba(0,0,0,0.55)',
                      zIndex: 1200,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 700 }}>
                      📡 Multi-Server Broadcast Deploy
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      Path tujuan: <code>/{normalizeRemoteRelPath(activeTab.relativePath)}</code>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 5,
                        maxHeight: 180,
                        overflowY: 'auto'
                      }}
                    >
                      {connections.map((c) => (
                        <label
                          key={c.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 7,
                            fontSize: 11.5,
                            padding: '4px 6px',
                            borderRadius: 5,
                            background: 'var(--bg-surface)',
                            cursor: 'pointer'
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={Boolean(multiDeployTargets[c.id])}
                            onChange={(e) =>
                              setMultiDeployTargets((prev) => ({
                                ...prev,
                                [c.id]: e.target.checked
                              }))
                            }
                          />
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {c.name}{' '}
                            <span style={{ color: 'var(--text-muted)' }}>
                              ({c.protocol.toUpperCase()})
                            </span>
                          </span>
                          {c.isProduction && (
                            <span
                              style={{
                                fontSize: 9.5,
                                fontWeight: 800,
                                padding: '1px 5px',
                                borderRadius: 4,
                                background: 'rgba(239, 68, 68, 0.2)',
                                color: '#fca5a5'
                              }}
                            >
                              PROD
                            </span>
                          )}
                        </label>
                      ))}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                      <button
                        type="button"
                        className="btn"
                        style={{ fontSize: 11, padding: '3px 8px' }}
                        onClick={() => setMultiDeployOpen(false)}
                      >
                        Tutup
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary"
                        style={{ fontSize: 11, padding: '3px 10px' }}
                        disabled={multiDeployBusy}
                        onClick={() => void handleRunMultiDeploy()}
                      >
                        {multiDeployBusy ? 'Mengirim...' : 'Deploy Sekarang'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        {depsPopoverOpen && phpFileDeps && (
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              right: 12,
              width: 'min(480px, 92vw)',
              maxHeight: 340,
              overflowY: 'auto',
              padding: 12,
              borderRadius: 8,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-strong)',
              boxShadow: '0 12px 30px rgba(0,0,0,0.55)',
              zIndex: 1150,
              display: 'flex',
              flexDirection: 'column',
              gap: 9
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: 12 }}>🧭 Peta Alur &amp; Ketergantungan File PHP</strong>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setDepsPopoverOpen(false)}
              >
                <X size={13} />
              </button>
            </div>

            <div>
              <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginBottom: 4 }}>
                File Include / Require ({phpFileDeps.includes.length}):
              </div>
              {phpFileDeps.includes.length === 0 ? (
                <span style={{ color: 'var(--text-muted)' }}>Tidak ada</span>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {phpFileDeps.includes.map((inc) => (
                    <button
                      key={inc}
                      type="button"
                      className="btn"
                      style={{ padding: '2px 6px', fontSize: 10.5, fontFamily: 'var(--font-mono)' }}
                      onClick={() => {
                        setDepsPopoverOpen(false);
                        void navigatePhpDefinition(
                          activeTab.id,
                          `include '${inc}';`,
                          10,
                          null
                        );
                      }}
                    >
                      {inc}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginBottom: 4 }}>
                Tabel Database (Klik untuk lacak semua pemakaian):
              </div>
              {phpFileDeps.readTables.length === 0 && phpFileDeps.writeTables.length === 0 ? (
                <span style={{ color: 'var(--text-muted)' }}>Tidak terdeteksi query tabel</span>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {phpFileDeps.writeTables.map((t) => (
                    <button
                      key={`w-${t}`}
                      type="button"
                      className="btn"
                      style={{
                        padding: '2px 6px',
                        fontSize: 10.5,
                        fontFamily: 'var(--font-mono)',
                        color: '#fcd34d',
                        borderColor: 'rgba(245, 158, 11, 0.45)'
                      }}
                      onClick={() => {
                        setDepsPopoverOpen(false);
                        findReferencesForSymbol(t.split('.').pop() || t);
                      }}
                    >
                      ✏️ TULIS: {t}
                    </button>
                  ))}
                  {phpFileDeps.readTables.map((t) => (
                    <button
                      key={`r-${t}`}
                      type="button"
                      className="btn"
                      style={{
                        padding: '2px 6px',
                        fontSize: 10.5,
                        fontFamily: 'var(--font-mono)',
                        color: '#7dd3fc'
                      }}
                      onClick={() => {
                        setDepsPopoverOpen(false);
                        findReferencesForSymbol(t.split('.').pop() || t);
                      }}
                    >
                      📖 BACA: {t}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {phpFileDeps.inputsUsed.length > 0 && (
              <div>
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginBottom: 4 }}>
                  Input HTTP / Session ({phpFileDeps.inputsUsed.length}):
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {phpFileDeps.inputsUsed.map((inp) => (
                    <code
                      key={inp}
                      style={{
                        padding: '1px 6px',
                        borderRadius: 4,
                        background: 'var(--bg-surface)',
                        fontSize: 10.5
                      }}
                    >
                      {inp}
                    </code>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* #3 Inline Gemini AI Edit & Refactor Bar (Ctrl+I) */}
      {inlineAiBarOpen && activeTab.kind === 'code' && (
        <div
          style={{
            padding: '8px 12px',
            background: 'var(--bg-elevated)',
            borderBottom: '1px solid #a855f7',
            display: 'flex',
            flexDirection: 'column',
            gap: 6
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: 11.5
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <Sparkles size={14} color="#a855f7" />
              <strong style={{ color: 'var(--text-primary)' }}>
                Gemini Inline Refactor (Ctrl+I)
              </strong>
              <span style={{ color: 'var(--text-muted)' }}>
                • Target:{' '}
                {selectedEditorText.trim()
                  ? `Blok kode dipilih (${selectedEditorText.split('\n').length} baris)`
                  : `Seluruh file (${activeTab.title})`}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {[
                'Ubah SQL ke $query->setParam() aman',
                'Kompatibelkan ke PHP 8.2+',
                'Konversi tabel HTML ke TTabel Wisanggeni',
                'Tambahkan encid() & decid() pada parameter ID'
              ].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className="btn"
                  style={{ padding: '2px 7px', fontSize: 10.5 }}
                  disabled={inlineBusy}
                  onClick={() => setInlinePrompt(preset)}
                >
                  {preset}
                </button>
              ))}
              <button
                type="button"
                className="btn-ghost"
                style={{ padding: '2px 5px' }}
                onClick={() => setInlineAiBarOpen(false)}
              >
                <X size={13} />
              </button>
            </div>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void runInlineAiTransform(inlinePrompt, true);
            }}
            style={{ display: 'flex', gap: 6 }}
          >
            <input
              autoFocus
              disabled={inlineBusy}
              value={inlinePrompt}
              onChange={(e) => setInlinePrompt(e.target.value)}
              placeholder="Instruksikan perubahan kode (contoh: ubah query raw menjadi $query->setParam dan tambahkan htmlspecialchars)..."
              style={{ flex: 1 }}
            />
            <button
              type="submit"
              className="btn"
              disabled={inlineBusy || !inlinePrompt.trim()}
              title="Tinjau perubahan berdampingan sebelum diterapkan"
            >
              <GitCompare size={13} color="#38bdf8" />
              <span>{inlineBusy ? 'Memproses...' : 'Preview Diff'}</span>
            </button>
            <button
              type="button"
              className="btn btn-accent"
              disabled={inlineBusy || !inlinePrompt.trim()}
              onClick={() => void runInlineAiTransform(inlinePrompt, false)}
              title="Langsung terapkan perubahan ke editor (backup tersimpan otomatis)"
            >
              <Sparkles size={13} />
              <span>Terapkan Langsung</span>
            </button>
          </form>
        </div>
      )}

      {/* #4 One-Click Fix PHP Syntax Error Banner */}
      {activeDiagnostics.length > 0 && activeTab.kind === 'code' && (
        <div
          style={{
            padding: '6px 12px',
            background: 'rgba(239, 68, 68, 0.12)',
            borderBottom: '1px solid rgba(239, 68, 68, 0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            fontSize: 11.5
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              color: '#fca5a5',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              cursor: 'pointer'
            }}
            title="Klik untuk langsung melompat ke baris error di editor"
            onClick={() => jumpToTabLine(activeTab.id, activeDiagnostics[0].line)}
          >
            <AlertTriangle size={14} color="#ef4444" style={{ flexShrink: 0 }} />
            <span>
              <strong>Baris {activeDiagnostics[0].line}:</strong> {activeDiagnostics[0].message}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <button
              type="button"
              className="btn"
              disabled={fixingLocalBusy || fixingLintBusy}
              style={{
                padding: '3px 9px',
                fontSize: 11,
                fontWeight: 700,
                color: '#6ee7b7',
                borderColor: 'rgba(16, 185, 129, 0.55)',
                background: 'rgba(16, 185, 129, 0.16)'
              }}
              onClick={() => void handleOneClickLocalFixPhpError()}
              title="Perbaiki error sintaks PHP secara instan 100% OFFLINE tanpa Gemini AI (terverifikasi langsung oleh php -l)"
            >
              <Zap size={12} color="#34d399" />
              <span>
                {fixingLocalBusy ? 'Memperbaiki Lokal...' : 'Perbaiki Instan (Lokal)'}
              </span>
            </button>
            <button
              type="button"
              className="btn btn-accent"
              disabled={fixingLintBusy || fixingLocalBusy}
              style={{ padding: '3px 9px', fontSize: 11 }}
              onClick={() => void handleOneClickFixPhpError()}
              title="Perbaiki menggunakan Google Gemini AI (mode patch cepat untuk kasus kompleks)"
            >
              <Sparkles size={12} />
              <span>
                {fixingLintBusy
                  ? `Gemini... (${fixingLintElapsed}d)`
                  : 'Gemini AI'}
              </span>
            </button>
            {fixingLintBusy && (
              <button
                type="button"
                className="btn"
                style={{ padding: '3px 8px', fontSize: 11, color: '#fca5a5' }}
                onClick={handleCancelFixPhpError}
                title="Batalkan proses perbaikan AI"
              >
                <X size={12} /> Batal
              </button>
            )}
          </div>
        </div>
      )}

      {/* Main Editor Workspace: Single or Side-by-Side Split */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, minWidth: 0 }}>
        {/* Left / Primary Pane */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            minHeight: 0,
            borderRight: splitEditorOpen ? '2px solid var(--border-strong)' : undefined
          }}
        >
          {activeTab.kind === 'diff' ? (
            <MonacoDiffEditorView tab={activeTab} />
          ) : (
            <MonacoCodeEditorView tab={activeTab} pane="primary" />
          )}
        </div>

        {/* Right / Secondary Split Pane */}
        {splitEditorOpen && secondaryTab && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              minWidth: 0,
              minHeight: 0
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 6,
                padding: '4px 8px',
                background: 'var(--bg-elevated)',
                borderBottom:
                  focusedPane === 'secondary'
                    ? '1px solid var(--accent)'
                    : '1px solid var(--border-subtle)',
                fontSize: 11.5
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
                <Columns2 size={13} color="#38bdf8" />
                <select
                  value={secondaryTab.id}
                  onChange={(e) => setSecondaryTab(e.target.value)}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    padding: '2px 6px',
                    fontSize: 11.5,
                    background: 'var(--bg-surface)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 5
                  }}
                  title="Pilih file yang ditampilkan di panel Split Kanan"
                >
                  {tabs.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title} {t.content !== t.savedContent ? '●' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {secondaryTab.content !== secondaryTab.savedContent && (
                  <button
                    className="btn btn-accent"
                    style={{ padding: '2px 7px', fontSize: 11 }}
                    title="Simpan Panel Kanan (Ctrl+S)"
                    onClick={() => void saveTab(secondaryTab.id)}
                  >
                    <Save size={11} />
                    <span>Simpan</span>
                  </button>
                )}
                {secondaryTab.kind === 'code' && (
                  <button
                    className="btn-ghost"
                    style={{ padding: '2px 5px' }}
                    title="Rapikan Kode Panel Kanan"
                    onClick={() => formatTabContent(secondaryTab.id)}
                  >
                    <Wand2 size={12} />
                  </button>
                )}
                <button
                  className="btn-ghost"
                  style={{ padding: '2px 5px' }}
                  title="Tutup Split Editor"
                  onClick={() => closeSplitEditor()}
                >
                  <X size={13} />
                </button>
              </div>
            </div>

            {secondaryTab.kind === 'diff' ? (
              <MonacoDiffEditorView tab={secondaryTab} />
            ) : (
              <MonacoCodeEditorView tab={secondaryTab} pane="secondary" />
            )}
          </div>
        )}
      </div>
    </div>
  );
};
