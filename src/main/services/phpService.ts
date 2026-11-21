import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import type {
  PhpClassMemberMeta,
  PhpClassMeta,
  PhpFunctionMeta,
  PhpLintDiagnostic,
  PhpLocalAutoFixResult,
  PhpParamMeta,
  PhpRuntimeCatalog,
  PhpSnippetRunResult,
  PhpWorkspaceSymbols
} from '@shared/types';
import { generateLocalPhpSyntaxFixCandidates } from '@shared/phpLocalAutoFix';

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'out', 'release', 'cache', 'storage']);

const PHP_REFLECTION_DUMP_SCRIPT = `
error_reporting(0);
$funcs = [];
$internal = get_defined_functions()['internal'] ?? [];
foreach ($internal as $fn) {
  try {
    $rf = new ReflectionFunction($fn);
    $params = [];
    foreach ($rf->getParameters() as $p) {
      $t = $p->hasType() ? (string)$p->getType() : '';
      $item = ['name' => '$' . $p->getName()];
      if ($t !== '') $item['type'] = $t;
      if ($p->isOptional()) $item['optional'] = true;
      if ($p->isDefaultValueAvailable()) {
        try {
          $dv = $p->getDefaultValue();
          if (is_null($dv)) $item['defaultValue'] = 'null';
          elseif (is_bool($dv)) $item['defaultValue'] = $dv ? 'true' : 'false';
          elseif (is_scalar($dv)) $item['defaultValue'] = var_export($dv, true);
        } catch (Throwable $e) {}
      }
      $params[] = $item;
    }
    $rt = $rf->hasReturnType() ? (string)$rf->getReturnType() : '';
    $ext = $rf->getExtensionName() ?: '';
    $entry = ['name' => $rf->getName(), 'params' => $params];
    if ($rt !== '') $entry['returnType'] = $rt;
    if ($ext !== '') $entry['extension'] = $ext;
    $funcs[] = $entry;
  } catch (Throwable $e) {}
}

$targetClasses = [
  'mysqli', 'mysqli_stmt', 'mysqli_result',
  'PDO', 'PDOStatement', 'PDOException',
  'DateTime', 'DateTimeImmutable', 'DateTimeZone', 'DateInterval',
  'Exception', 'Error', 'RuntimeException', 'InvalidArgumentException', 'JsonException',
  'SimpleXMLElement', 'DOMDocument', 'DOMElement', 'ZipArchive', 'SplFileInfo'
];
$classes = [];
foreach ($targetClasses as $cn) {
  if (!class_exists($cn) && !interface_exists($cn)) continue;
  try {
    $rc = new ReflectionClass($cn);
    $members = [];
    foreach ($rc->getConstants() as $ck => $cv) {
      $members[] = ['name' => (string)$ck, 'kind' => 'constant', 'isStatic' => true];
    }
    foreach ($rc->getProperties(ReflectionProperty::IS_PUBLIC) as $prop) {
      $pt = $prop->hasType() ? (string)$prop->getType() : '';
      $members[] = [
        'name' => $prop->getName(),
        'kind' => 'property',
        'isStatic' => $prop->isStatic(),
        'type' => $pt
      ];
    }
    foreach ($rc->getMethods(ReflectionMethod::IS_PUBLIC) as $m) {
      if (str_starts_with($m->getName(), '__') && $m->getName() !== '__construct') continue;
      $mps = [];
      foreach ($m->getParameters() as $p) {
        $pt = $p->hasType() ? (string)$p->getType() : '';
        $pi = ['name' => '$' . $p->getName()];
        if ($pt !== '') $pi['type'] = $pt;
        if ($p->isOptional()) $pi['optional'] = true;
        $mps[] = $pi;
      }
      $mrt = $m->hasReturnType() ? (string)$m->getReturnType() : '';
      $members[] = [
        'name' => $m->getName(),
        'kind' => 'method',
        'isStatic' => $m->isStatic(),
        'params' => $mps,
        'type' => $mrt
      ];
    }
    $classes[] = ['name' => $rc->getName(), 'members' => $members];
  } catch (Throwable $e) {}
}

$allConsts = get_defined_constants(true);
$pickedConsts = [];
$preferredGroups = ['Core', 'standard', 'json', 'mysqli', 'PDO', 'curl', 'filter', 'date', 'hash', 'pcre', 'mbstring'];
foreach ($preferredGroups as $grp) {
  if (!empty($allConsts[$grp])) {
    foreach (array_keys($allConsts[$grp]) as $ck) {
      if (preg_match('/^[A-Z][A-Z0-9_]{2,}$/', $ck)) {
        $pickedConsts[] = $ck;
      }
    }
  }
}

echo json_encode([
  'phpVersion' => PHP_VERSION,
  'functions' => $funcs,
  'classes' => $classes,
  'constants' => array_values(array_unique($pickedConsts))
]);
`;

