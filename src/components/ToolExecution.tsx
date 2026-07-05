import { createSignal, createEffect, For, Show } from 'solid-js';
import type { ToolCall } from '../types';
import { stripAnsi } from '../lib/markdown';
import { toolSummary, formatToolArgs, getEdits } from '../lib/toolFormat';
import DiffView from './DiffView';

export default function ToolExecution(props: { tool: ToolCall }) {
  // Running tools stay expanded; finished ones auto-collapse on the
  // running -> done transition (same pattern as ThinkingSection). Manual
  // toggles after that are left alone.
  const isRunning = () => props.tool.status === 'running';
  const [expanded, setExpanded] = createSignal(isRunning());
  let wasRunning = isRunning();
  createEffect(() => {
    if (wasRunning && !isRunning()) setExpanded(false);
    wasRunning = isRunning();
  });
  const summary = toolSummary(props.tool.name, props.tool.args);
  const argSections = formatToolArgs(props.tool.name, props.tool.args);
  return (
    <div class="tool-execution">
      <div
        class={`tool-header ${props.tool.status} ${expanded() ? 'expanded' : ''}`}
        onClick={() => setExpanded(!expanded())}
      >
        <span class="tool-name">{props.tool.name}</span>
        {summary && <span class="tool-summary">{summary}</span>}
        {(argSections.length > 0 || props.tool.output) && (
          <svg class="tool-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        )}
      </div>
      <Show when={expanded()}>
        {argSections.length > 0 && (
          <div class="tool-call">
            <For each={argSections}>
              {(section) => (
                <div class={`tool-call-section ${section.label.toLowerCase()}`}>
                  <div class="tool-call-label">{section.label}</div>
                  <pre class="tool-call-value">{section.lines.join('\n')}</pre>
                </div>
              )}
            </For>
          </div>
        )}
        {props.tool.name === 'edit' && (
          <div class="tool-diffs">
            <For each={getEdits(props.tool.args)}>
              {(ed) => <DiffView oldText={ed.oldText} newText={ed.newText} />}
            </For>
          </div>
        )}
        {props.tool.output && (
          <div class="tool-body">
            {stripAnsi(props.tool.output)}
          </div>
        )}
      </Show>
    </div>
  );
}
