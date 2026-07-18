import { Show } from 'solid-js';
import type { ProjectInfo } from '../../../types';
import type { DiffSummary } from '../../../lib/sessionDiff';
import DiffStats from '../../changes/DiffStats';
import type { SessionBindingInfo } from '../api';

export default function SessionBar(props: {
  project?: ProjectInfo;
  binding?: SessionBindingInfo | null;
  diff: DiffSummary;
  canAddFolder: boolean;
  onRestore: () => void;
  onRemove: () => void;
  onAddFolder: () => void;
  onOpenChanges: () => void;
}) {
  return <div class="composer-session-bar">
    <Show when={props.binding?.workspaceKind === 'scratch'} fallback={<Show when={props.project} keyed>{(project) => <span class="composer-session-project" title={project.directories.map((directory) => directory.path).join('\n')}>
      {project.directories.map((directory) => directory.name).join(' · ')}<Show when={props.binding?.branch}> — {props.binding!.branch}</Show>
    </span>}</Show>}><span class="composer-session-project">Temporary session</span></Show>
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
    <button class="composer-session-add-folder" onClick={props.onAddFolder} disabled={!props.canAddFolder || props.binding?.worktreeMissing} title="Add a folder to this session" aria-label="Add folder to session">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h5l2 2h8A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/><path d="M12 11v5M9.5 13.5h5"/></svg><span>Add folder</span>
    </button>
    <Show when={props.diff.files.length > 0}>
      <button class="diff-stats-chip session" onClick={props.onOpenChanges} title="Show all file changes from this session">
        <DiffStats files={props.diff.files.length} added={props.diff.added} deleted={props.diff.deleted}/>
      </button>
    </Show>
  </div>;
}
