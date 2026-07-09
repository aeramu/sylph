import { describe, it, expect } from 'vitest';
import { computeSessionDiffs } from './sessionDiff';
import type { ChatMessage, ToolCall } from '../types';

let idSeq = 0;
const user = (content = 'hi'): ChatMessage => ({ id: `u${idSeq++}`, role: 'user', content });
const assistant = (tools: ToolCall[]): ChatMessage => ({ id: `a${idSeq++}`, role: 'assistant', content: '', tools });
const tool = (name: string, args: Record<string, any>, over: Partial<ToolCall> = {}): ToolCall =>
  ({ id: `t${idSeq++}`, name, status: 'success', args, ...over });

describe('computeSessionDiffs', () => {
  it('counts a write with no baseline as (almost) all-added', () => {
    const d = computeSessionDiffs([
      user(),
      assistant([tool('write', { path: 'a.txt', content: 'x\ny\nz' })]),
    ]);
    expect(d.session.files).toHaveLength(1);
    // Known quirk: with no baseline the new content is diffed against '', and
    // ''.split('\n') is [''] — one empty line — so a brand-new file reports a
    // phantom -1. Locked in here so refactors don't change it silently.
    expect(d.session.files[0]).toMatchObject({ path: 'a.txt', added: 3, deleted: 1 });
  });

  it('diffs a write against an in-session read baseline instead of counting all-added', () => {
    const d = computeSessionDiffs([
      user(),
      assistant([
        tool('read', { path: 'a.txt' }, { output: 'x\nold\nz' }),
        tool('write', { path: 'a.txt', content: 'x\nnew\nz' }),
      ]),
    ]);
    expect(d.session.files[0]).toMatchObject({ path: 'a.txt', added: 1, deleted: 1 });
  });

  it('does not use a partial (offset/limit) read as a baseline', () => {
    const d = computeSessionDiffs([
      user(),
      assistant([
        tool('read', { path: 'a.txt', offset: 10, limit: 5 }, { output: 'x\nold\nz' }),
        tool('write', { path: 'a.txt', content: 'x\nnew\nz' }),
      ]),
    ]);
    // No usable baseline -> whole new content counts as added (plus the
    // phantom -1 from the empty-string baseline, as above).
    expect(d.session.files[0]).toMatchObject({ added: 3, deleted: 1 });
  });

  it('counts edits from oldText/newText', () => {
    const d = computeSessionDiffs([
      user(),
      assistant([tool('edit', { path: 'a.txt', oldText: 'foo\nbar', newText: 'foo\nbaz\nqux' })]),
    ]);
    expect(d.session.files[0]).toMatchObject({ added: 2, deleted: 1 });
  });

  it('ignores failed and running tool calls', () => {
    const d = computeSessionDiffs([
      user(),
      assistant([
        tool('write', { path: 'a.txt', content: 'x' }, { status: 'error' }),
        tool('write', { path: 'b.txt', content: 'y' }, { status: 'running' }),
      ]),
    ]);
    expect(d.session.files).toHaveLength(0);
  });

  it('filters out a no-op write that re-emits identical content', () => {
    const d = computeSessionDiffs([
      user(),
      assistant([
        tool('read', { path: 'a.txt' }, { output: 'same' }),
        tool('write', { path: 'a.txt', content: 'same' }),
      ]),
    ]);
    expect(d.session.files).toHaveLength(0);
  });

  it('attributes changes to the turn that made them', () => {
    const d = computeSessionDiffs([
      user(),                                                       // turn 1
      assistant([tool('write', { path: 'a.txt', content: 'a' })]),
      user(),                                                       // turn 2
      assistant([tool('write', { path: 'b.txt', content: 'b' })]),
    ]);
    expect(d.turns.get(1)!.files.map((f) => f.path)).toEqual(['a.txt']);
    expect(d.turns.get(2)!.files.map((f) => f.path)).toEqual(['b.txt']);
    expect(d.session.files).toHaveLength(2);
  });

  it('chains edits across turns using the replayed baseline', () => {
    const d = computeSessionDiffs([
      user(),
      assistant([
        tool('read', { path: 'a.txt' }, { output: 'one\ntwo' }),
        tool('edit', { path: 'a.txt', oldText: 'two', newText: 'TWO' }),
      ]),
      user(),
      // Baseline is now 'one\nTWO'; writing it back unchanged is a no-op.
      assistant([tool('write', { path: 'a.txt', content: 'one\nTWO' })]),
    ]);
    // Only the edit counted; the second-turn write matched the replayed baseline.
    expect(d.session.files[0]).toMatchObject({ added: 1, deleted: 1 });
    expect(d.turns.has(2)).toBe(false);
  });
});
