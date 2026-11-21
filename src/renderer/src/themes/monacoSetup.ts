import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker';
import { emmetHTML, emmetCSS, emmetJSX } from 'emmet-monaco-es';
import type { RubleBundle, ThemeId } from '@shared/types';
import { detectLanguageFromPathAndContent } from '@shared/webAssetAnalyzer';
import { formatCodeByLanguage } from '../languages/codeFormatter';
import { registerPhpIntelliSense } from '../languages/phpIntelliSense';
import { registerWebIntelliSense } from '../languages/webIntelliSense';

// Wire bundled Vite Web Workers so JavaScript/TypeScript, CSS/SCSS/LESS, HTML, & JSON language servers
// run reliably in both dev and packaged Electron `file://` (`app.asar`) builds!
if (typeof globalThis !== 'undefined' && !globalThis.MonacoEnvironment) {
  globalThis.MonacoEnvironment = {
    getWorker(_moduleId: string, label: string): Worker {
      if (label === 'json') {
        return new JsonWorker();
      }
      if (label === 'css' || label === 'scss' || label === 'less') {
        return new CssWorker();
      }
      if (label === 'html' || label === 'handlebars' || label === 'razor') {
        return new HtmlWorker();
      }
      if (label === 'typescript' || label === 'javascript') {
        return new TsWorker();
      }
      return new EditorWorker();
    }
  };
}

let initialized = false;
let snippetDisposables: monaco.IDisposable[] = [];
let ghostTextEnabledFlag = false;

export type EditorSuggestMode = 'calm' | 'manual' | 'full';

export function getMonacoSuggestOptions(
  mode: EditorSuggestMode,
  editorKind: 'code' | 'sql' = 'code'
): monaco.editor.IEditorOptions {
  if (mode === 'manual') {
    return {
      suggestOnTriggerCharacters: false,
      quickSuggestions: false,
      acceptSuggestionOnEnter: 'off',
      acceptSuggestionOnCommitCharacter: false,
      tabCompletion: 'off',
      parameterHints: { enabled: false },
      inlineSuggest: { enabled: false },
      suggest: {
        showWords: false,
        preview: false,
        snippetsPreventQuickSuggestions: true
      }
    };
  }

  if (mode === 'full') {
    return {
      suggestOnTriggerCharacters: true,
      quickSuggestions: {
        other: 'on',
        comments: 'off',
        strings: 'on'
      },
      quickSuggestionsDelay: 120,
      acceptSuggestionOnEnter: 'smart',
      acceptSuggestionOnCommitCharacter: false,
      tabCompletion: 'on',
      suggestSelection: 'recentlyUsedByPrefix',
      parameterHints: { enabled: true, cycle: false },
      inlineSuggest: { enabled: editorKind === 'code' },
      suggest: {
        showWords: editorKind !== 'sql',
        preview: false,
        snippetsPreventQuickSuggestions: true,
        filterGraceful: true
      }
    };
  }

  // Default: 'calm' (Santai — tidak mengganggu mengetik; Enter selalu baris baru, Tab / Klik terima saran)
  return {
    suggestOnTriggerCharacters: true,
    quickSuggestions: {
      other: 'on',
      comments: 'off',
      strings: 'off'
    },
    quickSuggestionsDelay: 320,
    acceptSuggestionOnEnter: 'off',
    acceptSuggestionOnCommitCharacter: false,
    tabCompletion: 'on',
    suggestSelection: 'recentlyUsedByPrefix',
    parameterHints: { enabled: true, cycle: false },
    inlineSuggest: { enabled: editorKind === 'code' },
    suggest: {
      showWords: editorKind !== 'sql',
      preview: false,
      snippetsPreventQuickSuggestions: true,
      filterGraceful: true
    }
  };
}

export function setGhostTextEnabledFlag(enabled: boolean): void {
  ghostTextEnabledFlag = enabled;
}

