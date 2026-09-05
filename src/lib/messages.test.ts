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
        responseId: 'live', role: 'assistant',
        content: [{ type: 'thinking', thinking: 'Reasoning' }, { type: 'text', text: 'Partial answer' }],
      },
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ id: 'old', content: 'Earlier' });
    expect(messages[0].isStreaming).toBeUndefined();
    expect(messages[1]).toMatchObject({
      id: 'live', content: 'Partial answer', thinking: 'Reasoning', isStreaming: true,
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
