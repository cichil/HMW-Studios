import { extractPhpEmbeddedSqlStatements, extractReferencedSqlTables } from './sqlSchemaAnalyzer';

export interface CompanionCandidateFile {
  source: 'local' | 'remote';
  name: string;
  relativePath: string;
  localPath?: string;
  connectionId?: string;
  connectionName?: string;
}

export interface ModuleCompanionItem extends CompanionCandidateFile {
  roleLabel: string;
  isCurrent: boolean;
}

const WISANGGENI_ROLE_SUFFIXES: Array<{ regex: RegExp; label: string; order: number }> = [
  { regex: /_(?:idx|index|list|data|browse)\.php$/i, label: 'Index / Tabel', order: 1 },
  { regex: /_(?:form|frm|input|edit|add)\.php$/i, label: 'Form Input', order: 2 },
  { regex: /_(?:save|simpan|act|aksi|proses|proc)\.php$/i, label: 'Proses Simpan', order: 3 },
  { regex: /_(?:del|delete|hapus)\.php$/i, label: 'Hapus', order: 4 },
  { regex: /_(?:detail|view|detil|info)\.php$/i, label: 'Detail', order: 5 },
  { regex: /_(?:ajax|json|api)\.php$/i, label: 'AJAX / API', order: 6 },
  { regex: /_(?:print|cetak|pdf|rpt|lap)\.php$/i, label: 'Cetak / PDF', order: 7 },
  { regex: /_(?:excel|xls|xlsx|csv|export)\.php$/i, label: 'Export Excel', order: 8 }
];

function extractWisanggeniStem(relPath: string): { dir: string; stem: string } | null {
  const norm = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const slashIdx = norm.lastIndexOf('/');
  const dir = slashIdx >= 0 ? norm.slice(0, slashIdx) : '';
  const base = slashIdx >= 0 ? norm.slice(slashIdx + 1) : norm;

  const suffixMatch = base.match(
    /^(.+?)_(?:idx|index|list|data|browse|form|frm|input|edit|add|save|simpan|act|aksi|proses|proc|del|delete|hapus|detail|view|detil|info|ajax|json|api|print|cetak|pdf|rpt|lap|excel|xls|xlsx|csv|export)\.php$/i
  );
  if (suffixMatch && suffixMatch[1]) {
    return { dir: dir.toLowerCase(), stem: suffixMatch[1].toLowerCase() };
  }
  return null;
}

function classifyWisanggeniRole(fileName: string): { label: string; order: number } {
  for (const r of WISANGGENI_ROLE_SUFFIXES) {
    if (r.regex.test(fileName)) return { label: r.label, order: r.order };
  }
  return { label: fileName.replace(/\.php$/i, ''), order: 50 };
}

function toSnakePlural(studly: string): string {
  const snake = studly
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
  if (snake.endsWith('y') && !/[aeiou]y$/.test(snake)) {
    return `${snake.slice(0, -1)}ies`;
  }
  if (snake.endsWith('s')) return snake;
  return `${snake}s`;
}

/**
 * Finds companion files belonging to the same Wisanggeni PHP module (`_idx`, `_form`, `_save`, `_cetak`, `_excel`)
 * or Laravel entity (`FooController`, `Foo` Model, `FooRequest`, `resources/views/foo/*.blade.php`).
 */
