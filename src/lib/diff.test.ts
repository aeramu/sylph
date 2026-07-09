import { describe, it, expect } from 'vitest';
import { diffLines } from './diff';

const counts = (rows: ReturnType<typeof diffLines>) => ({
  same: rows.filter((r) => r.type === 'same').length,
  add: rows.filter((r) => r.type === 'add').length,
  del: rows.filter((r) => r.type === 'del').length,
});

describe('diffLines', () => {
  it('reports no changes for identical text', () => {
    const rows = diffLines('a\nb\nc', 'a\nb\nc');
    expect(counts(rows)).toEqual({ same: 3, add: 0, del: 0 });
  });

  it('detects a single changed line as one add and one del', () => {
    const rows = diffLines('a\nb\nc', 'a\nB\nc');
    expect(counts(rows)).toEqual({ same: 2, add: 1, del: 1 });
  });

  it('detects a pure insertion', () => {
    const rows = diffLines('a\nc', 'a\nb\nc');
    expect(counts(rows)).toEqual({ same: 2, add: 1, del: 0 });
  });

  it('detects a pure deletion', () => {
    const rows = diffLines('a\nb\nc', 'a\nc');
    expect(counts(rows)).toEqual({ same: 2, add: 0, del: 1 });
  });

  it('preserves common prefix and suffix around a middle change', () => {
    const rows = diffLines('x\ny\nold\nz', 'x\ny\nnew\nz');
    // prefix x,y and suffix z stay 'same'; only the middle line flips.
    expect(counts(rows)).toEqual({ same: 3, add: 1, del: 1 });
  });

  it('falls back to all-del/all-add past the O(m*n) guard', () => {
    // Build two fully-disjoint blocks large enough to trip m*n > 200000.
    const a = Array.from({ length: 600 }, (_, i) => `a${i}`).join('\n');
    const b = Array.from({ length: 600 }, (_, i) => `b${i}`).join('\n');
    const rows = diffLines(a, b);
    const c = counts(rows);
    expect(c.same).toBe(0);
    expect(c.del).toBe(600);
    expect(c.add).toBe(600);
  });

  it('keeps a large diff exact when a shared prefix/suffix trims it under the guard', () => {
    // 1000 identical lines wrapping a 1-line change. Without prefix/suffix
    // trimming this would exceed the guard and degrade; with it, it stays exact.
    const head = Array.from({ length: 500 }, (_, i) => `h${i}`);
    const tail = Array.from({ length: 500 }, (_, i) => `t${i}`);
    const a = [...head, 'OLD', ...tail].join('\n');
    const b = [...head, 'NEW', ...tail].join('\n');
    expect(counts(diffLines(a, b))).toEqual({ same: 1000, add: 1, del: 1 });
  });
});
