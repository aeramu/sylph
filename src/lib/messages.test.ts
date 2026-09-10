import { describe, expect, it } from 'vitest';
import { mapHistoryToMessages, mapSessionSnapshotMessages } from './messages';

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

  it('renders an orphaned persisted completion as a dedicated background-job card', () => {
    const [message] = mapHistoryToMessages([{
      role: 'custom',
      customType: 'sylph.background-jobs',
      display: true,
      content: '<background-jobs-completed />',
      details: { jobs: [{ id: 'bg-1', name: 'Test suite', status: 'failed', exitCode: 1, error: 'Tests failed' }] },
    }]);

    expect(message).toMatchObject({
      role: 'background-job',
      content: '',
      backgroundJobs: [{ id: 'bg-1', name: 'Test suite', status: 'failed', exitCode: 1, error: 'Tests failed' }],
    });
  });

  it('updates the original bg_run card from persisted completion details instead of duplicating it', () => {
    const messages = mapHistoryToMessages([
      {
        id: 'assistant-1', role: 'assistant',
        content: [{ type: 'toolCall', id: 'call-1', name: 'bg_run', arguments: { name: 'Build', command: 'npm run build' } }],
      },
      {
        role: 'toolResult', toolCallId: 'call-1', content: 'Started',
        details: { job: { id: 'bg-1', name: 'Build', status: 'running', command: 'npm run build' } },
      },
      {
        role: 'custom', customType: 'sylph.background-jobs', display: true,
        details: { jobs: [{ id: 'bg-1', name: 'Build', status: 'completed', exitCode: 0, outputBytes: 42 }] },
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0].tools?.[0]).toMatchObject({
      name: 'bg_run', status: 'success',
      backgroundJob: { id: 'bg-1', name: 'Build', status: 'completed', exitCode: 0, outputBytes: 42 },
    });
  });

  it('omits non-display custom messages from history', () => {
    expect(mapHistoryToMessages([{
      role: 'custom', customType: 'state', display: false, content: 'hidden',
    }])).toEqual([]);
  });

  it('restores a partial assistant response when reconnecting mid-stream', () => {
    const messages = mapSessionSnapshotMessages({
      messages: [{ id: 'old', role: 'assistant', content: [{ type: 'text', text: 'Earlier' }] }],
      streamingMessage: {
        responseId: 'live', timestamp: 123, role: 'assistant',
        content: [{ type: 'thinking', thinking: 'Reasoning' }, { type: 'text', text: 'Partial answer' }],
      },
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ id: 'old', content: 'Earlier' });
    expect(messages[0].isStreaming).toBeUndefined();
    expect(messages[1]).toMatchObject({
      id: 'assistant:123', content: 'Partial answer', thinking: 'Reasoning', isStreaming: true,
    });
  });

  it('restores a transient user message from the live snapshot', () => {
    const messages = mapSessionSnapshotMessages({
      messages: [],
      streamingMessage: { role: 'user', clientMessageId: 'live-user', content: 'hello' },
    });
    expect(messages).toEqual([expect.objectContaining({ id: 'live-user', role: 'user', content: 'hello' })]);
  });

  it('restores queued steering messages and active tools from a snapshot', () => {
    const messages = mapSessionSnapshotMessages({
      messages: [{
        id: 'a1', role: 'assistant',
        content: [{ type: 'toolCall', id: 'c1', name: 'bash', arguments: { command: 'sleep 1' } }],
      }],
      pendingUserMessages: [{
        role: 'user', clientMessageId: 'client-1', displayText: 'Change direction', steered: true,
        content: [{ type: 'text', text: 'expanded prompt' }],
      }],
      activeToolCallIds: ['c1'],
    });

    expect(messages[0].tools?.[0].status).toBe('running');
    expect(messages[1]).toMatchObject({ id: 'client-1', role: 'user', content: 'Change direction', steered: true });
  });

  it('restores persisted steering metadata from history', () => {
    const [message] = mapHistoryToMessages([{
      role: 'user', clientMessageId: 'client-1', displayText: 'Visible prompt', steered: true,
      content: [{ type: 'text', text: 'expanded prompt' }],
    }]);

    expect(message).toMatchObject({ id: 'client-1', content: 'Visible prompt', steered: true });
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


describe('provider response IDs are not timeline identities', () => {
  const reply = (timestamp: number, text: string) => ({
    role: 'assistant', responseId: 'chatcmpl-keepalive', timestamp,
    content: [{ type: 'text', text }],
  });

  it('preserves separate replies in history even when response IDs repeat', () => {
    const messages = mapHistoryToMessages([
      { role: 'user', content: 'hi' }, reply(1, 'Hello'),
      { role: 'user', content: 'Open Blender' }, reply(2, 'Checking'), reply(3, 'Not installed'),
    ]);
    expect(new Set(messages.map(message => message.id)).size).toBe(5);
    expect(messages.map(message => message.content)).toEqual(['hi', 'Hello', 'Open Blender', 'Checking', 'Not installed']);
  });

  it('appends a live reply without overwriting an earlier response', () => {
    const messages = mapSessionSnapshotMessages({ messages: [reply(1, 'Hello')], streamingMessage: reply(2, 'Checking') });
    expect(messages.map(message => message.content)).toEqual(['Hello', 'Checking']);
    expect(messages[1].isStreaming).toBe(true);
  });

  it('reconciles the same live message when it is already in history', () => {
    const messages = mapSessionSnapshotMessages({ messages: [reply(1, 'Partial')], streamingMessage: reply(1, 'Complete') });
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('Complete');
  });
});
