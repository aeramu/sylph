import { SCHEDULES_FILE } from "../../config.ts";
import { JsonFileStore } from "../../platform/filesystem/jsonFileStore.ts";
import type { Schedule, ScheduleKind } from "./schedulerTypes.ts";

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function normalizeSchedule(value: unknown): Schedule | undefined {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (typeof record.id !== "string" || typeof record.name !== "string" || typeof record.prompt !== "string") return undefined;
  const kind: ScheduleKind = record.kind === "once" ? "once" : record.kind === "cron" ? "cron" : "cron";
  const createdAt = optionalString(record.createdAt) ?? new Date(0).toISOString();
  return {
    id: record.id,
    name: record.name,
    prompt: record.prompt,
    kind,
    ...(optionalString(record.runAt) ? { runAt: optionalString(record.runAt) } : {}),
    ...(optionalString(record.cron) ? { cron: optionalString(record.cron) } : {}),
    timezone: optionalString(record.timezone) ?? "UTC",
    enabled: record.enabled !== false,
    ...(optionalString(record.nextRunAt) ? { nextRunAt: optionalString(record.nextRunAt) } : {}),
    ...(optionalString(record.lastRunAt) ? { lastRunAt: optionalString(record.lastRunAt) } : {}),
    ...(optionalString(record.lastRunSessionId) ? { lastRunSessionId: optionalString(record.lastRunSessionId) } : {}),
    ...(optionalString(record.lastError) ? { lastError: optionalString(record.lastError) } : {}),
    ...(optionalString(record.runningAt) ? { runningAt: optionalString(record.runningAt) } : {}),
    ...(optionalString(record.projectId) ? { projectId: optionalString(record.projectId) } : {}),
    ...(optionalString(record.directoryId) ? { directoryId: optionalString(record.directoryId) } : {}),
    createdAt,
    updatedAt: optionalString(record.updatedAt) ?? createdAt,
  };
}

function normalizeSchedules(value: unknown): Schedule[] {
  return Array.isArray(value)
    ? value.map(normalizeSchedule).filter((schedule): schedule is Schedule => !!schedule)
    : [];
}

const scheduleStore = new JsonFileStore<Schedule[]>({
  filePath: SCHEDULES_FILE,
  defaultValue: () => [],
  normalize: normalizeSchedules,
});

export function getSchedules(): Schedule[] {
  return scheduleStore.read();
}

export function getSchedule(id: unknown): Schedule | undefined {
  return typeof id === "string" ? getSchedules().find((schedule) => schedule.id === id) : undefined;
}

export function saveSchedule(schedule: Schedule): Schedule {
  const schedules = getSchedules();
  const index = schedules.findIndex((entry) => entry.id === schedule.id);
  if (index >= 0) schedules[index] = schedule;
  else schedules.push(schedule);
  scheduleStore.write(schedules);
  return schedule;
}

export function deleteStoredSchedule(id: string): boolean {
  const schedules = getSchedules();
  const next = schedules.filter((schedule) => schedule.id !== id);
  if (next.length === schedules.length) return false;
  scheduleStore.write(next);
  return true;
}

export function saveSchedules(schedules: Schedule[]): void {
  scheduleStore.write(schedules);
}
