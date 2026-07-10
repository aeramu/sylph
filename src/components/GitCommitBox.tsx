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
        placeholder="Commit message"
        rows="3"
      />
      <button disabled={props.busy || !props.message.trim() || props.stagedCount === 0} onClick={props.onCommit}>
        Commit {props.stagedCount > 0 ? `${props.stagedCount} staged` : 'staged'}
      </button>
    </div>
  );
}
