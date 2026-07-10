import { createEffect, createMemo, createSignal, Index, Show } from 'solid-js';
import { diffMode, setDiffMode } from '../lib/diffMode';
import DiffView, { type DiffLineAction } from './DiffView';
import './GitTab.css';

type GitFile = {
  path: string;
  index: string;
  workingTree: string;
  unstagedPatch: string;
  stagedPatch: string;
  isUntracked: boolean;
};

type DiffLine = { type: 'context' | 'add' | 'del' | 'meta'; text: string; oldLine?: number; newLine?: number; raw: string };
type Hunk = { header: string; lines: DiffLine[]; rawLines: string[]; oldStart: number; oldCount: number; newStart: number; newCount: number };

type FilePatch = { headers: string[]; hunks: Hunk[] };

function parsePatch(patch: string): FilePatch {
  const lines = patch.split('\n');
  const headers: string[] = [];
  const hunks: Hunk[] = [];
  let hunk: Hunk | undefined;
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (match) {
      hunk = {
        header: line,
        lines: [],
        rawLines: [],
        oldStart: Number(match[1]),
        oldCount: Number(match[2] || 1),
        newStart: Number(match[3]),
        newCount: Number(match[4] || 1),
      };
      oldLine = hunk.oldStart;
      newLine = hunk.newStart;
      hunks.push(hunk);
      continue;
    }

    if (!hunk) {
      if (line) headers.push(line);
      continue;
    }

    hunk.rawLines.push(line);
    if (line.startsWith('+')) {
      hunk.lines.push({ type: 'add', text: line.slice(1), newLine, raw: line });
      newLine++;
    } else if (line.startsWith('-')) {
      hunk.lines.push({ type: 'del', text: line.slice(1), oldLine, raw: line });
      oldLine++;
    } else if (line.startsWith(' ')) {
      hunk.lines.push({ type: 'context', text: line.slice(1), oldLine, newLine, raw: line });
      oldLine++;
      newLine++;
    } else {
      hunk.lines.push({ type: 'meta', text: line, raw: line });
    }
  }

  return { headers, hunks };
}

function hunkPatch(patch: string, hunk: Hunk) {
  const parsed = parsePatch(patch);
  return [...parsed.headers, hunk.header, ...hunk.rawLines].join('\n');
}

// Build a valid single-line patch while retaining enough surrounding lines
// for Git to match the index. This powers line actions next to CodeMirror;
// the highlighted diff itself remains the shared app DiffView.
function normalizeHeaders(headers: string[]) {
  const newPath = headers.find((header) => header.startsWith('+++ b/'))?.slice(6);
  const oldPath = headers.find((header) => header.startsWith('--- a/'))?.slice(6);
  return headers
    .filter((header) => !header.startsWith('new file mode') && !header.startsWith('deleted file mode'))
    .map((header) => {
      if (header === '--- /dev/null' && newPath) return `--- a/${newPath}`;
      if (header === '+++ /dev/null' && oldPath) return `+++ b/${oldPath}`;
      return header;
    });
}

