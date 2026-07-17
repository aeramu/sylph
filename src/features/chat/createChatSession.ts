import { createSignal, type Accessor } from 'solid-js';
import type { ChatMessage } from '../../types';
import { sessionStatuses } from '../../lib/sessionStatus';

export function createChatSession(options: {
  sessionId: Accessor<string | undefined>;
  projectId: Accessor<string | undefined>;
  messages: ChatMessage[];
}) {
  const [newSessionProcessing, setNewSessionProcessing] = createSignal(false);
  const isProcessing = () => {
    const sessionId = options.sessionId();
    if (!sessionId) return newSessionProcessing();
    const status = sessionStatuses[sessionId];
    return status === 'working' || status === 'needsInput';
  };
  const draftKey = () => options.sessionId()
    ? `session:${options.sessionId()}`
    : `project:${options.projectId() ?? 'none'}:new`;
  const title = () => {
    const first = options.messages.find((message) => message.role === 'user' && message.content?.trim());
    const value = first?.content.trim().split('\n')[0] || 'New Chat';
    return value.length > 80 ? `${value.slice(0, 80)}…` : value;
  };
  return { newSessionProcessing, setNewSessionProcessing, isProcessing, draftKey, title };
}
