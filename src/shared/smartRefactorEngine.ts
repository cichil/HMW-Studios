export type RefactorSymbolKind = 'identifier' | 'php-variable' | 'css-class';

export interface SmartRenameFileInput {
  fileKey: string;
  displayPath: string;
  content: string;
}

export interface SmartRenameOccurrence {
  line: number;
  beforeLine: string;
  afterLine: string;
}

export interface SmartRenameFilePreview {
  fileKey: string;
  displayPath: string;
  occurrencesCount: number;
  newContent: string;
  sampleOccurrences: SmartRenameOccurrence[];
}

export interface SmartRenamePlan {
  symbolKind: RefactorSymbolKind;
  oldSymbol: string;
  newSymbol: string;
  totalFilesModified: number;
  totalOccurrences: number;
  files: SmartRenameFilePreview[];
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function inferSymbolKind(rawSymbol: string): RefactorSymbolKind {
  const s = rawSymbol.trim();
  if (s.startsWith('$')) return 'php-variable';
  if (s.startsWith('.') || (/^[a-z][a-z0-9]*-[a-z0-9-]+$/i.test(s) && !s.includes('_'))) {
    return 'css-class';
  }
  return 'identifier';
}

export function buildSmartSymbolRegex(
  oldSymbolRaw: string,
  kind: RefactorSymbolKind
): { regex: RegExp; normalizeReplacement: (newSymbolRaw: string) => string } | null {
  const trimmed = oldSymbolRaw.trim();
  if (!trimmed) return null;

  if (kind === 'php-variable') {
    const bareOld = trimmed.replace(/^\$+/, '');
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(bareOld)) return null;
    return {
      regex: new RegExp(`\\$${escapeRegex(bareOld)}(?![A-Za-z0-9_])`, 'g'),
      normalizeReplacement: (n) => `$${n.trim().replace(/^\$+/, '')}`
    };
  }

  if (kind === 'css-class') {
    const bareOld = trimmed.replace(/^\.+/, '');
    if (!/^[A-Za-z_-][A-Za-z0-9_-]*$/.test(bareOld)) return null;
    // Matches `.class-name` in CSS/JS selectors OR whole token inside `class="... class-name ..."`
    return {
      regex: new RegExp(`(?<![A-Za-z0-9_-])${escapeRegex(bareOld)}(?![A-Za-z0-9_-])`, 'g'),
      normalizeReplacement: (n) => n.trim().replace(/^\.+/, '')
    };
  }

  // Standard PHP/JS function, class, method, or column identifier
  const bareOld = trimmed.replace(/^[.$]+/, '');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(bareOld)) return null;
  return {
    regex: new RegExp(`(?<![A-Za-z0-9_$])${escapeRegex(bareOld)}(?![A-Za-z0-9_])`, 'g'),
    normalizeReplacement: (n) => n.trim().replace(/^[.$]+/, '')
  };
}

export function previewSmartSymbolRename(opts: {
  oldSymbol: string;
  newSymbol: string;
  kind?: RefactorSymbolKind;
  files: SmartRenameFileInput[];
}): SmartRenamePlan {
  const kind = opts.kind ?? inferSymbolKind(opts.oldSymbol);
  const matcher = buildSmartSymbolRegex(opts.oldSymbol, kind);
  const trimmedNew = opts.newSymbol.trim();

  if (!matcher || !trimmedNew || opts.oldSymbol.trim() === trimmedNew) {
    return {
      symbolKind: kind,
      oldSymbol: opts.oldSymbol.trim(),
      newSymbol: trimmedNew,
      totalFilesModified: 0,
      totalOccurrences: 0,
      files: []
    };
  }

  const replacementToken = matcher.normalizeReplacement(trimmedNew);
  const filePreviews: SmartRenameFilePreview[] = [];
  let totalOccurrences = 0;

  for (const file of opts.files) {
    const eol = file.content.includes('\r\n') ? '\r\n' : '\n';
    const lines = file.content.split(/\r?\n/);
    let fileCount = 0;
    const samples: SmartRenameOccurrence[] = [];

    const nextLines = lines.map((lineText, idx) => {
      matcher.regex.lastIndex = 0;
      if (!matcher.regex.test(lineText)) return lineText;
      matcher.regex.lastIndex = 0;
      let lineHits = 0;
      const replaced = lineText.replace(matcher.regex, () => {
        lineHits++;
        return replacementToken;
      });
      if (lineHits > 0 && replaced !== lineText) {
        fileCount += lineHits;
        if (samples.length < 6) {
          samples.push({
            line: idx + 1,
            beforeLine: lineText.trim().slice(0, 110),
            afterLine: replaced.trim().slice(0, 110)
          });
        }
      }
      return replaced;
    });

    if (fileCount > 0) {
      totalOccurrences += fileCount;
      filePreviews.push({
        fileKey: file.fileKey,
        displayPath: file.displayPath,
        occurrencesCount: fileCount,
        newContent: nextLines.join(eol),
        sampleOccurrences: samples
      });
    }
  }

  return {
    symbolKind: kind,
    oldSymbol: opts.oldSymbol.trim(),
    newSymbol: replacementToken,
    totalFilesModified: filePreviews.length,
    totalOccurrences,
    files: filePreviews
  };
}