function linePatch(patch: string, hunk: Hunk, index: number, reverse: boolean) {
  const parsed = parsePatch(patch);
  const selected = hunk.lines[index];
  if (!selected || (selected.type !== 'add' && selected.type !== 'del')) return '';

  const presentType = reverse ? 'add' : 'del';
  let oldStart: number | undefined;
  let newStart: number | undefined;
  let oldCount = 0;
  let newCount = 0;
  const body: string[] = [];

  for (const line of hunk.lines) {
    if (line.type === 'meta') continue;
    const include = line === selected || line.type === 'context' || line.type === presentType;
    if (!include) continue;
    const raw = line !== selected && line.type === presentType ? ` ${line.text}` : line.raw;
    if (oldStart == null) oldStart = line.oldLine ?? selected.oldLine ?? hunk.oldStart;
    if (newStart == null) newStart = line.newLine ?? selected.newLine ?? hunk.newStart;
    body.push(raw);
    if (raw[0] !== '+') oldCount++;
    if (raw[0] !== '-') newCount++;
  }

  if (oldStart == null || newStart == null || body.length === 0) return '';
  const headers = body.some((line) => line.startsWith(' ')) ? normalizeHeaders(parsed.headers) : parsed.headers;
  return [...headers, `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, ...body].join('\n');
}

function hunkView(hunk: Hunk, actionLabel: string, onLine: (index: number) => void) {
  const oldLines: string[] = [];
  const newLines: string[] = [];
  const oldLineActions: DiffLineAction[] = [];
  const newLineActions: DiffLineAction[] = [];

  hunk.lines.forEach((line, index) => {
    if (line.type === 'context') {
      oldLines.push(line.text);
      newLines.push(line.text);
    } else if (line.type === 'del') {
      oldLines.push(line.text);
      oldLineActions.push({
        line: oldLines.length,
        label: actionLabel.startsWith('Unstage') ? '−' : '+',
        title: `${actionLabel} ${line.oldLine}: ${line.text}`,
        onClick: () => onLine(index),
      });
    } else if (line.type === 'add') {
      newLines.push(line.text);
      newLineActions.push({
        line: newLines.length,
        label: actionLabel.startsWith('Unstage') ? '−' : '+',
        title: `${actionLabel} ${line.newLine}: ${line.text}`,
        onClick: () => onLine(index),
      });
    }
  });

  return {
    oldText: oldLines.join('\n'),
    newText: newLines.join('\n'),
    oldLineActions,
    newLineActions,
  };
}

function statusLabel(file: GitFile, staged: boolean) {
  if (!staged && file.isUntracked) return 'U';
  const status = staged ? file.index : file.workingTree;
  return status === '?' ? 'U' : status.trim() || 'M';
}

function splitFilePath(filePath: string) {
  const slash = filePath.lastIndexOf('/');
  return slash < 0
    ? { name: filePath, directory: '' }
    : { name: filePath.slice(slash + 1), directory: filePath.slice(0, slash) };
}

function patchStats(patch: string) {
  let added = 0;
  let deleted = 0;
  for (const hunk of parsePatch(patch).hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'add') added++;
      else if (line.type === 'del') deleted++;
    }
  }
  return { added, deleted };
}

function ChevronIcon(props: { expanded: boolean; class?: string }) {
  return (
    <svg
      class={`git-chevron ${props.expanded ? 'expanded' : ''} ${props.class ?? ''}`}
      width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9"></polyline>
    </svg>
  );
}

function PatchBlock(props: {
  patch: string;
  actionLabel: string;
  path: string;
  busy: boolean;
  reverse?: boolean;
  lineActionLabel: string;
  onApplyPatch: (patch: string) => void;
}) {
  const parsed = () => parsePatch(props.patch);
  const [collapsedHunks, setCollapsedHunks] = createSignal<Record<number, boolean>>({});

  return (
    <Show when={props.patch.trim()}>
      <div class="git-patch-block">
        <Index each={parsed().hunks}>
          {(hunk, hunkIndex) => {
            const view = createMemo(() => hunkView(
              hunk(),
              props.lineActionLabel,
              (index) => props.onApplyPatch(linePatch(props.patch, hunk(), index, !!props.reverse)),
            ));
            return (
              <div class="git-hunk">
                <div class="git-hunk-header">
                  <button
                    class="git-hunk-toggle"
                    onClick={() => setCollapsedHunks((value) => ({ ...value, [hunkIndex]: !value[hunkIndex] }))}
                    aria-expanded={!collapsedHunks()[hunkIndex]}
                    title={collapsedHunks()[hunkIndex] ? 'Expand hunk' : 'Collapse hunk'}
                  >
                    <ChevronIcon expanded={!collapsedHunks()[hunkIndex]} />
                    <code>{hunk().header}</code>
                  </button>
                  <button
                    class="git-icon-button git-hunk-action"
                    disabled={props.busy}
                    onClick={() => props.onApplyPatch(hunkPatch(props.patch, hunk()))}
                    title={`${props.actionLabel} hunk`}
                    aria-label={`${props.actionLabel} hunk`}
                  >
                    {props.reverse ? '−' : '+'}
                  </button>
                </div>
                <Show when={!collapsedHunks()[hunkIndex]}>
                  <DiffView
                    oldText={view().oldText}
                    newText={view().newText}
                    path={props.path}
                    oldLineActions={view().oldLineActions}
                    newLineActions={view().newLineActions}
                  />
                </Show>
              </div>
            );
          }}
        </Index>
      </div>
    </Show>
  );
}

function SourceSection(props: {
  title: string;
  files: GitFile[];
  staged: boolean;
  busy: boolean;
  collapsed: boolean;
  onToggle: () => void;
  expanded: Record<string, boolean>;
  onToggleFile: (key: string) => void;
  onFileAction: (file: GitFile) => void;
  onAllAction: () => void;
  onApplyPatch: (file: GitFile, patch: string, reverse: boolean) => void;
}) {
  return (
    <Show when={props.files.length > 0}>
      <section class="git-source-section">
        <div class="git-source-section-header">
          <button class="git-source-section-toggle" onClick={props.onToggle} aria-expanded={!props.collapsed}>
            <ChevronIcon expanded={!props.collapsed} />
            <span>{props.title}</span>
            <span class="git-source-count">{props.files.length}</span>
          </button>
          <button
            class="git-icon-button git-source-all-action"
            disabled={props.busy}
            onClick={props.onAllAction}
            title={props.staged ? 'Unstage all changes' : 'Stage all changes'}
            aria-label={props.staged ? 'Unstage all changes' : 'Stage all changes'}
          >
            {props.staged ? '−' : '+'}
          </button>
        </div>
        <Show when={!props.collapsed}>
          <div class="git-source-files">
            <Index each={props.files}>
              {(file) => {
                const key = () => `${props.staged ? 'staged' : 'unstaged'}:${file().path}`;
                const pathParts = () => splitFilePath(file().path);
                const patch = () => props.staged ? file().stagedPatch : file().unstagedPatch;
                const stats = () => patchStats(patch());
                return (
                  <div class={`git-source-file ${props.expanded[key()] ? 'expanded' : ''}`}>
                    <div class="git-source-file-row">
                      <button
                        class="git-source-file-open"
                        onClick={() => props.onToggleFile(key())}
                        title={file().path}
                        aria-expanded={!!props.expanded[key()]}
                      >
                        <ChevronIcon expanded={!!props.expanded[key()]} class="git-file-chevron" />
                        <span class="git-source-file-name">{pathParts().name}</span>
                        <Show when={pathParts().directory}>
                          <span class="git-source-file-directory">{pathParts().directory}</span>
                        </Show>
                      </button>
                      <span class="git-source-file-stats" aria-label={`${stats().added} lines added, ${stats().deleted} lines deleted`}>
                        <Show when={stats().added > 0}><span class="diff-stats-added">+{stats().added}</span></Show>
                        <Show when={stats().deleted > 0}><span class="diff-stats-deleted">-{stats().deleted}</span></Show>
                      </span>
                      <span class={`git-source-status status-${statusLabel(file(), props.staged).toLowerCase()}`} title={props.staged ? 'Staged status' : 'Working tree status'}>
                        {statusLabel(file(), props.staged)}
                      </span>
                      <button
                        class="git-icon-button git-source-file-action"
                        disabled={props.busy}
                        onClick={() => props.onFileAction(file())}
                        title={props.staged ? 'Unstage changes' : 'Stage changes'}
                        aria-label={`${props.staged ? 'Unstage' : 'Stage'} ${file().path}`}
                      >
                        {props.staged ? '−' : '+'}
                      </button>
                    </div>
                    <Show when={props.expanded[key()]}>
                      <Show when={patch().trim()} fallback={<div class="git-source-no-diff">No text diff available. Use the file action to {props.staged ? 'unstage' : 'stage'} it.</div>}>
                        <PatchBlock
                          patch={patch()}
                          actionLabel={props.staged ? 'Unstage' : 'Stage'}
                          path={file().path}
                          busy={props.busy}
                          reverse={props.staged}
                          lineActionLabel={props.staged ? 'Unstage line' : 'Stage line'}
                          onApplyPatch={(partial) => props.onApplyPatch(file(), partial, props.staged)}
                        />
                      </Show>
                    </Show>
                  </div>
                );
              }}
            </Index>
          </div>
        </Show>
      </section>
    </Show>
  );
}

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
      // Preserve object identity for unchanged files. Solid's <For> keys by
      // identity, so this keeps expanded CodeMirror views mounted on refresh.
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
        <div class="git-toolbar">
          <div>
            <div class="git-title">Git</div>
            <div class="git-subtitle">{files().length} changed file{files().length === 1 ? '' : 's'}</div>
          </div>
          <div class="git-toolbar-actions">
            <div class="git-diff-mode" role="group" aria-label="Git diff layout">
              <button
                class={`git-toolbar-icon ${diffMode() === 'split' ? 'active' : ''}`}
                onClick={() => setDiffMode('split')}
                title="Side-by-side diff"
                aria-label="Side-by-side diff"
                aria-pressed={diffMode() === 'split'}
              >
                Split
              </button>
              <button
                class={`git-toolbar-icon ${diffMode() === 'unified' ? 'active' : ''}`}
                onClick={() => setDiffMode('unified')}
                title="Unified diff"
                aria-label="Unified diff"
                aria-pressed={diffMode() === 'unified'}
              >
                Unified
              </button>
            </div>
            <button
              class="git-toolbar-icon git-refresh-button"
              disabled={loading() || busy()}
              onClick={() => void refresh()}
              title="Refresh Git status"
              aria-label="Refresh Git status"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="20 6 20 12 14 12"></polyline>
                <path d="M18.5 16a8 8 0 1 1 .5-8.5L20 12"></path>
              </svg>
            </button>
          </div>
        </div>

        <Show when={error()}>
          <div class="git-error">{error()}</div>
        </Show>

        <div class="git-commit-box">
          <textarea value={message()} onInput={(e) => setMessage(e.currentTarget.value)} placeholder="Commit message" rows="3" />
          <button disabled={busy() || !message().trim() || stagedFiles().length === 0} onClick={commit}>
            Commit {stagedFiles().length > 0 ? `${stagedFiles().length} staged` : 'staged'}
          </button>
        </div>

        <Show when={loaded()} fallback={<div class="git-empty">Loading git status...</div>}>
          <Show when={files().length > 0} fallback={<div class="git-empty">Working tree clean.</div>}>
            <div class="git-source-control">
              <SourceSection
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
              <SourceSection
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
