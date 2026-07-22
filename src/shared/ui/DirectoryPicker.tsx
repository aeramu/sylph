import { createEffect, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import './DirectoryPicker.css';

export interface DirectorySuggestion {
  name: string;
  path: string;
}

export interface DirectoryListResult {
  directories?: DirectorySuggestion[];
  currentPath?: string;
  createCandidate?: DirectorySuggestion & { parentPath: string };
}

export function folderName(folderPath: string) {
  const normalized = folderPath.trim().replace(/[\\/]+$/, '');
  return normalized.split(/[\\/]/).pop() || '';
}

function FolderIcon(props: { size?: number }) {
  const size = props.size ?? 16;
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
  </svg>;
}

export default function DirectoryPicker(props: {
  path: string;
  alias: string;
  onPathChange: (value: string) => void;
  onAliasChange: (value: string) => void;
  loadDirectories: (value: string, signal?: AbortSignal) => Promise<DirectoryListResult>;
  createDirectory?: (parentPath: string, name: string) => Promise<DirectorySuggestion>;
  onFolderSelected?: (suggestion: DirectorySuggestion) => void;
  onPathBlur?: (value: string) => void;
  onEscape?: () => void;
  pathPlaceholder?: string;
  aliasFallback?: string;
  suggestionsId: string;
  showAlias?: boolean;
  autoFocus?: boolean;
}) {
  // Keep immediate field state local. Add Project deliberately preserves each
  // row object's identity while updating its backing array, so relying only on
  // parent property tracking would leave selection-driven path changes stale.
  const [pathValue, setPathValue] = createSignal(props.path);
  const [aliasValue, setAliasValue] = createSignal(props.alias);
  const [suggestions, setSuggestions] = createSignal<DirectorySuggestion[]>([]);
  const [createCandidate, setCreateCandidate] = createSignal<(DirectorySuggestion & { parentPath: string })>();
  const [open, setOpen] = createSignal(false);
  const [highlighted, setHighlighted] = createSignal(0);
  const [loading, setLoading] = createSignal(false);
  const [createError, setCreateError] = createSignal('');
  let suggestionsRef: HTMLDivElement | undefined;
  let pathInput: HTMLInputElement | undefined;
  let timer: number | undefined;
  let controller: AbortController | undefined;

  const loadSuggestions = async (value: string) => {
    controller?.abort();
    controller = new AbortController();
    setLoading(true);
    try {
      const result = await props.loadDirectories(value, controller.signal);
      if (controller.signal.aborted) return;
      setSuggestions(result.directories || []);
      setCreateCandidate(result.createCandidate);
      setCreateError('');
      setHighlighted(0);
      setOpen(true);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setSuggestions([]);
        setCreateCandidate();
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  const scheduleSuggestions = (value: string) => {
    if (timer) window.clearTimeout(timer);
    setHighlighted(0);
    timer = window.setTimeout(() => void loadSuggestions(value), 180);
  };

  const selectSuggestion = (suggestion?: DirectorySuggestion) => {
    if (!suggestion) return;
    setPathValue(suggestion.path);
    props.onPathChange(suggestion.path);
    props.onFolderSelected?.(suggestion);
    // Selection doubles as navigation: the selected path remains the current
    // value while its child folders replace the suggestion list.
    void loadSuggestions(suggestion.path);
  };

  const createFolder = async () => {
    const candidate = createCandidate();
    if (!props.createDirectory || !candidate) return;
    setLoading(true);
    setCreateError('');
    try {
      const directory = await props.createDirectory(candidate.parentPath, candidate.name);
      selectSuggestion(directory);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Failed to create folder');
      setLoading(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open()) { void loadSuggestions(pathValue()); return; }
      const count = suggestions().length + (createCandidate() ? 1 : 0);
      if (count) setHighlighted((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + count) % count);
      return;
    }
    if (event.key === 'Enter' && open()) {
      const index = highlighted();
      if (index < suggestions().length) {
        event.preventDefault();
        selectSuggestion(suggestions()[index]);
      } else if (createCandidate()) {
        event.preventDefault();
        void createFolder();
      }
      return;
    }
    if (event.key === 'Escape') {
      if (open()) { event.preventDefault(); setOpen(false); }
      else props.onEscape?.();
    }
  };

  createEffect(() => {
    highlighted();
    if (!open()) return;
    queueMicrotask(() => suggestionsRef?.querySelector('.highlighted')?.scrollIntoView({ block: 'nearest' }));
  });
  onMount(() => { if (props.autoFocus) pathInput?.focus(); });
  onCleanup(() => { if (timer) window.clearTimeout(timer); controller?.abort(); });

  return <div class={`directory-picker-fields ${props.showAlias === false ? 'path-only' : ''}`}>
    <label class="directory-picker-field directory-picker-path-field"><span>Folder</span>
      <div class="directory-picker-path-wrap">
        <span class="directory-picker-path-icon"><FolderIcon/></span>
        <input ref={pathInput} value={pathValue()} onFocus={() => void loadSuggestions(pathValue())}
          onInput={(event) => { const value = event.currentTarget.value; setPathValue(value); props.onPathChange(value); scheduleSuggestions(value); }}
          onKeyDown={handleKeyDown} onBlur={() => { props.onPathBlur?.(pathValue()); window.setTimeout(() => setOpen(false), 140); }}
          placeholder={props.pathPlaceholder || '/Users/you/code/project'} autocomplete="off" spellcheck={false}
          aria-expanded={open()} aria-controls={props.suggestionsId} aria-autocomplete="list"/>
        <Show when={loading()}><span class="directory-picker-loading" aria-label="Loading folders"/></Show>
        <Show when={open()}><div ref={suggestionsRef} id={props.suggestionsId} class="directory-picker-suggestions" role="listbox">
          <For each={suggestions()}>{(suggestion, index) => <button type="button" role="option" aria-selected={highlighted() === index()}
            class={highlighted() === index() ? 'highlighted' : ''} onMouseMove={() => setHighlighted(index())}
            onMouseDown={(event) => event.preventDefault()} onClick={() => selectSuggestion(suggestion)}>
            <FolderIcon size={15}/><span class="directory-picker-suggestion-name">{suggestion.name}</span><span class="directory-picker-suggestion-path">{suggestion.path}</span>
          </button>}</For>
          <Show when={props.createDirectory && createCandidate()}>{(candidate) => <button type="button" role="option"
            aria-selected={highlighted() === suggestions().length} class={`directory-picker-create-option ${highlighted() === suggestions().length ? 'highlighted' : ''}`}
            onMouseMove={() => setHighlighted(suggestions().length)} onMouseDown={(event) => event.preventDefault()}
            onClick={() => void createFolder()} disabled={loading()}>
            <span class="directory-picker-create-icon" aria-hidden="true">＋</span><span class="directory-picker-suggestion-name">Create “{candidate().name}”</span><span class="directory-picker-suggestion-path">{candidate().path}</span>
          </button>}</Show>
          <Show when={!suggestions().length && !createCandidate()}><div class="directory-picker-empty">No subdirectories found</div></Show>
          <Show when={createError()}><div class="directory-picker-create-error" role="alert">{createError()}</div></Show>
        </div></Show>
      </div>
    </label>
    <Show when={props.showAlias !== false}><label class="directory-picker-field directory-picker-alias-field"><span>Alias</span>
      <input value={aliasValue()} onInput={(event) => { const value = event.currentTarget.value; setAliasValue(value); props.onAliasChange(value); }} placeholder={folderName(pathValue()) || props.aliasFallback || 'root'}/>
    </label></Show>
  </div>;
}
