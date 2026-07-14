import type { ChatMessage, ToolCall } from '../types';

// Whether a message has anything worth rendering. Aborted/steered turns can
// leave empty assistant messages in history; rendering them as blank bubbles
// injects phantom vertical gaps, so skip them (but always keep streaming ones
// so the live indicator still shows).
export function hasRenderableContent(m: ChatMessage): boolean {
  return (
    m.role === 'user' ||
    m.role === 'notification' ||
    !!m.isStreaming ||
    !!m.isThinking ||
    !!m.content?.trim() ||
    !!m.thinking?.trim() ||
    !!m.errorMessage?.trim() ||
    (m.tools?.length ?? 0) > 0 ||
    (m.images?.length ?? 0) > 0
  );
}

// Map the raw session history from /api/sessions/:sessionId into renderable ChatMessages:
// user/assistant turns become bubbles, and toolResult turns are folded into
// the tool call they answer on the preceding assistant message.
export function mapHistoryToMessages(rawMessages: any[]): ChatMessage[] {
  const mapped: ChatMessage[] = [];
  let currentAssistantMessage: ChatMessage | null = null;

  for (const m of rawMessages) {
    if (m.role === 'user') {
      let contentStr = '';
      const images: { url: string; mimeType: string }[] = [];
      if (typeof m.content === 'string') {
        contentStr = m.content;
      } else if (Array.isArray(m.content)) {
        m.content.forEach((c: any) => {
          if (c.type === 'text') {
            contentStr += c.text || '';
          } else if (c.type === 'image' && c.data) {
            images.push({ url: `data:${c.mimeType};base64,${c.data}`, mimeType: c.mimeType });
          }
        });
      }

      mapped.push({
        id: m.id || Math.random().toString(),
        role: 'user',
        content: contentStr,
        images: images.length ? images : undefined,
      });
      currentAssistantMessage = null;
    } else if (m.role === 'assistant') {
      let contentStr = '';
      let thinkingStr = '';
      const tools: ToolCall[] = [];

      if (typeof m.content === 'string') {
        contentStr = m.content;
      } else if (Array.isArray(m.content)) {
        m.content.forEach((c: any) => {
          if (c.type === 'text') {
            contentStr += c.text;
          } else if (c.type === 'thinking') {
            thinkingStr += c.thinking || '';
          } else if (c.type === 'toolCall') {
            tools.push({
              id: c.id,
              name: c.name,
              status: 'running',
              output: '',
              args: c.arguments,
            });
          }
        });
      }

      const msg: ChatMessage = {
        id: m.id || Math.random().toString(),
        role: 'assistant',
        content: contentStr,
        thinking: thinkingStr || undefined,
        tools
      };
      // Preserve error state from persisted history.
      if (m.stopReason === 'error' && m.errorMessage) {
        msg.errorMessage = m.errorMessage;
      }
      mapped.push(msg);
      currentAssistantMessage = msg;
    } else if (m.role === 'toolResult' && currentAssistantMessage && currentAssistantMessage.tools) {
      const tool = currentAssistantMessage.tools.find(t => t.id === m.toolCallId);
      if (tool) {
        let resultStr = '';
        if (typeof m.content === 'string') {
          resultStr = m.content;
        } else if (Array.isArray(m.content)) {
          resultStr = m.content.filter((c: any) => c.type === 'text').map((c: any) => c.text || '').join('');
          const resultImages = m.content
            .filter((c: any) => c.type === 'image' && c.data && c.mimeType)
            .map((c: any) => ({ url: `data:${c.mimeType};base64,${c.data}`, mimeType: c.mimeType }));
          if (resultImages.length) {
            currentAssistantMessage.images = [...(currentAssistantMessage.images ?? []), ...resultImages];
          }
        }
        tool.output = resultStr;
        tool.status = m.isError ? 'error' : 'success';
      }
    }
  }

  // Tools with no recorded result were interrupted; don't leave them
  // spinning as "running" forever.
  for (const m of mapped) {
    m.tools?.forEach(t => {
      if (t.status === 'running') t.status = 'error';
    });
  }

  return mapped;
}
