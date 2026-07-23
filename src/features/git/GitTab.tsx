import { createEffect, createMemo, createSignal, on, Show } from 'solid-js';
import type { GitCommit, GitDivergence, GitFile, GitRepositoryInfo } from '../../lib/gitPatch';
import { getGitCommitDraft, setGitCommitDraft } from '../../lib/gitCommitDraft';
import { generateCommitMessage as requestCommitMessage, refreshGit, runGitOperation, type GitScope } from './api';
import GitCommitBox from './GitCommitBox';
import { GitBranchSection, GitCommitHistory } from './GitRepositorySection';
import GitSourceSection from './GitSourceSection';
import GitToolbar from './GitToolbar';
import type { ReviewCommentRequest } from '../../shared/ui/ReviewCommentPopover';
import './GitTab.css';

export default function GitTab(props: {
  projectId?: string;
  directoryId?: string;
  sessionId?: string;
  refreshTrigger?: number;
  onComment?: (request: ReviewCommentRequest) => void;
}) {
  const [files, setFiles] = createSignal<GitFile[]>([]);
  const [repository, setRepository] = createSignal<GitRepositoryInfo>();
  const [commits, setCommits] = createSignal<GitCommit[]>([]);
  const [divergence, setDivergence] = createSignal<GitDivergence>({ upstream: null, unpushed: [], unpulled: [] });
  const [loading, setLoading] = createSignal(false);
  const [loaded, setLoaded] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [generating, setGenerating] = createSignal(false);
  const [syncOperation, setSyncOperation] = createSignal<'pull' | 'push' | null>(null);
  const [error, setError] = createSignal('');
  const draftId = () => `${props.sessionId || props.projectId || 'none'}:${props.directoryId || 'root'}`;
  const [message, setMessage] = createSignal(getGitCommitDraft(draftId()));
  const gitScope = (projectId: string): GitScope => ({ projectId, sessionId: props.sessionId, directoryId: props.directoryId });
  const [expanded, setExpanded] = createSignal<Record<string, boolean>>({});
  const [collapsed, setCollapsed] = createSignal({ branch: true, history: true, staged: false, unstaged: false });
  const stagedFiles = createMemo(() => files().filter((file) => file.index !== ' ' && file.index !== '?'));
  const unstagedFiles = createMemo(() => files().filter((file) => file.workingTree !== ' '));
  let refreshGeneration = 0;
  // Invalidated whenever the selected repository changes so a response from
  // one root cannot update another root's message, error, or loading state.
  let commitMessageGeneration = 0;

  const refresh = async (projectId = props.projectId || (props.sessionId ? '__session__' : undefined), fetchRemote = false) => {
    const generation = ++refreshGeneration;
    if (!projectId) {
      setFiles([]);
      setError('');
      setLoading(false);
      setLoaded(false);
      return false;
    }
    setLoading(true);
    setError('');
    try {
      const data = await refreshGit(gitScope(projectId), fetchRemote);
      if (generation !== refreshGeneration || (props.projectId || (props.sessionId ? '__session__' : undefined)) !== projectId) return false;
      const nextFiles = data.files;
      setRepository(data.repository);
      setCommits(data.commits);
      setDivergence(data.divergence);
      setFiles((previous) => {
        const previousByPath = new Map(previous.map((file) => [file.path, file]));
        return nextFiles.map((file) => {
          const existing = previousByPath.get(file.path);
          return existing
            && existing.index === file.index
            && existing.workingTree === file.workingTree
            && existing.unstagedPatch === file.unstagedPatch
            && existing.stagedPatch === file.stagedPatch
            && existing.isUntracked === file.isUntracked
            ? existing
            : file;
        });
      });
      setLoaded(true);
      return true;
    } catch (err: any) {
      if (generation !== refreshGeneration || (props.projectId || (props.sessionId ? '__session__' : undefined)) !== projectId) return false;
      setError(err.message || 'Failed to load git status');
      setLoaded(true);
      return false;
    } finally {
      if (generation === refreshGeneration) setLoading(false);
    }
  };

  const post = async (url: string, body: unknown) => {
    const projectId = props.projectId || (props.sessionId ? '__session__' : undefined);
    if (!projectId) return false;
    const sync = url === 'pull' || url === 'push' ? url : null;
    if (sync) setSyncOperation(sync);
    setBusy(true);
    setError('');
    try {
      await runGitOperation(gitScope(projectId), url, body);
      if ((props.projectId || (props.sessionId ? '__session__' : undefined)) === projectId) await refresh(projectId);
      return true;
    } catch (err: any) {
      if ((props.projectId || (props.sessionId ? '__session__' : undefined)) === projectId) setError(err.message || 'Git operation failed');
      return false;
    } finally {
      if (sync) setSyncOperation(null);
      setBusy(false);
    }
  };

  const updateMessage = (value: string) => {
    setMessage(value);
    setGitCommitDraft(draftId(), value);
  };

  const generateCommitMessage = async () => {
    const projectId = props.projectId || (props.sessionId ? '__session__' : undefined);
    if (!projectId || stagedFiles().length === 0) return;
    const requestDraftId = draftId();
    const generation = ++commitMessageGeneration;
    const isCurrentRequest = () => generation === commitMessageGeneration && draftId() === requestDraftId;
    setGenerating(true);
    setError('');
    try {
      const generated = await requestCommitMessage(gitScope(projectId));
      if (isCurrentRequest()) updateMessage(generated);
    } catch (err) {
      if (isCurrentRequest()) setError(err instanceof Error ? err.message : 'Failed to generate commit message');
    } finally {
      if (isCurrentRequest()) setGenerating(false);
    }
  };

  const commit = async () => {
    if (await post('commit', { message: message() })) updateMessage('');
  };

  createEffect(() => {
    const projectId = props.projectId || (props.sessionId ? '__session__' : undefined);
    setExpanded({});
    void props.sessionId;
    void props.directoryId;
    // Cancel ownership of any in-flight generation before loading this root's
    // draft. The HTTP request may finish, but its response is now stale.
    commitMessageGeneration++;
    setGenerating(false);
    setMessage(getGitCommitDraft(draftId()));
    setFiles([]);
    setRepository(undefined);
    setCommits([]);
    setDivergence({ upstream: null, unpushed: [], unpulled: [] });
    setLoaded(false);
    void refresh(projectId);
  });

  createEffect(on(
    () => props.refreshTrigger,
    () => void refresh(),
    { defer: true },
  ));

  return (
    <div class="git-tab">
      <Show when={props.projectId} fallback={<div class="git-empty">Select a project to use git.</div>}>
        <GitToolbar fileCount={files().length} loading={loading()} busy={busy()} onRefresh={() => void refresh(props.projectId, true)} />
        <Show when={error()}><div class="git-error">{error()}</div></Show>
        <GitBranchSection
          repository={repository()}
          divergence={divergence()}
          collapsed={collapsed().branch}
          busy={busy()}
          syncOperation={syncOperation()}
          onToggle={() => setCollapsed((value) => ({ ...value, branch: !value.branch }))}
          onPull={() => void post('pull', {})}
          onPush={() => void post('push', {})}
        />
        <GitCommitBox
          message={message()}
          stagedCount={stagedFiles().length}
          busy={busy()}
          generating={generating()}
          onMessage={updateMessage}
          onGenerate={() => void generateCommitMessage()}
          onCommit={() => void commit()}
        />
        <Show when={loaded()} fallback={<div class="git-empty">Loading git status...</div>}>
            <div class="git-source-control">
              <GitSourceSection
                title="Staged Changes"
                files={stagedFiles()}
                staged
                busy={busy()}
                collapsed={collapsed().staged}
                onToggle={() => setCollapsed((value) => ({ ...value, staged: !value.staged }))}
                expanded={expanded()}
                onToggleFile={(key) => setExpanded((value) => ({ ...value, [key]: !value[key] }))}
                onFileAction={(file) => void post('unstage-file', { path: file.path })}
                onAllAction={() => void post('unstage-all', {})}
                onApplyPatch={(file, patch, reverse) => void post('apply', { path: file.path, patch, reverse })}
                onComment={props.onComment ? (file, changeSet, request) => props.onComment?.({
                  surface: 'git', path: file.path, changeSet, ...request.selection, anchor: request.anchor,
                }) : undefined}
              />
              <GitSourceSection
                title="Unstaged Changes"
                files={unstagedFiles()}
                staged={false}
                busy={busy()}
                collapsed={collapsed().unstaged}
                onToggle={() => setCollapsed((value) => ({ ...value, unstaged: !value.unstaged }))}
                expanded={expanded()}
                onToggleFile={(key) => setExpanded((value) => ({ ...value, [key]: !value[key] }))}
                onFileAction={(file) => void post('stage-file', { path: file.path })}
                onAllAction={() => void post('stage-all', {})}
                onApplyPatch={(file, patch, reverse) => void post('apply', { path: file.path, patch, reverse })}
                onComment={props.onComment ? (file, changeSet, request) => props.onComment?.({
                  surface: 'git', path: file.path, changeSet, ...request.selection, anchor: request.anchor,
                }) : undefined}
              />
              <GitCommitHistory
                commits={commits()}
                collapsed={collapsed().history}
                onToggle={() => setCollapsed((value) => ({ ...value, history: !value.history }))}
              />
            </div>
        </Show>
      </Show>
    </div>
  );
}
