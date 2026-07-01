import { createSignal, For, onMount, Show } from 'solid-js';

export default function AddProjectModal(props: { onClose: () => void, onAdded: () => void }) {
  const [inputPath, setInputPath] = createSignal('');
  const [suggestions, setSuggestions] = createSignal<{name: string, path: string}[]>([]);
  const [isAdding, setIsAdding] = createSignal(false);
  const [errorMsg, setErrorMsg] = createSignal('');
  
  onMount(async () => {
    try {
      const res = await fetch(`/api/fs/list`);
      if (res.ok) {
        const data = await res.json();
        setInputPath(data.currentPath + '/');
        setSuggestions(data.directories || []);
      }
    } catch {}
  });

  let debounceTimer: any;
  const handleInput = (e: any) => {
    const val = e.target.value;
    setInputPath(val);
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/fs/list?path=${encodeURIComponent(val)}`);
        if (res.ok) {
          const data = await res.json();
          setSuggestions(data.directories || []);
        } else {
          setSuggestions([]);
        }
      } catch {
        setSuggestions([]);
      }
    }, 300);
  };

  const handleCreate = async () => {
    if (!inputPath()) return;
    setIsAdding(true);
    setErrorMsg('');
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: inputPath() })
      });
      if (res.ok) {
        props.onAdded();
      } else {
        const data = await res.json();
        setErrorMsg(data.error || 'Failed to add project');
      }
    } catch (err) {
      setErrorMsg('Error connecting to server');
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <div class="skills-modal-overlay">
      <div class="skills-modal" style="max-width: 500px; padding: 1.5rem;">
        <div class="skills-modal-header" style="margin-bottom: 1rem;">
          <h2 class="skills-modal-title">Add Project</h2>
          <button onClick={props.onClose} class="skills-modal-close">✕</button>
        </div>
        <div class="skills-modal-body" style="display: flex; flex-direction: column; gap: 1rem;">
          <div>
            <label style="display: block; margin-bottom: 0.5rem; font-size: 0.875rem; color: var(--text-secondary);">
              Project Directory Path
            </label>
            <input 
              type="text" 
              class="input-field" 
              value={inputPath()} 
              onInput={handleInput}
              placeholder="/Users/username/dev/project"
              style="width: 100%; box-sizing: border-box;"
            />
          </div>
          
          <div style="max-height: 250px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 8px; background: rgba(0,0,0,0.2);">
            <For each={suggestions()}>
              {(dir) => (
                <div 
                  class="session-item" 
                  style="border-radius: 0; border-bottom: 1px solid var(--border-color); display: flex; align-items: center; gap: 0.5rem; padding: 0.75rem;"
                  onClick={() => {
                    setInputPath(dir.path + '/');
                    setSuggestions([]);
                    // Trigger new suggestions based on this selection
                    setTimeout(async () => {
                      try {
                        const res = await fetch(`/api/fs/list?path=${encodeURIComponent(dir.path + '/')}`);
                        if (res.ok) {
                          const data = await res.json();
                          setSuggestions(data.directories || []);
                        }
                      } catch {}
                    }, 50);
                  }}
                >
                  <span style="font-size: 1.25rem;">📁</span>
                  <span style="font-size: 0.875rem; color: var(--text-primary);">{dir.name}</span>
                </div>
              )}
            </For>
            <Show when={suggestions().length === 0}>
              <div style="padding: 1rem; text-align: center; color: var(--text-secondary); font-size: 0.875rem;">
                No subdirectories found
              </div>
            </Show>
          </div>
          
          <Show when={errorMsg()}>
            <div style="color: #ef4444; font-size: 0.875rem; text-align: center;">{errorMsg()}</div>
          </Show>
          
          <button 
            class="new-chat-button" 
            onClick={handleCreate}
            disabled={isAdding() || !inputPath()}
            style={isAdding() ? 'opacity: 0.7; cursor: not-allowed;' : ''}
          >
            {isAdding() ? 'Adding...' : 'Add Project'}
          </button>
        </div>
      </div>
    </div>
  );
}
