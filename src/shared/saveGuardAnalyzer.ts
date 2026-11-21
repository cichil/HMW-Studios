export type SaveHazardKind =
  | 'php-debug-trap'
  | 'js-debug-trap'
  | 'merge-conflict'
  | 'script-brace-mismatch';

export interface SaveHazardItem {
  line: number;
  kind: SaveHazardKind;
  severity: 'critical' | 'warning';
  snippet: string;
  message: string;
  autoRemovable: boolean;
}

export interface PreSaveHazardReport {
  hasHazards: boolean;
  hasAutoRemovable: boolean;
  items: SaveHazardItem[];
}

function isCommentedLine(trimmed: string): boolean {
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('<!--')
  );
}

/**
 * Checks whether a <script> or JS code block has severely mismatched curly braces
 * (ignoring strings, regexes, comments, and embedded PHP tags `<?php ... ?>` / `<?= ... ?>`).
 */
function checkJsBraceBalance(jsCode: string): { balanced: boolean; delta: number } {
  // Strip embedded PHP blocks first so PHP braces inside <script> don't confuse JS balance
  const withoutPhp = jsCode.replace(/<\?(?:php|=)[\s\S]*?\?>/gi, '0');
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < withoutPhp.length; i++) {
    const ch = withoutPhp[i];
    const next = withoutPhp[i + 1];

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inSingle) {
      if (ch === '\\') i++;
      else if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '\\') i++;
      else if (ch === '"') inDouble = false;
      continue;
    }
    if (inTemplate) {
      if (ch === '\\') i++;
      else if (ch === '`') inTemplate = false;
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === '`') {
      inTemplate = true;
      continue;
    }

    if (ch === '{') depth++;
    else if (ch === '}') depth--;
  }

  return { balanced: depth === 0, delta: depth };
}

