import {
  findClosestIdentifiers,
  offsetToLineCol,
  type SqlQuickFixOption
} from './sqlSchemaAnalyzer';

export interface PhpVariableDiagnostic {
  line: number;
  startColumn: number;
  endColumn: number;
  variableName: string;
  message: string;
  quickFixes: SqlQuickFixOption[];
}

const PHP_BUILTIN_VARS = new Set([
  'this',
  '_GET',
  '_POST',
  '_SESSION',
  '_SERVER',
  '_FILES',
  '_COOKIE',
  '_REQUEST',
  '_ENV',
  'GLOBALS',
  'argc',
  'argv',
  'http_response_header',
  'php_errormsg'
]);

interface VarOccurrence {
  name: string;
  startOffset: number;
  endOffset: number;
  isWrite: boolean;
}

function buildLineStartsLocal(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

/**
 * Masks comments, single-quoted strings, and double-quoted non-variable text with spaces
 * while preserving `$var` positions inside PHP code blocks (and inside double-quoted strings as reads).
 */
function maskPhpKeepCodeAndVars(source: string): {
  maskedCode: string;
  doubleQuoteRanges: Array<{ start: number; end: number }>;
} {
  const chars = source.split('');
  const dqRanges: Array<{ start: number; end: number }> = [];
  let inPhp = false;
  let inSingle = false;
  let inDouble = false;
  let dqStart = -1;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1] ?? '';

    if (!inPhp) {
      if (source.slice(i, i + 5).toLowerCase() === '<?php') {
        for (let k = i; k < i + 5; k++) chars[k] = ' ';
        inPhp = true;
        i += 4;
        continue;
      }
      if (source.slice(i, i + 3) === '<?=') {
        for (let k = i; k < i + 3; k++) chars[k] = ' ';
        inPhp = true;
        i += 2;
        continue;
      }
      if (ch !== '\n') chars[i] = ' ';
      continue;
    }

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
      } else {
        chars[i] = ' ';
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        chars[i] = ' ';
        chars[i + 1] = ' ';
        inBlockComment = false;
        i++;
      } else if (ch !== '\n') {
        chars[i] = ' ';
      }
      continue;
    }

    if (inSingle) {
      if (ch === '\\') {
        if (chars[i] !== '\n') chars[i] = ' ';
        if (i + 1 < chars.length && chars[i + 1] !== '\n') chars[i + 1] = ' ';
        i++;
        continue;
      }
      if (ch === "'") {
        chars[i] = ' ';
        inSingle = false;
        continue;
      }
      if (ch !== '\n') chars[i] = ' ';
      continue;
    }

    if (inDouble) {
      if (ch === '\\') {
        if (chars[i] !== '\n') chars[i] = ' ';
        if (i + 1 < chars.length && chars[i + 1] !== '\n') chars[i + 1] = ' ';
        i++;
        continue;
      }
      if (ch === '"') {
        dqRanges.push({ start: dqStart, end: i });
        chars[i] = ' ';
        inDouble = false;
        continue;
      }
      // Keep `$identifier` inside double-quoted strings so interpolated variables are checked too!
      if (ch === '$' && /[A-Za-z_]/.test(next)) {
        let endVar = i + 1;
        while (endVar < source.length && /[A-Za-z0-9_]/.test(source[endVar])) {
          endVar++;
        }
        i = endVar - 1;
        continue;
      }
      if (ch !== '\n') chars[i] = ' ';
      continue;
    }

    // Inside normal PHP code
    if (ch === '?' && next === '>') {
      chars[i] = ' ';
      chars[i + 1] = ' ';
      inPhp = false;
      i++;
      continue;
    }
    if (ch === '/' && next === '/') {
      chars[i] = ' ';
      chars[i + 1] = ' ';
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === '#') {
      chars[i] = ' ';
      inLineComment = true;
      continue;
    }
    if (ch === '/' && next === '*') {
      chars[i] = ' ';
      chars[i + 1] = ' ';
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === "'") {
      chars[i] = ' ';
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      chars[i] = ' ';
      inDouble = true;
      dqStart = i;
      continue;
    }
  }

  return { maskedCode: chars.join(''), doubleQuoteRanges: dqRanges };
}