export function ensureMonacoInitialized(): void {
  if (initialized) return;
  initialized = true;

  monaco.editor.defineTheme('aptana-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6C7A91', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'F97316', fontStyle: 'bold' },
      { token: 'string', foreground: '4ADE80' },
      { token: 'number', foreground: 'FBBF24' },
      { token: 'type', foreground: '38BDF8' },
      { token: 'tag', foreground: 'FB923C' },
      { token: 'attribute.name', foreground: 'FACC15' },
      { token: 'attribute.value', foreground: '4ADE80' },
      { token: 'variable', foreground: '7DD3FC' },
      { token: 'variable.predefined', foreground: 'FACC15', fontStyle: 'bold' },
      { token: 'delimiter', foreground: '94A3B8' }
    ],
    colors: {
      'editor.background': '#14171F',
      'editor.foreground': '#EEF2F7',
      'editorLineNumber.foreground': '#4B5568',
      'editorLineNumber.activeForeground': '#F97316',
      'editor.selectionBackground': '#F9731633',
      'editor.lineHighlightBackground': '#1E243380',
      'editorCursor.foreground': '#F97316',
      'editorIndentGuide.background1': '#242B3D'
    }
  });

  monaco.editor.defineTheme('modern-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#11131A',
      'editorCursor.foreground': '#38BDF8'
    }
  });

  monaco.editor.defineTheme('modern-light', {
    base: 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#FFFFFF',
      'editorCursor.foreground': '#EA580C'
    }
  });

  // Enable full TypeScript / ESNext + DOM + JSX IntelliSense & Diagnostics
  monaco.typescript.typescriptDefaults.setEagerModelSync(true);
  monaco.typescript.typescriptDefaults.setCompilerOptions({
    target: monaco.typescript.ScriptTarget.ESNext,
    module: monaco.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.typescript.ModuleResolutionKind.NodeJs,
    jsx: monaco.typescript.JsxEmit.ReactJSX,
    lib: ['esnext', 'dom', 'dom.iterable'],
    allowNonTsExtensions: true,
    allowJs: true,
    strict: true
  });

  monaco.typescript.javascriptDefaults.setEagerModelSync(true);
  monaco.typescript.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false
  });
  monaco.typescript.javascriptDefaults.setCompilerOptions({
    target: monaco.typescript.ScriptTarget.ESNext,
    module: monaco.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.typescript.ModuleResolutionKind.NodeJs,
    jsx: monaco.typescript.JsxEmit.ReactJSX,
    lib: ['esnext', 'dom', 'dom.iterable'],
    allowNonTsExtensions: true,
    allowJs: true,
    checkJs: false
  });

  // Enable full CSS / SCSS / LESS validation, property/value completions, & color decorators
  const cssDiagOpts = {
    validate: true,
    lint: {
      compatibleVendorPrefixes: 'ignore' as const,
      vendorPrefix: 'warning' as const,
      duplicateProperties: 'warning' as const,
      emptyRules: 'ignore' as const,
      unknownProperties: 'warning' as const,
      hexColorLength: 'error' as const
    }
  };
  monaco.css.cssDefaults.setOptions(cssDiagOpts);
  monaco.css.scssDefaults.setOptions(cssDiagOpts);
  monaco.css.lessDefaults.setOptions(cssDiagOpts);

  // Register Emmet abbreviations (HTML + PHP templates, CSS/SCSS/LESS, JSX/TSX)
  emmetHTML(monaco, ['html', 'php']);
  emmetCSS(monaco, ['css', 'scss', 'less']);
  emmetJSX(monaco, ['javascript', 'typescript']);

  // Register full PHP 8 + SQL + Wisanggeni + Laravel IntelliSense
  registerPhpIntelliSense();

  // Register full JavaScript (DOM, jQuery, Project JS) & CSS/SCSS/Bootstrap IntelliSense (including inside .php/.html!)
  registerWebIntelliSense();

  // Register native Monaco DocumentFormattingEditProvider (Shift+Alt+F) across all primary web languages
  for (const fmtLang of [
    'php',
    'sql',
    'javascript',
    'typescript',
    'css',
    'scss',
    'less',
    'html',
    'json'
  ]) {
    monaco.languages.registerDocumentFormattingEditProvider(fmtLang, {
      provideDocumentFormattingEdits(model) {
        const original = model.getValue();
        const formatted = formatCodeByLanguage(original, fmtLang);
        if (formatted === original) return [];
        return [
          {
            range: model.getFullModelRange(),
            text: formatted
          }
        ];
      }
    });
  }

  // Register Google Gemini AI Ghost-Text Inline Completions (#6)
  const ghostLanguages = [
    'php',
    'sql',
    'javascript',
    'typescript',
    'html',
    'css',
    'scss',
    'less'
  ];
  for (const gLang of ghostLanguages) {
    monaco.languages.registerInlineCompletionsProvider(gLang, {
      provideInlineCompletions: async (model, position, _context, token) => {
        if (!ghostTextEnabledFlag || token.isCancellationRequested) {
          return { items: [] };
        }

        const currentLine = model.getLineContent(position.lineNumber);
        const beforeCursorOnLine = currentLine.slice(0, position.column - 1);
        if (beforeCursorOnLine.trim().length < 2 && position.lineNumber <= 1) {
          return { items: [] };
        }

        const survivedDebounce = await new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => resolve(true), 780);
          const sub = token.onCancellationRequested(() => {
            clearTimeout(timer);
            sub.dispose();
            resolve(false);
          });
        });

        if (!survivedDebounce || token.isCancellationRequested || model.isDisposed()) {
          return { items: [] };
        }

        const startLine = Math.max(1, position.lineNumber - 55);
        const endLine = Math.min(model.getLineCount(), position.lineNumber + 20);
        const prefix = model.getValueInRange({
          startLineNumber: startLine,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column
        });
        const suffix = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: position.column,
          endLineNumber: endLine,
          endColumn: model.getLineMaxColumn(endLine)
        });

        try {
          const suggestion = await window.aptana.ai.inlineCompletion({
            prefix,
            suffix,
            language: gLang,
            fileName: model.uri.path || `buffer.${gLang}`
          });

          if (!suggestion || token.isCancellationRequested) {
            return { items: [] };
          }

          return {
            items: [
              {
                insertText: suggestion,
                range: new monaco.Range(
                  position.lineNumber,
                  position.column,
                  position.lineNumber,
                  position.column
                )
              }
            ]
          };
        } catch {
          return { items: [] };
        }
      },
      disposeInlineCompletions: () => {}
    });
  }
}

