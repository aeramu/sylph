import { Show } from 'solid-js';
import type { ProjectInfo } from '../../../types';
import type { DiffSummary } from '../../../lib/sessionDiff';
import DiffStats from '../../changes/DiffStats';
import type { SessionBindingInfo } from '../api';

export default function SessionBar(props: {
  project?: ProjectInfo;
  binding?: SessionBindingInfo | null;
  diff: DiffSummary;
  onRestore: () => void;
  onRemove: () => void;
  onOpenChanges: () => void;
}) {
  return <div class="composer-session-bar">
    <Show when={props.project} keyed>{(project) => <span class="composer-session-project" title={project.directories.map((directory) => directory.path).join('\n')}>
      {project.directories.map((directory) => directory.name).join(' · ')}<Show when={props.binding?.branch}> — {props.binding!.branch}</Show>
    </span>}</Show>
    <Show when={props.binding?.worktreeMissing}>
      <span class="composer-session-worktree-missing">Missing</span>
      <button class="composer-session-worktree-restore" onClick={props.onRestore} title="Restore this session's worktree" aria-label="Restore this session's worktree">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg><span>Restore worktree</span>
      </button>
    </Show>
    <Show when={props.binding?.worktree && !props.binding?.worktreeMissing}>
      <button class="composer-session-worktree-remove" onClick={props.onRemove} title="Remove this session's worktree" aria-label="Remove this session's worktree">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/></svg>
      </button>
    </Show>
    <Show when={props.diff.files.length > 0}>
      <button class="diff-stats-chip session" onClick={props.onOpenChanges} title="Show all file changes from this session">
        <DiffStats files={props.diff.files.length} added={props.diff.added} deleted={props.diff.deleted}/>
      </button>
    </Show>
  </div>;
}
