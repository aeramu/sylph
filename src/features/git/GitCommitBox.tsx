export default function GitCommitBox(props: {
  message: string;
  stagedCount: number;
  busy: boolean;
  generating: boolean;
  onMessage: (message: string) => void;
  onGenerate: () => void;
  onCommit: () => void;
}) {
  return (
    <div class="git-commit-box">
      <textarea
        value={props.message}
        onInput={(event) => props.onMessage(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) return;
          event.preventDefault();
          if (!props.busy && props.message.trim() && props.stagedCount > 0) props.onCommit();
        }}
        placeholder="Commit message"
        aria-keyshortcuts="Meta+Enter Control+Enter"
        title="Commit message (⌘ Enter or Ctrl Enter to commit)"
        rows="3"
      />
      <div class="git-commit-actions">
        <button
          class="git-generate-button"
          disabled={props.busy || props.generating || props.stagedCount === 0}
          title="Generate a commit message from staged changes"
          onClick={props.onGenerate}
        >
          <span class={props.generating ? 'git-generate-spinner' : ''} aria-hidden="true">✦</span>
          {props.generating ? 'Generating…' : 'Generate message'}
        </button>
        <button class="git-commit-button" disabled={props.busy || props.generating || !props.message.trim() || props.stagedCount === 0} onClick={props.onCommit}>
          Commit
        </button>
      </div>
    </div>
  );
}
