import type { SetStoreFunction } from 'solid-js/store';
import type { ChatMessage } from '../types';

export interface AgentEventCallbacks {
  setProcessing: (v: boolean) => void;
  onTurnComplete?: () => void;
}

// Apply one streamed agent event to the messages store. Extracted from the
// component so the SSE plumbing and the store mutation logic stay separate.
export function applyAgentEvent(
  messages: ChatMessage[],
  setMessages: SetStoreFunction<ChatMessage[]>,
  event: any,
  callbacks: AgentEventCallbacks,
) {
  const lastIdx = messages.length - 1;

  if (event.type === 'message_start') {
    const msgId = event.message?.id || event.message?.responseId || Date.now().toString();

    if (event.message.role === 'assistant') {
      setMessages(messages.length, { id: msgId, role: 'assistant', content: '', isStreaming: true });
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
    if (lastIdx >= 0 && messages[lastIdx].role === 'assistant') {
      setMessages(lastIdx, 'isThinking', true);
    }
  } else if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'thinking_delta') {
    if (lastIdx >= 0 && messages[lastIdx].role === 'assistant') {
      setMessages(lastIdx, 'thinking', (t) => (t || '') + event.assistantMessageEvent.delta);
    }
  } else if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'thinking_end') {
    if (lastIdx >= 0 && messages[lastIdx].role === 'assistant') {
      setMessages(lastIdx, 'isThinking', false);
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
      if (lastIdx >= 0 && messages[lastIdx].role === 'assistant') {
        setMessages(lastIdx, 'content', (c) => (c || '') + event.assistantMessageEvent.delta);
      }
    }
  } else if (event.type === 'message_end') {
    setMessages(m => m.isStreaming === true, 'isStreaming', false);
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
    if (lastIdx >= 0 && messages[lastIdx].role === 'assistant') {
      const toolName = event.toolName || event.name || (event.toolCall && event.toolCall.name) || 'tool';
      setMessages(lastIdx, 'tools', (t) => [...(t || []), {
        id: event.toolCallId,
        name: toolName,
        status: 'running' as const,
        args: event.args,
      }]);
    }
  } else if (event.type === 'tool_execution_update') {
    if (lastIdx >= 0 && messages[lastIdx].role === 'assistant') {
      setMessages(lastIdx, 'tools', (tools) =>
        tools ? tools.map((t) => t.id === event.toolCallId ? { ...t, output: (t.output || '') + (event.delta || '') } : t) : []
      );
    }
  } else if (event.type === 'tool_execution_end') {
    if (lastIdx >= 0 && messages[lastIdx].role === 'assistant') {
      setMessages(lastIdx, 'tools', (tools) =>
        tools ? tools.map((t) => t.id === event.toolCallId ? { ...t, status: event.isError ? 'error' : 'success' } : t) : []
      );
    }
  }
}