export function applyMonacoTheme(theme: ThemeId): void {
  ensureMonacoInitialized();
  monaco.editor.setTheme(theme);
}

export function detectLanguageFromPath(filePath: string, contentSample?: string): string {
  return detectLanguageFromPathAndContent(filePath, contentSample);
}

export function registerRubleSnippetsInMonaco(bundles: RubleBundle[]): void {
  ensureMonacoInitialized();
  for (const d of snippetDisposables) {
    d.dispose();
  }
  snippetDisposables = [];

  const allSnippets = bundles.flatMap((b) =>
    b.snippets.map((s) => ({ ...s, bundleName: b.name }))
  );

  const targetLanguages = [
    'html',
    'css',
    'scss',
    'less',
    'javascript',
    'typescript',
    'php',
    'python',
    'json',
    'markdown'
  ];

  for (const lang of targetLanguages) {
    const applicable = allSnippets.filter(
      (s) => s.scope === 'global' || s.scope === lang
    );
    if (applicable.length === 0) continue;

    const disposable = monaco.languages.registerCompletionItemProvider(lang, {
      provideCompletionItems(model, position, context) {
        const word = model.getWordUntilPosition(position);
        const isExplicit =
          context.triggerKind === monaco.languages.CompletionTriggerKind.Invoke;
        // Jangan munculkan daftar snippet Ruble saat belum mengetik minimal 2 huruf (kecuali Ctrl+Space)
        if (!isExplicit && word.word.length < 2) {
          return { suggestions: [] };
        }
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn
        };

        return {
          suggestions: applicable.map((s) => ({
            label: s.trigger,
            kind: monaco.languages.CompletionItemKind.Snippet,
            detail: `[Ruble] ${s.name} (${s.bundleName})`,
            documentation: s.description,
            insertText: s.body,
            insertTextRules:
              monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range
          }))
        };
      }
    });
    snippetDisposables.push(disposable);
  }
}

export { monaco };
