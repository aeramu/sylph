import {
  backgroundJobService,
} from "../../../features/backgroundJobs/backgroundJobService.ts";
import type { BackgroundJob } from "../../../features/backgroundJobs/backgroundJobTypes.ts";

const deliveries = new Set<string>();

type CompletionStore = Pick<typeof backgroundJobService, "markCompletionDelivered" | "pendingTerminalJobs">;

function key(job: Pick<BackgroundJob, "sessionId" | "id">): string {
  return `${job.sessionId}\u0000${job.id}`;
}

function escapeXml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function completionContent(jobs: BackgroundJob[]): string {
  const rows = jobs.map((job) => [
    "  <job>",
    `    <id>${job.id}</id>`,
    `    <name>${escapeXml(job.name)}</name>`,
    `    <status>${job.status}</status>`,
    ...(job.exitCode !== undefined ? [`    <exit-code>${job.exitCode ?? "unknown"}</exit-code>`] : []),
    ...(job.error ? [`    <error>${escapeXml(job.error)}</error>`] : []),
    "  </job>",
  ].join("\n"));
  return [
    "<background-jobs-completed>",
    ...rows,
    "  <guidance>Terminal state is durable. Continue the user's task using this result. Use bg_logs only if command output is needed; do not call bg_status merely to reconfirm completion.</guidance>",
    "</background-jobs-completed>",
  ].join("\n");
}

export async function deliverBackgroundJobsToRuntime(
  runtime: any,
  candidates: BackgroundJob[],
  store: CompletionStore = backgroundJobService,
): Promise<void> {
  const jobs = candidates.filter((job) =>
    job.status !== "running" && !job.completionDeliveredAt && !job.completionSuppressedAt && !deliveries.has(key(job)));
  if (jobs.length === 0) return;
  for (const job of jobs) deliveries.add(key(job));
  try {
    await runtime.session.sendCustomMessage({
      customType: "sylph.background-jobs",
      content: completionContent(jobs),
      display: true,
      details: { jobs },
    }, { deliverAs: "followUp", triggerTurn: true });
    for (const job of jobs) store.markCompletionDelivered(job.sessionId, job.id);
  } finally {
    for (const job of jobs) deliveries.delete(key(job));
  }
}

export function deliverPendingBackgroundJobsToRuntime(
  runtime: any,
  sessionId: string,
  store: CompletionStore = backgroundJobService,
): Promise<void> {
  return deliverBackgroundJobsToRuntime(runtime, store.pendingTerminalJobs(sessionId), store);
}
