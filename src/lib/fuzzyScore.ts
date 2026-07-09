// Subsequence fuzzy match: every char of `query` must appear in `target` in
// order (e.g. "9rourel" matches "9router-reload"). Returns a relevance score
// (higher is better), or null when it doesn't match. Both args must be
// lowercased by the caller.
//
// Uses a small DP to find the highest-scoring alignment rather than a greedy
// first-occurrence walk — greedy would match the "r" ending "router" and miss
// the much stronger contiguous "rel" at the "-reload" boundary.
export function fuzzyScore(query: string, target: string): number | null {
  const n = query.length;
  const m = target.length;
  if (n === 0) return 0;
  if (n > m) return null;
  const NEG = -Infinity;

  const bonusAt = (ti: number, consecutive: boolean): number => {
    let b = 1;
    if (ti === 0) b += 8;                      // matches the very first char
    else {
      const p = target[ti - 1];
      if (p === '-' || p === '_' || p === '/' || p === ' ') b += 6; // word boundary
    }
    if (consecutive) b += 5;                   // adjacent to the previous match
    return b;
  };

  // prev[ti] = best score for query[0..qi] with query[qi] placed at target[ti].
  let prev = new Array<number>(m).fill(NEG);
  for (let ti = 0; ti <= m - n; ti++) {
    if (target[ti] === query[0]) prev[ti] = bonusAt(ti, false);
  }

  for (let qi = 1; qi < n; qi++) {
    const curr = new Array<number>(m).fill(NEG);
    let maxBeforePrev = NEG; // best prev[ti'] for ti' <= ti - 2 (non-adjacent)
    for (let ti = qi; ti <= m - n + qi; ti++) {
      if (ti - 2 >= 0 && prev[ti - 2] > maxBeforePrev) maxBeforePrev = prev[ti - 2];
      if (target[ti] !== query[qi]) continue;
      let best = NEG;
      if (prev[ti - 1] > NEG) best = prev[ti - 1] + bonusAt(ti, true);      // adjacent
      if (maxBeforePrev > NEG) best = Math.max(best, maxBeforePrev + bonusAt(ti, false));
      curr[ti] = best;
    }
    prev = curr;
  }

  let best = NEG;
  for (let ti = 0; ti < m; ti++) if (prev[ti] > best) best = prev[ti];
  if (best === NEG) return null;
  return best - target.length * 0.1; // gently prefer shorter, tighter matches
}
