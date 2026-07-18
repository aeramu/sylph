import { createSignal, For, onMount, Show } from 'solid-js';
import type { ProjectInfo } from '../../types';
import DirectoryPicker, { folderName } from '../../shared/ui/DirectoryPicker';
import { listDirectories, saveProject } from './api';
import './ProjectModal.css';

interface DirectoryDraft {
  id?: string;
  name: string;
  path: string;
}

function DirectoryRow(props: {
  directory: DirectoryDraft;
  index: number;
  removable: boolean;
  onChange: (field: keyof DirectoryDraft, value: string) => void;
  onRemove: () => void;
}) {
  return <div class="project-directory-card">
    <button class="project-directory-remove" onClick={props.onRemove} disabled={!props.removable} title="Remove directory" aria-label={`Remove directory ${props.index + 1}`}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/></svg>
    </button>
    <DirectoryPicker path={props.directory.path} alias={props.directory.name}
      onPathChange={(value) => props.onChange('path', value)} onAliasChange={(value) => props.onChange('name', value)}
      loadDirectories={listDirectories} suggestionsId={`project-folder-suggestions-${props.index}`}
      aliasFallback={props.index === 0 ? 'frontend' : 'api'}/>
  </div>;
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
  })) ?? [];
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
    if (!projectName().trim() && directories().length === 0) return;
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
  });

  return (
    <div class="skills-modal-overlay project-modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
      <div class="skills-modal project-modal" role="dialog" aria-modal="true" aria-labelledby="project-modal-title">
        <div class="project-modal-header">
          <div>
            <div class="project-modal-kicker">{editing() ? 'Project settings' : 'New workspace'}</div>
            <h2 id="project-modal-title">{editing() ? 'Edit Project' : 'Add Project'}</h2>
            <p>{editing() ? 'Update its name, roots, and aliases.' : 'Create a workspace now and add folders whenever you need them.'}</p>
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
                <p>Optional. Chats in a project without directories start in private temporary storage.</p>
              </div>
              <button class="project-add-root" onClick={addDirectory}>
                <span>＋</span> Add directory
              </button>
            </div>

            <div class="project-directory-list">
              <Show when={directories().length > 0} fallback={<div class="project-directory-empty">No directories yet. You can add one now or later.</div>}>
              <For each={directories()}>
                {(directory, index) => (
                  <DirectoryRow
                    directory={directory}
                    index={index()}
                    removable={true}
                    onChange={(field, value) => updateDirectory(index(), field, value)}
                    onRemove={() => removeDirectory(index())}
                  />
                )}
              </For>
              </Show>
            </div>

            <Show when={directories().length > 0}><div class="project-alias-hint"><span>@</span> Aliases namespace mentions, for example <code>@api/src/routes.ts</code>.</div></Show>
          </div>

          <Show when={errorMsg()}><div class="project-modal-error">{errorMsg()}</div></Show>
        </div>

        <div class="project-modal-footer">
          <Show when={editing() && props.onDelete}>
            <button class="project-delete-button" onClick={() => void removeProject()} disabled={saving() || deleting()}>{deleting() ? 'Removing…' : 'Remove project'}</button>
          </Show>
          <div class="project-modal-footer-actions">
            <button class="project-cancel-button" onClick={props.onClose} disabled={saving() || deleting()}>Cancel</button>
            <button class="project-save-button" onClick={() => void save()} disabled={saving() || deleting() || (!projectName().trim() && directories().length === 0)}>
              {saving() ? 'Saving…' : editing() ? 'Save changes' : 'Add project'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
