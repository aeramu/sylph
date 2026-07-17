import { createEffect, createSignal, onCleanup, type Accessor } from 'solid-js';
import type { ProjectInfo } from '../../types';
import { listBranches, listDirectories, type GitBranchOption } from './api';

export function createNewChatSetup(options: { project: Accessor<ProjectInfo | undefined>; projectId: Accessor<string | undefined>; sessionId: Accessor<string | undefined> }) {
  const [branches, setBranches] = createSignal<Record<string, GitBranchOption[]>>({});
  const [selectedBranches, setSelectedBranches] = createSignal<Record<string, string>>({});
  const [useWorktree, setUseWorktree] = createSignal(false);
  const [directoryId, setDirectoryId] = createSignal('');
  const [standalonePath, setStandalonePath] = createSignal('');
  const [suggestions, setSuggestions] = createSignal<Array<{ name: string; path: string }>>([]);
  const [suggestionsOpen, setSuggestionsOpen] = createSignal(false);
  const [suggestionIndex, setSuggestionIndex] = createSignal(0);
  const [suggestionsLoading, setSuggestionsLoading] = createSignal(false);
  const [branchErrors, setBranchErrors] = createSignal<Record<string, string>>({});
  let suggestionTimer: number | undefined;
  let suggestionController: AbortController | undefined;
  let branchRequest = 0;

  const loadSuggestions = async (value: string, open = true) => {
    suggestionController?.abort();
    const controller = new AbortController(); suggestionController = controller; setSuggestionsLoading(true);
    try {
      const data = await listDirectories(value, controller.signal);
      if (controller.signal.aborted) return;
      setSuggestions(data.directories || []); setSuggestionIndex(0);
      if (!value.trim() && data.currentPath) setStandalonePath(data.currentPath);
      if (open) setSuggestionsOpen(true);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setSuggestions([]);
    } finally { if (!controller.signal.aborted) setSuggestionsLoading(false); }
  };
  const scheduleSuggestions = (value: string) => {
    if (suggestionTimer) clearTimeout(suggestionTimer);
    setSuggestionIndex(0); suggestionTimer = window.setTimeout(() => void loadSuggestions(value), 180);
  };
  const selectSuggestion = (suggestion?: { path: string }) => {
    if (!suggestion) return;
    setStandalonePath(suggestion.path); void loadSuggestions(suggestion.path);
  };
  const selectBranch = (rootId: string, branch: string) => setSelectedBranches((previous) => ({ ...previous, [rootId]: branch }));

  createEffect(() => {
    const project = options.project();
    if (options.sessionId() || !options.projectId() || !project) { setBranches({}); setSelectedBranches({}); setBranchErrors({}); return; }
    const request = ++branchRequest;
    void Promise.all(project.directories.map(async (directory) => {
      try { return { directory, branches: await listBranches(options.projectId()!, directory.id) }; }
      catch (error) { return { directory, branches: [] as GitBranchOption[], error: error instanceof Error ? error.message : 'Git branches unavailable' }; }
    })).then((results) => {
      if (request !== branchRequest) return;
      const nextBranches: Record<string, GitBranchOption[]> = {}, nextSelected: Record<string, string> = {}, nextErrors: Record<string, string> = {};
      for (const result of results) {
        nextBranches[result.directory.id] = result.branches;
        const previous = selectedBranches()[result.directory.id];
        nextSelected[result.directory.id] = result.branches.some((branch) => branch.name === previous) ? previous : (result.branches.find((branch) => branch.current)?.name || result.branches[0]?.name || '');
        if (result.error || !nextSelected[result.directory.id]) nextErrors[result.directory.id] = result.error || 'No Git branches found';
      }
      setBranches(nextBranches); setSelectedBranches(nextSelected); setBranchErrors(nextErrors);
      if (Object.keys(nextErrors).length) setUseWorktree(false);
    });
  });
  onCleanup(() => { if (suggestionTimer) clearTimeout(suggestionTimer); suggestionController?.abort(); });
  return { branches, selectedBranches, useWorktree, directoryId, standalonePath, suggestions, suggestionsOpen, suggestionIndex, suggestionsLoading, branchErrors,
    setUseWorktree, setDirectoryId, setStandalonePath, setSuggestionsOpen, setSuggestionIndex, loadSuggestions, scheduleSuggestions, selectSuggestion, selectBranch };
}
