import { createSignal, createEffect, For, Show } from 'solid-js';
import type { ToolCall } from '../types';
import { stripAnsi } from '../lib/markdown';
import { toolSummary, formatToolArgs, getEdits } from '../lib/toolFormat';
import { diffLines } from '../lib/diff';
import DiffView from './DiffView';
import CodeView from './CodeView';

function editLineStats(args?: Record<string, any>): { added: number; deleted: number } | null {
  const edits = getEdits(args);
  if (edits.length === 0) return null;

  return edits.reduce(
    (total, edit) => {
      for (const row of diffLines(edit.oldText, edit.newText)) {
        if (row.type === 'add') total.added += 1;
        if (row.type === 'del') total.deleted += 1;
      }
      return total;
    },
    { added: 0, deleted: 0 },
  );
}

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
  const toolPath = () => String(props.tool.args?.path ?? '');
  const summary = toolSummary(props.tool.name, props.tool.args);
  const argSections = formatToolArgs(props.tool.name, props.tool.args);
  const lineStats = () => props.tool.name === 'edit' ? editLineStats(props.tool.args) : null;
  return (
    <div class="tool-execution">
      <div
        class={`tool-header ${props.tool.status} ${expanded() ? 'expanded' : ''}`}
        onClick={() => setExpanded(!expanded())}
      >
        <span class="tool-name">{props.tool.name}</span>
        {summary && <span class="tool-summary">{summary}</span>}
        <Show when={lineStats()}>
          {(stats) => (
            <span class="tool-edit-stats">
              <span class="tool-edit-stat added">+{stats().added}</span>
              <span class="tool-edit-stat deleted">-{stats().deleted}</span>
            </span>
          )}
        </Show>
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
                  <Show
                    when={props.tool.name === 'write' && section.label === 'Content'}
                    fallback={<pre class="tool-call-value">{section.lines.join('\n')}</pre>}
                  >
                    <CodeView code={section.lines.join('\n')} path={toolPath()} class="tool-call-code" />
                  </Show>
                </div>
              )}
            </For>
          </div>
        )}
        {props.tool.name === 'edit' && (
          <div class="tool-diffs">
            <For each={getEdits(props.tool.args)}>
              {(ed) => <DiffView oldText={ed.oldText} newText={ed.newText} path={toolPath()} />}
            </For>
          </div>
        )}
        {props.tool.output && (
          <Show
            when={props.tool.name === 'read'}
            fallback={(
              <div class="tool-body">
                {stripAnsi(props.tool.output)}
              </div>
            )}
          >
            <CodeView code={stripAnsi(props.tool.output)} path={toolPath()} class="tool-body-code" />
          </Show>
        )}
      </Show>
    </div>
  );
}
