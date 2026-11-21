export type SecurityIssueSeverity = 'critical' | 'high' | 'medium' | 'info';
export type SecurityIssueCategory =
  | 'sql-injection'
  | 'secret-leak'
  | 'broken-include'
  | 'xss'
  | 'php8-compat';

export interface ProjectSecurityFinding {
  id: string;
  severity: SecurityIssueSeverity;
  category: SecurityIssueCategory;
  relativePath: string;
  line: number;
  title: string;
  snippet: string;
  recommendation: string;
}

export interface ProjectSecurityScanReport {
  scannedFiles: number;
  durationMs: number;
  findings: ProjectSecurityFinding[];
  counts: {
    critical: number;
    high: number;
    medium: number;
    info: number;
  };
}

function resolvePosixNeighbor(baseFileRel: string, includeTarget: string): string {
  const cleanTarget = includeTarget.replace(/\\/g, '/').trim();
  if (cleanTarget.startsWith('/')) {
    return cleanTarget.replace(/^\/+/, '');
  }
  const parts = baseFileRel.replace(/\\/g, '/').split('/').filter(Boolean);
  parts.pop();
  for (const seg of cleanTarget.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (parts.length > 0) parts.pop();
      else parts.push('..');
    } else {
      parts.push(seg);
    }
  }
  return parts.join('/');
}

/**
 * High-speed static security, PHP 8.2+ compatibility, & broken-include scanner.
 * Runs 100% locally/offline with zero AI token usage.
 */
