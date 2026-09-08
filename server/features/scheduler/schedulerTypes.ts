export type ScheduleKind = "once" | "cron";

export interface Schedule {
  id: string;
  name: string;
  prompt: string;
  modelId?: string;
  kind: ScheduleKind;
  /** ISO 8601 instant for a one-time schedule. */
  runAt?: string;
  /** Five-field cron expression for recurring schedules. */
  cron?: string;
  /** IANA timezone used to interpret cron expressions. */
  timezone: string;
  enabled: boolean;
  nextRunAt?: string;
  lastRunAt?: string;
  lastRunSessionId?: string;
  lastError?: string;
  runningAt?: string;
  /** Inherited from the chat that created the schedule. */
  projectId?: string;
  /** Inherited starting directory within projectId. */
  directoryId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleInput {
  name?: unknown;
  prompt?: unknown;
  /** null clears the override and uses the server default. */
  modelId?: unknown;
  kind?: unknown;
  runAt?: unknown;
  cron?: unknown;
  timezone?: unknown;
  enabled?: unknown;
  /** HTTP adapter hint only; ownership is looked up, never accepted directly. */
  sessionId?: unknown;
}