export function findModuleCompanions(
  activeRelPath: string,
  activeSource: 'local' | 'remote',
  candidates: CompanionCandidateFile[]
): ModuleCompanionItem[] {
  const normActive = activeRelPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normActive) return [];

  // Prefer companions from the same source ('local' vs 'remote') first so navigation stays in the user's current environment
  const sameSourceCandidates = candidates.filter((c) => c.source === activeSource);
  const pool = sameSourceCandidates.length > 0 ? sameSourceCandidates : candidates;

  // 1. Wisanggeni / Intranet PHP `_idx` / `_form` / `_save` module family
  const wisStem = extractWisanggeniStem(normActive);
  if (wisStem) {
    const matches: Array<ModuleCompanionItem & { order: number }> = [];
    const seenRel = new Set<string>();

    for (const c of pool) {
      const cNorm = c.relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
      if (seenRel.has(cNorm.toLowerCase())) continue;
      const cStem = extractWisanggeniStem(cNorm);
      const cSlash = cNorm.lastIndexOf('/');
      const cDir = (cSlash >= 0 ? cNorm.slice(0, cSlash) : '').toLowerCase();
      const cBase = (cSlash >= 0 ? cNorm.slice(cSlash + 1) : cNorm).toLowerCase();

      const sameStem =
        (cStem && cStem.dir === wisStem.dir && cStem.stem === wisStem.stem) ||
        (cDir === wisStem.dir && cBase === `${wisStem.stem}.php`);

      if (sameStem) {
        seenRel.add(cNorm.toLowerCase());
        const role = classifyWisanggeniRole(c.name);
        matches.push({
          ...c,
          roleLabel: role.label,
          isCurrent: cNorm.toLowerCase() === normActive.toLowerCase(),
          order: role.order
        });
      }
    }

    matches.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    if (matches.length > 1) {
      return matches.map(({ order: _o, ...rest }) => rest);
    }
  }

  // 2. Laravel Controller <-> Model <-> Request <-> Blade Views family
  const baseName = normActive.split('/').pop() || '';
  let entityStudly = '';

  const ctrlMatch = baseName.match(/^([A-Z][A-Za-z0-9]*)Controller\.php$/);
  const modelMatch = normActive.match(/(?:^|\/)Models\/([A-Z][A-Za-z0-9]*)\.php$/);
  const reqMatch = baseName.match(/^(?:Store|Update|Save)?([A-Z][A-Za-z0-9]*)Request\.php$/);
  const bladeMatch = normActive.match(/resources\/views\/([a-z0-9_-]+)\/[^/]+\.blade\.php$/i);

  if (ctrlMatch) entityStudly = ctrlMatch[1];
  else if (modelMatch) entityStudly = modelMatch[1];
  else if (reqMatch) entityStudly = reqMatch[1];
  else if (bladeMatch) {
    const folder = bladeMatch[1].replace(/[-_]/g, ' ');
    entityStudly = folder
      .replace(/s$/i, '')
      .replace(/\b\w/g, (ch) => ch.toUpperCase())
      .replace(/\s+/g, '');
  }

  if (entityStudly) {
    const entityLow = entityStudly.toLowerCase();
    const viewDirPlural = toSnakePlural(entityStudly);
    const viewDirSingular = entityStudly
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .toLowerCase();

    const lvMatches: Array<ModuleCompanionItem & { order: number }> = [];
    for (const c of pool) {
      const cNorm = c.relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
      const cBase = c.name;
      const isCur = cNorm.toLowerCase() === normActive.toLowerCase();

      if (cBase.toLowerCase() === `${entityLow}controller.php`) {
        lvMatches.push({ ...c, roleLabel: 'Controller', isCurrent: isCur, order: 1 });
      } else if (
        cNorm.toLowerCase().endsWith(`models/${entityLow}.php`) ||
        cNorm.toLowerCase() === `app/${entityLow}.php`
      ) {
        lvMatches.push({ ...c, roleLabel: 'Model', isCurrent: isCur, order: 2 });
      } else if (
        cBase.toLowerCase().endsWith('request.php') &&
        cBase.toLowerCase().includes(entityLow)
      ) {
        lvMatches.push({
          ...c,
          roleLabel: cBase.replace(/\.php$/i, ''),
          isCurrent: isCur,
          order: 3
        });
      } else if (
        cNorm.toLowerCase().includes(`resources/views/${viewDirPlural}/`) ||
        cNorm.toLowerCase().includes(`resources/views/${viewDirSingular}/`) ||
        cNorm.toLowerCase().includes(`resources/views/${viewDirPlural.replace(/_/g, '-')}/`)
      ) {
        lvMatches.push({
          ...c,
          roleLabel: `View: ${cBase.replace(/\.blade\.php$/i, '')}`,
          isCurrent: isCur,
          order: 4
        });
      }
    }

    lvMatches.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    if (lvMatches.length > 1) {
      return lvMatches.slice(0, 10).map(({ order: _o, ...rest }) => rest);
    }
  }

  return [];
}

export interface PhpFileDependencyReport {
  includes: string[];
  readTables: string[];
  writeTables: string[];
  declaredSymbols: string[];
  inputsUsed: string[];
}

/**
 * Inspects a PHP file's structural dependencies: included files, read vs mutated SQL tables,
 * declared functions/classes, and HTTP/Session inputs.
 */
export function inspectPhpFileDependencies(code: string): PhpFileDependencyReport {
  const includes = new Set<string>();
  const readTables = new Set<string>();
  const writeTables = new Set<string>();
  const declaredSymbols = new Set<string>();
  const inputsUsed = new Set<string>();

  // 1. include / require paths
  const incRegex =
    /\b(?:include|include_once|require|require_once)\s*\(?\s*(?:[A-Z0-9_]+\s*\.\s*)?['"]([^'"]+\.php)['"]/gi;
  for (const m of code.matchAll(incRegex)) {
    if (m[1]) includes.add(m[1].replace(/^\/+/, ''));
  }

  // 2. SQL tables read vs written
  const stmts = extractPhpEmbeddedSqlStatements(code);
  for (const st of stmts) {
    const cleanSql = st.sqlTemplate.replace(/\{\{p\d+\}\}/g, '1').trim();
    const refs = extractReferencedSqlTables(cleanSql);
    const isWrite = /^(?:insert|update|delete|replace|alter|create|drop|truncate)\b/i.test(
      cleanSql
    );
    for (const r of refs.refs) {
      const label = r.schema ? `${r.schema}.${r.table}` : r.table;
      if (isWrite) writeTables.add(label);
      else readTables.add(label);
    }
  }

  // Also detect Laravel DB::table('...')
  for (const dm of code.matchAll(/\bDB::table\s*\(\s*['"]([A-Za-z0-9_.]+)['"]\s*\)/g)) {
    if (dm[1]) readTables.add(dm[1]);
  }

  // 3. Declared functions & classes
  for (const cm of code.matchAll(/\bclass\s+([A-Za-z_][A-Za-z0-9_]*)/g)) {
    if (cm[1]) declaredSymbols.add(`class ${cm[1]}`);
  }
  for (const fm of code.matchAll(/\bfunction\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
    if (fm[1]) declaredSymbols.add(`${fm[1]}()`);
  }

  // 4. Superglobal inputs
  for (const sm of code.matchAll(/\$(_(?:POST|GET|SESSION|FILES|REQUEST))\s*\[\s*['"]([^'"]+)['"]\s*\]/g)) {
    if (sm[1] && sm[2]) inputsUsed.add(`$${sm[1]}['${sm[2]}']`);
  }

  return {
    includes: Array.from(includes),
    readTables: Array.from(readTables),
    writeTables: Array.from(writeTables),
    declaredSymbols: Array.from(declaredSymbols).slice(0, 20),
    inputsUsed: Array.from(inputsUsed).slice(0, 24)
  };
}
