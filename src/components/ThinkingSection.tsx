import { createSignal, createEffect, Show } from 'solid-js';
import { renderMarkdown } from '../lib/markdown';

// Collapsible reasoning panel. Auto-expands while the model is actively
// thinking, then collapses once the answer text begins streaming.
export default function ThinkingSection(p: { text: string; active: boolean }) {
  const [expanded, setExpanded] = createSignal(p.active);
  let wasActive = p.active;
  createEffect(() => {
    // Collapse automatically on the active -> done transition, but leave the
    // user's manual toggle alone otherwise.
    if (wasActive && !p.active) setExpanded(false);
    wasActive = p.active;
  });
  return (
    <div class={`thinking-block ${p.active ? 'active' : ''}`}>
      <div class="thinking-summary" onClick={() => setExpanded(!expanded())}>
        <span class="thinking-summary-label">{p.active ? 'Thinking…' : 'Thought'}</span>
        <svg class={`thinking-chevron ${expanded() ? 'expanded' : ''}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </div>
      <Show when={expanded()}>
        <div class={`thinking-content ${p.active ? 'active' : ''}`} innerHTML={renderMarkdown(p.text)} />
      </Show>
    </div>
  );
}
