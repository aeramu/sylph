import { describe, expect, it } from 'vitest';
import { mapHistoryToMessages } from './messages';

describe('mapHistoryToMessages', () => {
  it('normalizes inline thinking into the canonical thinking fields', () => {
    const [message] = mapHistoryToMessages([{
      id: 'a1',
      role: 'assistant',
      content: '<think>Reasoning</think>Answer',
    }]);

    expect(message).toMatchObject({
      content: 'Answer',
      rawContent: '<think>Reasoning</think>Answer',
      thinking: 'Reasoning',
      isThinking: false,
    });
  });

  it('prefers structured thinking when both forms are present', () => {
    const [message] = mapHistoryToMessages([{
      id: 'a1',
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Structured' },
        { type: 'text', text: '<think>Inline duplicate</think>Answer' },
      ],
    }]);

    expect(message.content).toBe('Answer');
    expect(message.thinking).toBe('Structured');
  });

  it('promotes tool-result images onto the owning assistant message', () => {
    const [message] = mapHistoryToMessages([
      {
        id: 'a1',
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'c1', name: 'read', arguments: { path: '/tmp/page.png' } }],
      },
      {
        id: 'r1',
        role: 'toolResult',
        toolCallId: 'c1',
        content: [
          { type: 'text', text: 'Read image file [image/png]' },
          { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' },
        ],
      },
    ]);

    expect(message.images).toEqual([{ url: 'data:image/png;base64,aGVsbG8=', mimeType: 'image/png' }]);
    expect(message.tools?.[0]).toMatchObject({ status: 'success', output: 'Read image file [image/png]' });
  });
});
