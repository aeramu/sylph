export type DiffRow = { old?: string; new?: string; type: 'same' | 'add' | 'del' };

// Line-level LCS diff producing aligned rows for a side-by-side view.
export function diffLines(oldText: string, newText: string): DiffRow[] {
  // Empty text is zero lines, not one empty line — a write with no prior
  // content should count as all-added, without a phantom deleted line.
  const a = oldText === '' ? [] : oldText.split('\n');
  const b = newText === '' ? [] : newText.split('\n');

  // Trim the common prefix/suffix before running LCS: whole-file diffs
  // (write-as-update in sessionDiff) are mostly unchanged lines, and without
  // trimming any file beyond ~450 lines would trip the O(m*n) guard below
  // and degrade to all-del/all-add.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }

  const rows: DiffRow[] = a.slice(0, start).map((line): DiffRow => ({ old: line, new: line, type: 'same' }));
  rows.push(...diffLinesCore(a.slice(start, endA), b.slice(start, endB)));
  for (let i = endA; i < a.length; i++) rows.push({ old: a[i], new: a[i], type: 'same' });
  return rows;
}

function diffLinesCore(a: string[], b: string[]): DiffRow[] {
  const m = a.length, n = b.length;

  // Guard against pathological O(m*n) blowups on huge edits.
  if (m * n > 200000) {
    return [
      ...a.map((line): DiffRow => ({ old: line, type: 'del' })),
      ...b.map((line): DiffRow => ({ new: line, type: 'add' })),
    ];
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const rows: DiffRow[] = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { rows.push({ old: a[i], new: b[j], type: 'same' }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { rows.push({ old: a[i], type: 'del' }); i++; }
    else { rows.push({ new: b[j], type: 'add' }); j++; }
  }
  while (i < m) { rows.push({ old: a[i], type: 'del' }); i++; }
  while (j < n) { rows.push({ new: b[j], type: 'add' }); j++; }
  return rows;
}
