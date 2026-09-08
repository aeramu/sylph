import { createEffect, createSignal, For, Match, Switch, onCleanup, onMount } from 'solid-js';
import { Portal } from 'solid-js/web';
import type { PermissionMode } from '../../../types';

interface PermissionModeOption {
  value: PermissionMode;
  label: string;
  description: string;
  tone?: 'warning';
}

const OPTIONS: PermissionModeOption[] = [
  { value: 'read-only', label: 'Read only', description: 'Inspect files; block changes and side effects' },
  { value: 'safe', label: 'Ask for approval', description: 'Allow safe workspace actions; ask before risky or external actions' },
  { value: 'ai', label: 'Auto approve', description: 'Let the model selected in Settings review safety' },
  { value: 'relaxed', label: 'Relaxed', description: 'Allow everything except catastrophic commands', tone: 'warning' },
];

function PermissionIcon(props: { mode: PermissionMode }) {
  return (
    <Switch>
      <Match when={props.mode === 'read-only'}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
      </Match>
      <Match when={props.mode === 'safe'}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8.2 11.2V6.6a1.35 1.35 0 0 1 2.7 0v3.2-5.1a1.35 1.35 0 0 1 2.7 0v5.1-4.1a1.35 1.35 0 0 1 2.7 0v4.6-2.6a1.35 1.35 0 0 1 2.7 0v4.8c0 5-2.7 8-7.2 8-3 0-5-1.7-6.6-4.2l-1.5-2.4a1.55 1.55 0 0 1 .5-2.2 1.6 1.6 0 0 1 2.1.4l1.9 2.3" />
      </svg>
      </Match>
      <Match when={props.mode === 'ai'}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2.8 20 6v5.4c0 5.1-3.1 8.2-8 9.8-4.9-1.6-8-4.7-8-9.8V6l8-3.2Z" />
        <path d="m8.7 12.1 2.1 2.1 4.7-4.8" />
      </svg>
      </Match>
      <Match when={props.mode === 'relaxed'}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.8 20 6v5.4c0 5.1-3.1 8.2-8 9.8-4.9-1.6-8-4.7-8-9.8V6l8-3.2Z" />
      <path d="M12 8v5.2" />
      <path d="M12 16.6h.01" />
    </svg>
      </Match>
    </Switch>
  );
}

export default function PermissionModeSelector(props: {
  value: PermissionMode;
  onChange: (mode: PermissionMode) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = createSignal(false);
  const [highlighted, setHighlighted] = createSignal(0);
  const [menuPosition, setMenuPosition] = createSignal<{ left: number; top: number }>();
  let containerRef: HTMLDivElement | undefined;
  let triggerRef: HTMLButtonElement | undefined;
  let menuRef: HTMLDivElement | undefined;

  const selected = () => OPTIONS.find((option) => option.value === props.value) ?? OPTIONS[1];

  const positionMenu = () => {
    if (!triggerRef || !menuRef) return;
    const trigger = triggerRef.getBoundingClientRect();
    const menu = menuRef.getBoundingClientRect();
    const margin = 16;
    const gap = 9;
    const fitsAbove = trigger.top >= menu.height + gap + margin;
    const fitsBelow = window.innerHeight - trigger.bottom >= menu.height + gap + margin;
    const top = fitsAbove || !fitsBelow
      ? Math.max(margin, trigger.top - menu.height - gap)
      : Math.min(window.innerHeight - menu.height - margin, trigger.bottom + gap);
    const left = Math.max(margin, Math.min(trigger.left, window.innerWidth - menu.width - margin));
    setMenuPosition({ left, top });
  };

  const openMenu = () => {
    if (props.disabled) return;
    setMenuPosition(undefined);
    setHighlighted(Math.max(0, OPTIONS.findIndex((option) => option.value === props.value)));
    setOpen(true);
    requestAnimationFrame(positionMenu);
  };

  const closeMenu = (returnFocus = false) => {
    setOpen(false);
    setMenuPosition(undefined);
    if (returnFocus) queueMicrotask(() => triggerRef?.focus());
  };

  const choose = (mode: PermissionMode) => {
    props.onChange(mode);
    closeMenu();
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!open()) {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openMenu();
      }
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((index) => (index + 1) % OPTIONS.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((index) => (index - 1 + OPTIONS.length) % OPTIONS.length);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setHighlighted(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setHighlighted(OPTIONS.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(OPTIONS[highlighted()].value);
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault();
      closeMenu(event.key === 'Escape');
    }
  };

  onMount(() => {
    const handleOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (containerRef && !containerRef.contains(target) && !menuRef?.contains(target)) closeMenu();
    };
    const handleViewportChange = () => { if (open()) positionMenu(); };
    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    onCleanup(() => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    });
  });

  createEffect(() => {
    if (!open()) return;
    highlighted();
    queueMicrotask(() => {
      menuRef?.querySelector<HTMLElement>('.permission-mode-option.highlighted')?.focus();
    });
  });

  return (
    <div class="permission-mode-selector" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        class={`permission-mode-trigger mode-${props.value}`}
        aria-label="Permission mode"
        aria-haspopup="menu"
        aria-expanded={open()}
        title={`Permission mode: ${selected().label}`}
        disabled={props.disabled}
        onClick={() => open() ? closeMenu() : openMenu()}
        onKeyDown={handleKeyDown}
      >
        <span class="permission-mode-trigger-icon"><PermissionIcon mode={props.value} /></span>
        <span>{selected().label}</span>
        <svg class={`permission-mode-chevron ${open() ? 'open' : ''}`} viewBox="0 0 16 16" aria-hidden="true">
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>

      {open() && (
        <Portal mount={document.body}>
          <div
            ref={menuRef}
            class="permission-mode-menu"
            role="menu"
            aria-label="Permission behavior"
            style={{
              left: `${menuPosition()?.left ?? 0}px`,
              top: `${menuPosition()?.top ?? 0}px`,
              visibility: menuPosition() ? 'visible' : 'hidden',
            }}
            onKeyDown={handleKeyDown}
          >
            <For each={OPTIONS}>{(option, index) => (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={props.value === option.value}
                class={`permission-mode-option ${option.tone === 'warning' ? 'warning' : ''} ${highlighted() === index() ? 'highlighted' : ''}`}
                tabIndex={highlighted() === index() ? 0 : -1}
                onMouseEnter={() => setHighlighted(index())}
                onClick={() => choose(option.value)}
              >
                <span class="permission-mode-option-icon"><PermissionIcon mode={option.value} /></span>
                <span class="permission-mode-option-copy">
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
                {props.value === option.value && (
                  <svg class="permission-mode-check" viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8.2 3.1 3.1L13 4.8" /></svg>
                )}
              </button>
            )}</For>
          </div>
        </Portal>
      )}
    </div>
  );
}