const PHP_SUPERGLOBALS = new Set([
  '$_GET',
  '$_POST',
  '$_REQUEST',
  '$_SESSION',
  '$_SERVER',
  '$_COOKIE',
  '$_FILES',
  '$_ENV',
  '$GLOBALS',
  '$this'
]);

export function extractPhpVariablesForFunction(selectedCode: string): {
  params: string[];
  assignedVars: string[];
} {
  const usedOrder: string[] = [];
  const usedSet = new Set<string>();
  const assignedSet = new Set<string>();

  // Detect assigned variables `$var = ...` (excluding `==`, `===`, `!=`, `<=`, `>=`)
  const assignRe = /(\$[A-Za-z_][A-Za-z0-9_]*)\s*(?:\.=|\+=|-=|\*=|=(?![=>]))/g;
  let m: RegExpExecArray | null;
  while ((m = assignRe.exec(selectedCode)) !== null) {
    const v = m[1];
    if (!PHP_SUPERGLOBALS.has(v)) {
      assignedSet.add(v);
    }
  }

  // Detect all referenced variables
  const varRe = /\$[A-Za-z_][A-Za-z0-9_]*/g;
  while ((m = varRe.exec(selectedCode)) !== null) {
    const v = m[0];
    if (PHP_SUPERGLOBALS.has(v) || usedSet.has(v)) continue;
    usedSet.add(v);
    usedOrder.push(v);
  }

  return {
    params: usedOrder,
    assignedVars: Array.from(assignedSet)
  };
}

export interface ExtractSelectionResult {
  callReplacement: string;
  extractedDeclaration: string;
  suggestedIncludeFileName?: string;
}

export function buildExtractedFunctionCode(opts: {
  selectedCode: string;
  functionName: string;
  language: string;
  returnVar?: string;
}): ExtractSelectionResult {
  const cleanFn =
    opts.functionName
      .trim()
      .replace(/[^A-Za-z0-9_]/g, '_')
      .replace(/^[0-9]+/, '') || 'fungsiBaru';

  const isJs = opts.language === 'javascript' || opts.language === 'typescript';

  if (isJs) {
    const indentedBody = opts.selectedCode
      .split(/\r?\n/)
      .map((l) => `  ${l}`)
      .join('\n');
    return {
      callReplacement: `${cleanFn}();`,
      extractedDeclaration: `\nfunction ${cleanFn}() {\n${indentedBody}\n}\n`
    };
  }

  // Default: PHP function extraction with automatic parameter inference
  const { params, assignedVars } = extractPhpVariablesForFunction(opts.selectedCode);
  const paramSig = params.join(', ');
  const chosenReturn =
    opts.returnVar && opts.returnVar.startsWith('$')
      ? opts.returnVar
      : assignedVars.length === 1
        ? assignedVars[0]
        : '';

  const indentedBody = opts.selectedCode
    .trim()
    .split(/\r?\n/)
    .map((l) => `    ${l}`)
    .join('\n');

  const returnLine = chosenReturn ? `\n    return ${chosenReturn};` : '';
  const callExpr = chosenReturn
    ? `${chosenReturn} = ${cleanFn}(${paramSig});`
    : `${cleanFn}(${paramSig});`;

  return {
    callReplacement: callExpr,
    extractedDeclaration: `\nfunction ${cleanFn}(${paramSig})\n{\n${indentedBody}${returnLine}\n}\n`
  };
}

export function buildExtractedIncludeResult(opts: {
  selectedCode: string;
  targetFileName: string;
  isBlade?: boolean;
}): {
  includeStatement: string;
  partialFileContent: string;
  cleanFileName: string;
} {
  let cleanName = opts.targetFileName.trim().replace(/^[/\\]+/, '');
  if (!cleanName) {
    cleanName = opts.isBlade ? 'partials/komponen.blade.php' : 'komponen_partial.inc.php';
  } else if (!/\.[a-z0-9]+$/i.test(cleanName)) {
    cleanName = opts.isBlade ? `${cleanName}.blade.php` : `${cleanName}.php`;
  }

  if (opts.isBlade || cleanName.toLowerCase().endsWith('.blade.php')) {
    const bladeDot = cleanName
      .replace(/\.blade\.php$/i, '')
      .replace(/\\/g, '/')
      .replace(/\//g, '.');
    return {
      includeStatement: `@include('${bladeDot}')`,
      partialFileContent: `${opts.selectedCode.trim()}\n`,
      cleanFileName: cleanName
    };
  }

  const trimmed = opts.selectedCode.trim();
  // Estimate whether selection starts inside raw PHP code (without <?php tag) vs HTML/mixed
  const looksPurePhpStatements =
    !trimmed.startsWith('<') &&
    (/^\$[A-Za-z_]/.test(trimmed) ||
      /^(?:if|foreach|for|while|switch|echo|return|\$[a-zA-Z_]|mysql)/i.test(trimmed));

  const partialFileContent = looksPurePhpStatements
    ? `<?php\n${trimmed}\n?>\n`
    : `${trimmed}\n`;

  const includeStatement = looksPurePhpStatements
    ? `include '${cleanName}';`
    : `<?php include '${cleanName}'; ?>`;

  return {
    includeStatement,
    partialFileContent,
    cleanFileName: cleanName
  };
}
