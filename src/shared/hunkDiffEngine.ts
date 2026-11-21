/**
 * Pure line-level LCS diff & Hunk-Level Merge Engine for Local <-> Remote SFTP Folder Diff.
 * Allows selective per-block ("→ Push Blok" / "← Pull Blok") merging instead of overwriting whole files.
 */

export interface DiffLineOp {
  type: 'equal' | 'delete' | 'insert';
  leftLineNo?: number;
  rightLineNo?: number;
  text: string;
}

export interface DiffHunk {
  id: string;
  leftStart: number; // 0-based index in left lines
  leftCount: number;
  rightStart: number; // 0-based index in right lines
  rightCount: number;
  lines: DiffLineOp[];
}

export interface HunkDiffResult {
  leftLineCount: number;
  rightLineCount: number;
  identical: boolean;
  addedLines: number;
  removedLines: number;
  hunks: DiffHunk[];
}

function splitLinesPreserve(text: string): string[] {
  if (!text) return [];
  return text.replace(/\r\n/g, '\n').split('\n');
}

export function computeLineDiffOps(leftLines: string[], rightLines: string[]): DiffLineOp[] {
  const n = leftLines.length;
  const m = rightLines.length;

  // Guard for very large files (> 4000 lines): trim common prefix & suffix first
  let prefix = 0;
  while (prefix < n && prefix < m && leftLines[prefix] === rightLines[prefix]) {
    prefix++;
  }
  let suffix = 0;
  while (
    suffix < n - prefix &&
    suffix < m - prefix &&
    leftLines[n - 1 - suffix] === rightLines[m - 1 - suffix]
  ) {
    suffix++;
  }

  const ops: DiffLineOp[] = [];
  for (let i = 0; i < prefix; i++) {
    ops.push({ type: 'equal', leftLineNo: i + 1, rightLineNo: i + 1, text: leftLines[i] });
  }

  const midLeft = leftLines.slice(prefix, n - suffix);
  const midRight = rightLines.slice(prefix, m - suffix);
  const mn = midLeft.length;
  const mm = midRight.length;

  if (mn * mm > 2_500_000) {
    // Fast linear fallback for huge minified files
    for (let i = 0; i < mn; i++) {
      ops.push({ type: 'delete', leftLineNo: prefix + i + 1, text: midLeft[i] });
    }
    for (let j = 0; j < mm; j++) {
      ops.push({ type: 'insert', rightLineNo: prefix + j + 1, text: midRight[j] });
    }
  } else {
    // Standard DP LCS table on middle window
    const width = mm + 1;
    const dp = new Int32Array((mn + 1) * width);
    for (let i = mn - 1; i >= 0; i--) {
      const rowOff = i * width;
      const nextRowOff = (i + 1) * width;
      for (let j = mm - 1; j >= 0; j--) {
        if (midLeft[i] === midRight[j]) {
          dp[rowOff + j] = dp[nextRowOff + j + 1] + 1;
        } else {
          const down = dp[nextRowOff + j];
          const right = dp[rowOff + j + 1];
          dp[rowOff + j] = down >= right ? down : right;
        }
      }
    }

    let i = 0;
    let j = 0;
    while (i < mn && j < mm) {
      if (midLeft[i] === midRight[j]) {
        ops.push({
          type: 'equal',
          leftLineNo: prefix + i + 1,
          rightLineNo: prefix + j + 1,
          text: midLeft[i]
        });
        i++;
        j++;
      } else if (dp[(i + 1) * width + j] >= dp[i * width + (j + 1)]) {
        ops.push({ type: 'delete', leftLineNo: prefix + i + 1, text: midLeft[i] });
        i++;
      } else {
        ops.push({ type: 'insert', rightLineNo: prefix + j + 1, text: midRight[j] });
        j++;
      }
    }
    while (i < mn) {
      ops.push({ type: 'delete', leftLineNo: prefix + i + 1, text: midLeft[i] });
      i++;
    }
    while (j < mm) {
      ops.push({ type: 'insert', rightLineNo: prefix + j + 1, text: midRight[j] });
      j++;
    }
  }

  for (let s = 0; s < suffix; s++) {
    const li = n - suffix + s;
    const ri = m - suffix + s;
    ops.push({ type: 'equal', leftLineNo: li + 1, rightLineNo: ri + 1, text: leftLines[li] });
  }

  return ops;
}

