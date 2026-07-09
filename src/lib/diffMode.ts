import { createSignal } from 'solid-js';

// Global diff rendering preference: side-by-side (split) or unified. Shared
// by every DiffView (Changes panel and inline edit-tool diffs) so one toggle
// switches them all; persisted across sessions.
export type DiffMode = 'split' | 'unified';

const saved = (() => {
  try { return localStorage.getItem('sylph.diffMode'); } catch { return null; }
})();

const [diffMode, setDiffModeSignal] = createSignal<DiffMode>(saved === 'unified' ? 'unified' : 'split');

export { diffMode };

export function setDiffMode(mode: DiffMode) {
  setDiffModeSignal(mode);
  try { localStorage.setItem('sylph.diffMode', mode); } catch {}
}
