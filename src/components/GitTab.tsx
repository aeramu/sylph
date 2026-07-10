import { createEffect, createMemo, createSignal, Show } from 'solid-js';
import type { GitFile } from '../lib/gitPatch';
import GitCommitBox from './GitCommitBox';
import GitSourceSection from './GitSourceSection';
import GitToolbar from './GitToolbar';
import './GitTab.css';

export default function GitTab(props: { projectId?: string }) {
  const [files, setFiles] = createSignal<GitFile[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [loaded, setLoaded] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [message, setMessage] = createSignal('');
  const [expanded, setExpanded] = createSignal<Record<string, boolean>>({});
  const [collapsed, setCollapsed] = createSignal({ staged: false, unstaged: false });
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
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/git/status`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load git status');
      if (generation !== refreshGeneration || props.projectId !== projectId) return false;
      const nextFiles: GitFile[] = data.files || [];
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
      setBusy(false);
    }
  };

  const commit = async () => {
    if (await post('commit', { message: message() })) setMessage('');
  };

  createEffect(() => {
    const projectId = props.projectId;
    setExpanded({});
    setFiles([]);
    setLoaded(false);
    void refresh(projectId);
  });

  return (
    <div class="git-tab">
      <Show when={props.projectId} fallback={<div class="git-empty">Select a project to use git.</div>}>
        <GitToolbar fileCount={files().length} loading={loading()} busy={busy()} onRefresh={() => void refresh()} />
        <Show when={error()}><div class="git-error">{error()}</div></Show>
        <GitCommitBox
          message={message()}
          stagedCount={stagedFiles().length}
          busy={busy()}
          onMessage={setMessage}
          onCommit={() => void commit()}
        />
        <Show when={loaded()} fallback={<div class="git-empty">Loading git status...</div>}>
          <Show when={files().length > 0} fallback={<div class="git-empty">Working tree clean.</div>}>
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
                title="Changes"
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
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  );
}
