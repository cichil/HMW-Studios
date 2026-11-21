export interface LocalPhpFixDiagnosticInput {
  line: number;
  message: string;
}

export interface LocalPhpFixCandidate {
  ruleId: string;
  description: string;
  fixedCode: string;
}

function splitTrailingComment(line: string): { codePart: string; commentPart: string } {
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if ((ch === '/' && line[i + 1] === '/') || (ch === '#' && line[i + 1] !== '[')) {
      const codeRaw = line.slice(0, i);
      const trimmedEnd = codeRaw.replace(/\s+$/, '');
      const wsBetween = codeRaw.slice(trimmedEnd.length);
      return { codePart: trimmedEnd, commentPart: `${wsBetween}${line.slice(i)}` };
    }
    if (ch === '/' && line[i + 1] === '*') {
      const closeIdx = line.indexOf('*/', i + 2);
      if (closeIdx < 0) {
        const codeRaw = line.slice(0, i);
        const trimmedEnd = codeRaw.replace(/\s+$/, '');
        const wsBetween = codeRaw.slice(trimmedEnd.length);
        return { codePart: trimmedEnd, commentPart: `${wsBetween}${line.slice(i)}` };
      }
      i = closeIdx + 1;
    }
  }
  const trimmedEnd = line.replace(/\s+$/, '');
  return { codePart: trimmedEnd, commentPart: line.slice(trimmedEnd.length) };
}

function countUnquotedDelimiters(text: string): {
  paren: number;
  bracket: number;
  brace: number;
  unclosedQuote: "'" | '"' | null;
} {
  let quote: "'" | '"' | null = null;
  let inBlockComment = false;
  let paren = 0;
  let bracket = 0;
  let brace = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1] ?? '';

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    if ((ch === '/' && next === '/') || (ch === '#' && next !== '[')) {
      const nl = text.indexOf('\n', i);
      if (nl < 0) break;
      i = nl;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === '(') paren++;
    else if (ch === ')') paren--;
    else if (ch === '[') bracket++;
    else if (ch === ']') bracket--;
    else if (ch === '{') brace++;
    else if (ch === '}') brace--;
  }

  return { paren, bracket, brace, unclosedQuote: quote };
}

function findPrevCodeLineIndex(lines: string[], fromIdx: number): number {
  for (let i = fromIdx - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (!t) continue;
    if (t.startsWith('//') || t.startsWith('#') || t.startsWith('/*') || t.startsWith('*')) {
      continue;
    }
    return i;
  }
  return -1;
}

function replaceLine(lines: string[], idx: number, nextLine: string, eol: string): string {
  const copy = [...lines];
  copy[idx] = nextLine;
  return copy.join(eol);
}

function extractUnexpectedToken(message: string): {
  kind: string;
  literal: string | null;
  rawQuoted: string | null;
} {
  // Examples:
  // syntax error, unexpected string "096510%", expecting ")"
  // syntax error, unexpected double-quoted string "096510%", expecting ")"
  // syntax error, unexpected single-quoted string "abc", expecting ","
  // syntax error, unexpected variable "$nama", expecting ";" or ","
  // syntax error, unexpected token ")", expecting ";"
  // syntax error, unexpected identifier "foo", expecting ";"
  const m = message.match(
    /unexpected\s+([a-zA-Z0-9 _-]+?)\s+"([^"]+)"/i
  );
  if (m) {
    return {
      kind: m[1].trim().toLowerCase(),
      literal: m[2],
      rawQuoted: `"${m[2]}"`
    };
  }
  const m2 = message.match(/unexpected\s+'([^']+)'/i);
  if (m2) {
    return {
      kind: 'token',
      literal: m2[1],
      rawQuoted: `'${m2[1]}'`
    };
  }
  return { kind: '', literal: null, rawQuoted: null };
}

function findTokenPositionsInLine(line: string, literal: string): number[] {
  const positions: number[] = [];
  if (!literal) return positions;
  const searchVariants = Array.from(
    new Set([`"${literal}"`, `'${literal}'`, literal])
  );
  for (const variant of searchVariants) {
    let idx = line.indexOf(variant);
    while (idx >= 0) {
      positions.push(idx);
      idx = line.indexOf(variant, idx + 1);
    }
    if (positions.length > 0) break;
  }
  return positions;
}

