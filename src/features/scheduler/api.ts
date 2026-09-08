import { api } from '../../lib/api';

export type ScheduleKind = 'once' | 'cron';

export interface Schedule {
  id: string;
  name: string;
  prompt: string;
  modelId?: string;
  kind: ScheduleKind;
  runAt?: string;
  cron?: string;
  timezone: string;
  enabled: boolean;
  nextRunAt?: string;
  lastRunAt?: string;
  lastRunSessionId?: string;
  lastError?: string;
  runningAt?: string;
  projectId?: string;
  directoryId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SchedulePatch {
  name?: string;
  prompt?: string;
  modelId?: string | null;
  kind?: ScheduleKind;
  runAt?: string;
  cron?: string;
  timezone?: string;
  enabled?: boolean;
}

export async function listAllSchedules(): Promise<Schedule[]> {
  const data = await api<{ schedules?: Schedule[] }>('/api/schedules?scope=all', { cache: 'no-store' });
  return data.schedules || [];
}

export function updateSchedule(schedule: Schedule, patch: SchedulePatch): Promise<Schedule> {
  return api(`/api/schedules/${encodeURIComponent(schedule.id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...patch, projectId: schedule.projectId }),
  });
}

export function runSchedule(schedule: Schedule): Promise<{ scheduleId: string; launched: boolean; sessionId?: string; error?: string }> {
  return api(`/api/schedules/${encodeURIComponent(schedule.id)}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: schedule.projectId }),
  });
}

export function deleteSchedule(schedule: Schedule): Promise<{ success: boolean }> {
  const query = schedule.projectId ? `?projectId=${encodeURIComponent(schedule.projectId)}` : '';
  return api(`/api/schedules/${encodeURIComponent(schedule.id)}${query}`, { method: 'DELETE' });
}

export async function listScheduleModels(): Promise<Array<{ value: string; label: string }>> {
  const data = await api<{ models: Array<{ id: string; provider: string; value?: string }> }>('/api/models');
  return data.models.map((model) => ({
    value: model.value || `${model.provider}/${model.id}`,
    label: `${model.provider} / ${model.id}`,
  }));
}
