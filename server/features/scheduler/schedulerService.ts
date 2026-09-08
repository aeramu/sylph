import { randomUUID } from "node:crypto";
import { badRequest, notFound } from "../../platform/http/errors.ts";
import {
  deleteStoredSchedule, getSchedule, getSchedules, saveSchedule, saveSchedules,
} from "./schedulerRepository.ts";
import { calculateNextRun, isValidTimezone, parseOnceRunAt } from "./schedulerTime.ts";
import type { Schedule, ScheduleInput, ScheduleKind } from "./schedulerTypes.ts";

export interface ScheduleOwnership {
  projectId?: string;
  directoryId?: string;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) badRequest(`${field} is required`);
  return value.trim();
}

function modelId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return text(value, "modelId");
}

function kind(value: unknown): ScheduleKind {
  if (value !== "once" && value !== "cron") badRequest("kind must be once or cron");
  return value;
}

function timezone(value: unknown): string {
  const result = text(value, "timezone");
  if (!isValidTimezone(result)) badRequest("timezone must be a valid IANA timezone");
  return result;
}

function cronExpression(value: unknown, zone: string): string {
  const result = text(value, "cron");
  if (result.split(/\s+/).length !== 5) badRequest("cron must use five fields: minute hour day-of-month month day-of-week");
  try { calculateNextRun("cron", { cron: result, timezone: zone }); }
  catch (error) { badRequest(error instanceof Error ? error.message : "Invalid cron expression"); }
  return result;
}

function onceRunAt(value: unknown): string {
  const result = text(value, "runAt");
  try { return parseOnceRunAt(result); }
  catch (error) { badRequest(error instanceof Error ? error.message : "Invalid runAt timestamp"); }
}

function buildTiming(input: ScheduleInput): Pick<Schedule, "kind" | "timezone" | "runAt" | "cron" | "nextRunAt"> {
  const scheduleKind = kind(input.kind);
  const zone = timezone(input.timezone);
  if (scheduleKind === "once") {
    const runAt = onceRunAt(input.runAt);
    return { kind: scheduleKind, timezone: zone, runAt, nextRunAt: runAt };
  }
  const cron = cronExpression(input.cron, zone);
  return { kind: scheduleKind, timezone: zone, cron, nextRunAt: calculateNextRun("cron", { cron, timezone: zone }) };
}

function sortSchedules(schedules: Schedule[]): Schedule[] {
  return schedules.sort((a, b) => (a.nextRunAt ?? "~").localeCompare(b.nextRunAt ?? "~"));
}

export function listSchedules(projectId?: string): Schedule[] {
  return sortSchedules(getSchedules().filter((schedule) => schedule.projectId === projectId));
}

export function listAllSchedules(): Schedule[] {
  return sortSchedules(getSchedules());
}

export function createSchedule(input: ScheduleInput, ownership: ScheduleOwnership = {}): Schedule {
  const now = new Date().toISOString();
  const timing = buildTiming(input);
  return saveSchedule({
    id: `schedule-${randomUUID()}`,
    name: text(input.name, "name"),
    prompt: text(input.prompt, "prompt"),
    modelId: modelId(input.modelId),
    ...timing,
    enabled: input.enabled !== false,
    ...(ownership.projectId ? { projectId: ownership.projectId } : {}),
    ...(ownership.projectId && ownership.directoryId ? { directoryId: ownership.directoryId } : {}),
    createdAt: now,
    updatedAt: now,
  });
}

function ownedSchedule(id: string, projectId?: string): Schedule {
  const schedule = getSchedule(id);
  if (!schedule || schedule.projectId !== projectId) notFound("Schedule not found");
  return schedule;
}

export function updateSchedule(id: string, input: ScheduleInput, projectId?: string): Schedule {
  const current = ownedSchedule(id, projectId);
  const combined: ScheduleInput = {
    name: input.name ?? current.name,
    prompt: input.prompt ?? current.prompt,
    kind: input.kind ?? current.kind,
    runAt: input.runAt ?? current.runAt,
    cron: input.cron ?? current.cron,
    timezone: input.timezone ?? current.timezone,
  };
  const enabled = typeof input.enabled === "boolean" ? input.enabled : current.enabled;
  const timingChanged = input.kind !== undefined || input.runAt !== undefined || input.cron !== undefined || input.timezone !== undefined;
  const mustRecalculate = timingChanged || (!current.enabled && enabled);
  const timing = mustRecalculate ? buildTiming(combined) : {
    kind: current.kind,
    timezone: current.timezone,
    runAt: current.runAt,
    cron: current.cron,
    nextRunAt: current.nextRunAt,
  };
  return saveSchedule({
    ...current,
    name: text(combined.name, "name"),
    prompt: text(combined.prompt, "prompt"),
    modelId: input.modelId === undefined ? current.modelId : modelId(input.modelId),
    ...timing,
    enabled,
    lastError: undefined,
    updatedAt: new Date().toISOString(),
  });
}

export function deleteSchedule(id: string, projectId?: string): void {
  ownedSchedule(id, projectId);
  deleteStoredSchedule(id);
}

export function getScheduleForProject(id: string, projectId?: string): Schedule {
  return ownedSchedule(id, projectId);
}

/** Keep historical ownership visible, but prevent deleted projects from running. */
export function disableProjectSchedules(projectId: string): number {
  const schedules = getSchedules();
  const now = new Date().toISOString();
  let count = 0;
  const next = schedules.map((schedule) => {
    if (schedule.projectId !== projectId || !schedule.enabled) return schedule;
    count++;
    return { ...schedule, enabled: false, runningAt: undefined, lastError: "Project was deleted", updatedAt: now };
  });
  if (count) saveSchedules(next);
  return count;
}

export function disableDirectorySchedules(projectId: string, directoryIds: string[]): number {
  const ids = new Set(directoryIds);
  if (!ids.size) return 0;
  const schedules = getSchedules();
  const now = new Date().toISOString();
  let count = 0;
  const next = schedules.map((schedule) => {
    if (schedule.projectId !== projectId || !schedule.directoryId || !ids.has(schedule.directoryId) || !schedule.enabled) return schedule;
    count++;
    return { ...schedule, enabled: false, runningAt: undefined, lastError: "Starting directory was removed from the project", updatedAt: now };
  });
  if (count) saveSchedules(next);
  return count;
}
