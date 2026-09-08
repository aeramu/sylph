import { createMemo, createResource, createSignal, For, Show } from 'solid-js';
import type { ProjectInfo } from '../../types';
import { listProjects } from '../projects/api';
import {
  deleteSchedule, listAllSchedules, listScheduleModels, runSchedule, updateSchedule,
  type Schedule, type SchedulePatch,
} from './api';
import './SchedulesScreen.css';

function ScheduleIcon() {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5l3.25 2"/><path d="M8.25 3.75 6.5 2.5M15.75 3.75l1.75-1.25"/></svg>;
}

function formatDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
    : value;
}

function scheduleTiming(schedule: Schedule) {
  return schedule.kind === 'once'
    ? `Once · ${formatDate(schedule.runAt)}`
    : `${schedule.cron} · ${schedule.timezone}`;
}

function projectLabel(schedule: Schedule, projects: ProjectInfo[]) {
  if (!schedule.projectId) return 'No Project';
  return projects.find((project) => project.id === schedule.projectId)?.name || 'Deleted project';
}

function directoryLabel(schedule: Schedule, projects: ProjectInfo[]) {
  if (!schedule.projectId || !schedule.directoryId) return undefined;
  const project = projects.find((entry) => entry.id === schedule.projectId);
  return project?.directories.find((directory) => directory.id === schedule.directoryId)?.name || 'Removed directory';
}

export function ScheduleEditor(props: {
  schedule: Schedule;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [modelId, setModelId] = createSignal(props.schedule.modelId || '');
  const [modelError, setModelError] = createSignal('');
  const [models] = createResource(async () => {
    try { return await listScheduleModels(); }
    catch { setModelError('Could not load models. You can keep the saved model or use the server default.'); return []; }
  });
  const [name, setName] = createSignal(props.schedule.name);
  const [prompt, setPrompt] = createSignal(props.schedule.prompt);
  const [kind, setKind] = createSignal<'once' | 'cron'>(props.schedule.kind);
  const [runAt, setRunAt] = createSignal(props.schedule.runAt || '');
  const [cron, setCron] = createSignal(props.schedule.cron || '');
  const [timezone, setTimezone] = createSignal(props.schedule.timezone);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');

  const save = async (event: SubmitEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const patch: SchedulePatch = {
        name: name(), prompt: prompt(), modelId: modelId() || null, kind: kind(), timezone: timezone(),
        ...(kind() === 'once' ? { runAt: new Date(runAt()).toISOString() } : { cron: cron() }),
      };
      await updateSchedule(props.schedule, patch);
      await props.onSaved();
      props.onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save schedule');
    } finally {
      setBusy(false);
    }
  };

  const datetimeValue = () => {
    if (!runAt()) return '';
    const date = new Date(runAt());
    if (!Number.isFinite(date.getTime())) return '';
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
  };

  return <div class="schedule-editor-overlay" onClick={props.onClose}>
    <form class="schedule-editor" onSubmit={save} onClick={(event) => event.stopPropagation()}>
      <div class="schedule-editor-header"><div><div class="schedule-editor-kicker">Edit schedule</div><h2>{props.schedule.name}</h2></div><button type="button" onClick={props.onClose} aria-label="Close">✕</button></div>
      <label>Name<input value={name()} onInput={(event) => setName(event.currentTarget.value)} required maxlength={120}/></label>
      <label>Agent instructions<textarea value={prompt()} onInput={(event) => setPrompt(event.currentTarget.value)} rows={7} required/></label>
      <label>Model<select aria-label="Model" value={modelId()} onChange={(event) => setModelId(event.currentTarget.value)} disabled={models.loading || busy()}>
        <option value="" selected={!modelId()}>Server default</option>
        <Show when={modelId() && !(models() || []).some((model) => model.value === modelId())}>
          <option value={modelId()} selected>{modelId()} (saved)</option>
        </Show>
        <For each={models() || []}>{(model) => <option value={model.value} selected={modelId() === model.value}>{model.label}</option>}</For>
      </select><span class="schedule-field-help">Used for future runs, including Run now.</span></label>
      <Show when={modelError()}><div class="schedule-editor-error">{modelError()}</div></Show>
      <div class="schedule-editor-grid">
        <label>Type<select value={kind()} onChange={(event) => setKind(event.currentTarget.value as 'once' | 'cron')}><option value="once">One time</option><option value="cron">Recurring</option></select></label>
        <label>Timezone<input value={timezone()} onInput={(event) => setTimezone(event.currentTarget.value)} placeholder="Europe/London" required/></label>
      </div>
      <Show when={kind() === 'once'} fallback={<label>Cron expression<input value={cron()} onInput={(event) => setCron(event.currentTarget.value)} placeholder="0 9 * * 1-5" required/><span class="schedule-field-help">Minute, hour, day of month, month, day of week</span></label>}>
        <label>Run at<input type="datetime-local" value={datetimeValue()} onInput={(event) => setRunAt(event.currentTarget.value)} required/></label>
      </Show>
      <Show when={error()}><div class="schedule-editor-error">{error()}</div></Show>
      <div class="schedule-editor-actions"><button type="button" onClick={props.onClose}>Cancel</button><button class="primary" type="submit" disabled={busy() || !name().trim() || !prompt().trim()}>{busy() ? 'Saving…' : 'Save changes'}</button></div>
    </form>
  </div>;
}

