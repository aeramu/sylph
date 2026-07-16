import { createSignal, For, Show } from 'solid-js';

interface DirectoryDraft {
  name: string;
  path: string;
}

export default function AddProjectModal(props: { onClose: () => void, onAdded: () => void }) {
  const [projectName, setProjectName] = createSignal('');
  const [directories, setDirectories] = createSignal<DirectoryDraft[]>([{ name: '', path: '' }]);
  const [primaryIndex, setPrimaryIndex] = createSignal(0);
  const [isAdding, setIsAdding] = createSignal(false);
  const [errorMsg, setErrorMsg] = createSignal('');

  const updateDirectory = (index: number, field: keyof DirectoryDraft, value: string) => {
    setDirectories((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item));
  };

  const addDirectory = () => setDirectories((items) => [...items, { name: '', path: '' }]);
  const removeDirectory = (index: number) => {
    setDirectories((items) => items.filter((_, itemIndex) => itemIndex !== index));
    setPrimaryIndex((current) => current === index ? 0 : current > index ? current - 1 : current);
  };

  const handleCreate = async () => {
    const roots = directories().filter((directory) => directory.path.trim());
    if (roots.length === 0) return;
    setIsAdding(true);
    setErrorMsg('');
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: projectName().trim() || undefined,
          directories: directories()
            .map((directory, index) => ({ ...directory, path: directory.path.trim(), name: directory.name.trim() || undefined, primary: index === primaryIndex() }))
            .filter((directory) => directory.path),
        }),
      });
      if (res.ok) props.onAdded();
      else {
        const data = await res.json();
        setErrorMsg(data.error || 'Failed to add project');
      }
    } catch {
      setErrorMsg('Error connecting to server');
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <div class="skills-modal-overlay">
      <div class="skills-modal" style="max-width: 620px; padding: 1.5rem;">
        <div class="skills-modal-header" style="margin-bottom: 1rem;">
          <h2 class="skills-modal-title">Add Project</h2>
          <button onClick={props.onClose} class="skills-modal-close">✕</button>
        </div>
        <div class="skills-modal-body" style="display: flex; flex-direction: column; gap: 1rem;">
          <div>
            <label style="display: block; margin-bottom: 0.5rem; font-size: 0.875rem; color: var(--text-secondary);">Project Name</label>
            <input class="input-field" value={projectName()} onInput={(event) => setProjectName(event.currentTarget.value)} placeholder="My product" style="width: 100%; box-sizing: border-box;" />
          </div>

          <div style="display: flex; flex-direction: column; gap: 0.65rem;">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <label style="font-size: 0.875rem; color: var(--text-secondary);">Project Directories</label>
              <button class="icon-button" onClick={addDirectory} title="Add another directory" aria-label="Add another directory">＋</button>
            </div>
            <For each={directories()}>
              {(directory, index) => (
                <div style="display: grid; grid-template-columns: auto minmax(90px, 0.35fr) minmax(180px, 1fr) auto; gap: 0.5rem; align-items: center;">
                  <input type="radio" name="primary-directory" checked={primaryIndex() === index()} onChange={() => setPrimaryIndex(index())} title="Use as the default chat directory" />
                  <input class="input-field" value={directory.name} onInput={(event) => updateDirectory(index(), 'name', event.currentTarget.value)} placeholder="Alias (api)" />
                  <input class="input-field" value={directory.path} onInput={(event) => updateDirectory(index(), 'path', event.currentTarget.value)} placeholder="/Users/me/code/api" />
                  <button class="icon-button" onClick={() => removeDirectory(index())} disabled={directories().length === 1} title="Remove directory">✕</button>
                </div>
              )}
            </For>
            <div style="font-size: 0.75rem; color: var(--text-secondary);">
              Select the default directory with the radio button. Aliases are used in mentions, for example <code>@api/src/routes.ts</code>.
            </div>
          </div>

          <Show when={errorMsg()}>
            <div style="color: #ef4444; font-size: 0.875rem; text-align: center;">{errorMsg()}</div>
          </Show>

          <button class="new-chat-button" onClick={handleCreate} disabled={isAdding() || !directories().some((directory) => directory.path.trim())} style={isAdding() ? 'opacity: 0.7; cursor: not-allowed;' : ''}>
            {isAdding() ? 'Adding...' : 'Add Project'}
          </button>
        </div>
      </div>
    </div>
  );
}
