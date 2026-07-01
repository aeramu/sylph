import { createSignal, onCleanup, onMount, For, Show } from 'solid-js';

interface CustomSelectProps {
  options: { value: string; label: string; icon?: string }[];
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  triggerClass?: string;
  position?: 'top' | 'bottom';
}

export default function CustomSelect(props: CustomSelectProps) {
  const [isOpen, setIsOpen] = createSignal(false);
  let containerRef: HTMLDivElement | undefined;

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

  const selectedOption = () => props.options.find(o => o.value === props.value);

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
        <div class={`custom-select-dropdown ${props.position === 'top' ? 'position-top' : 'position-bottom'}`}>
          <For each={props.options}>
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
        </div>
      </Show>
    </div>
  );
}
