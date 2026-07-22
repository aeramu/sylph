import { createSignal, onCleanup, Show } from 'solid-js';
import CustomSelect from '../../../shared/ui/CustomSelect';
import DirectoryPicker, { folderName, type DirectorySuggestion } from '../../../shared/ui/DirectoryPicker';
import { attachFolder, createDirectory, listAttachFolderBranches, listDirectories, type GitBranchOption, type SessionBindingInfo } from '../api';
import './AddSessionFolderModal.css';

export default function AddSessionFolderModal(props: {
  sessionId: string;
  worktree: boolean;
  onClose: () => void;
  onAttached: (binding: SessionBindingInfo) => void;
}) {
  const [folderPath, setFolderPath] = createSignal('');
  const [alias, setAlias] = createSignal('');
  const [branches, setBranches] = createSignal<GitBranchOption[]>([]);
  const [baseBranch, setBaseBranch] = createSignal('');
  const [loadingBranches, setLoadingBranches] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal('');
  let branchRequest = 0;

  const loadBranches = async (value: string) => {
    if (!props.worktree || !value.trim()) return;
    const request = ++branchRequest;
    setLoadingBranches(true);
    setError('');
    try {
      const next = await listAttachFolderBranches(props.sessionId, value.trim());
      if (request !== branchRequest) return;
      setBranches(next);
      setBaseBranch(next.find((branch) => branch.current)?.name || next[0]?.name || '');
      if (!next.length) setError('No Git branches found in this folder.');
    } catch (caught) {
      if (request !== branchRequest) return;
      setBranches([]);
      setBaseBranch('');
      setError(caught instanceof Error ? caught.message : 'Git branches unavailable');
    } finally {
      if (request === branchRequest) setLoadingBranches(false);
    }
  };

  const chooseFolder = (suggestion: DirectorySuggestion) => {
    void loadBranches(suggestion.path);
  };

  const submit = async () => {
    const selectedPath = folderPath().trim();
    if (!selectedPath || (props.worktree && !baseBranch())) return;
    setSaving(true);
    setError('');
    try {
      const result = await attachFolder(props.sessionId, {
        path: selectedPath,
        name: alias().trim() || folderName(selectedPath),
        baseBranch: props.worktree ? baseBranch() : undefined,
      });
      props.onAttached(result.binding);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to add folder');
    } finally {
      setSaving(false);
    }
  };

  onCleanup(() => { branchRequest++; });

  return <div class="skills-modal-overlay session-folder-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving()) props.onClose(); }}>
    <div class="skills-modal session-folder-modal" role="dialog" aria-modal="true" aria-labelledby="session-folder-title">
      <div class="session-folder-header">
        <div><div class="session-folder-kicker">Session workspace</div><h2 id="session-folder-title">Add folder</h2>
          <p>{props.worktree ? 'Sylph will create a matching worktree on this session’s branch.' : 'The folder will be available to this conversation only.'}</p></div>
        <button class="session-folder-close" onClick={props.onClose} disabled={saving()} aria-label="Close">✕</button>
      </div>
      <div class="session-folder-body">
        <DirectoryPicker path={folderPath()} alias={alias()} onPathChange={(value) => {
          setFolderPath(value);
          if (props.worktree) { setBranches([]); setBaseBranch(''); }
        }} onAliasChange={setAlias} loadDirectories={listDirectories} createDirectory={createDirectory} onFolderSelected={chooseFolder}
          onPathBlur={(value) => { if (props.worktree && value.trim() && !branches().length && !loadingBranches()) void loadBranches(value); }}
          onEscape={props.onClose} pathPlaceholder="/Users/you/code/docs" aliasFallback="docs"
          suggestionsId="session-folder-suggestions" autoFocus/>
        <small class="session-folder-alias-hint">Used by mentions, for example <code>@{alias() || folderName(folderPath()) || 'docs'}/README.md</code>.</small>
        <Show when={props.worktree}><div class="session-folder-field"><span>Base branch</span>
          <CustomSelect value={baseBranch()} onChange={setBaseBranch} disabled={loadingBranches() || !branches().length}
            options={branches().map((branch) => ({ value: branch.name, label: branch.name, group: branch.remote ? 'Remote branches' : 'Local branches' }))}
            placeholder={loadingBranches() ? 'Loading branches…' : 'Choose the folder above'} searchable searchPlaceholder="Search branches…" position="bottom"/>
          <small>The existing session branch will be created from this base in the new repository.</small>
        </div></Show>
        <Show when={error()}><div class="session-folder-error">{error()}</div></Show>
      </div>
      <div class="session-folder-footer"><button class="session-folder-cancel" onClick={props.onClose} disabled={saving()}>Cancel</button>
        <button class="session-folder-submit" onClick={() => void submit()} disabled={saving() || !folderPath().trim() || (props.worktree && (!baseBranch() || loadingBranches()))}>
          {saving() ? 'Adding…' : props.worktree ? 'Create worktree & add' : 'Add to session'}
        </button></div>
    </div>
  </div>;
}
