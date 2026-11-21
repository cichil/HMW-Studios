export type OutlineSymbolKind =
  | 'class'
  | 'method'
  | 'function'
  | 'property'
  | 'constant'
  | 'tag'
  | 'selector'
  | 'heading';

export interface OutlineSymbolItem {
  id: string;
  name: string;
  detail?: string;
  kind: OutlineSymbolKind;
  line: number;
  depth: number;
}

export function extractCodeOutline(
  code: string,
  language: string
): OutlineSymbolItem[] {
  if (!code.trim()) return [];
  const lines = code.split(/\r?\n/);
  const lang = language.toLowerCase();
  const items: OutlineSymbolItem[] = [];

  if (lang === 'php') {
    let currentClass: string | null = null;
    let classBraceDepth = 0;
    let braceDepth = 0;

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const lineNo = i + 1;

      const classMatch = line.match(
        /^\s*(?:abstract\s+|final\s+|readonly\s+)*\b(class|interface|trait|enum)\s+([A-Za-z_\x80-\xff][A-Za-z0-9_\x80-\xff]*)/
      );
      if (classMatch) {
        currentClass = classMatch[2];
        classBraceDepth = braceDepth;
        items.push({
          id: `php-cls-${lineNo}-${classMatch[2]}`,
          name: classMatch[2],
          detail: classMatch[1],
          kind: 'class',
          line: lineNo,
          depth: 0
        });
      } else {
        const fnMatch = line.match(
          /^\s*(?:(?:public|protected|private|static|abstract|final)\s+)*function\s+&?\s*([A-Za-z_\x80-\xff][A-Za-z0-9_\x80-\xff]*)\s*\(([^)]*)\)/
        );
        if (fnMatch) {
          const isMethod = currentClass !== null;
          items.push({
            id: `php-fn-${lineNo}-${fnMatch[1]}`,
            name: `${fnMatch[1]}(${fnMatch[2].trim().slice(0, 38)})`,
            detail: isMethod ? `method • ${currentClass}` : 'function',
            kind: isMethod ? 'method' : 'function',
            line: lineNo,
            depth: isMethod ? 1 : 0
          });
        } else if (currentClass !== null) {
          const constMatch = line.match(
            /^\s*(?:(?:public|protected|private)\s+)?const\s+([A-Za-z_\x80-\xff][A-Za-z0-9_\x80-\xff]*)/
          );
          if (constMatch) {
            items.push({
              id: `php-const-${lineNo}-${constMatch[1]}`,
              name: constMatch[1],
              detail: 'const',
              kind: 'constant',
              line: lineNo,
              depth: 1
            });
          } else {
            const propMatch = line.match(
              /^\s*(?:(?:public|protected|private)(?:\s+(?:static|readonly))?\s+(?:\??[A-Za-z0-9_|\\]+\s+)?|var\s+)(\$[A-Za-z_\x80-\xff][A-Za-z0-9_\x80-\xff]*)/
            );
            if (propMatch) {
              items.push({
                id: `php-prop-${lineNo}-${propMatch[1]}`,
                name: propMatch[1],
                detail: 'property',
                kind: 'property',
                line: lineNo,
                depth: 1
              });
            }
          }
        } else {
          const defineMatch = line.match(
            /\bdefine\s*\(\s*['"]([A-Za-z0-9_]+)['"]/
          );
          if (defineMatch) {
            items.push({
              id: `php-def-${lineNo}-${defineMatch[1]}`,
              name: defineMatch[1],
              detail: 'define',
              kind: 'constant',
              line: lineNo,
              depth: 0
            });
          }
        }

        // Juga deteksi landmark HTML penting di template PHP campuran
        const htmlLandmark = line.match(
          /<(form|table|section|nav|header|main|footer|dialog|script)\b([^>]*)>/i
        );
        if (htmlLandmark) {
          const tag = htmlLandmark[1].toLowerCase();
          const attrs = htmlLandmark[2] ?? '';
          const idAttr = attrs.match(/\bid\s*=\s*['"]([^'"]+)['"]/i)?.[1];
          const clsAttr = attrs.match(/\bclass\s*=\s*['"]([^'"]+)['"]/i)?.[1];
          const suffix = idAttr
            ? `#${idAttr}`
            : clsAttr
              ? `.${clsAttr.trim().split(/\s+/)[0]}`
              : '';
          items.push({
            id: `php-html-${lineNo}-${tag}`,
            name: `<${tag}${suffix}>`,
            detail: 'HTML',
            kind: 'tag',
            line: lineNo,
            depth: 0
          });
        }
      }

      const opens = (line.match(/\{/g) ?? []).length;
      const closes = (line.match(/\}/g) ?? []).length;
      braceDepth += opens - closes;
      if (currentClass !== null && braceDepth <= classBraceDepth && closes > 0) {
        currentClass = null;
      }
    }
    return items;
  }

  if (lang === 'javascript' || lang === 'typescript') {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const lineNo = i + 1;

      const cls = line.match(
        /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(class|interface|type|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/
      );
      if (cls) {
        items.push({
          id: `ts-cls-${lineNo}-${cls[2]}`,
          name: cls[2],
          detail: cls[1],
          kind: 'class',
          line: lineNo,
          depth: 0
        });
        continue;
      }

      const fn = line.match(
        /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/
      );
      if (fn) {
        items.push({
          id: `ts-fn-${lineNo}-${fn[1]}`,
          name: `${fn[1]}()`,
          detail: 'function',
          kind: 'function',
          line: lineNo,
          depth: 0
        });
        continue;
      }

      const arrow = line.match(
        /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][A-Za-z0-9_$]*)\s*=>/
      );
      if (arrow) {
        items.push({
          id: `ts-arr-${lineNo}-${arrow[1]}`,
          name: `${arrow[1]}()`,
          detail: 'arrow fn',
          kind: 'function',
          line: lineNo,
          depth: 0
        });
      }
    }
    return items;
  }

  if (lang === 'html' || lang === 'xml') {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const lineNo = i + 1;
      const m = line.match(
        /<(header|nav|main|section|article|aside|footer|form|table|dialog|template|script|style|h[1-4]|div)\b([^>]*)>/i
      );
      if (!m) continue;
      const tag = m[1].toLowerCase();
      const attrs = m[2] ?? '';
      const idAttr = attrs.match(/\bid\s*=\s*['"]([^'"]+)['"]/i)?.[1];
      const clsAttr = attrs.match(/\bclass\s*=\s*['"]([^'"]+)['"]/i)?.[1];
      // Untuk <div>, hanya tampilkan jika punya id atau class agar tidak bising
      if (tag === 'div' && !idAttr && !clsAttr) continue;
      const suffix = idAttr
        ? `#${idAttr}`
        : clsAttr
          ? `.${clsAttr.trim().split(/\s+/)[0]}`
          : '';
      items.push({
        id: `html-${lineNo}-${tag}`,
        name: `<${tag}${suffix}>`,
        detail: 'element',
        kind: 'tag',
        line: lineNo,
        depth: tag === 'div' ? 1 : 0
      });
    }
    return items;
  }

  if (lang === 'css' || lang === 'scss' || lang === 'less') {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i].trim();
      const lineNo = i + 1;
      if (!line || line.startsWith('/*') || line.startsWith('*') || line.startsWith('//')) {
        continue;
      }
      const cssVarMatch = line.match(/^(--[A-Za-z0-9_-]+)\s*:\s*([^;]+);?/);
      if (cssVarMatch) {
        items.push({
          id: `css-var-${lineNo}-${cssVarMatch[1]}`,
          name: cssVarMatch[1],
          detail: cssVarMatch[2].trim().slice(0, 28),
          kind: 'property',
          line: lineNo,
          depth: 1
        });
        continue;
      }
      if (line.endsWith('{') && !line.startsWith('@keyframes')) {
        const selector = line.slice(0, -1).trim();
        if (selector) {
          items.push({
            id: `css-${lineNo}`,
            name: selector.slice(0, 56),
            detail: selector.startsWith('@') ? 'at-rule' : 'selector',
            kind: 'selector',
            line: lineNo,
            depth: 0
          });
        }
      }
    }
    return items;
  }

  if (lang === 'markdown') {
    for (let i = 0; i < lines.length; i += 1) {
      const m = lines[i].match(/^(#{1,4})\s+(.+)$/);
      if (m) {
        items.push({
          id: `md-${i + 1}`,
          name: m[2].trim(),
          detail: `H${m[1].length}`,
          kind: 'heading',
          line: i + 1,
          depth: Math.max(0, m[1].length - 1)
        });
      }
    }
    return items;
  }

  if (lang === 'sql') {
    for (let i = 0; i < lines.length; i += 1) {
      const m = lines[i].match(
        /^\s*(CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW|PROCEDURE|FUNCTION|INDEX)|ALTER\s+TABLE|INSERT\s+INTO|UPDATE|DELETE\s+FROM|SELECT)\b(.*)$/i
      );
      if (m) {
        items.push({
          id: `sql-${i + 1}`,
          name: `${m[1].toUpperCase()} ${m[2].trim().slice(0, 36)}`.trim(),
          detail: 'SQL',
          kind: 'function',
          line: i + 1,
          depth: 0
        });
      }
    }
    return items;
  }

  return items;
}
