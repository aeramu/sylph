import { For, Show } from 'solid-js';
import type { ChatMessage } from '../types';
import { renderMarkdown } from '../lib/markdown';
import ThinkingSection from './ThinkingSection';
import ToolExecution from './ToolExecution';

export default function MessageBubble(props: { msg: ChatMessage; onImageClick: (url: string) => void }) {
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
          class="message-content"
          innerHTML={renderMarkdown(props.msg.content)}
        />

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
