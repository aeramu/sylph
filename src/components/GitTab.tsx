import { createEffect, createMemo, createSignal, on, Show } from 'solid-js';
import type { GitCommit, GitDivergence, GitFile, GitRepositoryInfo } from '../lib/gitPatch';
import { getGitCommitDraft, setGitCommitDraft } from '../lib/gitCommitDraft';
import GitCommitBox from './GitCommitBox';
import { GitBranchSection, GitCommitHistory } from './GitRepositorySection';
import GitSourceSection from './GitSourceSection';
import GitToolbar from './GitToolbar';
import './GitTab.css';

export default function GitTab(props: { projectId?: string; refreshTrigger?: number }) {
  const [files, setFiles] = createSignal<GitFile[]>([]);
  const [repository, setRepository] = createSignal<GitRepositoryInfo>();
  const [commits, setCommits] = createSignal<GitCommit[]>([]);
  const [divergence, setDivergence] = createSignal<GitDivergence>({ upstream: null, unpushed: [], unpulled: [] });
  const [loading, setLoading] = createSignal(false);
  const [loaded, setLoaded] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [syncOperation, setSyncOperation] = createSignal<'pull' | 'push' | null>(null);
  const [error, setError] = createSignal('');
  const [message, setMessage] = createSignal(getGitCommitDraft(props.projectId));
  const [expanded, setExpanded] = createSignal<Record<string, boolean>>({});
  const [collapsed, setCollapsed] = createSignal({ branch: true, history: true, staged: false, unstaged: false });
  const stagedFiles = createMemo(() => files().filter((file) => file.index !== ' ' && file.index !== '?'));
  const unstagedFiles = createMemo(() => files().filter((file) => file.workingTree !== ' '));
  let refreshGeneration = 0;

  const refresh = async (projectId = props.projectId) => {
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
      const [statusRes, logRes, divergenceRes] = await Promise.all([
        fetch(`/api/projects/${encodeURIComponent(projectId)}/git/status`),
        fetch(`/api/projects/${encodeURIComponent(projectId)}/git/log?limit=30`),
        fetch(`/api/projects/${encodeURIComponent(projectId)}/git/divergence?limit=30`),
      ]);
      const [data, logData, divergenceData] = await Promise.all([statusRes.json(), logRes.json(), divergenceRes.json()]);
      if (!statusRes.ok) throw new Error(data.error || 'Failed to load git status');
      if (!logRes.ok) throw new Error(logData.error || 'Failed to load commit history');
      if (!divergenceRes.ok) throw new Error(divergenceData.error || 'Failed to load branch divergence');
      if (generation !== refreshGeneration || props.projectId !== projectId) return false;
      const nextFiles: GitFile[] = data.files || [];
      setRepository(data.repository);
      setCommits(logData.commits || []);
      setDivergence(divergenceData);
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
      if (generation !== refreshGeneration || props.projectId !== projectId) return false;
      setError(err.message || 'Failed to load git status');
      setLoaded(true);
      return false;
    } finally {
      if (generation === refreshGeneration) setLoading(false);
    }
  };

  const post = async (url: string, body: unknown) => {
    const projectId = props.projectId;
    if (!projectId) return false;
    const sync = url === 'pull' || url === 'push' ? url : null;
    if (sync) setSyncOperation(sync);
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/git/${url}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Git operation failed');
      if (props.projectId === projectId) await refresh(projectId);
      return true;
    } catch (err: any) {
      if (props.projectId === projectId) setError(err.message || 'Git operation failed');
      return false;
    } finally {
      if (sync) setSyncOperation(null);
      setBusy(false);
    }
  };

  const updateMessage = (value: string) => {
    setMessage(value);
    setGitCommitDraft(props.projectId, value);
  };

  const commit = async () => {
    if (await post('commit', { message: message() })) updateMessage('');
  };

  createEffect(() => {
    const projectId = props.projectId;
    setExpanded({});
    setMessage(getGitCommitDraft(projectId));
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
        <GitToolbar fileCount={files().length} loading={loading()} busy={busy()} onRefresh={() => void refresh()} />
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
          onMessage={updateMessage}
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
