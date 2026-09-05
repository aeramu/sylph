import { createEffect, For, Show } from 'solid-js';
import type { ChatMessage } from '../../types';
import { renderMarkdown } from '../../lib/markdown';
import { highlightMarkdownCodeBlocks } from '../../lib/codeHighlight';
import ThinkingSection from './ThinkingSection';
import ToolExecution from './ToolExecution';
import ThinkingIndicator from './components/ThinkingIndicator';
import BackgroundJobCard from './components/BackgroundJobCard';
import './MessageBubble.css';

export default function MessageBubble(props: { msg: ChatMessage; sessionId?: string; onImageClick: (url: string) => void }) {
  let contentRef: HTMLDivElement | undefined;

  createEffect(() => {
    void props.msg.content;
    highlightMarkdownCodeBlocks(contentRef);
  });

  if (props.msg.role === 'background-job') {
    return <BackgroundJobCard jobs={props.msg.backgroundJobs ?? []} sessionId={props.sessionId} />;
  }

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
        <Show when={props.msg.role === 'user' && props.msg.steered}>
          <div class="message-steered-chip" title="Delivered while the agent was working">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 2 11 13"></path>
              <path d="M22 2 15 22 11 13 2 9 22 2"></path>
            </svg>
            <span>steered</span>
          </div>
        </Show>
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
              {(tool) => tool.name === 'bg_run' && tool.backgroundJob
                ? <BackgroundJobCard jobs={[tool.backgroundJob]} sessionId={props.sessionId} embedded />
                : <ToolExecution tool={tool} />}
            </For>
          </div>
        )}

        <Show when={props.msg.isStreaming}><ThinkingIndicator /></Show>
      </div>
    </div>
  );
}