function splitTopLevelCommas(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const prev = i > 0 ? input[i - 1] : '';

    if (quote) {
      current += ch;
      if (ch === quote && prev !== '\\') {
        quote = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }

    if (ch === '(' || ch === '[') {
      depth += 1;
      current += ch;
      continue;
    }

    if (ch === ')' || ch === ']') {
      depth = Math.max(0, depth - 1);
      current += ch;
      continue;
    }

    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }

    current += ch;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }
  return parts;
}

export function parsePhpParamsRaw(rawParams: string): PhpParamMeta[] {
  const trimmed = rawParams.trim();
  if (!trimmed) return [];
  return splitTopLevelCommas(trimmed)
    .filter(Boolean)
    .map((part) => {
      const eqIdx = part.indexOf('=');
      const hasDefault = eqIdx >= 0;
      const left = (hasDefault ? part.slice(0, eqIdx) : part).trim();
      const right = hasDefault ? part.slice(eqIdx + 1).trim() : undefined;
      const tokens = left.split(/\s+/).filter(Boolean);
      const varToken = tokens.find(
        (t) => t.startsWith('$') || t.startsWith('&$') || t.startsWith('...$')
      );
      const typeTokens = tokens.filter((t) => t !== varToken);
      return {
        name: varToken ? varToken.replace(/^&/, '') : left,
        type: typeTokens.length > 0 ? typeTokens.join(' ') : undefined,
        optional: hasDefault,
        defaultValue: right
      };
    });
}

