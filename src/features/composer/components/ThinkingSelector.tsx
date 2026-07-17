import { For, Show } from 'solid-js';
import type { ThinkingLevel } from '../../../types';

export default function ThinkingSelector(props: {
  levels: Array<{ value: ThinkingLevel; label: string }>;
  selectedIndex: number;
  selectedLabel: string;
  open: boolean;
  draggedIndex: number | null;
  containerRef: (element: HTMLDivElement) => void;
  inputRef: (element: HTMLInputElement) => void;
  onToggle: () => void;
  onUpdate: (index: number) => void;
  onCommit: (index: number) => void;
  onClose: () => void;
  onReturnFocus: () => void;
}) {
  const displayed = () => props.draggedIndex ?? props.selectedIndex;
  const position = (index = displayed()) => `${(index / Math.max(props.levels.length - 1, 1)) * 100}%`;
  return <div class="thinking-slider" ref={props.containerRef}>
    <button class="thinking-selector thinking-slider-trigger" type="button" aria-haspopup="dialog" aria-expanded={props.open}
      title={`Thinking: ${props.selectedLabel}`} disabled={props.levels.length === 0} onClick={props.onToggle}>
      <span class="thinking-slider-trigger-value">{props.selectedLabel}</span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class={`custom-select-chevron ${props.open ? 'open' : ''}`}><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <Show when={props.open}><div class="thinking-slider-popover" role="dialog" aria-label="Thinking level">
      <div class="thinking-slider-popover-header"><span>Thinking level</span><strong>{props.selectedLabel}</strong></div>
      <div class="thinking-slider-scale" aria-hidden="true"><span>Faster</span><span>Smarter</span></div>
      <div class="thinking-slider-control"><div class="thinking-slider-track" aria-hidden="true"><div class="thinking-slider-points">
        <span class="thinking-slider-fill" style={`width: calc(${position()} + 11px)`}/>
        <For each={props.levels}>{(_, index) => <span class="thinking-slider-dot" style={`left: ${position(index())}`}/>}</For>
        <span class="thinking-slider-thumb" style={`left: ${position()}`}/>
      </div></div>
      <input ref={props.inputRef} class="thinking-slider-input" type="range" min="0" max={Math.max(props.levels.length - 1, 0)} step="any" value={displayed()}
        aria-label="Thinking level" aria-valuetext={props.selectedLabel} disabled={props.levels.length < 2}
        onInput={(event) => props.onUpdate(Number(event.currentTarget.value))} onChange={(event) => props.onCommit(Number(event.currentTarget.value))}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') { event.preventDefault(); props.onCommit(Math.round(displayed()) - 1); }
          else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') { event.preventDefault(); props.onCommit(Math.round(displayed()) + 1); }
          else if (event.key === 'Home') { event.preventDefault(); props.onCommit(0); }
          else if (event.key === 'End') { event.preventDefault(); props.onCommit(Math.max(props.levels.length - 1, 0)); }
          else if (event.key === 'Enter') { event.preventDefault(); props.onCommit(Number(event.currentTarget.value)); props.onClose(); props.onReturnFocus(); }
        }}/></div>
    </div></Show>
  </div>;
}
