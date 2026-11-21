import type {
  CssClassSymbol,
  CssVariableSymbol,
  HtmlIdSymbol,
  JsClassSymbol,
  JsFunctionSymbol,
  WebSymbolCatalog
} from './types';

export type WebRegionKind =
  | 'php'
  | 'js'
  | 'js-inline'
  | 'dom-selector'
  | 'css-block'
  | 'css-inline'
  | 'html-class'
  | 'html-id'
  | 'asset-path'
  | 'html-markup';

export interface DetectedWebSubContext {
  region: WebRegionKind;
  cssSubKind?: 'selector' | 'property' | 'value';
  activeCssProperty?: string;
  selectorKind?: 'id' | 'class' | 'css';
  assetKind?: 'js' | 'css';
  typedPrefix?: string;
}

const JS_RESERVED_NAMES = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'function',
  'return',
  'typeof',
  'delete',
  'await',
  'async',
  'class',
  'super',
  'constructor'
]);

/**
 * Recognizes language from file path / extension AND falls back to lightweight content sniffing
 * when opening extensionless or custom-named web files.
 */
export function detectLanguageFromPathAndContent(
  filePath: string,
  contentSample?: string
): string {
  const clean = filePath.replace(/\\/g, '/').trim();
  const lower = clean.toLowerCase();
  const baseName = lower.split('/').pop() ?? lower;

  if (
    lower.endsWith('.blade.php') ||
    lower.endsWith('.php') ||
    lower.endsWith('.phtml') ||
    lower.endsWith('.php5') ||
    lower.endsWith('.php7') ||
    lower.endsWith('.php8') ||
    lower.endsWith('.inc') ||
    lower.endsWith('.module') ||
    lower.endsWith('.tpl')
  ) {
    return 'php';
  }
  if (
    lower.endsWith('.ts') ||
    lower.endsWith('.tsx') ||
    lower.endsWith('.mts') ||
    lower.endsWith('.cts')
  ) {
    return 'typescript';
  }
  if (
    lower.endsWith('.js') ||
    lower.endsWith('.mjs') ||
    lower.endsWith('.cjs') ||
    lower.endsWith('.jsx') ||
    lower.endsWith('.es6')
  ) {
    return 'javascript';
  }
  if (lower.endsWith('.css')) return 'css';
  if (lower.endsWith('.scss') || lower.endsWith('.sass')) return 'scss';
  if (lower.endsWith('.less')) return 'less';
  if (
    lower.endsWith('.html') ||
    lower.endsWith('.htm') ||
    lower.endsWith('.xhtml') ||
    lower.endsWith('.vue') ||
    lower.endsWith('.svelte')
  ) {
    return 'html';
  }
  if (
    lower.endsWith('.json') ||
    lower.endsWith('.webmanifest') ||
    lower.endsWith('.map') ||
    baseName === '.babelrc' ||
    baseName === '.prettierrc' ||
    baseName === '.eslintrc' ||
    baseName === 'composer.lock'
  ) {
    return 'json';
  }
  if (lower.endsWith('.sql')) return 'sql';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'yaml';
  if (lower.endsWith('.xml') || lower.endsWith('.svg')) return 'xml';
  if (lower.endsWith('.py')) return 'python';
  if (lower.endsWith('.rb')) return 'ruby';
  if (lower.endsWith('.sh') || lower.endsWith('.bash')) return 'shell';

  if (contentSample) {
    const head = contentSample.slice(0, 1200).trimStart();
    if (/^<\?(?:php|=|\s)/i.test(head)) return 'php';
    if (/^(?:<!doctype\s+html|<html\b|<head\b|<body\b)/i.test(head)) return 'html';
    if (
      /^(?:@charset\b|@import\b|:root\s*\{|\*\s*\{|(?:html|body|\.[A-Za-z_-][A-Za-z0-9_-]*)\s*\{)/i.test(
        head
      )
    ) {
      return 'css';
    }
    if (
      /^(?:#!.*\b(?:node|deno|bun)\b|['"]use strict['"]|import\s+.+\s+from\s+['"]|export\s+(?:default|const|function|class)\b|(?:const|let)\s+[A-Za-z_$][A-Za-z0-9_$]*\s*=|document\.(?:getElementById|querySelector|addEventListener)|window\.addEventListener|\$\(\s*(?:document|function|['"]))/.test(
        head
      )
    ) {
      return 'javascript';
    }
  }

  return 'plaintext';
}

/**
 * Checks whether cursor at the end of `textBeforeCursor` is inside an unclosed `<?php ...` or `<?= ...` tag.
 */
export function isCursorInsidePhpTag(textBeforeCursor: string): boolean {
  const lastOpen = Math.max(
    textBeforeCursor.lastIndexOf('<?php'),
    textBeforeCursor.lastIndexOf('<?='),
    textBeforeCursor.lastIndexOf('<?')
  );
  if (lastOpen < 0) return false;
  // Ignore `<?xml` declaration
  if (/^<\?xml\b/i.test(textBeforeCursor.slice(lastOpen, lastOpen + 8))) {
    return false;
  }
  const lastClose = textBeforeCursor.lastIndexOf('?>');
  return lastClose < lastOpen;
}

function stripPhpBlocksToSpaces(text: string): string {
  return text.replace(/<\?(?:php|=)?[\s\S]*?\?>/gi, (m) =>
    m.replace(/[^\n]/g, ' ')
  );
}

function analyzeCssPositionKind(cssBeforeCursor: string): {
  cssSubKind: 'selector' | 'property' | 'value';
  activeCssProperty?: string;
  typedPrefix: string;
} {
  // Strip CSS block comments `/* ... */`
  const cleaned = cssBeforeCursor.replace(/\/\*[\s\S]*?\*\//g, ' ');

  let braceDepth = 0;
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === '{') braceDepth++;
    else if (cleaned[i] === '}') braceDepth = Math.max(0, braceDepth - 1);
  }

  if (braceDepth === 0) {
    const tailMatch = cleaned.match(/([.#@A-Za-z0-9_:-]*)$/);
    return {
      cssSubKind: 'selector',
      typedPrefix: tailMatch?.[1] ?? ''
    };
  }

  // Inside `{ ... }`: inspect text after last `{` or `;`
  const lastBrace = cleaned.lastIndexOf('{');
  const lastSemi = cleaned.lastIndexOf(';');
  const declSlice = cleaned.slice(Math.max(lastBrace, lastSemi) + 1);
  const colonIdx = declSlice.indexOf(':');

  if (colonIdx >= 0) {
    const propName = declSlice.slice(0, colonIdx).trim().toLowerCase();
    const afterColon = declSlice.slice(colonIdx + 1);
    const valMatch = afterColon.match(/([A-Za-z0-9_#-]*)$/);
    return {
      cssSubKind: 'value',
      activeCssProperty: propName || undefined,
      typedPrefix: valMatch?.[1] ?? ''
    };
  }

  const propMatch = declSlice.match(/(-*[A-Za-z0-9_-]*)$/);
  return {
    cssSubKind: 'property',
    typedPrefix: propMatch?.[1] ?? ''
  };
}

function detectJsDomSelectorAtLinePrefix(linePrefix: string): {
  selectorKind: 'id' | 'class' | 'css';
  typedPrefix: string;
} | null {
  // 1. `document.getElementById('...')`
  const byId = linePrefix.match(/\bgetElementById\s*\(\s*['"]([A-Za-z0-9_-]*)$/);
  if (byId) {
    return { selectorKind: 'id', typedPrefix: byId[1] };
  }

  // 2. `getElementsByClassName('...')` or `classList.add/remove/toggle/contains('...')`
  const byClass = linePrefix.match(
    /(?:\bgetElementsByClassName|\bclassList\s*\.\s*(?:add|remove|toggle|contains))\s*\(\s*['"]([A-Za-z0-9_-]*)$/
  );
  if (byClass) {
    return { selectorKind: 'class', typedPrefix: byClass[1] };
  }

  // 3. `$('#...')` / `$('. ...')` / `jQuery('...')` / `querySelector('...')` / `querySelectorAll('...')` / `closest('...')`
  const qs = linePrefix.match(
    /(?:\b(?:querySelector|querySelectorAll|closest|jQuery)|\$)\s*\(\s*['"]([#.]?[A-Za-z0-9_-]*)$/
  );
  if (qs) {
    const raw = qs[1];
    if (raw.startsWith('#')) {
      return { selectorKind: 'id', typedPrefix: raw.slice(1) };
    }
    if (raw.startsWith('.')) {
      return { selectorKind: 'class', typedPrefix: raw.slice(1) };
    }
    return { selectorKind: 'css', typedPrefix: raw };
  }

  return null;
}

/**
 * Determines the exact embedded web language context at the cursor across
 * `.php`, `.blade.php`, `.html`, `.js`, `.jsx`, `.ts`, `.tsx`, `.css`, `.scss`, and `.less`.
 */
export function detectWebSubContext(
  textBeforeCursor: string,
  linePrefix: string,
  hostLanguage: string
): DetectedWebSubContext {
  const lang = hostLanguage.toLowerCase();

  // 1. Standalone CSS / SCSS / LESS
  if (lang === 'css' || lang === 'scss' || lang === 'less') {
    const cssInfo = analyzeCssPositionKind(textBeforeCursor);
    return {
      region: 'css-block',
      ...cssInfo
    };
  }

  // 2. Standalone JavaScript / TypeScript
  if (lang === 'javascript' || lang === 'typescript') {
    const jsxClass = linePrefix.match(/\bclassName\s*=\s*['"](?:[^'"]*\s)?([A-Za-z0-9_:-]*)$/);
    if (jsxClass) {
      return {
        region: 'html-class',
        typedPrefix: jsxClass[1]
      };
    }
    const domSel = detectJsDomSelectorAtLinePrefix(linePrefix);
    if (domSel) {
      return {
        region: 'dom-selector',
        selectorKind: domSel.selectorKind,
        typedPrefix: domSel.typedPrefix
      };
    }
    return { region: 'js' };
  }

  // 3. PHP / HTML / Blade mixed files
  if (lang === 'php' && isCursorInsidePhpTag(textBeforeCursor)) {
    return { region: 'php' };
  }

  const stripped = lang === 'php' ? stripPhpBlocksToSpaces(textBeforeCursor) : textBeforeCursor;

  // 3a. Asset path attributes: `<script src="...">`, `<link rel="stylesheet" href="...">`
  const scriptSrcMatch = linePrefix.match(/<script\b[^>]*\bsrc\s*=\s*['"]([^'"]*)$/i);
  if (scriptSrcMatch) {
    return {
      region: 'asset-path',
      assetKind: 'js',
      typedPrefix: scriptSrcMatch[1]
    };
  }
  const linkHrefMatch = linePrefix.match(/<link\b[^>]*\bhref\s*=\s*['"]([^'"]*)$/i);
  if (linkHrefMatch && !/\brel\s*=\s*['"]icon/i.test(linePrefix)) {
    return {
      region: 'asset-path',
      assetKind: 'css',
      typedPrefix: linkHrefMatch[1]
    };
  }

  // 3b. Check if cursor is inside an unclosed `<script ...>` block!
  const lastScriptClose = stripped.toLowerCase().lastIndexOf('</script');
  const scriptAfterClose = lastScriptClose >= 0 ? stripped.slice(lastScriptClose + 8) : stripped;
  const scriptOpenMatches = Array.from(
    scriptAfterClose.matchAll(/<script\b([^>]*)>/gi)
  );
  if (scriptOpenMatches.length > 0) {
    const lastScriptOpen = scriptOpenMatches[scriptOpenMatches.length - 1];
    const attrs = (lastScriptOpen[1] ?? '').toLowerCase();
    const isJsonScript = /\btype\s*=\s*['"]application\/(?:ld\+)?json['"]/.test(attrs);
    if (!isJsonScript) {
      const domSel = detectJsDomSelectorAtLinePrefix(linePrefix);
      if (domSel) {
        return {
          region: 'dom-selector',
          selectorKind: domSel.selectorKind,
          typedPrefix: domSel.typedPrefix
        };
      }
      return { region: 'js' };
    }
  }

  // 3c. Check if cursor is inside an unclosed `<style ...>` block!
  const lastStyleClose = stripped.toLowerCase().lastIndexOf('</style');
  const styleAfterClose = lastStyleClose >= 0 ? stripped.slice(lastStyleClose + 7) : stripped;
  const styleOpenMatches = Array.from(styleAfterClose.matchAll(/<style\b[^>]*>/gi));
  if (styleOpenMatches.length > 0) {
    const lastOpen = styleOpenMatches[styleOpenMatches.length - 1];
    const cssInside = styleAfterClose.slice((lastOpen.index ?? 0) + lastOpen[0].length);
    const cssInfo = analyzeCssPositionKind(cssInside);
    return {
      region: 'css-block',
      ...cssInfo
    };
  }

  // 3d. Inline HTML `style="..."` attribute!
  const inlineStyleMatch = linePrefix.match(/\bstyle\s*=\s*(['"])([^'"]*)$/i);
  if (inlineStyleMatch) {
    const styleBody = inlineStyleMatch[2];
    const cssInfo = analyzeCssPositionKind(`{${styleBody}`);
    return {
      region: 'css-inline',
      ...cssInfo
    };
  }

  // 3e. Inline HTML `class="..."` / `className="..."` attribute!
  const htmlClassMatch = linePrefix.match(/\bclass(?:Name)?\s*=\s*(['"])([^'"]*)$/i);
  if (htmlClassMatch) {
    const classContent = htmlClassMatch[2];
    const lastToken = classContent.split(/\s+/).pop() ?? '';
    return {
      region: 'html-class',
      typedPrefix: lastToken
    };
  }

  // 3f. Inline HTML `for="..."` / `aria-labelledby="..."` (suggests IDs!)
  const htmlForMatch = linePrefix.match(/\b(?:for|aria-labelledby|aria-controls)\s*=\s*(['"])([A-Za-z0-9_-]*)$/i);
  if (htmlForMatch) {
    return {
      region: 'html-id',
      typedPrefix: htmlForMatch[2]
    };
  }

  // 3g. Inline HTML JS event handlers (`onclick="..."`, `onchange="..."`, `onsubmit="..."`, `@click="..."`, `x-data="..."`)
  const inlineJsAttrMatch = linePrefix.match(
    /(?:\bon(?:click|dblclick|change|submit|input|keyup|keydown|keypress|focus|blur|load|mouse(?:enter|leave|over|out|down|up))|@(?:click|submit|change|input|keyup)|x-(?:data|init|show|on:[a-z]+))\s*=\s*(['"])([^'"]*)$/i
  );
  if (inlineJsAttrMatch) {
    return {
      region: 'js-inline'
    };
  }

  return { region: 'html-markup' };
}

function lineNumberAtOffset(lineStarts: number[], offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lineStarts[mid] <= offset) lo = mid + 1;
    else hi = mid - 1;
  }
  return Math.max(1, hi + 1);
}

function buildLineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function extractLeadingJsDoc(lines: string[], zeroBasedLineIdx: number): string | undefined {
  let idx = zeroBasedLineIdx - 1;
  while (idx >= 0 && lines[idx].trim() === '') idx--;
  if (idx < 0 || !lines[idx].trim().endsWith('*/')) return undefined;
  const endIdx = idx;
  while (idx >= 0 && !lines[idx].includes('/**')) {
    if (endIdx - idx > 15) return undefined;
    idx--;
  }
  if (idx < 0) return undefined;
  const cleaned = lines
    .slice(idx, endIdx + 1)
    .map((l) => l.replace(/^\s*\/?\*+\/?\s?/, '').trim())
    .filter(Boolean)
    .join('\n');
  return cleaned || undefined;
}

function parseJsSegmentIntoCatalog(
  jsCode: string,
  baseLineOffset: number,
  fullSourceLines: string[],
  filePath: string | undefined,
  relativePath: string,
  jsFunctions: JsFunctionSymbol[],
  jsClasses: JsClassSymbol[]
): void {
  const segLines = jsCode.split(/\r?\n/);
  let currentClass: JsClassSymbol | null = null;
  let braceDepth = 0;
  let classBraceStart = -1;

  for (let i = 0; i < segLines.length; i++) {
    const line = segLines[i];
    const absLine = baseLineOffset + i;
    const trimmed = line.trim();

    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      continue;
    }

    // 1. ES6 Class declaration: `export class PegawaiService {`
    const clsMatch = line.match(
      /^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)/
    );
    if (clsMatch) {
      currentClass = {
        name: clsMatch[1],
        methods: [],
        doc: extractLeadingJsDoc(fullSourceLines, absLine - 1),
        filePath,
        relativePath,
        line: absLine
      };
      classBraceStart = braceDepth;
      jsClasses.push(currentClass);
    } else if (currentClass && braceDepth === classBraceStart + 1) {
      // Class method: `async loadPegawai(nip, tahun = 2026) {`
      const methodMatch = line.match(
        /^\s*(static\s+)?(async\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*\(([^)]*)\)\s*\{/
      );
      if (methodMatch && !JS_RESERVED_NAMES.has(methodMatch[3])) {
        const params = methodMatch[4]
          .split(',')
          .map((p) => p.split('=')[0].split(':')[0].trim())
          .filter(Boolean);
        currentClass.methods.push({
          name: methodMatch[3],
          params,
          isStatic: Boolean(methodMatch[1]),
          isAsync: Boolean(methodMatch[2]),
          line: absLine
        });
      }
    }

    // 2. Named function declaration: `function hitungGaji(gapok, tunjangan)`
    const fnMatch = line.match(
      /^\s*(?:export\s+)?(?:default\s+)?(async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(([^)]*)\)/
    );
    if (fnMatch && !JS_RESERVED_NAMES.has(fnMatch[2])) {
      const params = fnMatch[3]
        .split(',')
        .map((p) => p.split('=')[0].split(':')[0].trim())
        .filter(Boolean);
      jsFunctions.push({
        name: fnMatch[2],
        params,
        isAsync: Boolean(fnMatch[1]),
        kind: 'function',
        doc: extractLeadingJsDoc(fullSourceLines, absLine - 1),
        filePath,
        relativePath,
        line: absLine
      });
    } else {
      // 3. Arrow / function expression assigned to const/let/var: `const formatRupiah = (angka) =>`
      const arrowMatch = line.match(
        /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(async\s+)?(?:function\s*\(([^)]*)\)|\(([^)]*)\)\s*=>|([A-Za-z_$][A-Za-z0-9_$]*)\s*=>)/
      );
      if (arrowMatch && !JS_RESERVED_NAMES.has(arrowMatch[1])) {
        const rawParams = arrowMatch[3] ?? arrowMatch[4] ?? arrowMatch[5] ?? '';
        const params = rawParams
          .split(',')
          .map((p) => p.split('=')[0].split(':')[0].trim())
          .filter(Boolean);
        jsFunctions.push({
          name: arrowMatch[1],
          params,
          isAsync: Boolean(arrowMatch[2]),
          kind: 'arrow',
          doc: extractLeadingJsDoc(fullSourceLines, absLine - 1),
          filePath,
          relativePath,
          line: absLine
        });
      } else {
        // 4. `window.simpanData = function(id) {` or `window.simpanData = (id) =>`
        const winFnMatch = line.match(
          /\bwindow\.([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(async\s+)?(?:function\s*\(([^)]*)\)|\(([^)]*)\)\s*=>)/
        );
        if (winFnMatch) {
          const rawParams = winFnMatch[3] ?? winFnMatch[4] ?? '';
          const params = rawParams
            .split(',')
            .map((p) => p.split('=')[0].trim())
            .filter(Boolean);
          jsFunctions.push({
            name: winFnMatch[1],
            params,
            isAsync: Boolean(winFnMatch[2]),
            kind: 'window',
            filePath,
            relativePath,
            line: absLine
          });
        }
      }
    }

    for (let k = 0; k < line.length; k++) {
      if (line[k] === '{') braceDepth++;
      else if (line[k] === '}') {
        braceDepth = Math.max(0, braceDepth - 1);
        if (currentClass && braceDepth <= classBraceStart) {
          currentClass = null;
        }
      }
    }
  }
}

function parseCssSegmentIntoCatalog(
  cssCode: string,
  baseDocOffset: number,
  lineStarts: number[],
  filePath: string | undefined,
  relativePath: string,
  cssClasses: CssClassSymbol[],
  cssVariables: CssVariableSymbol[]
): void {
  // Mask CSS block comments while preserving exact offsets for accurate line numbers
  const masked = cssCode.replace(/\/\*[\s\S]*?\*\//g, (m) =>
    m.replace(/[^\n]/g, ' ')
  );

  // 1. Extract CSS Custom Properties `--var-name: value;`
  for (const vm of masked.matchAll(/(--[A-Za-z0-9_-]{2,64})\s*:\s*([^;}\n]{1,120})/g)) {
    const varName = vm[1];
    const val = vm[2].trim();
    const hexMatch = val.match(/#(?:[0-9a-fA-F]{3,8})\b/);
    const line = lineNumberAtOffset(lineStarts, baseDocOffset + (vm.index ?? 0));
    cssVariables.push({
      name: varName,
      value: val,
      colorHex: hexMatch?.[0],
      filePath,
      relativePath,
      line
    });
  }

  // 2. Extract CSS Class rules `.my-class, .btn.active { ... }`
  const ruleRegex = /([^{};@][^{};]{0,240})\{([^{}]{0,600})\}/g;
  for (const rm of masked.matchAll(ruleRegex)) {
    const selectorHeader = rm[1];
    const bodyRaw = rm[2];
    const headerOffset = baseDocOffset + (rm.index ?? 0);
    const line = lineNumberAtOffset(lineStarts, headerOffset);

    const preview = bodyRaw
      .split(';')
      .map((s) => s.trim().replace(/\s+/g, ' '))
      .filter(Boolean)
      .slice(0, 4)
      .join('; ');
    const hexMatch = bodyRaw.match(/#(?:[0-9a-fA-F]{3,8})\b/);

    for (const cm of selectorHeader.matchAll(/\.([A-Za-z_-][A-Za-z0-9_-]{1,64})/g)) {
      const clsName = cm[1];
      // Skip numeric decimals like `.5s`
      if (/^\d/.test(clsName)) continue;
      cssClasses.push({
        name: clsName,
        declarationsPreview: preview ? `${preview};` : undefined,
        colorHex: hexMatch?.[0],
        fromStylesheet: true,
        filePath,
        relativePath,
        line
      });
    }
  }
}

/**
 * Scans a single `.js`, `.ts`, `.css`, `.scss`, `.less`, `.html`, or `.php` file
 * to extract JS functions/classes, CSS classes/variables, and HTML element `#id`s.
 */
export function extractWebSymbolsFromSource(
  source: string,
  relativePath: string,
  filePath?: string
): WebSymbolCatalog {
  const jsFunctions: JsFunctionSymbol[] = [];
  const jsClasses: JsClassSymbol[] = [];
  const cssClasses: CssClassSymbol[] = [];
  const cssVariables: CssVariableSymbol[] = [];
  const htmlIds: HtmlIdSymbol[] = [];
  const jsFiles: string[] = [];
  const cssFiles: string[] = [];

  const normRel = relativePath.replace(/\\/g, '/');
  const lang = detectLanguageFromPathAndContent(normRel, source);
  const lineStarts = buildLineStarts(source);
  const allLines = source.split(/\r?\n/);

  if (lang === 'javascript' || lang === 'typescript') {
    jsFiles.push(normRel);
    parseJsSegmentIntoCatalog(
      source,
      1,
      allLines,
      filePath,
      normRel,
      jsFunctions,
      jsClasses
    );
    return {
      jsFunctions,
      jsClasses,
      cssClasses,
      cssVariables,
      htmlIds,
      jsFiles,
      cssFiles
    };
  }

  if (lang === 'css' || lang === 'scss' || lang === 'less') {
    cssFiles.push(normRel);
    parseCssSegmentIntoCatalog(
      source,
      0,
      lineStarts,
      filePath,
      normRel,
      cssClasses,
      cssVariables
    );
    return {
      jsFunctions,
      jsClasses,
      cssClasses,
      cssVariables,
      htmlIds,
      jsFiles,
      cssFiles
    };
  }

  if (lang === 'php' || lang === 'html') {
    const cleanHtml = lang === 'php' ? stripPhpBlocksToSpaces(source) : source;

    // 1. Embedded `<script>...</script>` blocks
    for (const sm of cleanHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
      const attrs = (sm[1] ?? '').toLowerCase();
      if (/\bsrc\s*=/.test(attrs) && !sm[2].trim()) continue;
      if (/\btype\s*=\s*['"]application\/(?:ld\+)?json['"]/.test(attrs)) continue;
      const bodyStartOffset = (sm.index ?? 0) + sm[0].indexOf('>') + 1;
      const baseLine = lineNumberAtOffset(lineStarts, bodyStartOffset);
      parseJsSegmentIntoCatalog(
        sm[2],
        baseLine,
        allLines,
        filePath,
        normRel,
        jsFunctions,
        jsClasses
      );
    }

    // 2. Embedded `<style>...</style>` blocks
    for (const stm of cleanHtml.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) {
      const bodyStartOffset = (stm.index ?? 0) + stm[0].indexOf('>') + 1;
      parseCssSegmentIntoCatalog(
        stm[1],
        bodyStartOffset,
        lineStarts,
        filePath,
        normRel,
        cssClasses,
        cssVariables
      );
    }

    // 3. HTML `id="..."` attributes (for `$('#id')` & `document.getElementById('id')`)
    for (const im of cleanHtml.matchAll(
      /<([A-Za-z][A-Za-z0-9:-]*)\b[^>]*?\bid\s*=\s*['"]([A-Za-z_][A-Za-z0-9_-]{1,64})['"]/gi
    )) {
      const tagName = im[1].toLowerCase();
      const idVal = im[2];
      const line = lineNumberAtOffset(lineStarts, im.index ?? 0);
      htmlIds.push({
        id: idVal,
        tagName,
        filePath,
        relativePath: normRel,
        line
      });
    }

    // 4. Also harvest used `class="foo bar"` tokens as fallback class completions
    for (const cm of cleanHtml.matchAll(/\bclass\s*=\s*['"]([^'"]{1,200})['"]/gi)) {
      const line = lineNumberAtOffset(lineStarts, cm.index ?? 0);
      for (const token of cm[1].split(/\s+/)) {
        const cleanTok = token.trim();
        if (/^[A-Za-z_-][A-Za-z0-9_-]{1,56}$/.test(cleanTok)) {
          cssClasses.push({
            name: cleanTok,
            fromStylesheet: false,
            filePath,
            relativePath: normRel,
            line
          });
        }
      }
    }
  }

  return {
    jsFunctions,
    jsClasses,
    cssClasses,
    cssVariables,
    htmlIds,
    jsFiles,
    cssFiles
  };
}

export function createEmptyWebSymbolCatalog(): WebSymbolCatalog {
  return {
    jsFunctions: [],
    jsClasses: [],
    cssClasses: [],
    cssVariables: [],
    htmlIds: [],
    jsFiles: [],
    cssFiles: []
  };
}

/**
 * Merges and deduplicates multiple `WebSymbolCatalog` snapshots (preferring stylesheet definitions
 * with `declarationsPreview` over plain HTML `class="..."` occurrences).
 */
export function mergeWebSymbolCatalogs(catalogs: WebSymbolCatalog[]): WebSymbolCatalog {
  const fnMap = new Map<string, JsFunctionSymbol>();
  const clsMap = new Map<string, JsClassSymbol>();
  const cssClsMap = new Map<string, CssClassSymbol>();
  const cssVarMap = new Map<string, CssVariableSymbol>();
  const htmlIdMap = new Map<string, HtmlIdSymbol>();
  const jsFileSet = new Set<string>();
  const cssFileSet = new Set<string>();

  for (const cat of catalogs) {
    for (const f of cat.jsFiles) jsFileSet.add(f);
    for (const f of cat.cssFiles) cssFileSet.add(f);

    for (const fn of cat.jsFunctions) {
      if (!fnMap.has(fn.name)) {
        fnMap.set(fn.name, fn);
      }
    }
    for (const c of cat.jsClasses) {
      if (!clsMap.has(c.name)) {
        clsMap.set(c.name, c);
      }
    }
    for (const cc of cat.cssClasses) {
      const existing = cssClsMap.get(cc.name);
      if (
        !existing ||
        (!existing.fromStylesheet && cc.fromStylesheet) ||
        (!existing.declarationsPreview && cc.declarationsPreview)
      ) {
        cssClsMap.set(cc.name, cc);
      }
    }
    for (const cv of cat.cssVariables) {
      if (!cssVarMap.has(cv.name)) {
        cssVarMap.set(cv.name, cv);
      }
    }
    for (const hid of cat.htmlIds) {
      if (!htmlIdMap.has(hid.id)) {
        htmlIdMap.set(hid.id, hid);
      }
    }
  }

  return {
    jsFunctions: Array.from(fnMap.values()),
    jsClasses: Array.from(clsMap.values()),
    cssClasses: Array.from(cssClsMap.values()),
    cssVariables: Array.from(cssVarMap.values()),
    htmlIds: Array.from(htmlIdMap.values()),
    jsFiles: Array.from(jsFileSet).sort(),
    cssFiles: Array.from(cssFileSet).sort()
  };
}

/**
 * Generates ambient `.d.ts` definitions for Monaco's `javascriptDefaults` / `typescriptDefaults`
 * covering jQuery (`$` / `jQuery`), DataTables, Select2, SweetAlert2 (`Swal`), Axios, Bootstrap 5,
 * PLUS all user-defined JS functions & classes discovered across the workspace and open SFTP tabs!
 */
export function buildAmbientWebExtraLibDts(catalog: WebSymbolCatalog): string {
  const lines: string[] = [
    `// Ambient Web Ecosystem & Project Declarations generated by HMW Studio`,
    `interface JQueryAjaxSettings {`,
    `  url?: string;`,
    `  type?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';`,
    `  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';`,
    `  data?: any;`,
    `  dataType?: 'json' | 'html' | 'text' | 'script' | 'xml';`,
    `  contentType?: string | boolean;`,
    `  processData?: boolean;`,
    `  cache?: boolean;`,
    `  headers?: Record<string, string>;`,
    `  beforeSend?: (jqXHR: any) => void;`,
    `  success?: (response: any, textStatus: string, jqXHR: any) => void;`,
    `  error?: (jqXHR: any, textStatus: string, errorThrown: string) => void;`,
    `  complete?: (jqXHR: any, textStatus: string) => void;`,
    `}`,
    `interface JQuery<TElement = HTMLElement> {`,
    `  val(): string | number | string[] | undefined;`,
    `  val(value: string | number | string[]): this;`,
    `  html(): string;`,
    `  html(content: string): this;`,
    `  text(): string;`,
    `  text(content: string | number): this;`,
    `  attr(name: string): string | undefined;`,
    `  attr(name: string, value: string | number | boolean): this;`,
    `  prop(name: string): any;`,
    `  prop(name: string, value: any): this;`,
    `  data(key?: string): any;`,
    `  data(key: string, value: any): this;`,
    `  css(propertyName: string): string;`,
    `  css(propertyName: string | Record<string, string | number>, value?: string | number): this;`,
    `  addClass(className: string): this;`,
    `  removeClass(className?: string): this;`,
    `  toggleClass(className: string, state?: boolean): this;`,
    `  hasClass(className: string): boolean;`,
    `  on(events: string, selectorOrHandler: any, handler?: (event: any) => void): this;`,
    `  off(events?: string, selector?: string): this;`,
    `  click(handler?: (event: any) => void): this;`,
    `  change(handler?: (event: any) => void): this;`,
    `  submit(handler?: (event: any) => void): this;`,
    `  keyup(handler?: (event: any) => void): this;`,
    `  focus(): this;`,
    `  show(duration?: number | string): this;`,
    `  hide(duration?: number | string): this;`,
    `  toggle(showOrHide?: boolean): this;`,
    `  fadeIn(duration?: number): this;`,
    `  fadeOut(duration?: number): this;`,
    `  slideDown(duration?: number): this;`,
    `  slideUp(duration?: number): this;`,
    `  serialize(): string;`,
    `  serializeArray(): Array<{ name: string; value: string }>;`,
    `  find(selector: string): JQuery;`,
    `  closest(selector: string): JQuery;`,
    `  parent(selector?: string): JQuery;`,
    `  children(selector?: string): JQuery;`,
    `  append(content: string | Node | JQuery): this;`,
    `  prepend(content: string | Node | JQuery): this;`,
    `  empty(): this;`,
    `  remove(): this;`,
    `  each(callback: (index: number, element: TElement) => void | boolean): this;`,
    `  ready(handler: () => void): this;`,
    `  modal(action?: 'show' | 'hide' | 'toggle' | Record<string, any>): this;`,
    `  select2(options?: Record<string, any> | string): this;`,
    `  DataTable(options?: Record<string, any>): any;`,
    `}`,
    `interface JQueryStatic {`,
    `  (selector: string | Element | Document | Window | (() => void), context?: any): JQuery;`,
    `  ajax(settings: JQueryAjaxSettings): Promise<any>;`,
    `  get(url: string, data?: any, success?: (res: any) => void, dataType?: string): Promise<any>;`,
    `  post(url: string, data?: any, success?: (res: any) => void, dataType?: string): Promise<any>;`,
    `  getJSON(url: string, data?: any, success?: (res: any) => void): Promise<any>;`,
    `  each<T>(collection: T[], callback: (index: number, value: T) => void | boolean): T[];`,
    `  extend(target: any, ...sources: any[]): any;`,
    `  param(obj: any): string;`,
    `}`,
    `declare const $: JQueryStatic;`,
    `declare const jQuery: JQueryStatic;`,
    `declare namespace Swal {`,
    `  function fire(options: { title?: string; text?: string; html?: string; icon?: 'success' | 'error' | 'warning' | 'info' | 'question'; showCancelButton?: boolean; confirmButtonText?: string; cancelButtonText?: string; timer?: number } | string, text?: string, icon?: string): Promise<{ isConfirmed: boolean; isDismissed: boolean; value?: any }>;`,
    `}`,
    `declare namespace axios {`,
    `  function get<T = any>(url: string, config?: Record<string, any>): Promise<{ data: T; status: number }>;`,
    `  function post<T = any>(url: string, data?: any, config?: Record<string, any>): Promise<{ data: T; status: number }>;`,
    `  function put<T = any>(url: string, data?: any, config?: Record<string, any>): Promise<{ data: T; status: number }>;`,
    `  function delete<T = any>(url: string, config?: Record<string, any>): Promise<{ data: T; status: number }>;`,
    `}`
  ];

  const sanitizeIdent = (s: string, idx: number): string => {
    const clean = s.replace(/^\.\.\./, '').replace(/[^A-Za-z0-9_$]/g, '');
    if (!clean || /^\d/.test(clean) || JS_RESERVED_NAMES.has(clean)) {
      return `arg${idx + 1}`;
    }
    return s.startsWith('...') ? `...${clean}: any[]` : `${clean}?: any`;
  };

  for (const fn of catalog.jsFunctions) {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(fn.name) || JS_RESERVED_NAMES.has(fn.name)) {
      continue;
    }
    if (fn.doc) {
      lines.push(`/** ${fn.doc.replace(/\*\//g, '* /')} (${fn.relativePath ?? 'proyek'}) */`);
    }
    const paramSig = fn.params.map((p, idx) => sanitizeIdent(p, idx)).join(', ');
    const retType = fn.isAsync ? 'Promise<any>' : 'any';
    lines.push(`declare function ${fn.name}(${paramSig}): ${retType};`);
  }

  for (const cls of catalog.jsClasses) {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(cls.name) || JS_RESERVED_NAMES.has(cls.name)) {
      continue;
    }
    lines.push(`declare class ${cls.name} {`);
    for (const m of cls.methods) {
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(m.name)) continue;
      const pSig = m.params.map((p, idx) => sanitizeIdent(p, idx)).join(', ');
      const ret = m.isAsync ? 'Promise<any>' : 'any';
      lines.push(`  ${m.isStatic ? 'static ' : ''}${m.name}(${pSig}): ${ret};`);
    }
    lines.push(`}`);
  }

  return lines.join('\n');
}
