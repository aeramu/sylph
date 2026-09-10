import type { SetStoreFunction } from 'solid-js/store';
import type { ChatMessage } from '../types';
import { normalizeAssistantThinking } from './messageThinking';
import {
  backgroundJobsFromCustomMessage, backgroundJobsFromToolDetails, mapAgentUserMessage, mapCustomMessage, messageId,
} from './messages';

export interface AgentEventCallbacks {
  setProcessing: (v: boolean) => void;
  onTurnComplete?: () => void;
  onSuccessfulFileMutation?: () => void;
}

// Tool start/end events are separate. Keep the authoritative name keyed by
// call id instead of relying on a reactive message-store lookup at end time.
const activeToolNames = new Map<string, string>();

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
    const msgId = messageId(event.message ?? {});

    if (event.message.role === 'user') {
      const incoming = mapAgentUserMessage({ ...event.message, id: msgId });
      const existing = messages.findIndex((message) => message.id === msgId);
      if (existing >= 0) {
        // The submitting tab already has an optimistic bubble. Reconcile its
        // durable metadata; other tabs append the same event as a new row.
        setMessages(existing, (message) => ({ ...message, ...incoming }));
      } else {
        setMessages(messages.length, incoming);
      }
    } else if (event.message.role === 'custom') {
      const jobs = backgroundJobsFromCustomMessage(event.message);
      const unlinked = jobs.filter((job) => {
        const ownsJob = (message: ChatMessage) => message.tools?.some((tool) => tool.name === 'bg_run' && tool.backgroundJob?.id === job.id) === true;
        if (!messages.some(ownsJob)) return true;
        setMessages(
          ownsJob,
          'tools',
          tool => tool.name === 'bg_run' && tool.backgroundJob?.id === job.id,
          'backgroundJob',
          job,
        );
        return false;
      });
      const custom = mapCustomMessage(event.message, jobs.length > 0 ? unlinked : undefined);
      if (custom && !messages.some((message) => message.id === custom.id)) setMessages(messages.length, custom);
    } else if (event.message.role === 'assistant') {
      // An assistant message can arrive already terminated with an error
      // (e.g. provider rate limit, usage limit reached). Capture the error
      // text instead of leaving an empty streaming bubble forever.
      const isError = event.message.stopReason === 'error' && event.message.errorMessage;
      const existing = messages.findIndex((message) => message.id === msgId);
      if (existing < 0) {
        setMessages(messages.length, {
          id: msgId,
          role: 'assistant',
          content: '',
          rawContent: '',
          isStreaming: !isError,
          ...(isError ? { errorMessage: event.message.errorMessage } : {}),
        });
      }
    } else if (event.message.role === 'toolResult') {
      const toolCallId = event.message.toolCallId;
      let initialOutput = '';
      let resultImages: { url: string; mimeType: string }[] = [];

      if (typeof event.message.content === 'string') {
        initialOutput = event.message.content;
      } else if (Array.isArray(event.message.content)) {
        initialOutput = event.message.content.filter((c: any) => c.type === 'text').map((c: any) => c.text || '').join('');
        resultImages = event.message.content
          .filter((c: any) => c.type === 'image' && c.data && c.mimeType)
          .map((c: any) => ({ url: `data:${c.mimeType};base64,${c.data}`, mimeType: c.mimeType }));
      }

      const detailJobs = backgroundJobsFromToolDetails(event.message.details);
      setMessages(
        m => m.role === 'assistant' && !!m.tools?.some(t => t.id === toolCallId),
        'tools',
        t => t.id === toolCallId,
        tool => ({
          ...tool,
          resultMsgId: msgId,
          status: (event.message.isError ? 'error' : 'success') as 'error' | 'success',
          output: initialOutput || tool.output,
          ...(tool.name === 'bg_run' && detailJobs[0] ? { backgroundJob: detailJobs[0] } : {}),
        })
      );
      for (const job of detailJobs) {
        setMessages(
          message => message.tools?.some((tool) => tool.name === 'bg_run' && tool.backgroundJob?.id === job.id) === true,
          'tools',
          tool => tool.name === 'bg_run' && tool.backgroundJob?.id === job.id,
          'backgroundJob',
          job,
        );
      }
      if (resultImages.length) {
        setMessages(
          m => m.role === 'assistant' && !!m.tools?.some(t => t.id === toolCallId),
          message => ({ ...message, images: [...(message.images ?? []), ...resultImages] }),
        );
      }
    }
  } else if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'thinking_start') {
    const idx = liveAssistantIdx(messages);
    if (idx >= 0) {
      setMessages(idx, (message) => ({
        ...message,
        structuredThinkingActive: true,
        ...normalizeAssistantThinking({ ...message, structuredThinkingActive: true }),
      }));
    }
  } else if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'thinking_delta') {
    const idx = liveAssistantIdx(messages);
    if (idx >= 0) {
      setMessages(idx, (message) => {
        const structuredThinking = (message.structuredThinking || '') + event.assistantMessageEvent.delta;
        return {
          ...message,
          structuredThinking,
          ...normalizeAssistantThinking({ ...message, structuredThinking }),
        };
      });
    }
  } else if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'thinking_end') {
    const idx = liveAssistantIdx(messages);
    if (idx >= 0) {
      setMessages(idx, (message) => ({
        ...message,
        structuredThinkingActive: false,
        ...normalizeAssistantThinking({ ...message, structuredThinkingActive: false }),
      }));
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
        setMessages(idx, (message) => {
          const rawContent = (message.rawContent ?? message.content ?? '') + event.assistantMessageEvent.delta;
          return {
            ...message,
            rawContent,
            ...normalizeAssistantThinking({ ...message, rawContent }),
          };
        });
      }
    }
  } else if (event.type === 'message_end' && (event.message?.role === 'custom' || event.message?.role === 'user')) {
    // Their matching message_start already rendered the row. Neither message
    // type should close an unrelated assistant stream.
    return;
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
    setMessages(m => m.isThinking === true, (message) => ({
      ...message,
      isThinking: false,
      structuredThinkingActive: false,
    }));
  } else if (event.type === 'agent_start') {
    callbacks.setProcessing(true);
  } else if (event.type === 'agent_end') {
    callbacks.setProcessing(false);
    setMessages(m => m.isStreaming === true, 'isStreaming', false);
    setMessages(m => m.isThinking === true, (message) => ({
      ...message,
      isThinking: false,
      structuredThinkingActive: false,
    }));
    // All message_end persistence has already run before agent_end, so the
    // session file on disk now has real metadata (first message, count).
    callbacks.onTurnComplete?.();
  } else if (event.type === 'tool_execution_start') {
    const idx = liveAssistantIdx(messages);
    if (idx >= 0) {
      const toolName = event.toolName || event.name || (event.toolCall && event.toolCall.name) || 'tool';
      if (event.toolCallId) activeToolNames.set(event.toolCallId, toolName);
      const existingTool = messages[idx].tools?.findIndex((tool) => tool.id === event.toolCallId) ?? -1;
      if (existingTool >= 0) {
        setMessages(idx, 'tools', existingTool, (tool) => ({ ...tool, name: toolName, status: 'running' as const, args: event.args ?? tool.args }));
      } else {
        setMessages(idx, 'tools', (tools) => [...(tools || []), {
          id: event.toolCallId,
          name: toolName,
          status: 'running' as const,
          args: event.args,
        }]);
      }
    }
  } else if (event.type === 'tool_execution_update') {
    // Match the tool by id anywhere (like toolResult message_start does):
    // the owning assistant message need not be the last one anymore.
    if (event.toolCallId) {
      const snapshot = Array.isArray(event.partialResult?.content)
        ? event.partialResult.content
          .filter((part: any) => part?.type === 'text')
          .map((part: any) => part.text || '')
          .join('')
        : undefined;
      setMessages(
        m => m.role === 'assistant' && !!m.tools?.some(t => t.id === event.toolCallId),
        'tools',
        t => t.id === event.toolCallId,
        tool => ({ ...tool, output: snapshot ?? ((tool.output || '') + (event.delta || '')) })
      );
    }
  } else if (event.type === 'tool_execution_end') {
    if (event.toolCallId) {
      const toolName = event.toolName
        || event.name
        || event.toolCall?.name
        || activeToolNames.get(event.toolCallId)
        || messages.flatMap((message) => message.tools ?? []).find((tool) => tool.id === event.toolCallId)?.name;
      const detailJobs = backgroundJobsFromToolDetails(event.result?.details);
      activeToolNames.delete(event.toolCallId);
      setMessages(
        m => m.role === 'assistant' && !!m.tools?.some(t => t.id === event.toolCallId),
        'tools',
        t => t.id === event.toolCallId,
        tool => ({
          ...tool,
          status: (event.isError ? 'error' : 'success') as 'error' | 'success',
          ...(toolName === 'bg_run' && detailJobs[0] ? { backgroundJob: detailJobs[0] } : {}),
        })
      );
      for (const job of detailJobs) {
        setMessages(
          message => message.tools?.some((tool) => tool.name === 'bg_run' && tool.backgroundJob?.id === job.id) === true,
          'tools',
          tool => tool.name === 'bg_run' && tool.backgroundJob?.id === job.id,
          'backgroundJob',
          job,
        );
      }
      if (!event.isError && (toolName === 'edit' || toolName === 'write')) {
        callbacks.onSuccessfulFileMutation?.();
      }
    }
  }
}