function insertBeforeLineTerminator(line: string, insertStr: string): string {
  const { codePart, commentPart } = splitTrailingComment(line);
  if (/;\s*$/.test(codePart)) {
    return `${codePart.replace(/;\s*$/, `${insertStr};`)}${commentPart}`;
  }
  if (/\{\s*$/.test(codePart)) {
    return `${codePart.replace(/\{\s*$/, `${insertStr} {`)}${commentPart}`;
  }
  if (/:\s*$/.test(codePart)) {
    return `${codePart.replace(/:\s*$/, `${insertStr}:`)}${commentPart}`;
  }
  return `${codePart}${insertStr}${commentPart}`;
}

/**
 * Menghasilkan daftar kandidat perbaikan sintaks PHP secara lokal/offline (tanpa AI)
 * berdasarkan nomor baris & pesan error parser PHP (`php -l`).
 * Setiap kandidat selanjutnya diverifikasi langsung oleh `php -l` agar 100% valid.
 */
export function generateLocalPhpSyntaxFixCandidates(
  code: string,
  diag: LocalPhpFixDiagnosticInput
): LocalPhpFixCandidate[] {
  const eol = code.includes('\r\n') ? '\r\n' : '\n';
  const lines = code.split(/\r?\n/);
  if (lines.length === 0) return [];

  const errIdx = Math.max(0, Math.min(lines.length - 1, (diag.line || 1) - 1));
  const errLine = lines[errIdx];
  const prevIdx = findPrevCodeLineIndex(lines, errIdx);
  const prevLine = prevIdx >= 0 ? lines[prevIdx] : '';
  const msg = diag.message || '';
  const msgLow = msg.toLowerCase();

  const candidates: LocalPhpFixCandidate[] = [];
  const seenCode = new Set<string>([code]);

  const addCandidate = (ruleId: string, description: string, fixedCode: string): void => {
    if (!fixedCode || seenCode.has(fixedCode)) return;
    seenCode.add(fixedCode);
    candidates.push({ ruleId, description, fixedCode });
  };

  const unexpected = extractUnexpectedToken(msg);
  const expectsParen = /expecting\s+["']\)["']/i.test(msg) || /unclosed\s+["']\(["']/i.test(msg);
  const expectsBracket = /expecting\s+["']\]["']/i.test(msg) || /unclosed\s+["']\[["']/i.test(msg);
  const expectsSemicolon = /expecting\s+["'];["']/i.test(msg);
  const expectsComma = /expecting[^;]*["'],["']/i.test(msg);
  const isUnexpectedEof = /unexpected\s+end\s+of\s+file/i.test(msg);
  const isStringUnexpected =
    unexpected.kind.includes('string') || unexpected.kind.includes('encapsed');

  // 1. Kasus khusus: `unexpected string "..."` (misal: `LIKE "096510%"` di dalam string `"..."` atau lupa `.` / `,`)
  if (unexpected.literal) {
    const tokenHits = findTokenPositionsInLine(errLine, unexpected.literal);

    // 1A. Kutip ganda tidak di-escape di dalam string kutip ganda (sangat umum pada query SQL PHP!)
    // Contoh: mysql("SELECT ... WHERE kd LIKE "096510%"") -> mysql("SELECT ... WHERE kd LIKE '096510%'")
    if (isStringUnexpected || expectsParen) {
      const doubleQuotedLiteral = `"${unexpected.literal}"`;
      if (errLine.includes(doubleQuotedLiteral)) {
        // Prioritas 1: ubah kutip dalam menjadi kutip tunggal `'...'` (idiomatik SQL / HTML)
        addCandidate(
          'inner-double-to-single-quote',
          `Mengubah kutip ganda dalam ${doubleQuotedLiteral} menjadi kutip tunggal '${unexpected.literal}' pada baris ${errIdx + 1}`,
          replaceLine(
            lines,
            errIdx,
            errLine.replace(doubleQuotedLiteral, `'${unexpected.literal}'`),
            eol
          )
        );
        // Prioritas 2: escape kutip ganda dalam menjadi `\"...\"`
        addCandidate(
          'escape-inner-double-quote',
          `Menambahkan escape backslash pada kutip ganda ${doubleQuotedLiteral} di baris ${errIdx + 1}`,
          replaceLine(
            lines,
            errIdx,
            errLine.replace(doubleQuotedLiteral, `\\"${unexpected.literal}\\"`),
            eol
          )
        );
      }

      // Sama untuk kutip tunggal di dalam kutip tunggal
      const singleQuotedLiteral = `'${unexpected.literal}'`;
      if (errLine.includes(singleQuotedLiteral)) {
        addCandidate(
          'escape-inner-single-quote',
          `Menambahkan escape backslash pada kutip tunggal ${singleQuotedLiteral} di baris ${errIdx + 1}`,
          replaceLine(
            lines,
            errIdx,
            errLine.replace(singleQuotedLiteral, `\\'${unexpected.literal}\\'`),
            eol
          )
        );
      }

      // Cek pola lebih luas: kutip ganda bertabrakan pada baris error di dekat angka/teks literal
      const escapedLit = unexpected.literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const unescapedInnerRx = new RegExp(`(["'])([^"']*?)"(${escapedLit})"`, 'g');
      if (unescapedInnerRx.test(errLine)) {
        addCandidate(
          'sql-inner-quote-fix',
          `Memperbaiki kutip bertabrakan di sekitar "${unexpected.literal}" pada baris ${errIdx + 1}`,
          replaceLine(
            lines,
            errIdx,
            errLine.replace(
              new RegExp(`"(${escapedLit})"`, 'g'),
              `'${unexpected.literal}'`
            ),
            eol
          )
        );
      }
    }

    // 1B. Lupa operator penggabung `.` atau pemisah argumen `,` tepat sebelum token yang tidak terduga
    for (const pos of tokenHits) {
      if (pos <= 0) continue;
      const before = errLine.slice(0, pos);
      const after = errLine.slice(pos);
      const beforeTrim = before.replace(/\s+$/, '');
      const ws = before.slice(beforeTrim.length) || ' ';

      // Jika sebelumnya string/variabel/ekspresi, coba sisipkan `.` dan `,`
      const looksLikeConcat =
        /["')\]0-9A-Za-z_]$/.test(beforeTrim) && !/[.,(\[=+\-*/?:!&|]$/.test(beforeTrim);
      if (looksLikeConcat) {
        // Di dalam pemanggilan fungsi (`expecting ")"`), coba `,` & `.` (urutan berdasarkan konteks)
        const prevEndsWithString = /["']$/.test(beforeTrim);
        if (prevEndsWithString || !expectsParen) {
          addCandidate(
            'insert-concat-dot',
            `Menambahkan operator penggabung string "." sebelum ${unexpected.rawQuoted ?? unexpected.literal} pada baris ${errIdx + 1}`,
            replaceLine(lines, errIdx, `${beforeTrim} . ${after}`, eol)
          );
          if (expectsParen || expectsComma || expectsBracket) {
            addCandidate(
              'insert-missing-comma',
              `Menambahkan tanda koma "," sebelum ${unexpected.rawQuoted ?? unexpected.literal} pada baris ${errIdx + 1}`,
              replaceLine(lines, errIdx, `${beforeTrim},${ws}${after}`, eol)
            );
          }
        } else {
          addCandidate(
            'insert-missing-comma',
            `Menambahkan tanda koma "," sebelum ${unexpected.rawQuoted ?? unexpected.literal} pada baris ${errIdx + 1}`,
            replaceLine(lines, errIdx, `${beforeTrim},${ws}${after}`, eol)
          );
          addCandidate(
            'insert-concat-dot',
            `Menambahkan operator penggabung string "." sebelum ${unexpected.rawQuoted ?? unexpected.literal} pada baris ${errIdx + 1}`,
            replaceLine(lines, errIdx, `${beforeTrim} . ${after}`, eol)
          );
        }
      }

      // Coba tutup kurung `)` tepat sebelum token jika baris kelebihan `(`
      if (expectsParen) {
        addCandidate(
          'insert-closing-paren-before-token',
          `Menambahkan kurung tutup ")" sebelum ${unexpected.rawQuoted ?? unexpected.literal} pada baris ${errIdx + 1}`,
          replaceLine(lines, errIdx, `${beforeTrim})${ws}${after}`, eol)
        );
      }
    }
  }

  // 1C. Deteksi umum kutip ganda/tunggal bersarang tidak di-escape pada baris error
  // Contoh: sprintf("SELECT * FROM tbl WHERE kd LIKE "096510%"") atau "<div class="box">"
  // (PHP 8 sering melaporkan `Invalid numeric literal`, `unexpected identifier`, atau `unexpected string`)
  const findUnescapedQuoteIndices = (line: string, q: '"' | "'"): number[] => {
    const out: number[] = [];
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '\\') {
        i++;
        continue;
      }
      if (line[i] === q) out.push(i);
    }
    return out;
  };

  const dqIndices = findUnescapedQuoteIndices(errLine, '"');
  if (dqIndices.length >= 4 && dqIndices.length % 2 === 0) {
    // Ganti pasangan kutip dalam (indeks 1..n-2) menjadi kutip tunggal `'...'` (idiomatik SQL/HTML)
    const charsSingle = errLine.split('');
    for (let k = 1; k < dqIndices.length - 1; k++) {
      charsSingle[dqIndices[k]] = "'";
    }
    addCandidate(
      'nested-double-quotes-to-single',
      `Mengubah kutip ganda bersarang di dalam string menjadi kutip tunggal pada baris ${errIdx + 1}`,
      replaceLine(lines, errIdx, charsSingle.join(''), eol)
    );

    // Atau escape kutip ganda dalam menjadi `\"`
    let escapedLine = '';
    const innerSet = new Set(dqIndices.slice(1, -1));
    for (let i = 0; i < errLine.length; i++) {
      escapedLine += innerSet.has(i) ? '\\"' : errLine[i];
    }
    addCandidate(
      'nested-double-quotes-escaped',
      `Menambahkan escape backslash (\\") pada kutip ganda bersarang di baris ${errIdx + 1}`,
      replaceLine(lines, errIdx, escapedLine, eol)
    );
  }

  const sqIndices = findUnescapedQuoteIndices(errLine, "'");
  if (sqIndices.length >= 4 && sqIndices.length % 2 === 0) {
    let escapedSq = '';
    const innerSet = new Set(sqIndices.slice(1, -1));
    for (let i = 0; i < errLine.length; i++) {
      escapedSq += innerSet.has(i) ? "\\'" : errLine[i];
    }
    addCandidate(
      'nested-single-quotes-escaped',
      `Menambahkan escape backslash (\\') pada kutip tunggal bersarang di baris ${errIdx + 1}`,
      replaceLine(lines, errIdx, escapedSq, eol)
    );
  }

  // 1D. Perbaikan String Multi-Baris PHP (sangat umum pada query SQL ber-concatenation!)
  // Contoh nyata:
  //   "tanggapan like '%".$_GET["what"]."%')" : "").""
  //   order by tgl_input desc";
  // -> Kelebihan kutip ganda `""` di akhir baris sebelumnya, atau lupa kutip buka `"` di awal baris error,
  //    atau lupa operator `.` di akhir baris sebelumnya!
  if (prevIdx >= 0) {
    const { codePart: prevCode, commentPart: prevComment } = splitTrailingComment(prevLine);
    const { codePart: errCode } = splitTrailingComment(errLine);
    const errLeadingWs = errLine.match(/^(\s*)/)?.[1] ?? '';
    const errBody = errLine.slice(errLeadingWs.length);
    const errDqCount = findUnescapedQuoteIndices(errCode, '"').length;
    const errSqCount = findUnescapedQuoteIndices(errCode, "'").length;

    // (a) Baris sebelumnya berakhir dengan `""` (kutip ganda dobel tak sengaja) sementara baris error punya kutip ganjil
    if (prevCode.endsWith('""') && errDqCount % 2 === 1) {
      addCandidate(
        'multiline-trim-extra-double-quote-prev',
        `Menghapus tanda kutip ganda berlebih di akhir baris ${prevIdx + 1} agar string multi-baris tersambung`,
        replaceLine(lines, prevIdx, `${prevCode.slice(0, -1)}${prevComment}`, eol)
      );
    }

    // (b) Baris sebelumnya berakhir dengan `''` (kutip tunggal dobel tak sengaja) sementara baris error punya kutip ganjil
    if (prevCode.endsWith("''") && errSqCount % 2 === 1) {
      addCandidate(
        'multiline-trim-extra-single-quote-prev',
        `Menghapus tanda kutip tunggal berlebih di akhir baris ${prevIdx + 1} agar string multi-baris tersambung`,
        replaceLine(lines, prevIdx, `${prevCode.slice(0, -1)}${prevComment}`, eol)
      );
    }

    // (c) Baris error memiliki 1 kutip penutup di akhir (lupa kutip pembuka di awal baris!)
    if (errDqCount % 2 === 1 && !errBody.startsWith('"')) {
      if (prevCode.endsWith('.')) {
        addCandidate(
          'multiline-prepend-open-double-quote',
          `Menambahkan kutip pembuka '"' di awal baris ${errIdx + 1}`,
          replaceLine(lines, errIdx, `${errLeadingWs}"${errBody}`, eol)
        );
      } else if (/["')\]A-Za-z0-9_]$/.test(prevCode)) {
        addCandidate(
          'multiline-prepend-dot-and-open-double-quote',
          `Menambahkan operator penggabung '. "' di awal baris ${errIdx + 1}`,
          replaceLine(lines, errIdx, `${errLeadingWs}. "${errBody}`, eol)
        );
      }
    }
    if (errSqCount % 2 === 1 && !errBody.startsWith("'")) {
      if (prevCode.endsWith('.')) {
        addCandidate(
          'multiline-prepend-open-single-quote',
          `Menambahkan kutip pembuka "'" di awal baris ${errIdx + 1}`,
          replaceLine(lines, errIdx, `${errLeadingWs}'${errBody}`, eol)
        );
      } else if (/["')\]A-Za-z0-9_]$/.test(prevCode)) {
        addCandidate(
          'multiline-prepend-dot-and-open-single-quote',
          `Menambahkan operator penggabung ". '" di awal baris ${errIdx + 1}`,
          replaceLine(lines, errIdx, `${errLeadingWs}. '${errBody}`, eol)
        );
      }
    }

    // (d) Lupa operator penggabung `.` di akhir baris sebelumnya saat sambung string/ekspresi di baris berikutnya
    if (
      /["')\]A-Za-z0-9_]$/.test(prevCode) &&
      !/[;{},:.(\[=+\-*/?&|<>]$/.test(prevCode) &&
      /^["'$(]/.test(errBody)
    ) {
      addCandidate(
        'missing-concat-dot-prev-line',
        `Menambahkan operator penggabung string "." di akhir baris ${prevIdx + 1}`,
        replaceLine(lines, prevIdx, `${prevCode} .${prevComment}`, eol)
      );
    }
  }

  // 2. Lupa titik koma `;` pada baris sebelumnya (penyebab #1 error sintaks PHP!)
  if (prevIdx >= 0) {
    const { codePart: prevCode, commentPart: prevComment } = splitTrailingComment(prevLine);
    if (
      prevCode.length > 0 &&
      !/[;{},:(\[.=+\-*/?&|<>]$/.test(prevCode) &&
      !/<\?(?:php)?\s*$/i.test(prevCode) &&
      !/\?>\s*$/.test(prevCode)
    ) {
      addCandidate(
        'missing-semicolon-prev-line',
        `Menambahkan titik koma ";" yang hilang di akhir baris ${prevIdx + 1}`,
        replaceLine(lines, prevIdx, `${prevCode};${prevComment}`, eol)
      );
    }

    // 3. Lupa koma `,` di akhir baris sebelumnya (array multi-baris / argumen fungsi)
    if (
      (expectsParen || expectsBracket || expectsComma || /unexpected/i.test(msg)) &&
      prevCode.length > 0 &&
      !/[,;{(\[:]$/.test(prevCode) &&
      !/<\?(?:php)?\s*$/i.test(prevCode)
    ) {
      addCandidate(
        'missing-comma-prev-line',
        `Menambahkan tanda koma "," yang hilang di akhir baris ${prevIdx + 1}`,
        replaceLine(lines, prevIdx, `${prevCode},${prevComment}`, eol)
      );
    }
  }

  // 4. Lupa titik koma `;` pada baris error itu sendiri (mis. sebelum `?>` atau akhir file)
  if (expectsSemicolon || isUnexpectedEof || errLine.includes('?>')) {
    if (errLine.includes('?>') && !/;\s*\?>/.test(errLine)) {
      addCandidate(
        'missing-semicolon-before-close-tag',
        `Menambahkan titik koma ";" sebelum tag penutup "?>" pada baris ${errIdx + 1}`,
        replaceLine(lines, errIdx, errLine.replace(/\s*\?>/, '; ?>'), eol)
      );
    }
    const { codePart, commentPart } = splitTrailingComment(errLine);
    if (codePart.length > 0 && !/[;{},:(\[]$/.test(codePart)) {
      addCandidate(
        'missing-semicolon-curr-line',
        `Menambahkan titik koma ";" di akhir baris ${errIdx + 1}`,
        replaceLine(lines, errIdx, `${codePart};${commentPart}`, eol)
      );
    }
  }

  // 5. Kurung tutup `)` atau `]` hilang pada baris error atau baris sebelumnya
  const errCounts = countUnquotedDelimiters(errLine);
  if (expectsParen || errCounts.paren > 0) {
    const missingCount = Math.max(1, errCounts.paren);
    if (missingCount <= 3) {
      const closing = ')'.repeat(missingCount);
      addCandidate(
        'missing-closing-paren-curr',
        `Menambahkan ${missingCount} kurung tutup "${closing}" pada baris ${errIdx + 1}`,
        replaceLine(lines, errIdx, insertBeforeLineTerminator(errLine, closing), eol)
      );
    }
    if (prevIdx >= 0) {
      const prevCounts = countUnquotedDelimiters(prevLine);
      if (prevCounts.paren > 0 && prevCounts.paren <= 3) {
        const closing = ')'.repeat(prevCounts.paren);
        addCandidate(
          'missing-closing-paren-prev',
          `Menambahkan ${prevCounts.paren} kurung tutup "${closing}" pada baris ${prevIdx + 1}`,
          replaceLine(lines, prevIdx, insertBeforeLineTerminator(prevLine, closing), eol)
        );
      }
    }
  }

  if (expectsBracket || errCounts.bracket > 0) {
    const missingCount = Math.max(1, errCounts.bracket);
    if (missingCount <= 3) {
      const closing = ']'.repeat(missingCount);
      addCandidate(
        'missing-closing-bracket-curr',
        `Menambahkan ${missingCount} kurung siku tutup "${closing}" pada baris ${errIdx + 1}`,
        replaceLine(lines, errIdx, insertBeforeLineTerminator(errLine, closing), eol)
      );
    }
  }

  // 6. Kutip string belum ditutup pada baris error (`"..."` atau `'...'`)
  if (errCounts.unclosedQuote) {
    const q = errCounts.unclosedQuote;
    addCandidate(
      'close-unclosed-quote',
      `Menutup tanda kutip ${q} yang belum tertutup pada baris ${errIdx + 1}`,
      replaceLine(lines, errIdx, insertBeforeLineTerminator(errLine, q), eol)
    );
  }

  // 7. Kelebihan / salah ketik tanda tutup `)`, `]`, `}`, `;`, atau `,` pada baris error
  if (
    unexpected.literal &&
    [')', ']', '}', ';', ','].includes(unexpected.literal) &&
    errLine.includes(unexpected.literal)
  ) {
    const tok = unexpected.literal;
    const lastIdx = errLine.lastIndexOf(tok);
    if (lastIdx >= 0) {
      addCandidate(
        'remove-stray-closing-token',
        `Menghapus karakter "${tok}" berlebih pada baris ${errIdx + 1}`,
        replaceLine(
          lines,
          errIdx,
          `${errLine.slice(0, lastIdx)}${errLine.slice(lastIdx + tok.length)}`,
          eol
        )
      );
    }
    const firstIdx = errLine.indexOf(tok);
    if (firstIdx >= 0 && firstIdx !== lastIdx) {
      addCandidate(
        'remove-first-stray-token',
        `Menghapus karakter "${tok}" tidak valid pada baris ${errIdx + 1}`,
        replaceLine(
          lines,
          errIdx,
          `${errLine.slice(0, firstIdx)}${errLine.slice(firstIdx + tok.length)}`,
          eol
        )
      );
    }
  }

  // 8. Menggunakan `=` alih-alih `=>` pada pasangan key-value array (`'nama' = $val`)
  if (msgLow.includes('unexpected token "="') || msgLow.includes("unexpected '='")) {
    const arrayEq = errLine.replace(/(['"][^'"]+['"]\s*)=(?![=>])/, '$1=>');
    if (arrayEq !== errLine) {
      addCandidate(
        'array-assign-to-double-arrow',
        `Mengubah "=" menjadi "=>" pada elemen array di baris ${errIdx + 1}`,
        replaceLine(lines, errIdx, arrayEq, eol)
      );
    }
  }

  // 9. Sintaks lama PHP 7/8 curly-brace offset: `$arr{0}` -> `$arr[0]`
  if (/\$[A-Za-z_][A-Za-z0-9_]*\{[^}]+\}/.test(errLine)) {
    const fixedCurly = errLine.replace(/(\$[A-Za-z_][A-Za-z0-9_]*)\{([^}]+)\}/g, '$1[$2]');
    if (fixedCurly !== errLine) {
      addCandidate(
        'php8-curly-offset-to-bracket',
        `Mengubah akses offset kurawal "{...}" menjadi "[...]" (kompatibilitas PHP 8) pada baris ${errIdx + 1}`,
        replaceLine(lines, errIdx, fixedCurly, eol)
      );
    }
  }

  // 10. Lupa titik dua `:` setelah `case ...` atau `default`
  if (/^\s*(?:case\s+.+|default)\s*$/i.test(splitTrailingComment(errLine).codePart)) {
    const { codePart, commentPart } = splitTrailingComment(errLine);
    addCandidate(
      'missing-switch-colon',
      `Menambahkan tanda ":" pada pernyataan switch di baris ${errIdx + 1}`,
      replaceLine(lines, errIdx, `${codePart}:${commentPart}`, eol)
    );
  }

  // 11. Kurung kurawal penutup `}` hilang di akhir file (`unexpected end of file` / `unclosed "{"`)
  if (isUnexpectedEof || /unclosed\s+["']\{["']/i.test(msg)) {
    const fullCounts = countUnquotedDelimiters(code);
    if (fullCounts.brace > 0 && fullCounts.brace <= 4) {
      const closingBraces = Array.from({ length: fullCounts.brace }, () => '}').join(eol);
      // Jika ada tag penutup `?>` di dekat akhir file, sisipkan sebelum `?>`
      let insertedBeforeClose = false;
      for (let i = lines.length - 1; i >= Math.max(0, lines.length - 10); i--) {
        if (/^\s*\?>\s*$/.test(lines[i])) {
          const copy = [...lines];
          copy.splice(i, 0, closingBraces);
          addCandidate(
            'missing-closing-brace-eof',
            `Menambahkan ${fullCounts.brace} kurung kurawal tutup "}" sebelum "?>" di akhir file`,
            copy.join(eol)
          );
          insertedBeforeClose = true;
          break;
        }
      }
      if (!insertedBeforeClose) {
        addCandidate(
          'missing-closing-brace-eof',
          `Menambahkan ${fullCounts.brace} kurung kurawal tutup "}" di akhir file`,
          `${code.replace(/\s*$/, '')}${eol}${closingBraces}${eol}`
        );
      }
    }
  }

  return candidates;
}
