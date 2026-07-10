import { describe, expect, it } from 'vitest';
import {
  gitHunkView,
  gitPatchStats,
  gitStatusLabel,
  makeHunkPatch,
  makeLinePatch,
  parseGitPatch,
} from './gitPatch';

const patch = `diff --git a/file.ts b/file.ts
index 1111111..2222222 100644
--- a/file.ts
+++ b/file.ts
@@ -10,4 +10,5 @@
 context
-old one
-old two
+new one
+new two
+new three
 tail`;

describe('git patch helpers', () => {
  it('parses hunk coordinates and line numbers', () => {
    const parsed = parseGitPatch(patch);
    expect(parsed.hunks).toHaveLength(1);
    expect(parsed.hunks[0]).toMatchObject({ oldStart: 10, oldCount: 4, newStart: 10, newCount: 5 });
    expect(parsed.hunks[0].lines.map((line) => [line.type, line.oldLine, line.newLine])).toEqual([
      ['context', 10, 10], ['del', 11, undefined], ['del', 12, undefined],
      ['add', undefined, 11], ['add', undefined, 12], ['add', undefined, 13], ['context', 13, 14],
    ]);
  });

  it('calculates patch statistics without counting headers', () => {
    expect(gitPatchStats(patch)).toEqual({ added: 3, deleted: 2 });
  });

  it('extracts one hunk with file headers', () => {
    const hunk = parseGitPatch(patch).hunks[0];
    expect(makeHunkPatch(patch, hunk)).toContain('@@ -10,4 +10,5 @@');
    expect(makeHunkPatch(patch, hunk)).toContain('--- a/file.ts');
  });

  it('generates a forward patch for one added line', () => {
    const hunk = parseGitPatch(patch).hunks[0];
    const result = makeLinePatch(patch, hunk, 3, false);
    expect(result).toContain('+new one');
    expect(result).not.toContain('+new two');
    expect(result).toContain(' old one');
    expect(result).toContain(' old two');
  });

  it('generates a reverse patch for one staged deletion', () => {
    const hunk = parseGitPatch(patch).hunks[0];
    const result = makeLinePatch(patch, hunk, 1, true);
    expect(result).toContain('-old one');
    expect(result).not.toContain('-old two');
    expect(result).toContain(' new one');
  });

  it('maps patch lines to their displayed documents', () => {
    const view = gitHunkView(parseGitPatch(patch).hunks[0]);
    expect(view.oldText).toBe('context\nold one\nold two\ntail');
    expect(view.newText).toBe('context\nnew one\nnew two\nnew three\ntail');
    expect(view.oldActions.map((action) => [action.line, action.patchLineIndex])).toEqual([[2, 1], [3, 2]]);
    expect(view.newActions.map((action) => [action.line, action.patchLineIndex])).toEqual([[2, 3], [3, 4], [4, 5]]);
  });

  it('uses conventional status labels', () => {
    const untracked = { path: 'new', index: '?', workingTree: '?', stagedPatch: '', unstagedPatch: '', isUntracked: true };
    expect(gitStatusLabel(untracked, false)).toEqual({ code: '?', title: 'Untracked' });
    expect(gitStatusLabel({ ...untracked, isUntracked: false, index: 'U' }, true)).toEqual({ code: 'U', title: 'Merge conflict' });
  });
});
