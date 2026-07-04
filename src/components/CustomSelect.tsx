import { createEffect, createMemo, createSignal, onCleanup, onMount, For, Show } from 'solid-js';

export interface CustomSelectOption {
  value: string;
  label: string;
  icon?: string;
  group?: string;
  provider?: string;
  searchText?: string;
}

interface CustomSelectProps {
  options: CustomSelectOption[];
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  triggerClass?: string;
  position?: 'top' | 'bottom';
  searchable?: boolean;
  searchPlaceholder?: string;
  noOptionsText?: string;
  groupBy?: (option: CustomSelectOption) => string | undefined;
}

// Same subsequence fuzzy matcher used by slash command selection.
function fuzzyScore(query: string, target: string): number | null {
  const n = query.length;
  const m = target.length;
  if (n === 0) return 0;
  if (n > m) return null;
  const NEG = -Infinity;

  const bonusAt = (ti: number, consecutive: boolean): number => {
    let b = 1;
    if (ti === 0) b += 8;
    else {
      const p = target[ti - 1];
      if (p === '-' || p === '_' || p === '/' || p === ' ') b += 6;
    }
    if (consecutive) b += 5;
    return b;
  };

  let prev = new Array<number>(m).fill(NEG);
  for (let ti = 0; ti <= m - n; ti++) {
    if (target[ti] === query[0]) prev[ti] = bonusAt(ti, false);
  }

  for (let qi = 1; qi < n; qi++) {
    const curr = new Array<number>(m).fill(NEG);
    let maxBeforePrev = NEG;
    for (let ti = qi; ti <= m - n + qi; ti++) {
      if (ti - 2 >= 0 && prev[ti - 2] > maxBeforePrev) maxBeforePrev = prev[ti - 2];
      if (target[ti] !== query[qi]) continue;
      let best = NEG;
      if (prev[ti - 1] > NEG) best = prev[ti - 1] + bonusAt(ti, true);
      if (maxBeforePrev > NEG) best = Math.max(best, maxBeforePrev + bonusAt(ti, false));
      curr[ti] = best;
    }
    prev = curr;
  }

  let best = NEG;
  for (let ti = 0; ti < m; ti++) if (prev[ti] > best) best = prev[ti];
  if (best === NEG) return null;
  return best - target.length * 0.1;
}

export default function CustomSelect(props: CustomSelectProps) {
  const [isOpen, setIsOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  let containerRef: HTMLDivElement | undefined;
  let searchInputRef: HTMLInputElement | undefined;

  const handleClickOutside = (e: MouseEvent) => {
    if (containerRef && !containerRef.contains(e.target as Node)) {
      setIsOpen(false);
    }
  };

  onMount(() => {
    document.addEventListener('mousedown', handleClickOutside);
  });
  
  onCleanup(() => {
    document.removeEventListener('mousedown', handleClickOutside);
  });

  createEffect(() => {
    if (!isOpen()) {
      setQuery('');
      return;
    }
    if (props.searchable) queueMicrotask(() => searchInputRef?.focus());
  });

  const selectedOption = () => props.options.find(o => o.value === props.value);
  const groupFor = (opt: CustomSelectOption) => props.groupBy?.(opt) || opt.group;

  const filteredOptions = createMemo(() => {
    const q = query().trim().toLowerCase();
    if (!q) return props.options;

    const scored: { opt: CustomSelectOption; score: number; index: number }[] = [];
    props.options.forEach((opt, index) => {
      const group = groupFor(opt) || '';
      const targets = [
        opt.label,
        opt.value,
        group,
        opt.searchText || '',
        `${group} ${opt.label} ${opt.value}`,
      ];
      const scores = targets
        .map((target) => fuzzyScore(q, target.toLowerCase()))
        .filter((score): score is number => score !== null);
      if (scores.length > 0) scored.push({ opt, score: Math.max(...scores), index });
    });

    scored.sort((a, b) => b.score - a.score || a.index - b.index);
    return scored.map(s => s.opt);
  });

  const groupedOptions = createMemo(() => {
    const groups: { label?: string; options: CustomSelectOption[] }[] = [];
    const byLabel = new Map<string, { label?: string; options: CustomSelectOption[] }>();

    for (const opt of filteredOptions()) {
      const label = groupFor(opt);
      if (!label) {
        groups.push({ options: [opt] });
        continue;
      }
      let group = byLabel.get(label);
      if (!group) {
        group = { label, options: [] };
        byLabel.set(label, group);
        groups.push(group);
      }
      group.options.push(opt);
    }

    return groups;
  });

  const renderIcon = (iconType?: string) => {
    if (iconType === 'folder') {
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.8;">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
        </svg>
      );
    }
    return null;
  };

  return (
    <div class="custom-select-container" ref={containerRef}>
      <button 
        class={`custom-select-trigger ${props.triggerClass || ''}`} 
        onClick={() => setIsOpen(!isOpen())}
        type="button"
      >
        {selectedOption()?.icon && renderIcon(selectedOption()?.icon)}
        <span class="custom-select-label">
          {selectedOption() ? selectedOption()?.label : (props.placeholder || 'Select...')}
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class={`custom-select-chevron ${isOpen() ? 'open' : ''}`}>
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>

      <Show when={isOpen()}>
        <div class={`custom-select-dropdown ${props.position === 'top' ? 'position-top' : 'position-bottom'} ${props.searchable ? 'is-searchable' : ''}`}>
          <Show when={props.searchable}>
            <div class="custom-select-search-wrap">
              <input
                ref={searchInputRef}
                class="custom-select-search"
                value={query()}
                placeholder={props.searchPlaceholder || 'Search...'}
                onInput={(e) => setQuery(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setIsOpen(false);
                  }
                }}
              />
            </div>
          </Show>
          <div class="custom-select-options">
            <Show when={filteredOptions().length > 0} fallback={
              <div class="custom-select-empty">{props.noOptionsText || 'No options found'}</div>
            }>
              <For each={groupedOptions()}>
                {(group) => (
                  <>
                    <Show when={group.label}>
                      <div class="custom-select-group-label">{group.label}</div>
                    </Show>
                    <For each={group.options}>
                      {(opt) => (
                        <div 
                          class={`custom-select-option ${props.value === opt.value ? 'selected' : ''}`}
                          onClick={() => {
                            props.onChange(opt.value);
                            setIsOpen(false);
                          }}
                        >
                          {opt.icon && renderIcon(opt.icon)}
                          {opt.label}
                        </div>
                      )}
                    </For>
                  </>
                )}
              </For>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}
