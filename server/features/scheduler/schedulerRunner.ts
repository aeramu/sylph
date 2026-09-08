import { sendChat, type SendChatResult } from "../chat/chatService.ts";
import { getProjectById } from "../projects/projectRepository.ts";
import { getSchedule, getSchedules, saveSchedule } from "./schedulerRepository.ts";
import { calculateNextRun } from "./schedulerTime.ts";
import type { Schedule } from "./schedulerTypes.ts";

export const SCHEDULER_INTERVAL_MS = 30_000;

export type ScheduledChatSender = (input: {
  prompt: string;
  modelId?: string;
  projectId?: string;
  directoryId?: string;
}) => Promise<SendChatResult>;

export interface ScheduleRunResult {
  scheduleId: string;
  launched: boolean;
  sessionId?: string;
  error?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const activeScheduleIds = new Set<string>();

function claimSchedule(id: string, now: Date, requireDue: boolean): Schedule | undefined {
  const schedule = getSchedule(id);
  if (!schedule || activeScheduleIds.has(id)) return undefined;
  // A persisted runningAt with no in-process owner was left by an interrupted
  // server process and is recovered immediately on startup.
  const staleClaim = !!schedule.runningAt;
  if (requireDue && !staleClaim
      && (!schedule.enabled || !schedule.nextRunAt || new Date(schedule.nextRunAt).getTime() > now.getTime())) return undefined;

  let nextRunAt: string | undefined;
  let enabled = schedule.enabled;
  if (schedule.kind === "cron") {
    nextRunAt = calculateNextRun("cron", schedule, now);
  } else {
    // Claim one-time schedules permanently before launching so a restart while
    // the chat is being created cannot execute the task twice.
    enabled = false;
  }

  const claimed = saveSchedule({
    ...schedule,
    enabled,
    nextRunAt,
    runningAt: now.toISOString(),
    lastError: undefined,
    updatedAt: now.toISOString(),
  });
  activeScheduleIds.add(id);
  return claimed;
}

function finishSchedule(id: string, patch: Partial<Schedule>, now: Date): void {
  const current = getSchedule(id);
  if (!current) return;
  saveSchedule({ ...current, ...patch, runningAt: undefined, updatedAt: now.toISOString() });
}

export async function runSchedule(
  id: string,
  options: { requireDue?: boolean; sender?: ScheduledChatSender; now?: Date } = {},
): Promise<ScheduleRunResult> {
  const now = options.now ?? new Date();
  const schedule = claimSchedule(id, now, options.requireDue === true);
  if (!schedule) return { scheduleId: id, launched: false };

  try {
    if (schedule.projectId && !getProjectById(schedule.projectId)) throw new Error("Scheduled project no longer exists");
    const result = await (options.sender ?? sendChat)({
      prompt: schedule.prompt,
      ...(schedule.modelId ? { modelId: schedule.modelId } : {}),
      ...(schedule.projectId ? { projectId: schedule.projectId } : {}),
      ...(schedule.projectId && schedule.directoryId ? { directoryId: schedule.directoryId } : {}),
    });
    finishSchedule(id, {
      lastRunAt: now.toISOString(),
      lastRunSessionId: result.sessionId,
      lastError: undefined,
    }, new Date());
    return { scheduleId: id, launched: true, sessionId: result.sessionId };
  } catch (error) {
    const message = errorMessage(error);
    finishSchedule(id, { lastRunAt: now.toISOString(), lastError: message }, new Date());
    return { scheduleId: id, launched: false, error: message };
  } finally {
    activeScheduleIds.delete(id);
  }
}

export async function runDueSchedules(
  options: { sender?: ScheduledChatSender; now?: Date } = {},
): Promise<ScheduleRunResult[]> {
  const now = options.now ?? new Date();
  const due = getSchedules()
    .filter((schedule) => !activeScheduleIds.has(schedule.id)
      && (!!schedule.runningAt || (schedule.enabled && !!schedule.nextRunAt && new Date(schedule.nextRunAt).getTime() <= now.getTime())))
    .sort((a, b) => (a.nextRunAt ?? a.runningAt ?? "").localeCompare(b.nextRunAt ?? b.runningAt ?? ""));
  const results: ScheduleRunResult[] = [];
  for (const schedule of due) {
    results.push(await runSchedule(schedule.id, { requireDue: true, sender: options.sender, now }));
  }
  return results;
}

let tickInProgress = false;

/** Start the single durable scheduler polling timer from the server root. */
export function startSchedulerTimer(): NodeJS.Timeout {
  const tick = async () => {
    if (tickInProgress) return;
    tickInProgress = true;
    try {
      const results = await runDueSchedules();
      for (const result of results) if (result.error) console.error(`[scheduler] ${result.scheduleId}: ${result.error}`);
    } catch (error) {
      console.error("[scheduler] Failed to scan due schedules:", error);
    } finally {
      tickInProgress = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), SCHEDULER_INTERVAL_MS);
  timer.unref();
  return timer;
}