export function scanSourceFilesForSecurityAndHealth(opts: {
  files: Array<{ relativePath?: string; relPath?: string; content: string }>;
  knownProjectRelPaths?: Iterable<string>;
  knownRelPaths?: Iterable<string>;
}): ProjectSecurityScanReport {
  const started = Date.now();
  const rawKnown = opts.knownProjectRelPaths ?? opts.knownRelPaths;
  const knownSet = rawKnown
    ? new Set(
        Array.from(rawKnown).map((p) =>
          p.replace(/^[/\\]+/, '').replace(/\\/g, '/').toLowerCase()
        )
      )
    : null;

  const findings: ProjectSecurityFinding[] = [];
  let seq = 0;

  for (const file of opts.files) {
    const rawRel = file.relativePath ?? file.relPath ?? '';
    const rel = rawRel.replace(/^[/\\]+/, '').replace(/\\/g, '/');
    const isPhp = /\.(php|phtml|inc)$/i.test(rel);
    const lines = file.content.split(/\r?\n/);

    for (let idx = 0; idx < lines.length; idx++) {
      const lineNum = idx + 1;
      const line = lines[idx];
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) {
        continue;
      }

      if (isPhp) {
        // 1. Raw SQL Injection (`SELECT/INSERT/UPDATE/DELETE ... $_GET/$_POST/$_REQUEST`)
        if (
          /\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b/i.test(line) &&
          /\$_(GET|POST|REQUEST)\s*\[/.test(line) &&
          !/\b(intval|floatval|mysqli_real_escape_string|addslashes|setParam)\s*\(/.test(line)
        ) {
          findings.push({
            id: `sec-${++seq}`,
            severity: 'critical',
            category: 'sql-injection',
            relativePath: rel,
            line: lineNum,
            title: 'Potensi SQL Injection: Superglobal mentah masuk langsung ke query SQL',
            snippet: trimmed.slice(0, 140),
            recommendation:
              'Gunakan Prepared Statement (`?` / `$query->setParam(...)`) atau konversi `intval()` sebelum menyusun SQL.'
          });
        }

        // 2. Broken Static Include / Require Target
        if (knownSet && knownSet.size > 0) {
          const incMatch = line.match(
            /\b(?:include|include_once|require|require_once)\s*(?:\(\s*)?['"]([^'"$]+)['"]\s*\)?/
          );
          if (incMatch && incMatch[1]) {
            const rawTarget = incMatch[1].trim();
            if (
              !rawTarget.startsWith('http://') &&
              !rawTarget.startsWith('https://') &&
              !rawTarget.startsWith('php://')
            ) {
              const resolved = resolvePosixNeighbor(rel, rawTarget);
              if (!resolved.startsWith('..') && !knownSet.has(resolved.toLowerCase())) {
                findings.push({
                  id: `sec-${++seq}`,
                  severity: 'high',
                  category: 'broken-include',
                  relativePath: rel,
                  line: lineNum,
                  title: `Target include/require tidak ditemukan: "${rawTarget}"`,
                  snippet: trimmed.slice(0, 140),
                  recommendation: `Periksa path "${resolved}" — file yang hilang pada require/include akan memicu Fatal Error di produksi.`
                });
              }
            }
          }
        }

        // 3. Reflected XSS (`echo $_GET[...]` / `<?= $_GET[...] ?>` without escaping)
        if (
          /(?:\becho\b|\bprint\b|<\?=)[^;]*\$_(GET|POST|REQUEST)\s*\[/.test(line) &&
          !/\b(htmlspecialchars|htmlentities|strip_tags|intval|urlencode|json_encode|encid)\s*\(/.test(
            line
          )
        ) {
          findings.push({
            id: `sec-${++seq}`,
            severity: 'medium',
            category: 'xss',
            relativePath: rel,
            line: lineNum,
            title: 'Potensi Reflected XSS: Output superglobal tanpa htmlspecialchars()',
            snippet: trimmed.slice(0, 140),
            recommendation:
              "Bungkus output dengan `htmlspecialchars($val, ENT_QUOTES, 'UTF-8')` agar aman dari injeksi `<script>`."
          });
        }

        // 4. PHP 8.x Removed / Deprecated Legacy Functions
        const php8Removed = line.match(
          /\b(mysql_query|mysql_connect|mysql_fetch_array|mysql_fetch_assoc|mysql_real_escape_string|create_function|ereg|eregi|split|get_magic_quotes_gpc|each|utf8_encode|utf8_decode)\s*\(/
        );
        if (php8Removed) {
          findings.push({
            id: `sec-${++seq}`,
            severity: 'info',
            category: 'php8-compat',
            relativePath: rel,
            line: lineNum,
            title: `Fungsi usang dihapus di PHP 8: ${php8Removed[1]}()`,
            snippet: trimmed.slice(0, 140),
            recommendation:
              'Ganti `mysql_*` ke `mysqli_*` / PDO, `ereg`/`split` ke `preg_match`/`preg_split`, dan `create_function` ke `fn() =>`.'
          });
        }
      }

      // 5. Hardcoded API Keys / Private Keys
      if (
        /(?:AIza[0-9A-Za-z_-]{35}|sk-[A-Za-z0-9]{32,}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----)/.test(
          line
        )
      ) {
        findings.push({
          id: `sec-${++seq}`,
          severity: 'critical',
          category: 'secret-leak',
          relativePath: rel,
          line: lineNum,
          title: 'Terdeteksi API Key / Private Key Hardcoded di dalam Kode Sumber',
          snippet: trimmed.slice(0, 90) + '...',
          recommendation:
            'Pindahkan kunci rahasia ke variabel environment (`.env`) diluar public webroot.'
        });
      }
    }
  }

  const severityRank: Record<SecurityIssueSeverity, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    info: 3
  };
  findings.sort((a, b) => {
    const sr = severityRank[a.severity] - severityRank[b.severity];
    return sr !== 0 ? sr : a.relativePath.localeCompare(b.relativePath) || a.line - b.line;
  });

  return {
    scannedFiles: opts.files.length,
    durationMs: Date.now() - started,
    findings,
    counts: {
      critical: findings.filter((f) => f.severity === 'critical').length,
      high: findings.filter((f) => f.severity === 'high').length,
      medium: findings.filter((f) => f.severity === 'medium').length,
      info: findings.filter((f) => f.severity === 'info').length
    }
  };
}
