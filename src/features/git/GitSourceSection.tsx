import { Index, Show } from 'solid-js';
import type { GitFile } from '../../lib/gitPatch';
import { gitPatchStats, gitStatusLabel, splitGitFilePath } from '../../lib/gitPatch';
import DisclosureChevron from '../../shared/ui/DisclosureChevron';
import GitPatchView from './GitPatchView';

export default function GitSourceSection(props: {
  title: string;
  files: GitFile[];
  staged: boolean;
  busy: boolean;
  collapsed: boolean;
  onToggle: () => void;
  expanded: Record<string, boolean>;
  onToggleFile: (key: string) => void;
  onFileAction: (file: GitFile) => void;
  onAllAction: () => void;
  onApplyPatch: (file: GitFile, patch: string, reverse: boolean) => void;
}) {
  return (
      <section class={`git-source-section ${props.files.length === 0 ? 'empty' : ''}`}>
        <div class="git-source-section-header">
          <button class="git-source-section-toggle" onClick={props.onToggle} aria-expanded={!props.collapsed}>
            <DisclosureChevron expanded={!props.collapsed} class="git-chevron" />
            <span>{props.title}</span>
            <span class="git-source-count">{props.files.length}</span>
          </button>
          <button
            class="git-icon-button git-source-all-action"
            disabled={props.busy || props.files.length === 0}
            onClick={props.onAllAction}
            title={props.staged ? 'Unstage all changes' : 'Stage all changes'}
            aria-label={props.staged ? 'Unstage all changes' : 'Stage all changes'}
          >
            {props.staged ? '−' : '+'}
          </button>
        </div>
        <Show when={!props.collapsed}>
          <Show when={props.files.length > 0} fallback={<div class="git-source-empty">No changes</div>}>
          <div class="git-source-files">
            <Index each={props.files}>
              {(file) => {
                const key = () => `${props.staged ? 'staged' : 'unstaged'}:${file().path}`;
                const pathParts = () => splitGitFilePath(file().path);
                const patch = () => props.staged ? file().stagedPatch : file().unstagedPatch;
                const stats = () => gitPatchStats(patch());
                const status = () => gitStatusLabel(file(), props.staged);
                return (
                  <div class={`git-source-file ${props.expanded[key()] ? 'expanded' : ''}`}>
                    <div class="git-source-file-row">
                      <button
                        class="git-source-file-open"
                        onClick={() => props.onToggleFile(key())}
                        title={file().path}
                        aria-expanded={!!props.expanded[key()]}
                      >
                        <DisclosureChevron expanded={!!props.expanded[key()]} class="git-chevron git-file-chevron" />
                        <span class="git-source-file-name">{pathParts().name}</span>
                        <Show when={pathParts().directory}>
                          <span class="git-source-file-directory">{pathParts().directory}</span>
                        </Show>
                      </button>
                      <button
                        class="git-icon-button git-source-file-action"
                        disabled={props.busy}
                        onClick={() => props.onFileAction(file())}
                        title={props.staged ? 'Unstage changes' : 'Stage changes'}
                        aria-label={`${props.staged ? 'Unstage' : 'Stage'} ${file().path}`}
                      >
                        {props.staged ? '−' : '+'}
                      </button>
                      <span class="git-source-file-stats" aria-label={`${stats().added} lines added, ${stats().deleted} lines deleted`}>
                        <Show when={stats().added > 0}><span class="diff-stats-added">+{stats().added}</span></Show>
                        <Show when={stats().deleted > 0}><span class="diff-stats-deleted">-{stats().deleted}</span></Show>
                      </span>
                      <span class={`git-source-status status-${status().code.toLowerCase()}`} title={status().title}>
                        {status().code}
                      </span>
                    </div>
                    <Show when={props.expanded[key()]}>
                      <Show when={patch().trim()} fallback={<div class="git-source-no-diff">No text diff available. Use the file action to {props.staged ? 'unstage' : 'stage'} it.</div>}>
                        <GitPatchView
                          patch={patch()}
                          actionLabel={props.staged ? 'Unstage' : 'Stage'}
                          path={file().path}
                          busy={props.busy}
                          reverse={props.staged}
                          lineActionLabel={props.staged ? 'Unstage line' : 'Stage line'}
                          onApplyPatch={(partial) => props.onApplyPatch(file(), partial, props.staged)}
                        />
                      </Show>
                    </Show>
                  </div>
                );
              }}
            </Index>
          </div>
          </Show>
        </Show>
      </section>
  );
}
