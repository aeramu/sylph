import { createEffect, createSignal, For, onCleanup, Show } from 'solid-js';
import type { BackgroundJobInfo, BackgroundJobStatus } from '../../../types';
import { getBackgroundJobLogs } from '../api';
import DisclosureChevron from '../../../shared/ui/DisclosureChevron';
import './BackgroundJobCard.css';

const STATUS_LABELS: Record<BackgroundJobStatus, string> = {
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  killed: 'Stopped',
};

function elapsed(job: BackgroundJobInfo): string | undefined {
  const start = job.startedAt ? Date.parse(job.startedAt) : NaN;
  const end = job.endedAt ? Date.parse(job.endedAt) : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatBytes(bytes: number | undefined): string | undefined {
  if (bytes === undefined) return undefined;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function StatusIcon(props: { status: BackgroundJobStatus }) {
  return <span class={`background-job-status-icon ${props.status}`} aria-hidden="true">
    <Show when={props.status === 'running'} fallback={
      <Show when={props.status === 'completed'} fallback={
        <Show when={props.status === 'failed'} fallback={
          <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>
        }>
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 17h.01" /></svg>
        </Show>
      }>
        <svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6" /></svg>
      </Show>
    }>
      <span class="background-job-spinner" />
    </Show>
  </span>;
}

function JobDetails(props: { job: BackgroundJobInfo; sessionId?: string }) {
  const [logs, setLogs] = createSignal<string>();
  const [truncated, setTruncated] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [loadError, setLoadError] = createSignal<string>();
  let requestedJobId: string | undefined;

  const loadLogs = async (sessionId: string, jobId: string) => {
    setLoading(true);
    setLoadError(undefined);
    try {
      const result = await getBackgroundJobLogs(sessionId, jobId);
      if (requestedJobId !== jobId) return;
      setLogs(result.text);
      setTruncated(result.truncated);
    } catch (error) {
      if (requestedJobId === jobId) setLoadError(error instanceof Error ? error.message : 'Could not load output');
    } finally {
      if (requestedJobId === jobId) setLoading(false);
    }
  };

  createEffect(() => {
    const jobId = props.job.id;
    const sessionId = props.sessionId || props.job.sessionId;
    if (!sessionId || requestedJobId === jobId) return;
    requestedJobId = jobId;
    setLogs(undefined);
    setTruncated(false);
    void loadLogs(sessionId, jobId);
  });

  return <div class="background-job-details">
    <Show when={props.job.error}>
      <div class="background-job-error">{props.job.error}</div>
    </Show>
    <Show when={props.job.command || props.job.cwd}>
      <dl class="background-job-metadata">
        <Show when={props.job.command}><dt>Command</dt><dd><code>{props.job.command}</code></dd></Show>
        <Show when={props.job.cwd}><dt>Directory</dt><dd><code>{props.job.cwd}</code></dd></Show>
        <Show when={props.job.signal}><dt>Signal</dt><dd>{props.job.signal}</dd></Show>
      </dl>
    </Show>
    <div class="background-job-output-heading">
      <span>Output</span>
      <Show when={formatBytes(props.job.outputBytes)}>{(size) => <span>{size()}</span>}</Show>
    </div>
    <Show when={loading()}><div class="background-job-output-state">Loading output…</div></Show>
    <Show when={loadError()}>{(error) => <div class="background-job-output-state error">{error()}</div>}</Show>
    <Show when={!loading() && !loadError() && logs() !== undefined}>
      <pre class="background-job-output">{logs() || '(no output)'}</pre>
      <Show when={truncated()}><div class="background-job-truncated">Earlier output omitted.</div></Show>
    </Show>
  </div>;
}

function BackgroundJobItem(props: { job: BackgroundJobInfo; sessionId?: string; nested?: boolean }) {
  const [expanded, setExpanded] = createSignal(props.job.status === 'failed');
  const [copied, setCopied] = createSignal(false);
  let copyReset: ReturnType<typeof setTimeout> | undefined;
  let wasFailed = props.job.status === 'failed';

  createEffect(() => {
    const failed = props.job.status === 'failed';
    if (failed && !wasFailed) setExpanded(true);
    wasFailed = failed;
  });

  onCleanup(() => { if (copyReset) clearTimeout(copyReset); });

  const copyJobId = async () => {
    try {
      await navigator.clipboard.writeText(props.job.id);
      setCopied(true);
      if (copyReset) clearTimeout(copyReset);
      copyReset = setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const meta = () => {
    const pieces: string[] = [];
    const jobElapsed = elapsed(props.job);
    if (jobElapsed) pieces.push(jobElapsed);
    if (props.job.exitCode !== undefined) pieces.push(`exit ${props.job.exitCode ?? 'unknown'}`);
    return pieces.join(' · ');
  };

  return <div class={`background-job-item ${props.job.status} ${props.nested ? 'nested' : ''}`}>
    <div class="background-job-main">
      <button class="background-job-summary" type="button" aria-expanded={expanded()} onClick={() => setExpanded(!expanded())}>
        <StatusIcon status={props.job.status} />
        <span class="background-job-title-wrap">
          <span class="background-job-title">{props.job.name}</span>
          <span class="background-job-subtitle">
            <span class={`background-job-status ${props.job.status}`}>{STATUS_LABELS[props.job.status]}</span>
            <Show when={meta()}>{(value) => <><span aria-hidden="true"> · </span><span>{value()}</span></>}</Show>
          </span>
        </span>
        <DisclosureChevron expanded={expanded()} class="background-job-chevron" />
      </button>
      <div class="background-job-actions">
        <button type="button" onClick={() => setExpanded(!expanded())}>{expanded() ? 'Hide details' : 'View logs'}</button>
        <button type="button" aria-label={`Copy job ID ${props.job.id}`} title={props.job.id} onClick={() => void copyJobId()}>{copied() ? 'Copied' : 'Copy ID'}</button>
      </div>
    </div>
    <Show when={expanded()}><JobDetails job={props.job} sessionId={props.sessionId} /></Show>
  </div>;
}

export default function BackgroundJobCard(props: { jobs: readonly BackgroundJobInfo[]; sessionId?: string; embedded?: boolean }) {
  const [groupExpanded, setGroupExpanded] = createSignal(props.jobs.some((job) => job.status === 'failed'));
  const grouped = () => props.jobs.length > 1;
  const groupStatus = (): BackgroundJobStatus => props.jobs.some((job) => job.status === 'failed')
    ? 'failed'
    : props.jobs.some((job) => job.status === 'running')
      ? 'running'
      : props.jobs.some((job) => job.status === 'killed') ? 'killed' : 'completed';

  return <div class={`background-job-card ${props.embedded ? 'embedded' : ''}`}>
    <Show when={grouped()} fallback={
      <Show when={props.jobs[0]} keyed>{(job) => <BackgroundJobItem job={job} sessionId={props.sessionId} />}</Show>
    }>
      <button class={`background-job-group-summary ${groupStatus()}`} type="button" aria-expanded={groupExpanded()} onClick={() => setGroupExpanded(!groupExpanded())}>
        <StatusIcon status={groupStatus()} />
        <span>{props.jobs.length} background jobs finished</span>
        <DisclosureChevron expanded={groupExpanded()} class="background-job-chevron" />
      </button>
      <Show when={groupExpanded()}>
        <div class="background-job-group-items">
          <For each={props.jobs}>{(job) => <BackgroundJobItem job={job} sessionId={props.sessionId} nested />}</For>
        </div>
      </Show>
    </Show>
  </div>;
}
