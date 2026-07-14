import { describe, expect, it } from 'vitest';
import { mapHistoryToMessages } from './messages';

describe('mapHistoryToMessages tool-result images', () => {
  it('promotes tool-result images onto the owning assistant message', () => {
    const [message] = mapHistoryToMessages([
      {
        id: 'a1',
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'c1', name: 'send_image', arguments: { path: '/tmp/page.png' } }],
      },
      {
        id: 'r1',
        role: 'toolResult',
        toolCallId: 'c1',
        content: [
          { type: 'text', text: 'Sent image: page.png' },
          { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' },
        ],
      },
    ]);

    expect(message.images).toEqual([{ url: 'data:image/png;base64,aGVsbG8=', mimeType: 'image/png' }]);
    expect(message.tools?.[0]).toMatchObject({ status: 'success', output: 'Sent image: page.png' });
  });
});
