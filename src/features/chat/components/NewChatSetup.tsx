import { For, Show } from 'solid-js';
import type { ProjectInfo } from '../../../types';
import CustomSelect from '../../../shared/ui/CustomSelect';
import { folderName } from '../../../shared/ui/DirectoryPicker';
import type { GitBranchOption } from '../api';

function FolderIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h5l2 2h8A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/></svg>;
}

export default function NewChatSetup(props: {
  activeProjectId?: string;
  activeProject?: ProjectInfo;
  projects: ProjectInfo[];
  selectedDirectoryId: string;
  standalonePath: string;
  useWorktree: boolean;
  branches: Record<string, GitBranchOption[]>;
  selectedBranches: Record<string, string>;
  branchErrors: Record<string, string>;
  onSelectProject: (id?: string) => void;
  onSelectDirectory: (id: string) => void;
  onOpenStartingFolder: () => void;
  onUseWorktree: (enabled: boolean) => void;
  onSelectBranch: (directoryId: string, branch: string) => void;
}) {
  return <div class="top-project-row">
    <CustomSelect
      triggerClass={`project-selector ${!props.activeProjectId ? 'no-project' : ''}`}
      value={props.activeProjectId || '__none__'}
      onChange={(value) => props.onSelectProject(value === '__none__' ? undefined : value)}
      options={[{ value: '__none__', label: 'No Project', icon: 'project' }, ...props.projects.map((project) => ({ value: project.id, label: project.name, icon: 'project' }))]}
      placeholder="Select a Project" position="bottom" typeahead
    />
    <Show when={!props.activeProject || props.activeProject.directories.length === 0}>
      <button class={`starting-folder-trigger ${props.standalonePath ? 'selected' : ''}`} onClick={props.onOpenStartingFolder}
        title={props.standalonePath || 'Choose an optional starting folder'} aria-label={props.standalonePath ? `Starting folder ${folderName(props.standalonePath)}` : 'Add starting folder'}>
        <FolderIcon/><span>{props.standalonePath ? folderName(props.standalonePath) : 'Add folder'}</span>
      </button>
    </Show>
    <Show when={props.activeProject && props.activeProject.directories.length > 1}>
      <CustomSelect triggerClass="project-selector" value={props.selectedDirectoryId} onChange={props.onSelectDirectory}
        options={props.activeProject!.directories.map((directory) => ({ value: directory.id, label: directory.name, icon: 'folder' }))}
        placeholder="Select a Directory" position="bottom"/>
    </Show>
    <Show when={props.activeProject && props.activeProject.directories.length > 0 && (props.activeProject.directories.length > 1 || Object.keys(props.branchErrors).length === 0)}>
      <label class="worktree-toggle" title="Create isolated Git worktrees for every project directory">
        <input type="checkbox" checked={props.useWorktree} disabled={Object.keys(props.branchErrors).length > 0} onChange={(event) => props.onUseWorktree(event.currentTarget.checked)}/><span>Worktrees</span>
      </label>
    </Show>
    <Show when={props.useWorktree && props.activeProject}><div class="workspace-branch-selectors">
      <For each={props.activeProject!.directories}>{(directory) => <div class="workspace-branch-row"><span>{directory.name}</span>
        <CustomSelect triggerClass="branch-selector" value={props.selectedBranches[directory.id] || ''} onChange={(value) => props.onSelectBranch(directory.id, value)}
          options={(props.branches[directory.id] || []).map((branch) => ({ value: branch.name, label: branch.name, group: branch.remote ? 'Remote branches' : 'Local branches' }))}
          placeholder="Base branch" position="bottom" searchable searchPlaceholder={`Search ${directory.name} branches…`}/>
      </div>}</For>
    </div></Show>
    <Show when={props.activeProject && props.activeProject.directories.length > 1 && Object.keys(props.branchErrors).length > 0}>
      <span class="worktree-unavailable" title={Object.entries(props.branchErrors).map(([id, error]) => `${props.activeProject!.directories.find((directory) => directory.id === id)?.name}: ${error}`).join('\n')}>
        Worktrees unavailable for {Object.keys(props.branchErrors).length} root(s)
      </span>
    </Show>
  </div>;
}