export function analyzePreSaveHazards(opts: {
  content: string;
  previousSavedContent?: string;
  language: string;
  fileName: string;
  isProduction?: boolean;
}): PreSaveHazardReport {
  const { content, previousSavedContent, language, fileName, isProduction = false } = opts;
  const lines = content.split(/\r?\n/);
  const prevLineSet = new Set(
    (previousSavedContent ?? '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
  );

  const items: SaveHazardItem[] = [];
  const lowerName = fileName.toLowerCase();
  const isPhpLike = language === 'php' || lowerName.endsWith('.php');
  const isJsLike =
    language === 'javascript' ||
    language === 'typescript' ||
    lowerName.endsWith('.js') ||
    lowerName.endsWith('.ts');

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // 1. Git Merge Conflict Markers (always critical, regardless of previous content!)
    if (/^(?:<<<<<<<\s|=======$|>>>>>>>\s)/.test(trimmed)) {
      items.push({
        line: i + 1,
        kind: 'merge-conflict',
        severity: 'critical',
        snippet: trimmed.slice(0, 90),
        message: 'Marker konflik Git (`<<<<<<<` / `=======` / `>>>>>>>`) belum diselesaikan!',
        autoRemovable: false
      });
      continue;
    }

    if (isCommentedLine(trimmed)) continue;

    // Only flag debug traps if newly added in this edit OR saving directly to a PRODUCTION server
    const isNewlyAdded = !prevLineSet.has(trimmed);
    if (!isNewlyAdded && !isProduction) continue;

    // 2. PHP Debug Traps (carefully ignoring normal `or die(...)` DB error guards!)
    if (isPhpLike) {
      const hasVarDumpOrDd =
        /\b(?:var_dump|dd|dump)\s*\(/.test(trimmed) ||
        (/\bprint_r\s*\(/.test(trimmed) && !/,\s*true\s*\)/.test(trimmed));
      const hasStandaloneDebugDie =
        /^(?:die|exit)\s*\(\s*(?:\$[A-Za-z_]|['"]tes|['"]debug|['"]cek|\))?/i.test(trimmed) &&
        !/\bor\s+(?:die|exit)\b/i.test(trimmed);

      if (hasVarDumpOrDd || hasStandaloneDebugDie) {
        const cleanStandalone =
          /^(?:<\?php\s*)?(?:var_dump|print_r|dd|dump)\s*\([^;]*\)\s*;\s*(?:(?:die|exit)\s*(?:\([^;]*\))?\s*;\s*)?(?:\?>)?$/i.test(
            trimmed
          ) || /^(?:die|exit)\s*\(\s*\)\s*;$/i.test(trimmed);

        items.push({
          line: i + 1,
          kind: 'php-debug-trap',
          severity: isProduction ? 'critical' : 'warning',
          snippet: trimmed.slice(0, 100),
          message: hasVarDumpOrDd
            ? 'Jebakan debug PHP (`var_dump` / `print_r` / `dd`) terdeteksi sebelum simpan ke server.'
            : 'Pemanggilan `die()` / `exit()` debug terdeteksi.',
          autoRemovable: cleanStandalone
        });
        continue;
      }
    }

    // 3. JavaScript `debugger;` trap
    if (isPhpLike || isJsLike || language === 'html') {
      if (/^\bdebugger\s*;?$/.test(trimmed)) {
        items.push({
          line: i + 1,
          kind: 'js-debug-trap',
          severity: 'warning',
          snippet: trimmed,
          message: 'Statement `debugger;` JavaScript tertinggal (akan menghentikan browser user saat DevTools terbuka).',
          autoRemovable: true
        });
      }
    }
  }

  // 4. Check JS / embedded <script> curly brace balance
  if (isJsLike) {
    const bal = checkJsBraceBalance(content);
    if (!bal.balanced) {
      items.push({
        line: lines.length,
        kind: 'script-brace-mismatch',
        severity: 'critical',
        snippet: `Selisih kurung kurawal '{' vs '}': ${bal.delta > 0 ? `+${bal.delta} belum ditutup` : `${bal.delta} kelebihan tutup`}`,
        message: 'Kurung kurawal `{ ... }` JavaScript tidak seimbang!',
        autoRemovable: false
      });
    }
  } else if (isPhpLike || language === 'html') {
    const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    let m: RegExpExecArray | null;
    while ((m = scriptRegex.exec(content)) !== null) {
      const scriptBody = m[1];
      if (!scriptBody.trim()) continue;
      const bal = checkJsBraceBalance(scriptBody);
      if (!bal.balanced) {
        const lineBefore = content.slice(0, m.index).split(/\r?\n/).length;
        items.push({
          line: lineBefore,
          kind: 'script-brace-mismatch',
          severity: 'critical',
          snippet: `<script> pada baris ${lineBefore} (${bal.delta > 0 ? `${bal.delta} '{' belum ditutup` : `${Math.abs(bal.delta)} '}' berlebih`})`,
          message: 'Kurung kurawal `{ ... }` di dalam blok `<script>` tidak seimbang!',
          autoRemovable: false
        });
      }
    }
  }

  return {
    hasHazards: items.length > 0,
    hasAutoRemovable: items.some((it) => it.autoRemovable),
    items
  };
}

export function stripAutoRemovableDebugTraps(
  content: string,
  items: SaveHazardItem[]
): string {
  const removableLineNums = new Set(
    items.filter((it) => it.autoRemovable).map((it) => it.line)
  );
  if (removableLineNums.size === 0) return content;

  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  const filtered: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    if (!removableLineNums.has(lineNo)) {
      filtered.push(lines[i]);
      continue;
    }
    // If line had `<?php var_dump($x); ?>` inline inside HTML, remove cleanly; if standalone inside PHP block, drop line
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('<?php') && !trimmed.endsWith('?>')) {
      filtered.push('<?php');
    } else if (!trimmed.startsWith('<?php') && trimmed.endsWith('?>')) {
      filtered.push('?>');
    }
  }

  return filtered.join(eol);
}
