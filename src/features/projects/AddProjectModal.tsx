import { createEffect, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import type { ProjectInfo } from '../../types';
import { listDirectories, saveProject, type DirectorySuggestion } from './api';
import './ProjectModal.css';

interface DirectoryDraft {
  id?: string;
  name: string;
  path: string;
}

function folderName(folderPath: string) {
  const normalized = folderPath.trim().replace(/[\\/]+$/, '');
  return normalized.split(/[\\/]/).pop() || '';
}

function FolderIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function DirectoryRow(props: {
  directory: DirectoryDraft;
  index: number;
  removable: boolean;
  onChange: (field: keyof DirectoryDraft, value: string) => void;
  onRemove: () => void;
}) {
  const [alias, setAlias] = createSignal(props.directory.name);
  const [folderPath, setFolderPath] = createSignal(props.directory.path);
  const [suggestions, setSuggestions] = createSignal<DirectorySuggestion[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = createSignal(false);
  const [highlightedSuggestion, setHighlightedSuggestion] = createSignal(0);
  const [loading, setLoading] = createSignal(false);
  let suggestionsRef: HTMLDivElement | undefined;
  let timer: number | undefined;
  let controller: AbortController | undefined;

  const loadSuggestions = async (value: string) => {
    controller?.abort();
    controller = new AbortController();
    setLoading(true);
    try {
      const data = await listDirectories(value, controller.signal);
      setSuggestions(data.directories || []);
      setHighlightedSuggestion(0);
      setSuggestionsOpen(true);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setSuggestions([]);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  const scheduleSuggestions = (value: string) => {
    if (timer) window.clearTimeout(timer);
    setHighlightedSuggestion(0);
    timer = window.setTimeout(() => void loadSuggestions(value), 180);
  };

  const selectSuggestion = (suggestion: DirectorySuggestion | undefined) => {
    if (!suggestion) return;
    setFolderPath(suggestion.path);
    props.onChange('path', suggestion.path);
    // Treat selection as navigation: the chosen folder is already the current
    // value, while the open list immediately shows its children for drill-down.
    void loadSuggestions(suggestion.path);
  };

  const handleSuggestionKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!suggestionsOpen()) {
        void loadSuggestions(folderPath());
        return;
      }
      const count = suggestions().length;
      if (count) {
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        setHighlightedSuggestion((index) => (index + direction + count) % count);
      }
      return;
    }
    if (event.key === 'Enter' && suggestionsOpen() && suggestions().length) {
      event.preventDefault();
      selectSuggestion(suggestions()[highlightedSuggestion()]);
      return;
    }
    if (event.key === 'Escape' && suggestionsOpen()) {
      event.preventDefault();
      setSuggestionsOpen(false);
    }
  };

  createEffect(() => {
    highlightedSuggestion();
    if (!suggestionsOpen()) return;
    queueMicrotask(() => suggestionsRef?.querySelector('.highlighted')?.scrollIntoView({ block: 'nearest' }));
  });

  onCleanup(() => {
    if (timer) window.clearTimeout(timer);
    controller?.abort();
  });

  return (
    <div class="project-directory-card">
      <button class="project-directory-remove" onClick={props.onRemove} disabled={!props.removable} title="Remove directory" aria-label={`Remove directory ${props.index + 1}`}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/></svg>
      </button>
      <div class="project-directory-fields">
        <label class="project-field path-field">
          <span>Folder</span>
          <div class="project-path-input-wrap">
            <span class="project-path-icon"><FolderIcon /></span>
            <input
              value={folderPath()}
              onFocus={() => void loadSuggestions(folderPath())}
              onInput={(event) => {
                setFolderPath(event.currentTarget.value);
                props.onChange('path', event.currentTarget.value);
                scheduleSuggestions(event.currentTarget.value);
              }}
              onKeyDown={handleSuggestionKeyDown}
              onBlur={() => window.setTimeout(() => setSuggestionsOpen(false), 140)}
              placeholder="/Users/you/code/project"
              autocomplete="off"
              spellcheck={false}
              aria-expanded={suggestionsOpen()}
              aria-controls={`project-folder-suggestions-${props.index}`}
              aria-autocomplete="list"
            />
            <Show when={loading()}><span class="project-path-loading" aria-label="Loading folders" /></Show>
            <Show when={suggestionsOpen()}>
              <div ref={suggestionsRef} id={`project-folder-suggestions-${props.index}`} class="project-path-suggestions" role="listbox">
                <Show when={suggestions().length > 0} fallback={<div class="project-path-empty">No subdirectories found</div>}>
                  <For each={suggestions()}>
                    {(suggestion, suggestionIndex) => (
                      <button
                        type="button"
                        role="option"
                        aria-selected={highlightedSuggestion() === suggestionIndex()}
                        class={highlightedSuggestion() === suggestionIndex() ? 'highlighted' : ''}
                        onMouseMove={() => setHighlightedSuggestion(suggestionIndex())}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => selectSuggestion(suggestion)}
                      >
                        <FolderIcon />
                        <span class="project-suggestion-name">{suggestion.name}</span>
                        <span class="project-suggestion-path">{suggestion.path}</span>
                      </button>
                    )}
                  </For>
                </Show>
              </div>
            </Show>
          </div>
        </label>
        <label class="project-field compact">
          <span>Alias</span>
          <input
            value={alias()}
            onInput={(event) => { setAlias(event.currentTarget.value); props.onChange('name', event.currentTarget.value); }}
            placeholder={folderName(folderPath()) || (props.index === 0 ? 'frontend' : 'api')}
          />
        </label>
      </div>
    </div>
  );
}

