export default function GitCommitBox(props: {
  message: string;
  stagedCount: number;
  busy: boolean;
  onMessage: (message: string) => void;
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
      <button disabled={props.busy || !props.message.trim() || props.stagedCount === 0} onClick={props.onCommit}>
        Commit
      </button>
    </div>
  );
}
