const VOID_HTML_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr'
]);

function formatJson(code: string): string {
  try {
    const parsed = JSON.parse(code);
    return `${JSON.stringify(parsed, null, 2)}\n`;
  } catch {
    return formatBraceAndHtmlCode(code, '  ', false);
  }
}

function formatSql(code: string): string {
  // Uppercase kata kunci utama SQL di luar string literal & rapikan baris klausa utama
  let out = '';
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < code.length; i += 1) {
    const ch = code[i];
    const next = code[i + 1] ?? '';

    if (inLineComment) {
      out += ch;
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      out += ch;
      if (ch === '*' && next === '/') {
        out += '/';
        i += 1;
        inBlockComment = false;
      }
      continue;
    }
    if (inSingle) {
      out += ch;
      if (ch === '\\' && next) {
        out += next;
        i += 1;
      } else if (ch === "'" && next === "'") {
        out += "'";
        i += 1;
      } else if (ch === "'") {
        inSingle = false;
      }
      continue;
    }
    if (inDouble) {
      out += ch;
      if (ch === '\\' && next) {
        out += next;
        i += 1;
      } else if (ch === '"') {
        inDouble = false;
      }
      continue;
    }
    if (inBacktick) {
      out += ch;
      if (ch === '`') inBacktick = false;
      continue;
    }

    if (ch === '-' && next === '-') {
      inLineComment = true;
      out += '--';
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      out += '/*';
      i += 1;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      out += ch;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      out += ch;
      continue;
    }
    if (ch === '`') {
      inBacktick = true;
      out += ch;
      continue;
    }

    if (/[a-zA-Z_]/.test(ch)) {
      let j = i;
      while (j < code.length && /[a-zA-Z0-9_]/.test(code[j])) j += 1;
      const word = code.slice(i, j);
      const upper = word.toUpperCase();
      const SQL_KEYWORDS = new Set([
        'SELECT',
        'DISTINCT',
        'FROM',
        'WHERE',
        'AND',
        'OR',
        'NOT',
        'IN',
        'IS',
        'NULL',
        'LIKE',
        'BETWEEN',
        'JOIN',
        'LEFT',
        'RIGHT',
        'INNER',
        'OUTER',
        'ON',
        'AS',
        'GROUP',
        'BY',
        'HAVING',
        'ORDER',
        'ASC',
        'DESC',
        'LIMIT',
        'OFFSET',
        'INSERT',
        'INTO',
        'VALUES',
        'UPDATE',
        'SET',
        'DELETE',
        'CREATE',
        'ALTER',
        'DROP',
        'TABLE',
        'INDEX',
        'VIEW',
        'PRIMARY',
        'KEY',
        'FOREIGN',
        'REFERENCES',
        'DEFAULT',
        'CASE',
        'WHEN',
        'THEN',
        'ELSE',
        'END',
        'UNION',
        'ALL',
        'EXISTS',
        'COUNT',
        'SUM',
        'AVG',
        'MIN',
        'MAX',
        'COALESCE'
      ]);
      out += SQL_KEYWORDS.has(upper) ? upper : word;
      i = j - 1;
      continue;
    }

    out += ch;
  }

  const lines = out
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+$/g, ''));

  let indent = 0;
  const formatted: string[] = [];
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) {
      if (formatted.length > 0 && formatted[formatted.length - 1] !== '') {
        formatted.push('');
      }
      continue;
    }
    if (trimmed.startsWith(')')) {
      indent = Math.max(0, indent - 1);
    }
    const subClause = /^(AND|OR|ON|WHEN|THEN|ELSE)\b/i.test(trimmed) ? '  ' : '';
    formatted.push(`${'  '.repeat(indent)}${subClause}${trimmed}`);
    const openParens = (trimmed.match(/\(/g) ?? []).length;
    const closeParens = (trimmed.match(/\)/g) ?? []).length;
    const delta = openParens - closeParens + (trimmed.startsWith(')') ? 1 : 0);
    indent = Math.max(0, indent + delta);
  }

  return `${formatted.join('\n').trimEnd()}\n`;
}

/**
 * Formatter kode stateful untuk PHP (termasuk campuran PHP + HTML + string SQL multi-baris),
 * HTML, CSS/SCSS, dan JavaScript/TypeScript.
 * Menjaga isi string multi-baris dan heredoc tetap utuh 100% tanpa merusak spasi di dalam string.
 */
