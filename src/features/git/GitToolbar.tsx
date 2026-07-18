import DiffModeToggle from '../../shared/ui/DiffModeToggle';

export default function GitToolbar(props: { fileCount: number; loading: boolean; busy: boolean; onRefresh: () => void }) {
  return (
    <div class="git-toolbar">
      <div>
        <div class="git-title">Git</div>
        <div class="git-subtitle">{props.fileCount} changed file{props.fileCount === 1 ? '' : 's'}</div>
      </div>
      <div class="git-toolbar-actions">
        <DiffModeToggle class="git-diff-mode" ariaLabel="Git diff layout" />
        <button
          class={`git-toolbar-icon git-refresh-button ${props.loading ? 'loading' : ''}`}
          disabled={props.loading || props.busy}
          onClick={props.onRefresh}
          title="Fetch remote and refresh Git status and commits"
          aria-label="Fetch remote and refresh Git status and commits"
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
