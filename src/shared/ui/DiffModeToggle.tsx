import { diffMode, setDiffMode } from '../../lib/diffMode';
import './DiffModeToggle.css';

export default function DiffModeToggle(props: { class?: string; ariaLabel?: string }) {
  return (
    <div class={`diff-mode-toggle ${props.class ?? ''}`} role="group" aria-label={props.ariaLabel ?? 'Diff layout'}>
      <button
        type="button"
        class={diffMode() === 'split' ? 'active' : ''}
        onClick={() => setDiffMode('split')}
        title="Side-by-side diff"
        aria-label="Side-by-side diff"
        aria-pressed={diffMode() === 'split'}
      >
        Split
      </button>
      <button
        type="button"
        class={diffMode() === 'unified' ? 'active' : ''}
        onClick={() => setDiffMode('unified')}
        title="Unified diff"
        aria-label="Unified diff"
        aria-pressed={diffMode() === 'unified'}
      >
        Unified
      </button>
    </div>
  );
}
