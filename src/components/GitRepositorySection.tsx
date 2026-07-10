import { createSignal, For, Show } from 'solid-js';
import type { GitCommit, GitDivergence, GitRepositoryInfo } from '../lib/gitPatch';
import { GitChevron } from './GitPatchView';

function commitDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

function CommitRows(props: { commits: GitCommit[]; empty: string }) {
  return (
    <div class="git-commit-list">
      <For each={props.commits} fallback={<div class="git-source-empty">{props.empty}</div>}>
        {(commit) => (
          <div class="git-commit-row" title={`${commit.hash}\n${commit.author} · ${commit.authoredAt}`}>
            <code>{commit.shortHash}</code>
            <div class="git-commit-details">
              <span class="git-commit-subject">{commit.subject}</span>
              <span class="git-commit-meta">{commit.author} · {commitDate(commit.authoredAt)}</span>
            </div>
          </div>
        )}
      </For>
    </div>
  );
}

export function GitBranchSection(props: {
  repository?: GitRepositoryInfo;
  divergence: GitDivergence;
  collapsed: boolean;
  busy: boolean;
  syncOperation: 'pull' | 'push' | null;
  onToggle: () => void;
  onPull: () => void;
  onPush: () => void;
}) {
  const [collapsedGroups, setCollapsedGroups] = createSignal({ unpushed: false, unpulled: false });

  return (
    <section class="git-branch-section">
      <div class="git-branch-header">
        <button class="git-branch-toggle" onClick={props.onToggle} aria-expanded={!props.collapsed}>
          <GitChevron expanded={!props.collapsed} />
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="6" cy="5" r="2"></circle><circle cx="6" cy="19" r="2"></circle><circle cx="18" cy="12" r="2"></circle>
            <path d="M6 7v10M8 7c5 0 3 5 8 5"></path>
          </svg>
          <span>{props.repository?.branch ?? 'Branch'}</span>
        </button>
        <div class="git-sync-actions">
          <button
            class="git-sync-button"
            disabled={props.busy || !props.repository?.upstream || (props.repository?.behind ?? 0) === 0}
            onClick={props.onPull}
            title={`Pull ${props.repository?.behind ?? 0} commit${props.repository?.behind === 1 ? '' : 's'} (fast-forward only)`}
            aria-label={`Pull ${props.repository?.behind ?? 0} commits`}
          >
            <Show when={props.syncOperation !== 'pull'} fallback={
              <svg class="git-sync-spinner" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                <path d="M21 12a9 9 0 1 1-3-6.7"></path>
              </svg>
            }>
              <span>↓&nbsp;{props.repository?.behind ?? 0}</span>
            </Show>
          </button>
          <button
            class="git-sync-button"
            disabled={props.busy || !props.repository?.upstream || (props.repository?.ahead ?? 0) === 0}
            onClick={props.onPush}
            title={`Push ${props.repository?.ahead ?? 0} commit${props.repository?.ahead === 1 ? '' : 's'}`}
            aria-label={`Push ${props.repository?.ahead ?? 0} commits`}
          >
            <Show when={props.syncOperation !== 'push'} fallback={
              <svg class="git-sync-spinner" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                <path d="M21 12a9 9 0 1 1-3-6.7"></path>
              </svg>
            }>
              <span>↑&nbsp;{props.repository?.ahead ?? 0}</span>
            </Show>
          </button>
        </div>
      </div>
      <Show when={!props.collapsed}>
        <Show when={props.repository?.upstream} fallback={<div class="git-source-empty">No upstream configured</div>}>
          <div class="git-divergence-group">
            <button
              class="git-divergence-title"
              onClick={() => setCollapsedGroups((value) => ({ ...value, unpushed: !value.unpushed }))}
              aria-expanded={!collapsedGroups().unpushed}
            >
              <GitChevron expanded={!collapsedGroups().unpushed} />
              <span>Unpushed commits</span>
              <span class="git-source-count">{props.divergence.unpushed.length}</span>
            </button>
            <Show when={!collapsedGroups().unpushed}>
              <CommitRows commits={props.divergence.unpushed} empty="No unpushed commits" />
            </Show>
          </div>
          <div class="git-divergence-group">
            <button
              class="git-divergence-title"
              onClick={() => setCollapsedGroups((value) => ({ ...value, unpulled: !value.unpulled }))}
              aria-expanded={!collapsedGroups().unpulled}
            >
              <GitChevron expanded={!collapsedGroups().unpulled} />
              <span>Unpulled commits</span>
              <span class="git-source-count">{props.divergence.unpulled.length}</span>
            </button>
            <Show when={!collapsedGroups().unpulled}>
              <CommitRows commits={props.divergence.unpulled} empty="No unpulled commits" />
            </Show>
          </div>
        </Show>
      </Show>
    </section>
  );
}

export function GitCommitHistory(props: { commits: GitCommit[]; collapsed: boolean; onToggle: () => void }) {
  return (
    <section class="git-history-section">
      <button class="git-history-toggle" onClick={props.onToggle} aria-expanded={!props.collapsed}>
        <GitChevron expanded={!props.collapsed} />
        <span>Commits</span>
      </button>
      <Show when={!props.collapsed}>
        <CommitRows commits={props.commits} empty="No commits" />
      </Show>
    </section>
  );
}
