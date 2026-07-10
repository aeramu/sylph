import { diffMode, setDiffMode } from '../lib/diffMode';

export default function GitToolbar(props: { fileCount: number; loading: boolean; busy: boolean; onRefresh: () => void }) {
  return (
    <div class="git-toolbar">
      <div>
        <div class="git-title">Git</div>
        <div class="git-subtitle">{props.fileCount} changed file{props.fileCount === 1 ? '' : 's'}</div>
      </div>
      <div class="git-toolbar-actions">
        <div class="git-diff-mode" role="group" aria-label="Git diff layout">
          <button
            class={`git-toolbar-icon ${diffMode() === 'split' ? 'active' : ''}`}
            onClick={() => setDiffMode('split')}
            title="Side-by-side diff"
            aria-label="Side-by-side diff"
            aria-pressed={diffMode() === 'split'}
          >
            Split
          </button>
          <button
            class={`git-toolbar-icon ${diffMode() === 'unified' ? 'active' : ''}`}
            onClick={() => setDiffMode('unified')}
            title="Unified diff"
            aria-label="Unified diff"
            aria-pressed={diffMode() === 'unified'}
          >
            Unified
          </button>
        </div>
        <button
          class={`git-toolbar-icon git-refresh-button ${props.loading ? 'loading' : ''}`}
          disabled={props.loading || props.busy}
          onClick={props.onRefresh}
          title="Refresh Git status"
          aria-label="Refresh Git status"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5"></path>
            <path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5"></path>
          </svg>
        </button>
      </div>
    </div>
  );
}
