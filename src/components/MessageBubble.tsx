import { createEffect, For, Show } from 'solid-js';
import type { ChatMessage } from '../types';
import { renderMarkdown } from '../lib/markdown';
import { highlightMarkdownCodeBlocks } from '../lib/codeHighlight';
import ThinkingSection from './ThinkingSection';
import ToolExecution from './ToolExecution';

export default function MessageBubble(props: { msg: ChatMessage; onImageClick: (url: string) => void }) {
  let contentRef: HTMLDivElement | undefined;

  createEffect(() => {
    void props.msg.content;
    highlightMarkdownCodeBlocks(contentRef);
  });

  if (props.msg.role === 'notification') {
    return (
      <div class={`chat-notification chat-notification-${props.msg.notifyType || 'info'}`}>
        <svg class="chat-notification-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="16" x2="12" y2="12"></line>
          <line x1="12" y1="8" x2="12.01" y2="8"></line>
        </svg>
        <span class="chat-notification-text">{props.msg.content}</span>
      </div>
    );
  }

  return (
    <div class={`message ${props.msg.role}`}>
      <div class="message-bubble">
        {props.msg.images && props.msg.images.length > 0 && (
          <div class="message-images">
            <For each={props.msg.images}>
              {(img) => (
                <img src={img.url} class="message-image" alt="attachment" onClick={() => props.onImageClick(img.url)} />
              )}
            </For>
          </div>
        )}
        <Show when={props.msg.role === 'assistant' && (props.msg.thinking || props.msg.isThinking)}>
          <ThinkingSection text={props.msg.thinking || ''} active={!!props.msg.isThinking} />
        </Show>
        <div
          ref={contentRef}
          class="message-content"
          innerHTML={renderMarkdown(props.msg.content, { processThinkingTags: props.msg.role !== 'assistant' })}
        />

        <Show when={props.msg.errorMessage}>
          <div class="message-error">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0; margin-top: 2px;">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <span>{props.msg.errorMessage}</span>
          </div>
        </Show>

        {props.msg.tools && props.msg.tools.length > 0 && (
          <div class="tool-executions">
            <For each={props.msg.tools}>
              {(tool) => <ToolExecution tool={tool} />}
            </For>
          </div>
        )}

        {props.msg.isStreaming && (
          <div class="thinking-indicator">
            <div class="thinking-dot"></div>
            <div class="thinking-dot"></div>
            <div class="thinking-dot"></div>
          </div>
        )}
      </div>
    </div>
  );
}
