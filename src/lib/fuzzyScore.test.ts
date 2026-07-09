import { describe, it, expect } from 'vitest';
import { fuzzyScore } from './fuzzyScore';

describe('fuzzyScore', () => {
  it('scores an empty query as 0 (matches anything)', () => {
    expect(fuzzyScore('', 'anything')).toBe(0);
  });

  it('returns null when the query is longer than the target', () => {
    expect(fuzzyScore('abcd', 'abc')).toBeNull();
  });

  it('returns null when chars are not a subsequence', () => {
    expect(fuzzyScore('xyz', 'router-reload')).toBeNull();
  });

  it('matches an in-order subsequence', () => {
    expect(fuzzyScore('rrl', 'router-reload')).not.toBeNull();
  });

  it('prefers the contiguous word-boundary alignment over a greedy early match', () => {
    // "rel" should align with the "-reload" boundary, not the "r" of "router".
    // We assert the chosen alignment scores higher than a hand-built greedy one
    // by comparing against a target where only the greedy match exists.
    const boundary = fuzzyScore('rel', 'router-reload')!;
    const scattered = fuzzyScore('rel', 'rxexlxxxxxxxx')!;
    expect(boundary).toBeGreaterThan(scattered);
  });

  it('gives a first-character match a boundary bonus', () => {
    const atStart = fuzzyScore('a', 'abc')!;
    const inMiddle = fuzzyScore('a', 'xable')!; // 'a' not at index 0
    expect(atStart).toBeGreaterThan(inMiddle);
  });

  it('gently prefers shorter targets among equal matches', () => {
    const short = fuzzyScore('go', 'go')!;
    const long = fuzzyScore('go', 'go-something-long')!;
    expect(short).toBeGreaterThan(long);
  });
});
