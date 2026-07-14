import type { ChatMessage } from '../types';
import { extractThinkingBlocks } from './markdown';

export function normalizeAssistantThinking(message: ChatMessage): Partial<ChatMessage> {
  const rawContent = message.rawContent ?? message.content;
  const inline = extractThinkingBlocks(rawContent);
  const hasStructuredThinking = !!message.structuredThinking || !!message.structuredThinkingActive;

  return {
    rawContent,
    content: inline.content,
    thinking: hasStructuredThinking ? message.structuredThinking : inline.thinking || undefined,
    isThinking: hasStructuredThinking ? !!message.structuredThinkingActive : inline.isThinking,
  };
}
