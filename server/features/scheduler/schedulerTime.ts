import { Cron } from "croner";
import type { ScheduleKind } from "./schedulerTypes.ts";

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

export function parseOnceRunAt(value: string, now = new Date()): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("runAt must be a valid ISO 8601 timestamp");
  if (date.getTime() <= now.getTime()) throw new Error("runAt must be in the future");
  return date.toISOString();
}

export function nextCronRun(cron: string, timezone: string, after = new Date()): string {
  // A paused Cron is only used as a parser/calculator; the durable runner owns
  // the sole process timer instead of creating one timer per schedule.
  const job = new Cron(cron, { timezone, paused: true });
  const next = job.nextRun(after);
  job.stop();
  if (!next) throw new Error("cron has no future execution time");
  return next.toISOString();
}

export function calculateNextRun(
  kind: ScheduleKind,
  options: { runAt?: string; cron?: string; timezone: string },
  after = new Date(),
): string | undefined {
  if (kind === "once") {
    if (!options.runAt) throw new Error("runAt is required for a one-time schedule");
    const instant = new Date(options.runAt);
    if (!Number.isFinite(instant.getTime())) throw new Error("runAt must be a valid ISO 8601 timestamp");
    return instant.getTime() > after.getTime() ? instant.toISOString() : undefined;
  }
  if (!options.cron) throw new Error("cron is required for a recurring schedule");
  return nextCronRun(options.cron, options.timezone, after);
}
