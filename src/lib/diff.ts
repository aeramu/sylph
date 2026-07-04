export type DiffRow = { old?: string; new?: string; type: 'same' | 'add' | 'del' };

// Line-level LCS diff producing aligned rows for a side-by-side view.
export function diffLines(oldText: string, newText: string): DiffRow[] {
  const a = oldText.split('\n');
  const b = newText.split('\n');
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
