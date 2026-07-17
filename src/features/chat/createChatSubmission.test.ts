import { describe, expect, it } from 'vitest';
import { prepareChatSubmission } from './createChatSubmission';

describe('chat submission', () => {
  it('separates image transport from optimistic previews and inlines text files', () => {
    const result = prepareChatSubmission('Review this', [
      { id: 'image', kind: 'image', name: 'shot.png', mimeType: 'image/png', size: 1, data: 'base64', previewUrl: 'data:image/png;base64,base64' },
      { id: 'file', kind: 'file', name: 'note.md', mimeType: 'text/markdown', size: 1, text: '# Note' },
    ]);
    expect(result.messageImages).toEqual([{ url: 'data:image/png;base64,base64', mimeType: 'image/png' }]);
    expect(result.images).toEqual([{ type: 'image', data: 'base64', mimeType: 'image/png' }]);
    expect(result.prompt).toBe('Review this\n\n<file name="note.md">\n# Note\n</file>');
  });
});