function formatBraceAndHtmlCode(
  code: string,
  indentUnit: string,
  isPhpOrHtml: boolean
): string {
  const rawLines = code.split(/\r?\n/);
  const resultLines: string[] = [];

  let indentLevel = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let inBlockComment = false;
  let heredocTag: string | null = null;
  let inPhpTag = false;
  let consecutiveBlankLines = 0;

  for (let lineIdx = 0; lineIdx < rawLines.length; lineIdx += 1) {
    const rawLine = rawLines[lineIdx];
    const startedInsideString =
      inSingleQuote || inDoubleQuote || inBacktick || heredocTag !== null;
    const startedInsideBlockComment = inBlockComment;

    if (heredocTag !== null) {
      // Baris penutup heredoc PHP: misal `SQL;` atau `EOT`
      resultLines.push(rawLine);
      const trimmedHeredoc = rawLine.trim();
      if (
        trimmedHeredoc === heredocTag ||
        trimmedHeredoc === `${heredocTag};`
      ) {
        heredocTag = null;
      }
      continue;
    }

    // Jika baris dimulai dari dalam string multi-baris (contoh: query SQL multi-baris di PHP),
    // JANGAN ubah spasi/indentasi baris tersebut agar isi string tetap murni!
    if (startedInsideString) {
      resultLines.push(rawLine);
      // Tetap pindai karakter pada baris ini untuk mendeteksi penutup string & buka blok sesudahnya
      let netOpenAfterString = 0;
      for (let i = 0; i < rawLine.length; i += 1) {
        const ch = rawLine[i];
        const next = rawLine[i + 1] ?? '';
        if (inSingleQuote) {
          if (ch === '\\') i += 1;
          else if (ch === "'") inSingleQuote = false;
          continue;
        }
        if (inDoubleQuote) {
          if (ch === '\\') i += 1;
          else if (ch === '"') inDoubleQuote = false;
          continue;
        }
        if (inBacktick) {
          if (ch === '\\') i += 1;
          else if (ch === '`') inBacktick = false;
          continue;
        }
        if (ch === '/' && next === '/') break;
        if (ch === '#') break;
        if (ch === '/' && next === '*') {
          inBlockComment = true;
          i += 1;
          continue;
        }
        if (inBlockComment) {
          if (ch === '*' && next === '/') {
            inBlockComment = false;
            i += 1;
          }
          continue;
        }
        if (ch === "'") inSingleQuote = true;
        else if (ch === '"') inDoubleQuote = true;
        else if (ch === '`') inBacktick = true;
        else if (ch === '{' || ch === '[') netOpenAfterString += 1;
        else if (ch === '}' || ch === ']') netOpenAfterString -= 1;
      }
      if (netOpenAfterString !== 0) {
        indentLevel = Math.max(0, indentLevel + netOpenAfterString);
      }
      continue;
    }

    const trimmed = rawLine.trim();
    if (!trimmed) {
      consecutiveBlankLines += 1;
      if (consecutiveBlankLines <= 2) {
        resultLines.push('');
      }
      continue;
    }
    consecutiveBlankLines = 0;

    if (startedInsideBlockComment) {
      const prefix = trimmed.startsWith('*') ? ' ' : '   ';
      resultLines.push(`${indentUnit.repeat(indentLevel)}${prefix}${trimmed}`);
      if (trimmed.includes('*/')) {
        inBlockComment = false;
      }
      continue;
    }

    // Hitung dedent di awal baris (sebelum baris dicetak)
    let leadingDedent = 0;
    const startsWithClosingBrace = /^[}\])]/.test(trimmed);
    const startsWithPhpAltMidOrEnd =
      isPhpOrHtml &&
      /^(?:endif|endforeach|endwhile|endswitch|endfor)\b/i.test(trimmed);
    const startsWithPhpAltMid =
      isPhpOrHtml && /^(?:else\s*:|elseif\b[^;]*:\s*$)/i.test(trimmed);
    const startsWithCaseDefault = /^(?:case\b.*:|default\s*:)/.test(trimmed);
    const startsWithClosingHtmlTag =
      isPhpOrHtml && !inPhpTag && /^<\/[a-zA-Z0-9:-]+>/.test(trimmed);

    if (
      startsWithClosingBrace ||
      startsWithPhpAltMidOrEnd ||
      startsWithPhpAltMid ||
      startsWithClosingHtmlTag
    ) {
      leadingDedent = 1;
    }

    const effectiveIndent = Math.max(
      0,
      indentLevel - leadingDedent - (startsWithCaseDefault ? 0 : 0)
    );
    const formattedLine = `${indentUnit.repeat(effectiveIndent)}${trimmed}`;
    resultLines.push(formattedLine);

    // Pindai token di sepanjang baris untuk menentukan indentLevel baris berikutnya
    let netBraceDelta = 0;
    let codeOutsideComments = '';

    for (let i = 0; i < trimmed.length; i += 1) {
      const ch = trimmed[i];
      const next = trimmed[i + 1] ?? '';

      if (inBlockComment) {
        if (ch === '*' && next === '/') {
          inBlockComment = false;
          i += 1;
        }
        continue;
      }

      if (inSingleQuote) {
        if (ch === '\\') i += 1;
        else if (ch === "'") inSingleQuote = false;
        continue;
      }

      if (inDoubleQuote) {
        if (ch === '\\') i += 1;
        else if (ch === '"') inDoubleQuote = false;
        continue;
      }

      if (inBacktick) {
        if (ch === '\\') i += 1;
        else if (ch === '`') inBacktick = false;
        continue;
      }

      if (isPhpOrHtml) {
        if (trimmed.slice(i, i + 5).toLowerCase() === '<?php') {
          inPhpTag = true;
        } else if (trimmed.slice(i, i + 3) === '<?=') {
          inPhpTag = true;
        } else if (ch === '?' && next === '>') {
          inPhpTag = false;
          i += 1;
          continue;
        }
      }

      // Deteksi heredoc / nowdoc PHP: <<<SQL atau <<<'SQL' atau <<<"SQL"
      if (
        isPhpOrHtml &&
        inPhpTag &&
        ch === '<' &&
        next === '<' &&
        trimmed[i + 2] === '<'
      ) {
        const rest = trimmed.slice(i + 3).trim();
        const hdMatch = rest.match(/^['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?$/);
        if (hdMatch) {
          heredocTag = hdMatch[1];
          break;
        }
      }

      if (ch === '/' && next === '/') break;
      if (inPhpTag && ch === '#') break;
      if (ch === '/' && next === '*') {
        inBlockComment = true;
        i += 1;
        continue;
      }
      if (isPhpOrHtml && !inPhpTag && trimmed.slice(i, i + 4) === '<!--') {
        const endHtmlComment = trimmed.indexOf('-->', i + 4);
        if (endHtmlComment === -1) break;
        i = endHtmlComment + 2;
        continue;
      }

      if (ch === "'") {
        inSingleQuote = true;
        continue;
      }
      if (ch === '"') {
        inDoubleQuote = true;
        continue;
      }
      if (ch === '`') {
        inBacktick = true;
        continue;
      }

      codeOutsideComments += ch;
      if (ch === '{' || ch === '[') {
        netBraceDelta += 1;
      } else if (ch === '}' || ch === ']') {
        netBraceDelta -= 1;
      }
    }

    // Jika baris dimulai dengan `}` / `]`, kita sudah mengurangkannya lewat leadingDedent;
    // sesuaikan agar tidak dikurangi dua kali.
    let totalDelta = netBraceDelta;

    // Dukungan PHP alternative syntax (`if (...):` ... `endif;`)
    if (isPhpOrHtml) {
      const strippedCode = codeOutsideComments.trim();
      if (/^(?:if|foreach|for|while|switch)\b[^;]*:\s*$/i.test(strippedCode)) {
        totalDelta += 1;
      }
      if (/^(?:endif|endforeach|endwhile|endswitch|endfor)\b/i.test(strippedCode)) {
        totalDelta -= 1;
      }

      // Hitung tag HTML pembuka vs penutup jika baris berada di mode HTML (di luar blok PHP murni)
      if (!inPhpTag && !startsWithClosingBrace) {
        const withoutPhpInline = trimmed.replace(/<\?(?:php|=)[\s\S]*?\?>/gi, '');
        const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9:-]*)\b[^>]*>/g;
        let tagMatch: RegExpExecArray | null;
        let htmlDelta = 0;
        while ((tagMatch = tagRegex.exec(withoutPhpInline)) !== null) {
          const fullTag = tagMatch[0];
          const tagName = tagMatch[1].toLowerCase();
          if (VOID_HTML_TAGS.has(tagName) || fullTag.endsWith('/>')) continue;
          if (fullTag.startsWith('</')) {
            htmlDelta -= 1;
          } else {
            htmlDelta += 1;
          }
        }
        totalDelta += htmlDelta;
      }
    }

    indentLevel = Math.max(0, indentLevel + totalDelta);
  }

  return `${resultLines.join('\n').trimEnd()}\n`;
}

export function formatCodeByLanguage(code: string, language: string): string {
  if (!code.trim()) return code;
  const lang = language.toLowerCase();

  if (lang === 'json') {
    return formatJson(code);
  }
  if (lang === 'sql') {
    return formatSql(code);
  }
  if (lang === 'php') {
    return formatBraceAndHtmlCode(code, '    ', true);
  }
  if (lang === 'html' || lang === 'xml') {
    return formatBraceAndHtmlCode(code, '  ', true);
  }
  if (
    lang === 'css' ||
    lang === 'scss' ||
    lang === 'less' ||
    lang === 'javascript' ||
    lang === 'typescript'
  ) {
    return formatBraceAndHtmlCode(code, '  ', false);
  }

  // Fallback untuk bahasa lain: bersihkan trailing whitespace berlebih
  return `${code
    .split(/\r?\n/)
    .map((l) => l.replace(/[ \t]+$/g, ''))
    .join('\n')
    .trimEnd()}\n`;
}