export default function AddProjectModal(props: {
  project?: ProjectInfo;
  onClose: () => void;
  onSaved: () => void;
  onDelete?: () => Promise<void> | void;
}) {
  const editing = () => !!props.project;
  const initialDirectories = (): DirectoryDraft[] => props.project?.directories.map((directory) => ({
    ...directory,
    // The folder name is the implicit alias. Only surface a value when the
    // user has intentionally customized it.
    name: directory.name === folderName(directory.path) ? '' : directory.name,
  })) ?? [{ name: '', path: '' }];
  const [projectName, setProjectName] = createSignal(props.project?.name ?? '');
  const [directories, setDirectories] = createSignal<DirectoryDraft[]>(initialDirectories());
  const [saving, setSaving] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);
  const [errorMsg, setErrorMsg] = createSignal('');

  const updateDirectory = (index: number, field: keyof DirectoryDraft, value: string) => {
    setDirectories((items) => {
      // Preserve item identity so Solid's keyed <For> does not remount the row
      // on every keystroke (which would drop focus and close autocomplete).
      (items[index] as any)[field] = value;
      return [...items];
    });
  };
  const addDirectory = () => setDirectories((items) => [...items, { name: '', path: '' }]);
  const removeDirectory = (index: number) => {
    setDirectories((items) => items.filter((_, itemIndex) => itemIndex !== index));
  };

  const save = async () => {
    if (!directories().some((directory) => directory.path.trim())) return;
    setSaving(true);
    setErrorMsg('');
    try {
      await saveProject({
        id: props.project?.id,
        name: projectName().trim() || undefined,
        directories: directories().map((directory) => ({
          id: directory.id,
          name: directory.name.trim() || undefined,
          path: directory.path.trim(),
        })).filter((directory) => directory.path),
      });
      props.onSaved();
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Error connecting to server');
    } finally {
      setSaving(false);
    }
  };

  const removeProject = async () => {
    if (!props.onDelete || !confirm(`Remove ${props.project?.name || 'this project'} from Sylph?\n\nYour files and Git repositories will not be deleted.`)) return;
    setDeleting(true);
    setErrorMsg('');
    try { await props.onDelete(); }
    catch (error) { setErrorMsg(error instanceof Error ? error.message : 'Failed to remove project'); setDeleting(false); }
  };

  onMount(() => {
    document.querySelector<HTMLInputElement>('.project-modal input')?.focus();
    if (!editing()) {
      void listDirectories().then((data) => {
        if (directories()[0].path) return;
        setDirectories([{ name: '', path: `${data.currentPath}${data.currentPath.endsWith('/') ? '' : '/'}` }]);
      }).catch(() => {});
    }
  });

  return (
    <div class="skills-modal-overlay project-modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
      <div class="skills-modal project-modal" role="dialog" aria-modal="true" aria-labelledby="project-modal-title">
        <div class="project-modal-header">
          <div>
            <div class="project-modal-kicker">{editing() ? 'Project settings' : 'New workspace'}</div>
            <h2 id="project-modal-title">{editing() ? 'Edit Project' : 'Add Project'}</h2>
            <p>{editing() ? 'Update its name, roots, and aliases.' : 'Group related folders into one multi-root workspace.'}</p>
          </div>
          <button onClick={props.onClose} class="project-modal-close" aria-label="Close">✕</button>
        </div>

        <div class="project-modal-body">
          <label class="project-field project-name-field">
            <span>Project name</span>
            <input value={projectName()} onInput={(event) => setProjectName(event.currentTarget.value)} placeholder="My product" />
            <small>Shown in the sidebar and project picker.</small>
          </label>

          <div class="project-roots-section">
            <div class="project-roots-heading">
              <div>
                <h3>Workspace directories</h3>
                <p>Each directory is available to AI context, mentions, permissions, Git, and worktrees.</p>
              </div>
              <button class="project-add-root" onClick={addDirectory}>
                <span>＋</span> Add directory
              </button>
            </div>

            <div class="project-directory-list">
              <For each={directories()}>
                {(directory, index) => (
                  <DirectoryRow
                    directory={directory}
                    index={index()}
                    removable={directories().length > 1}
                    onChange={(field, value) => updateDirectory(index(), field, value)}
                    onRemove={() => removeDirectory(index())}
                  />
                )}
              </For>
            </div>

            <div class="project-alias-hint"><span>@</span> Aliases namespace mentions, for example <code>@api/src/routes.ts</code>.</div>
          </div>

          <Show when={errorMsg()}><div class="project-modal-error">{errorMsg()}</div></Show>
        </div>

        <div class="project-modal-footer">
          <Show when={editing() && props.onDelete}>
            <button class="project-delete-button" onClick={() => void removeProject()} disabled={saving() || deleting()}>{deleting() ? 'Removing…' : 'Remove project'}</button>
          </Show>
          <div class="project-modal-footer-actions">
            <button class="project-cancel-button" onClick={props.onClose} disabled={saving() || deleting()}>Cancel</button>
            <button class="project-save-button" onClick={() => void save()} disabled={saving() || deleting() || !directories().some((directory) => directory.path.trim())}>
              {saving() ? 'Saving…' : editing() ? 'Save changes' : 'Add project'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