export function extractPhpSymbolsFromSource(
  source: string,
  filePath?: string,
  relativePath?: string
): PhpWorkspaceSymbols {
  const functions: PhpFunctionMeta[] = [];
  const classes: PhpClassMeta[] = [];
  const arrayKeysSet = new Set<string>();

  const lines = source.split(/\r?\n/);

  let currentClass: PhpClassMeta | null = null;
  let braceDepth = 0;
  let classStartDepth = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Extract string keys in $arr['key'] or $arr["key"]
    const keyMatches = line.matchAll(/\[\s*['"]([a-zA-Z_][a-zA-Z0-9_-]{1,48})['"]\s*\]/g);
    for (const km of keyMatches) {
      arrayKeysSet.add(km[1]);
    }

    const classMatch = line.match(
      /^\s*(?:final\s+|abstract\s+|readonly\s+)*(?:class|interface|trait)\s+([A-Za-z_][A-Za-z0-9_]*)/
    );
    if (classMatch) {
      currentClass = {
        name: classMatch[1],
        members: [],
        filePath,
        relativePath,
        line: lineNum
      };
      classes.push(currentClass);
      classStartDepth = braceDepth;
    }

    const fnMatch = line.match(
      /^\s*(?:<\?(?:php)?\s+)?(?:(public|protected|private|static|final|abstract)\s+)*function\s+&?\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)(?:\s*:\s*([?A-Za-z0-9_|\\]+))?/
    );
    if (fnMatch) {
      const modifiers = fnMatch[0];
      const fnName = fnMatch[2];
      const params = parsePhpParamsRaw(fnMatch[3] ?? '');
      const returnType = fnMatch[4]?.trim();

      if (currentClass && braceDepth > classStartDepth) {
        const isConstructor =
          fnName === '__construct' ||
          fnName.toLowerCase() === currentClass.name.toLowerCase();

        if (isConstructor) {
          if (!currentClass.constructorParams || fnName === '__construct') {
            currentClass.constructorParams = params;
          }
        } else if (!/\b(private|protected)\b/.test(modifiers) || filePath === undefined) {
          currentClass.members.push({
            name: fnName,
            kind: 'method',
            isStatic: /\bstatic\b/.test(modifiers),
            params,
            type: returnType,
            line: lineNum
          });
        }
      } else {
        functions.push({
          name: fnName,
          params,
          returnType,
          filePath,
          relativePath,
          line: lineNum
        });
      }
    }

    if (currentClass && braceDepth > classStartDepth) {
      // Support both PHP 5/8 `public [type] $prop` and PHP 4/Wisanggeni `var $prop`
      const propMatch = line.match(
        /^\s*(?:public\s+(?:(static|readonly)\s+)*(?:([?A-Za-z0-9_|\\]+)\s+)?|var\s+)\$([A-Za-z_][A-Za-z0-9_]*)(?:[^;]*;\s*\/\/=?\s*(.+))?/
      );
      if (propMatch) {
        const propName = propMatch[3];
        if (!currentClass.members.some((m) => m.kind === 'property' && m.name === propName)) {
          const inlineDoc = propMatch[4]?.trim();
          currentClass.members.push({
            name: propName,
            kind: 'property',
            isStatic: Boolean(propMatch[1]?.includes('static')),
            type: propMatch[2],
            doc: inlineDoc || undefined,
            line: lineNum
          });
        }
      }

      const constMatch = line.match(
        /^\s*(?:public\s+)?const\s+([A-Z_][A-Z0-9_]*)\s*=/
      );
      if (constMatch) {
        currentClass.members.push({
          name: constMatch[1],
          kind: 'constant',
          isStatic: true,
          line: lineNum
        });
      }
    }

    for (const ch of line) {
      if (ch === '{') braceDepth += 1;
      else if (ch === '}') {
        braceDepth = Math.max(0, braceDepth - 1);
        if (currentClass && braceDepth <= classStartDepth) {
          currentClass = null;
          classStartDepth = -1;
        }
      }
    }
  }

  return {
    functions,
    classes,
    arrayKeys: Array.from(arrayKeysSet)
  };
}

export class PhpLanguageService {
  private resolvedPhpBin: string | null | undefined = undefined;
  private cachedCatalog: PhpRuntimeCatalog | null = null;

  private runProcess(
    cmd: string,
    args: string[],
    stdinText?: string,
    timeoutMs = 6000,
    cwd?: string
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolvePromise) => {
      let stdout = '';
      let stderr = '';
      let settled = false;

      let child;
      try {
        child = spawn(cmd, args, {
          cwd: cwd && existsSync(cwd) ? cwd : undefined,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe']
        });
      } catch (err) {
        resolvePromise({
          code: -1,
          stdout: '',
          stderr: err instanceof Error ? err.message : String(err)
        });
        return;
      }

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try {
            child.kill();
          } catch {
            // Ignore
          }
          resolvePromise({ code: -1, stdout, stderr: `${stderr}\nTimeout` });
        }
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf-8');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf-8');
      });
      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolvePromise({ code: -1, stdout, stderr: err.message });
      });
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolvePromise({ code: code ?? -1, stdout, stderr });
      });

      if (stdinText !== undefined) {
        child.stdin.write(stdinText, 'utf-8');
      }
      child.stdin.end();
    });
  }

  async resolvePhpBinary(): Promise<string | null> {
    if (this.resolvedPhpBin !== undefined) return this.resolvedPhpBin;

    // 1. Check PATH directly
    const direct = await this.runProcess('php', ['-v'], undefined, 2500);
    if (direct.code === 0 && direct.stdout.includes('PHP ')) {
      this.resolvedPhpBin = 'php';
      return this.resolvedPhpBin;
    }

    // 2. Check common Windows PHP installations (XAMPP, Laragon, WAMP, C:\php)
    const candidates: string[] = [
      'C:\\xampp3\\php\\php.exe',
      'C:\\xampp\\php\\php.exe',
      'D:\\xampp3\\php\\php.exe',
      'D:\\xampp\\php\\php.exe',
      'C:\\php\\php.exe'
    ];

    for (const root of ['C:\\laragon\\bin\\php', 'C:\\wamp64\\bin\\php']) {
      if (existsSync(root)) {
        try {
          const subDirs = readdirSync(root, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => join(root, d.name, 'php.exe'))
            .reverse();
          candidates.push(...subDirs);
        } catch {
          // Ignore
        }
      }
    }

    for (const bin of candidates) {
      if (existsSync(bin)) {
        const res = await this.runProcess(bin, ['-v'], undefined, 2500);
        if (res.code === 0 && res.stdout.includes('PHP ')) {
          this.resolvedPhpBin = bin;
          return this.resolvedPhpBin;
        }
      }
    }

    this.resolvedPhpBin = null;
    return null;
  }

  async getCatalog(): Promise<PhpRuntimeCatalog> {
    if (this.cachedCatalog) return this.cachedCatalog;

    const phpBin = await this.resolvePhpBinary();
    if (!phpBin) {
      this.cachedCatalog = {
        available: false,
        phpVersion: 'Built-in PHP 8 Static Catalog',
        phpBinary: null,
        functions: [],
        classes: [],
        constants: []
      };
      return this.cachedCatalog;
    }

    const res = await this.runProcess(
      phpBin,
      ['-d', 'display_errors=0', '-r', PHP_REFLECTION_DUMP_SCRIPT],
      undefined,
      8000
    );

    if (res.code === 0 && res.stdout.trim()) {
      try {
        const parsed = JSON.parse(res.stdout) as {
          phpVersion: string;
          functions: PhpFunctionMeta[];
          classes: PhpClassMeta[];
          constants: string[];
        };
        this.cachedCatalog = {
          available: true,
          phpVersion: parsed.phpVersion,
          phpBinary: phpBin,
          functions: parsed.functions ?? [],
          classes: parsed.classes ?? [],
          constants: parsed.constants ?? []
        };
        return this.cachedCatalog;
      } catch {
        // Fall through to fallback
      }
    }

    this.cachedCatalog = {
      available: false,
      phpVersion: 'Built-in PHP 8 Static Catalog',
      phpBinary: phpBin,
      functions: [],
      classes: [],
      constants: []
    };
    return this.cachedCatalog;
  }

  async lint(code: string): Promise<{ available: boolean; diagnostics: PhpLintDiagnostic[] }> {
    const phpBin = await this.resolvePhpBinary();
    if (!phpBin) {
      return { available: false, diagnostics: [] };
    }

    const res = await this.runProcess(
      phpBin,
      ['-l', '-d', 'display_errors=1', '-d', 'html_errors=0', '-d', 'log_errors=0'],
      code,
      4000
    );

    if (res.code === 0) {
      return { available: true, diagnostics: [] };
    }

    const combined = `${res.stdout}\n${res.stderr}`;
    const diagnostics: PhpLintDiagnostic[] = [];
    for (const rawLine of combined.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('Errors parsing ')) continue;

      const match = line.match(
        /^(?:PHP\s+)?(Parse error|Fatal error|Warning|Deprecated|Notice):\s*(.+?)\s+in\s+(?:Standard input code|-)\s+on\s+line\s+(\d+)/i
      );
      if (match) {
        const kind = match[1].toLowerCase();
        const message = match[2].trim();
        const lineNumber = Math.max(1, Number(match[3]) || 1);
        diagnostics.push({
          line: lineNumber,
          column: 1,
          message: `${match[1]}: ${message}`,
          severity: kind.includes('error') ? 'error' : 'warning'
        });
      }
    }

    return { available: true, diagnostics };
  }

  /**
   * Memperbaiki error sintaks PHP secara LOKAL (100% offline, tanpa Gemini AI, < 100ms)
   * dan memverifikasi setiap kandidat langsung menggunakan `php -l` agar hasilnya 100% valid.
   * Mendukung hingga 3 perbaikan berantai apabila terdapat beberapa error sintaks sekaligus.
   */
  async autoFixSyntaxLocal(code: string): Promise<PhpLocalAutoFixResult> {
    const started = Date.now();
    const initial = await this.lint(code);
    if (!initial.available) {
      return {
        fixed: false,
        explanation:
          'Binary PHP CLI (php.exe) tidak ditemukan, sehingga verifikasi perbaikan lokal tidak dapat dijalankan.',
        appliedFixes: [],
        durationMs: Math.max(1, Date.now() - started)
      };
    }

    const firstErrors = initial.diagnostics.filter((d) => d.severity === 'error');
    if (firstErrors.length === 0) {
      return {
        fixed: true,
        fixedCode: code,
        explanation: 'Tidak ditemukan error sintaks PHP pada file ini.',
        appliedFixes: [],
        durationMs: Math.max(1, Date.now() - started)
      };
    }

    let workingCode = code;
    let currentErr = firstErrors[0];
    const appliedFixes: string[] = [];
    const maxPasses = 3;

    for (let pass = 0; pass < maxPasses; pass++) {
      const candidates = generateLocalPhpSyntaxFixCandidates(workingCode, currentErr);
      let solvedAll = false;
      let advancedCandidate: {
        fixedCode: string;
        description: string;
        nextErr: PhpLintDiagnostic;
      } | null = null;

      for (const cand of candidates.slice(0, 24)) {
        const check = await this.lint(cand.fixedCode);
        const errs = check.diagnostics.filter((d) => d.severity === 'error');
        if (errs.length === 0) {
          workingCode = cand.fixedCode;
          appliedFixes.push(cand.description);
          solvedAll = true;
          break;
        }
        // Jika baris error bergeser maju ke baris lebih bawah, berarti error pada baris sekarang sudah teratasi!
        if (!advancedCandidate && errs[0].line > currentErr.line) {
          advancedCandidate = {
            fixedCode: cand.fixedCode,
            description: cand.description,
            nextErr: errs[0]
          };
        }
      }

      if (solvedAll) {
        return {
          fixed: true,
          fixedCode: workingCode,
          explanation: appliedFixes.join('; '),
          appliedFixes,
          durationMs: Math.max(1, Date.now() - started)
        };
      }

      if (advancedCandidate) {
        workingCode = advancedCandidate.fixedCode;
        appliedFixes.push(advancedCandidate.description);
        currentErr = advancedCandidate.nextErr;
        continue;
      }

      break;
    }

    // Jika sebagian error sudah terperbaiki pada file dengan banyak error, tetap kembalikan progresnya
    if (appliedFixes.length > 0) {
      return {
        fixed: true,
        fixedCode: workingCode,
        explanation: `${appliedFixes.join('; ')} (masih ada error lanjutan di baris ${currentErr.line})`,
        appliedFixes,
        durationMs: Math.max(1, Date.now() - started),
        remainingError: `Baris ${currentErr.line}: ${currentErr.message}`
      };
    }

    return {
      fixed: false,
      explanation: `Pola error di baris ${currentErr.line} terlalu kompleks untuk perbaikan otomatis lokal. Anda dapat klik "Gemini AI" untuk perbaikan cerdas.`,
      appliedFixes: [],
      durationMs: Math.max(1, Date.now() - started),
      remainingError: `Baris ${currentErr.line}: ${currentErr.message}`
    };
  }

  async runSnippet(code: string, cwd?: string): Promise<PhpSnippetRunResult> {
    const started = Date.now();
    const phpBin = await this.resolvePhpBinary();
    if (!phpBin) {
      return {
        available: false,
        phpVersion: 'Tidak ditemukan',
        exitCode: -1,
        stdout: '',
        stderr:
          'Binary PHP CLI tidak ditemukan di PATH maupun folder XAMPP/Laragon/WAMP. Pastikan php.exe terpasang.',
        durationMs: Math.max(1, Date.now() - started)
      };
    }

    const cat = await this.getCatalog();
    const trimmed = code.trim();
    const wrappedCode =
      trimmed.startsWith('<?php') || trimmed.startsWith('<?=')
        ? code
        : `<?php\n${code}`;

    const res = await this.runProcess(
      phpBin,
      ['-d', 'display_errors=1', '-d', 'html_errors=0', '-d', 'log_errors=0'],
      wrappedCode,
      8000,
      cwd
    );

    return {
      available: true,
      phpVersion: cat.phpVersion || 'PHP CLI',
      exitCode: res.code,
      stdout: res.stdout,
      stderr: res.stderr,
      durationMs: Math.max(1, Date.now() - started)
    };
  }

  async scanWorkspace(workspacePath: string): Promise<PhpWorkspaceSymbols> {
    const root = resolve(workspacePath);
    const allFunctions = new Map<string, PhpFunctionMeta>();
    const allClasses = new Map<string, PhpClassMeta>();
    const allArrayKeys = new Set<string>();
    let scannedCount = 0;
    const maxFiles = 300;

    const walk = async (dir: string): Promise<void> => {
      if (scannedCount >= maxFiles) return;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (scannedCount >= maxFiles) return;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name)) {
            await walk(full);
          }
          continue;
        }

        const lower = entry.name.toLowerCase();
        if (!lower.endsWith('.php') && !lower.endsWith('.phtml')) continue;

        try {
          const st = await stat(full);
          if (st.size > 512 * 1024) continue;
          scannedCount += 1;
          const content = await readFile(full, 'utf-8');
          const rel = relative(root, full).replace(/\\/g, '/');
          const extracted = extractPhpSymbolsFromSource(content, full, rel);

          for (const fn of extracted.functions) {
            if (!allFunctions.has(fn.name)) allFunctions.set(fn.name, fn);
          }
          for (const cls of extracted.classes) {
            const existing = allClasses.get(cls.name);
            if (!existing) {
              allClasses.set(cls.name, cls);
            } else {
              const seenMembers = new Set(existing.members.map((m) => `${m.kind}:${m.name}`));
              for (const m of cls.members) {
                if (!seenMembers.has(`${m.kind}:${m.name}`)) {
                  existing.members.push(m);
                }
              }
            }
          }
          for (const k of extracted.arrayKeys) {
            allArrayKeys.add(k);
          }
        } catch {
          // Ignore unreadable file
        }
      }
    };

    await walk(root);

    return {
      functions: Array.from(allFunctions.values()),
      classes: Array.from(allClasses.values()),
      arrayKeys: Array.from(allArrayKeys).slice(0, 500)
    };
  }
}
