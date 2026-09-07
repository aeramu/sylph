import { describe, expect, it } from 'vitest';
import { groupToolMessages } from './toolGroups';
import type { ChatMessage } from '../types';

const call = (id: string, content = ''): ChatMessage => ({
  id, role: 'assistant', content, tools: [{ id, name: 'read', status: 'success' }],
});
const thought = (id: string, content = ''): ChatMessage => ({ id, role: 'assistant', content, thinking: id });

describe('groupToolMessages', () => {
  it('combines adjacent calls after commentary and preserves source messages', () => {
    const messages = [call('a', 'Checking files'), call('b'), call('c')];
    const rows = groupToolMessages(messages);
    expect(rows.map(row => row.kind)).toEqual(['message', 'work']);
    expect(rows[1]).toMatchObject({ items: messages.map(message => ({ kind: 'tool', tool: message.tools![0] })) });
    expect(messages[0].tools).toHaveLength(1);
  });

  it('keeps text, images, errors, user messages and turn chips between groups', () => {
    const boundaries: ChatMessage[] = [
      call('text', 'Next step'),
      { ...call('image'), images: [{ url: 'image.png', mimeType: 'image/png' }] },
      { ...call('error'), errorMessage: 'Failed' },
      { id: 'user', role: 'user', content: 'Wait' },
    ];
    for (const boundary of boundaries) {
      const rows = groupToolMessages([call('a'), boundary]);
      expect(rows[0]).toMatchObject({ kind: 'work', items: [{ kind: 'tool' }] });
      expect(rows[1].kind).toBe('message');
    }
    expect(groupToolMessages([call('a'), call('b')], index => index === 0).map(row => row.kind))
      .toEqual(['work', 'turn', 'work']);
  });

  it('preserves thought/tool order and joins the final thought before answer text', () => {
    const rows = groupToolMessages([thought('a'), call('b'), thought('c', 'Answer')]);
    expect(rows.map(row => row.kind)).toEqual(['work', 'message']);
    expect(rows[0]).toMatchObject({ items: [{ kind: 'thought' }, { kind: 'tool' }, { kind: 'thought' }] });
    expect(rows[1]).toMatchObject({ message: { content: 'Answer', thinking: undefined } });
  });

  it('keeps one thought separate from tools after intervening text and combines consecutive thoughts', () => {
    expect(groupToolMessages([{ ...call('a', 'Checking'), thinking: 'Reasoning' }]).map(row => row.kind))
      .toEqual(['work', 'message', 'work']);
    expect(groupToolMessages([thought('a'), thought('b')])).toMatchObject([
      { kind: 'work', items: [{ kind: 'thought' }, { kind: 'thought' }] },
    ]);
  });
});
