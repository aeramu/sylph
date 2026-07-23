import { describe, expect, it } from 'vitest';
import { addReviewComment, formatReviewComments, getReviewComments, removeReviewComments } from './reviewComments';

describe('review comments', () => {
  it('keeps drafts isolated by session and removes only submitted comments', () => {
    const first = addReviewComment('session-a', {
      surface: 'artifact', path: 'report.md', quote: 'First', comment: 'Expand this section.', lineStart: 2, lineEnd: 2,
    });
    addReviewComment('session-a', {
      surface: 'git', path: 'src/api.ts', quote: 'return value', comment: 'Preserve the fallback.', side: 'new', lineStart: 42, lineEnd: 43, changeSet: 'unstaged',
    });
    addReviewComment('session-b', {
      surface: 'artifact', path: 'other.md', quote: 'Other', comment: 'Separate session.',
    });

    expect(getReviewComments('session-a')).toHaveLength(2);
    expect(getReviewComments('session-b')).toHaveLength(1);
    removeReviewComments('session-a', [first[0].id]);
    expect(getReviewComments('session-a')).toHaveLength(1);
    expect(getReviewComments('session-b')).toHaveLength(1);
  });

  it('formats artifact and git selections as one structured prompt', () => {
    const text = formatReviewComments([
      { id: 'a', surface: 'artifact', path: 'report.md', quote: 'Selected text', comment: 'Add evidence.', lineStart: 3, lineEnd: 3 },
      { id: 'g', surface: 'git', path: 'src/api.ts', quote: 'old\nnew', comment: 'Keep compatibility.', side: 'new', lineStart: 42, lineEnd: 43, changeSet: 'staged' },
    ]);

    expect(text).toContain('Artifact `report.md`, line 3');
    expect(text).toContain('Git staged diff `src/api.ts`, new lines 42-43');
    expect(text).toContain('> old\n> new');
    expect(text).toContain('**Comment:** Keep compatibility.');
  });
});
