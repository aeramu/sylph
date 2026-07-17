import './DiffStats.css';

// "X files changed +a -d" — shared by the composer session bar, the per-turn
// chips in the message stream, and the Changes tab summary.
export default function DiffStats(props: { files: number; added: number; deleted: number }) {
  return (
    <span class="diff-stats">
      <span class="diff-stats-files">
        {props.files} {props.files === 1 ? 'file' : 'files'} changed
      </span>
      <span class="diff-stats-added">+{props.added}</span>
      <span class="diff-stats-deleted">-{props.deleted}</span>
    </span>
  );
}