function collectVariablesInSlice(
  maskedCode: string,
  sliceStart: number,
  sliceEnd: number,
  dqRanges: Array<{ start: number; end: number }>
): VarOccurrence[] {
  const sub = maskedCode.slice(sliceStart, sliceEnd);
  const out: VarOccurrence[] = [];

  // Mark explicit declaration/binding offsets inside `sub`:
  // global $a, $b; | static $x; | foreach (... as $k => $v) | catch (... $e) | use ($a, &$b) | list($a, $b)
  const writeOffsets = new Set<number>();

  for (const gm of sub.matchAll(/\b(?:global|static)\s+([^;]+)/g)) {
    const base = (gm.index ?? 0) + gm[0].indexOf(gm[1]);
    for (const vm of gm[1].matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)/g)) {
      writeOffsets.add(base + (vm.index ?? 0));
    }
  }

  for (const fm of sub.matchAll(/\bas\s+&?\$([A-Za-z_][A-Za-z0-9_]*)(?:\s*=>\s*&?\$([A-Za-z_][A-Za-z0-9_]*))?/g)) {
    const full = fm[0];
    const base = fm.index ?? 0;
    const firstIdx = full.indexOf('$');
    if (firstIdx >= 0) writeOffsets.add(base + firstIdx);
    if (fm[2]) {
      const secondIdx = full.lastIndexOf('$');
      if (secondIdx > firstIdx) writeOffsets.add(base + secondIdx);
    }
  }

  for (const cm of sub.matchAll(/\bcatch\s*\([^)]*\$([A-Za-z_][A-Za-z0-9_]*)\s*\)/g)) {
    const lastDollar = cm[0].lastIndexOf('$');
    if (lastDollar >= 0) writeOffsets.add((cm.index ?? 0) + lastDollar);
  }

  for (const um of sub.matchAll(/\buse\s*\(([^)]+)\)/g)) {
    const base = (um.index ?? 0) + um[0].indexOf(um[1]);
    for (const vm of um[1].matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)/g)) {
      writeOffsets.add(base + (vm.index ?? 0));
    }
  }

  for (const lm of sub.matchAll(/\blist\s*\(([^)]+)\)\s*=/g)) {
    const base = (lm.index ?? 0) + lm[0].indexOf(lm[1]);
    for (const vm of lm[1].matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)/g)) {
      writeOffsets.add(base + (vm.index ?? 0));
    }
  }

  // Destructuring `[$a, $b] = ...`
  for (const dm of sub.matchAll(/\[([^\]]+)\]\s*=(?!=)/g)) {
    const base = (dm.index ?? 0) + dm[0].indexOf(dm[1]);
    for (const vm of dm[1].matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)/g)) {
      writeOffsets.add(base + (vm.index ?? 0));
    }
  }

  const varRegex = /\$([A-Za-z_][A-Za-z0-9_]*)/g;
  for (const vm of sub.matchAll(varRegex)) {
    const relIdx = vm.index ?? 0;
    const absStart = sliceStart + relIdx;
    const absEnd = absStart + vm[0].length;
    const name = vm[1];

    // Skip static class properties `Self::$prop` or `ClassName::$prop` or variable-variables `$$x`
    const before2 = sub.slice(Math.max(0, relIdx - 2), relIdx);
    if (before2 === '::' || before2.endsWith('$') || before2.endsWith('->')) {
      continue;
    }

    //Skip class property declarations `var $x`, `public $x`, `protected static ?string $x`
    const linePrefix = sub.slice(Math.max(0, sub.lastIndexOf('\n', relIdx) + 1), relIdx);
    if (/\b(?:public|protected|private|var|readonly)\b[^;=()]*$/.test(linePrefix)) {
      continue;
    }

    const insideDq = dqRanges.some((r) => absStart > r.start && absEnd <= r.end);

    let isWrite = writeOffsets.has(relIdx);
    if (!isWrite && !insideDq) {
      // Check assignment `$x = ...`, `$x .= ...`, `$x += ...`, `$x ??= ...`, `$x++`, `++$x`
      // Also `$x['k'] = ...` counts as initializing/mutating array `$x` in PHP!
      const after = sub.slice(relIdx + vm[0].length);
      if (
        /^(?:\s*\[[^\]]*\])*\s*(?:=(?!=|>)|\.=|\+=|-=|\*=|\/=|\?\?=|\+\+|--)/.test(after) ||
        /(?:\+\+|--)\s*$/.test(linePrefix)
      ) {
        isWrite = true;
      }
      // Pass-by-reference function call like `preg_match(..., $matches)` or `exec($cmd, $out, $code)`
      if (/\b(?:preg_match|preg_match_all|exec|system|passthru|fsockopen|parse_str)\s*\([^;]*$/.test(linePrefix)) {
        isWrite = true;
      }
    }

    out.push({ name, startOffset: absStart, endOffset: absEnd, isWrite });
  }

  return out;
}

