import { createSignal } from 'solid-js';
import DirectoryPicker from '../../../shared/ui/DirectoryPicker';
import { createDirectory, listDirectories } from '../api';
import './AddSessionFolderModal.css';

export default function StartingFolderModal(props: {
  initialPath: string;
  onClose: () => void;
  onSelect: (path: string) => void;
  onClear: () => void;
}) {
  const [folderPath, setFolderPath] = createSignal(props.initialPath);

  return <div class="skills-modal-overlay session-folder-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
    <div class="skills-modal session-folder-modal" role="dialog" aria-modal="true" aria-labelledby="starting-folder-title">
      <div class="session-folder-header">
        <div><div class="session-folder-kicker">New chat</div><h2 id="starting-folder-title">Choose starting folder</h2>
          <p>Optional. Without a folder, this chat starts in private temporary storage.</p></div>
        <button class="session-folder-close" onClick={props.onClose} aria-label="Close">✕</button>
      </div>
      <div class="session-folder-body starting-folder-body">
        <DirectoryPicker path={folderPath()} alias="" onPathChange={setFolderPath} onAliasChange={() => {}}
          loadDirectories={listDirectories} createDirectory={createDirectory} onEscape={props.onClose} pathPlaceholder="/Users/you/code/project"
          aliasFallback="root" suggestionsId="starting-folder-suggestions" showAlias={false} autoFocus/>
      </div>
      <div class="session-folder-footer starting-folder-footer">
        <button class="session-folder-cancel" onClick={props.onClose}>Cancel</button>
        <button class="starting-folder-clear" onClick={props.onClear}>No folder</button>
        <button class="session-folder-submit" onClick={() => props.onSelect(folderPath().trim())} disabled={!folderPath().trim()}>Use folder</button>
      </div>
    </div>
  </div>;
}