export default function SchedulesScreen(props: {
  onClose: () => void;
  onOpenSession: (id: string) => void;
}) {
  const [projects] = createResource(listProjects);
  const [schedules, { refetch: refreshSchedules }] = createResource(listAllSchedules);
  const [filter, setFilter] = createSignal<'all' | 'enabled' | 'paused' | 'errors'>('all');
  const [projectFilter, setProjectFilter] = createSignal('*');
  const [query, setQuery] = createSignal('');
  const [busyId, setBusyId] = createSignal('');
  const [message, setMessage] = createSignal<{ type: 'error' | 'success'; text: string } | null>(null);
  const [editing, setEditing] = createSignal<Schedule | null>(null);

  const visible = createMemo(() => {
    const needle = query().trim().toLowerCase();
    return (schedules() || []).filter((schedule) => {
      if (filter() === 'enabled' && !schedule.enabled) return false;
      if (filter() === 'paused' && schedule.enabled) return false;
      if (filter() === 'errors' && !schedule.lastError) return false;
      if (projectFilter() !== '*' && (schedule.projectId || '__none__') !== projectFilter()) return false;
      if (needle && !`${schedule.name} ${schedule.prompt} ${schedule.cron || ''} ${projectLabel(schedule, projects() || [])}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  });

  const mutate = async (schedule: Schedule, operation: () => Promise<unknown>, success: string) => {
    setBusyId(schedule.id);
    setMessage(null);
    try {
      await operation();
      setMessage({ type: 'success', text: success });
      await refreshSchedules();
    } catch (reason) {
      setMessage({ type: 'error', text: reason instanceof Error ? reason.message : 'Schedule operation failed' });
    } finally {
      setBusyId('');
    }
  };

  const remove = async (schedule: Schedule) => {
    if (!confirm(`Delete “${schedule.name}”?\n\nThis permanently deletes the schedule.`)) return;
    await mutate(schedule, () => deleteSchedule(schedule), `Deleted “${schedule.name}”.`);
  };

  const runNow = async (schedule: Schedule) => {
    setBusyId(schedule.id);
    setMessage(null);
    try {
      const result = await runSchedule(schedule);
      if (!result.launched) throw new Error(result.error || 'The schedule is already running');
      setMessage({ type: 'success', text: `Started “${schedule.name}” in a new chat.` });
      await refreshSchedules();
    } catch (reason) {
      setMessage({ type: 'error', text: reason instanceof Error ? reason.message : 'Could not run schedule' });
    } finally {
      setBusyId('');
    }
  };

  return <div class="schedules-screen">
    <header class="schedules-header">
      <div class="schedules-heading"><span class="schedules-heading-icon"><ScheduleIcon/></span><div><div class="schedules-eyebrow">Automation</div><h1>Schedules</h1><p>Agent tasks created from your chats. New schedules are created by asking the AI.</p></div></div>
      <button class="schedules-close" onClick={props.onClose} aria-label="Close schedules">✕</button>
    </header>

    <main class="schedules-main">
      <section class="schedules-toolbar" aria-label="Schedule filters">
        <div class="schedules-filter-tabs">
          <For each={[['all', 'All'], ['enabled', 'Active'], ['paused', 'Paused'], ['errors', 'Errors']] as const}>{([value, label]) => <button class={filter() === value ? 'active' : ''} onClick={() => setFilter(value)}>{label}</button>}</For>
        </div>
        <div class="schedules-toolbar-fields">
          <select aria-label="Filter by project" value={projectFilter()} onChange={(event) => setProjectFilter(event.currentTarget.value)}>
            <option value="*">All projects</option><option value="__none__">No Project</option>
            <For each={projects() || []}>{(project) => <option value={project.id}>{project.name}</option>}</For>
          </select>
          <input aria-label="Search schedules" value={query()} onInput={(event) => setQuery(event.currentTarget.value)} placeholder="Search schedules"/>
        </div>
      </section>

      <Show when={message()} keyed>{(notice) => <div class={`schedules-notice ${notice.type}`}>{notice.text}<button onClick={() => setMessage(null)} aria-label="Dismiss">✕</button></div>}</Show>

      <Show when={!schedules.loading} fallback={<div class="schedules-state"><span class="schedules-spinner"/>Loading schedules…</div>}>
        <Show when={visible().length} fallback={<div class="schedules-empty"><span class="schedules-empty-icon"><ScheduleIcon/></span><h2>No schedules here</h2><p>{(schedules() || []).length ? 'Try changing the filters.' : 'Ask the AI in any chat to schedule a task, and it will appear here automatically.'}</p></div>}>
          <div class="schedules-list">
            <For each={visible()}>{(schedule) => {
              const directory = () => directoryLabel(schedule, projects() || []);
              return <article class={`schedule-card ${schedule.enabled ? '' : 'paused'} ${schedule.lastError ? 'has-error' : ''}`}>
                <div class="schedule-card-status"><span class={`schedule-status-dot ${schedule.runningAt ? 'running' : schedule.enabled ? 'active' : 'paused'}`}/></div>
                <div class="schedule-card-body">
                  <div class="schedule-card-title-row"><div><h2>{schedule.name}</h2><div class="schedule-badges"><span class="schedule-project-badge">{projectLabel(schedule, projects() || [])}</span><Show when={directory()}>{(name) => <span class="schedule-directory-badge">{name()}</span>}</Show><span class={`schedule-state-badge ${schedule.enabled ? 'active' : 'paused'}`}>{schedule.runningAt ? 'Running' : schedule.enabled ? 'Active' : 'Paused'}</span></div></div>
                    <div class="schedule-card-actions">
                      <button onClick={() => void runNow(schedule)} disabled={busyId() === schedule.id || !!schedule.runningAt} title="Run now" aria-label={`Run ${schedule.name} now`}><svg viewBox="0 0 24 24" fill="none"><path d="m9 7 8 5-8 5z"/></svg></button>
                      <button onClick={() => setEditing(schedule)} disabled={busyId() === schedule.id} title="Edit" aria-label={`Edit ${schedule.name}`}><svg viewBox="0 0 24 24" fill="none"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/></svg></button>
                      <button onClick={() => void mutate(schedule, () => updateSchedule(schedule, { enabled: !schedule.enabled }), schedule.enabled ? `Paused “${schedule.name}”.` : `Enabled “${schedule.name}”.`)} disabled={busyId() === schedule.id} title={schedule.enabled ? 'Pause' : 'Enable'} aria-label={`${schedule.enabled ? 'Pause' : 'Enable'} ${schedule.name}`}><Show when={schedule.enabled} fallback={<svg viewBox="0 0 24 24" fill="none"><path d="m9 7 8 5-8 5z"/></svg>}><svg viewBox="0 0 24 24" fill="none"><path d="M9 7v10M15 7v10"/></svg></Show></button>
                      <button class="danger" onClick={() => void remove(schedule)} disabled={busyId() === schedule.id} title="Delete" aria-label={`Delete ${schedule.name}`}><svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/></svg></button>
                    </div>
                  </div>
                  <p class="schedule-prompt">{schedule.prompt}</p>
                  <div class="schedule-card-meta">
                    <div><span>Schedule</span><strong>{scheduleTiming(schedule)}</strong></div>
                    <div><span>Next run</span><strong>{schedule.enabled ? formatDate(schedule.nextRunAt) : 'Paused'}</strong></div>
                    <div><span>Last run</span><strong>{formatDate(schedule.lastRunAt)}</strong></div>
                    <Show when={schedule.lastRunSessionId}><div><span>Result</span><button class="schedule-chat-link" onClick={() => props.onOpenSession(schedule.lastRunSessionId!)}>Open chat →</button></div></Show>
                  </div>
                  <Show when={schedule.lastError}><div class="schedule-card-error"><strong>Last error</strong><span>{schedule.lastError}</span></div></Show>
                </div>
              </article>;
            }}</For>
          </div>
        </Show>
      </Show>
    </main>

    <Show when={editing()} keyed>{(schedule) => <ScheduleEditor schedule={schedule} onClose={() => setEditing(null)} onSaved={async () => { await refreshSchedules(); setMessage({ type: 'success', text: `Updated “${schedule.name}”.` }); }}/>}</Show>
  </div>;
}
