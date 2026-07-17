import { For, Show } from 'solid-js';
import type { ProjectInfo } from '../../../types';
import CustomSelect from '../../../shared/ui/CustomSelect';
import type { GitBranchOption } from '../api';

export default function NewChatSetup(props: {
  activeProjectId?: string;
  activeProject?: ProjectInfo;
  projects: ProjectInfo[];
  selectedDirectoryId: string;
  standalonePath: string;
  suggestions: Array<{ name: string; path: string }>;
  suggestionsOpen: boolean;
  suggestionIndex: number;
  suggestionsLoading: boolean;
  useWorktree: boolean;
  branches: Record<string, GitBranchOption[]>;
  selectedBranches: Record<string, string>;
  branchErrors: Record<string, string>;
  onSelectProject: (id?: string) => void;
  onSelectDirectory: (id: string) => void;
  onStandaloneInput: (value: string) => void;
  onStandaloneFocus: () => void;
  onStandaloneKeyDown: (event: KeyboardEvent) => void;
  onStandaloneBlur: () => void;
  onSelectSuggestion: (suggestion: { path: string }) => void;
  onSuggestionIndex: (index: number) => void;
  onSuggestionsRef: (element: HTMLDivElement) => void;
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
    <Show when={!props.activeProject}>
      <div class="standalone-directory-picker">
        <svg class="standalone-directory-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h5l2 2h8A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/></svg>
        <input class="standalone-directory-input" value={props.standalonePath} onFocus={props.onStandaloneFocus}
          onInput={(event) => props.onStandaloneInput(event.currentTarget.value)} onKeyDown={props.onStandaloneKeyDown}
          onBlur={props.onStandaloneBlur} placeholder="Starting directory" aria-label="Starting directory"
          aria-expanded={props.suggestionsOpen} aria-controls="standalone-directory-suggestions" aria-autocomplete="list" autocomplete="off" spellcheck={false}/>
        <Show when={props.suggestionsLoading}><span class="standalone-directory-loading" aria-label="Loading folders"/></Show>
        <Show when={props.suggestionsOpen}><div ref={props.onSuggestionsRef} id="standalone-directory-suggestions" class="standalone-directory-suggestions" role="listbox">
          <Show when={props.suggestions.length > 0} fallback={<div class="standalone-directory-empty">No subdirectories found</div>}>
            <For each={props.suggestions}>{(directory, index) => <button type="button" role="option" aria-selected={props.suggestionIndex === index()}
              class={props.suggestionIndex === index() ? 'highlighted' : ''} onMouseEnter={() => props.onSuggestionIndex(index())}
              onMouseDown={(event) => event.preventDefault()} onClick={() => props.onSelectSuggestion(directory)}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h5l2 2h8A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/></svg>
              <span>{directory.name}</span><small>{directory.path}</small>
            </button>}</For>
          </Show>
        </div></Show>
      </div>
    </Show>
    <Show when={props.activeProject && props.activeProject.directories.length > 1}>
      <CustomSelect triggerClass="project-selector" value={props.selectedDirectoryId} onChange={props.onSelectDirectory}
        options={props.activeProject!.directories.map((directory) => ({ value: directory.id, label: directory.name, icon: 'folder' }))}
        placeholder="Select a Directory" position="bottom"/>
    </Show>
    <Show when={props.activeProject && (props.activeProject.directories.length > 1 || Object.keys(props.branchErrors).length === 0)}>
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
