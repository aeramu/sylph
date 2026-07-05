import type { SetStoreFunction } from 'solid-js/store';
import type { ChatMessage } from '../types';

export interface AgentEventCallbacks {
  setProcessing: (v: boolean) => void;
  onTurnComplete?: () => void;
}

// Index of the assistant message live events should mutate: the streaming
// one, or failing that the most recent assistant message. Deltas used to
// target messages[length - 1], which silently dropped them whenever a
// steering prompt (optimistic user bubble) or a notification was appended
// behind the still-streaming assistant message.
function liveAssistantIdx(messages: ChatMessage[]): number {
  let lastAssistant = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'assistant') continue;
    if (m.isStreaming) return i;
    if (lastAssistant < 0) lastAssistant = i;
  }
  return lastAssistant;
}

// Apply one streamed agent event to the messages store. Extracted from the
// component so the SSE plumbing and the store mutation logic stay separate.
export function applyAgentEvent(
  messages: ChatMessage[],
  setMessages: SetStoreFunction<ChatMessage[]>,
  event: any,
  callbacks: AgentEventCallbacks,
) {
  if (event.type === 'message_start') {
    const msgId = event.message?.id || event.message?.responseId || Date.now().toString();

    if (event.message.role === 'assistant') {
      // An assistant message can arrive already terminated with an error
      // (e.g. provider rate limit, usage limit reached). Capture the error
      // text instead of leaving an empty streaming bubble forever.
      const isError = event.message.stopReason === 'error' && event.message.errorMessage;
      setMessages(messages.length, {
        id: msgId,
        role: 'assistant',
        content: '',
        isStreaming: !isError,
        ...(isError ? { errorMessage: event.message.errorMessage } : {}),
      });
    } else if (event.message.role === 'toolResult') {
      const toolCallId = event.message.toolCallId;
      let initialOutput = '';

      if (typeof event.message.content === 'string') {
        initialOutput = event.message.content;
      } else if (Array.isArray(event.message.content)) {
        initialOutput = event.message.content.filter((c: any) => c.type === 'text').map((c: any) => c.text || '').join('');
      }

      setMessages(
        m => m.role === 'assistant' && !!m.tools?.some(t => t.id === toolCallId),
        'tools',
        t => t.id === toolCallId,
        tool => ({
          ...tool,
          resultMsgId: msgId,
          status: (event.message.isError ? 'error' : 'success') as 'error' | 'success',
          output: initialOutput || tool.output
        })
      );
    }
  } else if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'thinking_start') {
    // Thinking only streams on the active assistant message (never tool results).
    const idx = liveAssistantIdx(messages);
    if (idx >= 0) {
      setMessages(idx, 'isThinking', true);
    }
  } else if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'thinking_delta') {
    const idx = liveAssistantIdx(messages);
    if (idx >= 0) {
      setMessages(idx, 'thinking', (t) => (t || '') + event.assistantMessageEvent.delta);
    }
  } else if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'thinking_end') {
    const idx = liveAssistantIdx(messages);
    if (idx >= 0) {
      setMessages(idx, 'isThinking', false);
    }
  } else if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
    const msgId = event.message?.id || event.message?.responseId;

    const isToolResult = msgId
      ? messages.some(m => m.tools?.some(t => t.resultMsgId === msgId))
      : (event.message?.role === 'toolResult' || !!event.message?.toolCallId);

    if (isToolResult) {
      const toolCallId = event.message?.toolCallId;
      if (toolCallId) {
        setMessages(
          m => m.role === 'assistant' && !!m.tools?.some(t => t.id === toolCallId),
          'tools',
          t => t.id === toolCallId,
          tool => ({ ...tool, output: (tool.output || '') + event.assistantMessageEvent.delta })
        );
      } else if (msgId) {
        setMessages(
          m => m.role === 'assistant' && !!m.tools?.some(t => t.resultMsgId === msgId),
          'tools',
          t => t.resultMsgId === msgId,
          tool => ({ ...tool, output: (tool.output || '') + event.assistantMessageEvent.delta })
        );
      }
    } else {
      const idx = liveAssistantIdx(messages);
      if (idx >= 0) {
        setMessages(idx, 'content', (c) => (c || '') + event.assistantMessageEvent.delta);
      }
    }
  } else if (event.type === 'message_end') {
    // message_end can also carry an error if the failure happens mid-stream.
    if (event.message?.stopReason === 'error' && event.message?.errorMessage) {
      const idx = liveAssistantIdx(messages);
      if (idx >= 0) {
        setMessages(idx, 'errorMessage', event.message.errorMessage);
        setMessages(idx, 'isStreaming', false);
      }
    } else {
      setMessages(m => m.isStreaming === true, 'isStreaming', false);
    }
    setMessages(m => m.isThinking === true, 'isThinking', false);
  } else if (event.type === 'agent_start') {
    callbacks.setProcessing(true);
  } else if (event.type === 'agent_end') {
    callbacks.setProcessing(false);
    setMessages(m => m.isStreaming === true, 'isStreaming', false);
    setMessages(m => m.isThinking === true, 'isThinking', false);
    // All message_end persistence has already run before agent_end, so the
    // session file on disk now has real metadata (first message, count).
    callbacks.onTurnComplete?.();
  } else if (event.type === 'tool_execution_start') {
    const idx = liveAssistantIdx(messages);
    if (idx >= 0) {
      const toolName = event.toolName || event.name || (event.toolCall && event.toolCall.name) || 'tool';
      setMessages(idx, 'tools', (t) => [...(t || []), {
        id: event.toolCallId,
        name: toolName,
        status: 'running' as const,
        args: event.args,
      }]);
    }
  } else if (event.type === 'tool_execution_update') {
    // Match the tool by id anywhere (like toolResult message_start does):
    // the owning assistant message need not be the last one anymore.
    if (event.toolCallId) {
      setMessages(
        m => m.role === 'assistant' && !!m.tools?.some(t => t.id === event.toolCallId),
        'tools',
        t => t.id === event.toolCallId,
        tool => ({ ...tool, output: (tool.output || '') + (event.delta || '') })
      );
    }
  } else if (event.type === 'tool_execution_end') {
    if (event.toolCallId) {
      setMessages(
        m => m.role === 'assistant' && !!m.tools?.some(t => t.id === event.toolCallId),
        'tools',
        t => t.id === event.toolCallId,
        tool => ({ ...tool, status: (event.isError ? 'error' : 'success') as 'error' | 'success' })
      );
    }
  }
}
