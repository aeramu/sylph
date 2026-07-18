import { createSignal, createEffect, For, Show } from 'solid-js';
import type { ToolCall } from '../../types';
import { renderMarkdown, stripAnsi } from '../../lib/markdown';
import { highlightCodeToHtml, highlightMarkdownCodeBlocks } from '../../lib/codeHighlight';
import { escapeHtml } from '../../lib/html';
import { toolSummary, formatToolArgs, getEdits } from '../../lib/toolFormat';
import { diffLines } from '../../lib/diff';
import DiffView from '../changes/DiffView';
import CodeView from '../../shared/ui/CodeView';
import DisclosureChevron from '../../shared/ui/DisclosureChevron';
import './ToolExecution.css';

function fencedMarkdown(code: string, language = ''): string {
  const longestBacktickRun = Math.max(0, ...Array.from(code.matchAll(/`+/g), (m) => m[0].length));
  const fence = '`'.repeat(Math.max(3, longestBacktickRun + 1));
  return `${fence}${language}\n${code}\n${fence}`;
}

function InlineHighlightedCode(props: { code: string; language: string; class?: string }) {
  const [html, setHtml] = createSignal<string | null>(null);
  let seq = 0;

  createEffect(() => {
    const current = ++seq;
    const code = props.code;
    const language = props.language;
    setHtml(null);

    void highlightCodeToHtml(code, language).then((highlighted) => {
      if (current === seq) setHtml(highlighted);
    });
  });

  return (
    <code
      class={`inline-highlighted-code cm-highlighted ${props.class ?? ''}`}
      innerHTML={html() ?? escapeHtml(props.code)}
    />
  );
}

function MarkdownSnippet(props: { code: string; language?: string; class?: string }) {
  let contentRef: HTMLDivElement | undefined;

  createEffect(() => {
    void props.code;
    void props.language;
    highlightMarkdownCodeBlocks(contentRef);
  });

  return (
    <div
      ref={contentRef}
      class={`message-content tool-markdown-code ${props.class ?? ''}`}
      innerHTML={renderMarkdown(fencedMarkdown(props.code, props.language || ''))}
    />
  );
}

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
        {summary && (
          <Show
            when={props.tool.name === 'bash'}
            fallback={<span class="tool-summary">{summary}</span>}
          >
            <span class="tool-summary tool-summary-code">
              <InlineHighlightedCode code={summary} language="bash" />
            </span>
          </Show>
        )}
        <Show when={lineStats()}>
          {(stats) => (
            <span class="tool-edit-stats">
              <span class="tool-edit-stat added">+{stats().added}</span>
              <span class="tool-edit-stat deleted">-{stats().deleted}</span>
            </span>
          )}
        </Show>
        {(argSections.length > 0 || props.tool.output) && (
          <DisclosureChevron expanded={expanded()} class="tool-chevron" />
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
                    when={props.tool.name === 'bash' && section.label === 'Command'}
                    fallback={(
                      <Show
                        when={props.tool.name === 'write' && section.label === 'Content'}
                        fallback={<pre class="tool-call-value">{section.lines.join('\n')}</pre>}
                      >
                        <CodeView
                          code={section.lines.join('\n')}
                          path={toolPath()}
                          class="tool-call-code"
                        />
                      </Show>
                    )}
                  >
                    <MarkdownSnippet
                      code={section.lines.join('\n')}
                      language="bash"
                      class="tool-call-code"
                    />
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
            when={props.tool.name === 'bash'}
            fallback={(
              <Show
                when={props.tool.name === 'read'}
                fallback={(
                  <div class="tool-body">
                    {stripAnsi(props.tool.output)}
                  </div>
                )}
              >
                <CodeView
                  code={stripAnsi(props.tool.output)}
                  path={toolPath()}
                  class="tool-body-code"
                />
              </Show>
            )}
          >
            <MarkdownSnippet
              code={stripAnsi(props.tool.output)}
              language="output"
              class="tool-body-code"
            />
          </Show>
        )}
      </Show>
    </div>
  );
}