export function computeHunkDiff(
  leftText: string,
  rightText: string,
  contextLines = 2
): HunkDiffResult {
  const leftLines = splitLinesPreserve(leftText);
  const rightLines = splitLinesPreserve(rightText);
  const ops = computeLineDiffOps(leftLines, rightLines);

  let addedLines = 0;
  let removedLines = 0;
  for (const op of ops) {
    if (op.type === 'insert') addedLines++;
    else if (op.type === 'delete') removedLines++;
  }

  if (addedLines === 0 && removedLines === 0) {
    return {
      leftLineCount: leftLines.length,
      rightLineCount: rightLines.length,
      identical: true,
      addedLines: 0,
      removedLines: 0,
      hunks: []
    };
  }

  // Group non-equal runs into distinct hunks (with context lines)
  const changeRanges: Array<{ start: number; end: number }> = [];
  let idx = 0;
  while (idx < ops.length) {
    if (ops[idx].type !== 'equal') {
      const start = idx;
      while (idx < ops.length && ops[idx].type !== 'equal') idx++;
      const end = idx - 1;
      const prev = changeRanges[changeRanges.length - 1];
      if (prev && start - prev.end <= contextLines * 2 + 1) {
        prev.end = end;
      } else {
        changeRanges.push({ start, end });
      }
    } else {
      idx++;
    }
  }

  const hunks: DiffHunk[] = changeRanges.map((range, hIdx) => {
    const sliceStart = Math.max(0, range.start - contextLines);
    const sliceEnd = Math.min(ops.length - 1, range.end + contextLines);
    const slice = ops.slice(sliceStart, sliceEnd + 1);

    // Exact 0-based start indices for the whole hunk slice
    let leftPos = 0;
    let rightPos = 0;
    for (let k = 0; k < sliceStart; k++) {
      if (ops[k].type !== 'insert') leftPos++;
      if (ops[k].type !== 'delete') rightPos++;
    }
    const leftCount = slice.filter((o) => o.type !== 'insert').length;
    const rightCount = slice.filter((o) => o.type !== 'delete').length;

    return {
      id: `hunk-${hIdx + 1}`,
      leftStart: leftPos,
      leftCount,
      rightStart: rightPos,
      rightCount,
      lines: slice
    };
  });

  return {
    leftLineCount: leftLines.length,
    rightLineCount: rightLines.length,
    identical: false,
    addedLines,
    removedLines,
    hunks
  };
}

/**
 * Push a single hunk from Left (Local) into Right (Remote), returning the updated Right file text.
 */
export function applyHunkLeftToRight(
  leftText: string,
  rightText: string,
  hunk: DiffHunk
): string {
  const leftLines = splitLinesPreserve(leftText);
  const rightLines = splitLinesPreserve(rightText);
  const replacement = leftLines.slice(hunk.leftStart, hunk.leftStart + hunk.leftCount);
  const nextRight = [
    ...rightLines.slice(0, hunk.rightStart),
    ...replacement,
    ...rightLines.slice(hunk.rightStart + hunk.rightCount)
  ];
  return nextRight.join('\n');
}

/**
 * Pull a single hunk from Right (Remote) into Left (Local), returning the updated Left file text.
 */
export function applyHunkRightToLeft(
  leftText: string,
  rightText: string,
  hunk: DiffHunk
): string {
  const leftLines = splitLinesPreserve(leftText);
  const rightLines = splitLinesPreserve(rightText);
  const replacement = rightLines.slice(hunk.rightStart, hunk.rightStart + hunk.rightCount);
  const nextLeft = [
    ...leftLines.slice(0, hunk.leftStart),
    ...replacement,
    ...leftLines.slice(hunk.leftStart + hunk.leftCount)
  ];
  return nextLeft.join('\n');
}
