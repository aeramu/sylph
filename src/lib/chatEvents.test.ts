import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'solid-js';
import { createStore } from 'solid-js/store';
import { applyAgentEvent, type AgentEventCallbacks } from './chatEvents';
import type { ChatMessage } from '../types';

// Drive a sequence of agent events through a real Solid store and return the
// resulting messages plus the callback spies.
function run(events: any[]) {
  return createRoot((dispose) => {
    const [messages, setMessages] = createStore<ChatMessage[]>([]);
    const callbacks: AgentEventCallbacks = {
      setProcessing: vi.fn(),
      onTurnComplete: vi.fn(),
      onSuccessfulFileMutation: vi.fn(),
    };
    for (const e of events) applyAgentEvent(messages, setMessages, e, callbacks);
    const snapshot = messages.map((m) => ({ ...m, tools: m.tools?.map((t) => ({ ...t })) }));
    dispose();
    return { messages: snapshot, callbacks };
  });
}

const assistantStart = (id: string, extra: any = {}) => ({
  type: 'message_start',
  message: { id, role: 'assistant', ...extra },
});
const textDelta = (delta: string, message: any = {}) => ({
  type: 'message_update',
  message,
  assistantMessageEvent: { type: 'text_delta', delta },
});

describe('applyAgentEvent', () => {
  it('opens a streaming assistant bubble on message_start', () => {
    const { messages } = run([assistantStart('m1')]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ role: 'assistant', isStreaming: true, content: '' });
  });

  it('captures a message that arrives already errored instead of leaving it streaming', () => {
    const { messages } = run([
      assistantStart('m1', { stopReason: 'error', errorMessage: 'rate limited' }),
    ]);
    expect(messages[0]).toMatchObject({ isStreaming: false, errorMessage: 'rate limited' });
  });

  it('appends text deltas to the live assistant message', () => {
    const { messages } = run([assistantStart('m1'), textDelta('Hel'), textDelta('lo')]);
    expect(messages[0].content).toBe('Hello');
  });

  it('routes deltas to the streaming message even when a later bubble was appended', () => {
    // A steering user message can land behind the still-streaming assistant.
    const { messages } = run([
      assistantStart('m1'),
      textDelta('a'),
      { type: 'message_start', message: { id: 'u1', role: 'user' } },
      textDelta('b'),
    ]);
    const streamed = messages.find((m) => m.id === 'm1');
    expect(streamed?.content).toBe('ab');
  });

  it('accumulates thinking deltas and clears the flag on message_end', () => {
    const { messages } = run([
      assistantStart('m1'),
      { type: 'message_update', assistantMessageEvent: { type: 'thinking_start' } },
      { type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'ponder' } },
      { type: 'message_end', message: { id: 'm1' } },
    ]);
    expect(messages[0].thinking).toBe('ponder');
    expect(messages[0].isThinking).toBe(false);
    expect(messages[0].isStreaming).toBe(false);
  });

  it('tracks a tool call through start, output, and end', () => {
    const { messages } = run([
      assistantStart('m1'),
      { type: 'tool_execution_start', toolCallId: 'c1', toolName: 'bash', args: { command: 'ls' } },
      { type: 'tool_execution_update', toolCallId: 'c1', delta: 'file.txt' },
      { type: 'tool_execution_end', toolCallId: 'c1', isError: false },
    ]);
    const t = messages[0].tools![0];
    expect(t).toMatchObject({ id: 'c1', name: 'bash', status: 'success', output: 'file.txt' });
  });

  it('promotes image content from a live tool result onto the assistant bubble', () => {
    const { messages } = run([
      assistantStart('m1'),
      { type: 'tool_execution_start', toolCallId: 'c1', toolName: 'send_image', args: { path: '/tmp/page.png' } },
      {
        type: 'message_start',
        message: {
          id: 'r1',
          role: 'toolResult',
          toolCallId: 'c1',
          content: [
            { type: 'text', text: 'Sent image: page.png' },
            { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' },
          ],
        },
      },
    ]);

    expect(messages[0].images).toEqual([{ url: 'data:image/png;base64,aGVsbG8=', mimeType: 'image/png' }]);
    expect(messages[0].tools?.[0]).toMatchObject({ status: 'success', output: 'Sent image: page.png' });
  });

  it('notifies after successful edit/write tools only', () => {
    const successful = run([
      assistantStart('m1'),
      { type: 'tool_execution_start', toolCallId: 'c1', toolName: 'edit', args: {} },
      { type: 'tool_execution_end', toolCallId: 'c1', isError: false },
      { type: 'tool_execution_start', toolCallId: 'c2', toolName: 'write', args: {} },
      { type: 'tool_execution_end', toolCallId: 'c2', isError: false },
      { type: 'tool_execution_start', toolCallId: 'c3', toolName: 'bash', args: {} },
      { type: 'tool_execution_end', toolCallId: 'c3', isError: false },
    ]);
    expect(successful.callbacks.onSuccessfulFileMutation).toHaveBeenCalledTimes(2);

    const namedEnd = run([
      assistantStart('m1'),
      { type: 'tool_execution_end', toolCallId: 'c4', toolName: 'write', isError: false },
    ]);
    expect(namedEnd.callbacks.onSuccessfulFileMutation).toHaveBeenCalledTimes(1);

    const failed = run([
      assistantStart('m1'),
      { type: 'tool_execution_start', toolCallId: 'c1', toolName: 'edit', args: {} },
      { type: 'tool_execution_end', toolCallId: 'c1', isError: true },
    ]);
    expect(failed.callbacks.onSuccessfulFileMutation).not.toHaveBeenCalled();
  });

  it('marks a tool call errored on a failed tool_execution_end', () => {
    const { messages } = run([
      assistantStart('m1'),
      { type: 'tool_execution_start', toolCallId: 'c1', toolName: 'bash', args: {} },
      { type: 'tool_execution_end', toolCallId: 'c1', isError: true },
    ]);
    expect(messages[0].tools![0].status).toBe('error');
  });

  it('records a mid-stream error on message_end', () => {
    const { messages } = run([
      assistantStart('m1'),
      { type: 'message_end', message: { id: 'm1', stopReason: 'error', errorMessage: 'boom' } },
    ]);
    expect(messages[0]).toMatchObject({ errorMessage: 'boom', isStreaming: false });
  });

  it('toggles processing and fires onTurnComplete around the turn', () => {
    const { callbacks } = run([
      { type: 'agent_start' },
      assistantStart('m1'),
      { type: 'agent_end' },
    ]);
    expect(callbacks.setProcessing).toHaveBeenCalledWith(true);
    expect(callbacks.setProcessing).toHaveBeenCalledWith(false);
    expect(callbacks.onTurnComplete).toHaveBeenCalledTimes(1);
  });
});
