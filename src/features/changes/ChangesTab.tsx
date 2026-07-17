import { createSignal, Index, Show } from 'solid-js';
import type { DiffSummary, FileDiff } from '../../lib/sessionDiff';
import { diffMode, setDiffMode } from '../../lib/diffMode';
import DiffStats from './DiffStats';
import DiffView from './DiffView';
import './ChangesTab.css';

function FileDiffSection(props: { file: FileDiff; defaultExpanded: boolean }) {
  const [expanded, setExpanded] = createSignal(props.defaultExpanded);
  return (
    <div class="changes-file">
      <button class="changes-file-header" onClick={() => setExpanded((e) => !e)}>
        <svg
          class={`changes-file-chevron ${expanded() ? 'expanded' : ''}`}
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
        >
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
        <span class="changes-file-path" title={props.file.path}>{props.file.path}</span>
        <span class="changes-file-stats">
          <span class="diff-stats-added">+{props.file.added}</span>
          <span class="diff-stats-deleted">-{props.file.deleted}</span>
        </span>
      </button>
      <Show when={expanded()}>
        <div class="changes-file-blocks">
          <Index each={props.file.blocks}>
            {(block) => <DiffView oldText={block().oldText} newText={block().newText} path={props.file.path} />}
          </Index>
        </div>
      </Show>
    </div>
  );
}

// Contents of the Changes tab: the session's (or one turn's) file diffs,
// reconstructed from edit/write tool calls (see lib/sessionDiff.ts).
export default function ChangesTab(props: {
  diff: DiffSummary;
  turnFilter: number | null;
  onClearFilter: () => void;
}) {
  return (
    <div class="changes-tab">
      <Show when={props.turnFilter != null}>
        <div class="changes-filter">
          <span class="changes-filter-label">For turn {props.turnFilter} only</span>
          <button class="changes-filter-clear" onClick={props.onClearFilter} title="Show whole session" aria-label="Clear turn filter">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </Show>
      <Show
        when={props.diff.files.length > 0}
        fallback={
          <div class="changes-empty">
            {props.turnFilter != null
              ? `No file changes in turn ${props.turnFilter}.`
              : 'No file changes in this session yet.'}
          </div>
        }
      >
        <div class="changes-summary">
          <DiffStats files={props.diff.files.length} added={props.diff.added} deleted={props.diff.deleted} />
          <div class="diff-mode-toggle" role="group" aria-label="Diff layout">
            <button
              class={`diff-mode-btn ${diffMode() === 'split' ? 'active' : ''}`}
              onClick={() => setDiffMode('split')}
              title="Side-by-side diff"
            >
              Split
            </button>
            <button
              class={`diff-mode-btn ${diffMode() === 'unified' ? 'active' : ''}`}
              onClick={() => setDiffMode('unified')}
              title="Unified diff"
            >
              Unified
            </button>
          </div>
        </div>
        <div class="changes-files">
          {/* Index (not For): the diff summaries are recomputed objects on
              every message-store change, so keying by identity would remount
              each file section (and its CodeMirror views) mid-stream. */}
          <Index each={props.diff.files}>
            {(file) => <FileDiffSection file={file()} defaultExpanded={props.diff.files.length <= 3} />}
          </Index>
        </div>
      </Show>
    </div>
  );
}
