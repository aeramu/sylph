import type { ChatMessage, ToolCall } from '../types';
import { hasRenderableContent } from './messages';

export type WorkItem =
  | { kind: 'thought'; message: ChatMessage }
  | { kind: 'tool'; tool: ToolCall };

export type WorkTimelineRow =
  | { id: string; kind: 'message'; message: ChatMessage }
  | { id: string; kind: 'work'; items: WorkItem[] }
  | { id: string; kind: 'turn'; index: number };

// Preserve display order: thoughts, message text, then tool calls. Only
// consecutive work is combined; visible messages and turn chips separate it.
export function groupToolMessages(
  messages: readonly ChatMessage[],
  endsTurn: (index: number) => boolean = () => false,
): WorkTimelineRow[] {
  const rows: WorkTimelineRow[] = [];
  const appendWork = (id: string, items: WorkItem[]) => {
    const previous = rows.at(-1);
    if (previous?.kind === 'work') previous.items.push(...items);
    else rows.push({ id, kind: 'work', items });
  };

  messages.forEach((message, index) => {
    if (message.role !== 'assistant') {
      if (hasRenderableContent(message)) rows.push({ id: message.id, kind: 'message', message });
    } else {
      const hasThought = !!message.thinking?.trim() || !!message.isThinking;
      const hasTools = !!message.tools?.length;
      if (hasThought) appendWork(`${message.id}:thought`, [{ kind: 'thought', message }]);
      const body = { ...message, thinking: undefined, isThinking: false, tools: [],
        isStreaming: message.isStreaming && !hasThought && !hasTools };
      if (hasRenderableContent(body)) rows.push({ id: message.id, kind: 'message', message: body });
      if (hasTools) appendWork(`${message.id}:tools`, message.tools!.map(tool => ({ kind: 'tool', tool })));
    }
    if (endsTurn(index)) rows.push({ id: `${message.id}:turn`, kind: 'turn', index });
  });
  return rows;
}