/**
 * Detects undefined variables inside PHP functions/methods AND close-spelling variable typos
 * at top-level file scope, complete with `Ctrl+.` Quick Fixes.
 */
export function analyzePhpVariableIssues(source: string): PhpVariableDiagnostic[] {
  if (!source.includes('<?')) return [];
  const lineStarts = buildLineStartsLocal(source);
  const { maskedCode, doubleQuoteRanges } = maskPhpKeepCodeAndVars(source);
  const diagnostics: PhpVariableDiagnostic[] = [];

  // Collect all top-level/file-wide defined variable names (useful for `global $x` hints & file-scope typo checks)
  const allFileOccurrences = collectVariablesInSlice(
    maskedCode,
    0,
    maskedCode.length,
    doubleQuoteRanges
  );
  const fileWideWrittenVars = new Set<string>();
  for (const occ of allFileOccurrences) {
    if (occ.isWrite) fileWideWrittenVars.add(occ.name);
  }

  // Find every `function [name]($params) [use (...)] { ... }` block
  const funcRanges: Array<{ start: number; end: number }> = [];
  const funcHeaderRegex = /\bfunction\s+(?:&\s*)?(?:[A-Za-z_][A-Za-z0-9_]*)?\s*\(([^)]*)\)(?:\s*use\s*\(([^)]*)\))?[^{;]*\{/g;

  for (const fm of maskedCode.matchAll(funcHeaderRegex)) {
    const headerStart = fm.index ?? 0;
    const openBraceIdx = headerStart + fm[0].length - 1;
    let depth = 1;
    let pos = openBraceIdx + 1;
    while (pos < maskedCode.length && depth > 0) {
      if (maskedCode[pos] === '{') depth++;
      else if (maskedCode[pos] === '}') depth--;
      pos++;
    }
    const closeBraceIdx = pos;
    funcRanges.push({ start: headerStart, end: closeBraceIdx });

    const paramDefined = new Set<string>();
    for (const pm of (fm[1] ?? '').matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)/g)) {
      paramDefined.add(pm[1]);
    }
    for (const um of (fm[2] ?? '').matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)/g)) {
      paramDefined.add(um[1]);
    }

    const bodyOccs = collectVariablesInSlice(
      maskedCode,
      openBraceIdx + 1,
      closeBraceIdx - 1,
      doubleQuoteRanges
    );

    // Exclude occurrences belonging to nested closures inside this function
    // (we'll evaluate nested closures on their own iteration of `funcHeaderRegex`!)
    // Actually let's check nested `function (` inside body:
    const nestedSpans: Array<{ s: number; e: number }> = [];
    const innerSub = maskedCode.slice(openBraceIdx + 1, closeBraceIdx - 1);
    for (const nfm of innerSub.matchAll(/\bfunction\s*\([^)]*\)[^{;]*\{/g)) {
      const ns = openBraceIdx + 1 + (nfm.index ?? 0);
      const nb = ns + nfm[0].length - 1;
      let nd = 1;
      let np = nb + 1;
      while (np < closeBraceIdx - 1 && nd > 0) {
        if (maskedCode[np] === '{') nd++;
        else if (maskedCode[np] === '}') nd--;
        np++;
      }
      nestedSpans.push({ s: ns, e: np });
    }

    const ownOccs = bodyOccs.filter(
      (o) => !nestedSpans.some((sp) => o.startOffset >= sp.s && o.endOffset <= sp.e)
    );

    const definedInFunc = new Set<string>(paramDefined);
    for (const o of ownOccs) {
      if (o.isWrite) {
        definedInFunc.add(o.name);
        continue;
      }
      const beforeSlice = maskedCode.slice(Math.max(openBraceIdx, o.startOffset - 24), o.startOffset);
      if (/\b(?:isset|empty)\s*\(\s*$/.test(beforeSlice)) {
        definedInFunc.add(o.name);
      }
    }

    const candidateNames = [
      ...Array.from(definedInFunc),
      ...Array.from(fileWideWrittenVars)
    ];

    for (const o of ownOccs) {
      if (o.isWrite || PHP_BUILTIN_VARS.has(o.name) || definedInFunc.has(o.name)) {
        continue;
      }
      // Ignore variables explicitly guarded by `isset($x)` or `empty($x)`!
      const beforeSlice = maskedCode.slice(Math.max(openBraceIdx, o.startOffset - 24), o.startOffset);
      if (/\b(?:isset|empty)\s*\(\s*$/.test(beforeSlice)) {
        continue;
      }

      const start = offsetToLineCol(lineStarts, o.startOffset);
      const end = offsetToLineCol(lineStarts, o.endOffset);
      const closest = findClosestIdentifiers(o.name, candidateNames, 3);
      const quickFixes: SqlQuickFixOption[] = closest.map((c) => ({
        title: `Perbaiki nama variabel menjadi '$${c}'`,
        replacement: `$${c}`
      }));

      if (fileWideWrittenVars.has(o.name) || ['page', 'query', 'pegawai', 'db_conn'].includes(o.name)) {
        quickFixes.unshift({
          title: `Variabel global? Gunakan '$GLOBALS['${o.name}']'`,
          replacement: `$GLOBALS['${o.name}']`
        });
      }

      diagnostics.push({
        line: start.line,
        startColumn: start.col,
        endColumn: end.col,
        variableName: `$${o.name}`,
        message:
          closest.length > 0
            ? `Variabel "$${o.name}" belum didefinisikan di dalam fungsi ini. Maksud Anda "$${closest[0]}"?`
            : `Variabel "$${o.name}" belum didefinisikan di dalam fungsi ini (tambahkan ke parameter atau deklarasikan 'global $${o.name};').`,
        quickFixes
      });
    }
  }

  // Top-level scope: only flag clear spelling typos (length >= 5, close Levenshtein match to a written variable in the file)
  // so globals from `include 'connect_db.php'` never produce false positives!
  const topLevelOccs = allFileOccurrences.filter(
    (o) => !funcRanges.some((fr) => o.startOffset >= fr.start && o.endOffset <= fr.end)
  );
  const writtenArr = Array.from(fileWideWrittenVars);

  for (const o of topLevelOccs) {
    if (
      o.isWrite ||
      o.name.length < 5 ||
      PHP_BUILTIN_VARS.has(o.name) ||
      fileWideWrittenVars.has(o.name) ||
      ['page', 'query', 'pegawai', 'db_conn'].includes(o.name)
    ) {
      continue;
    }
    const beforeSlice = maskedCode.slice(Math.max(0, o.startOffset - 24), o.startOffset);
    if (/\b(?:isset|empty)\s*\(\s*$/.test(beforeSlice)) continue;

    const closest = findClosestIdentifiers(o.name, writtenArr, 2).filter((cand) => {
      // Must share prefix or be within <= 2 edits so unrelated included globals aren't flagged
      return Math.abs(cand.length - o.name.length) <= 2;
    });

    if (closest.length > 0) {
      const start = offsetToLineCol(lineStarts, o.startOffset);
      const end = offsetToLineCol(lineStarts, o.endOffset);
      diagnostics.push({
        line: start.line,
        startColumn: start.col,
        endColumn: end.col,
        variableName: `$${o.name}`,
        message: `Kemungkinan salah ketik variabel "$${o.name}" (belum pernah diisi di file ini). Maksud Anda "$${closest[0]}"?`,
        quickFixes: closest.map((c) => ({
          title: `Perbaiki nama variabel menjadi '$${c}'`,
          replacement: `$${c}`
        }))
      });
    }
  }

  return diagnostics;
}
