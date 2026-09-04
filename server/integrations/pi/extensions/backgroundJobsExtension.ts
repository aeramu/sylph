import { defineTool, formatSize, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  backgroundJobService, type BackgroundJobServicePort,
} from "../../../features/backgroundJobs/backgroundJobService.ts";
import type { BackgroundJob } from "../../../features/backgroundJobs/backgroundJobTypes.ts";

const MAX_VISIBLE_LOG_BYTES = 50 * 1024;

export interface BackgroundJobToolsOptions {
  sessionId: string;
  cwd: string;
  environment: Record<string, string>;
  shellPath?: string;
  commandPrefix?: string;
  service?: BackgroundJobServicePort;
}

function text(content: string, details?: unknown) {
  return { content: [{ type: "text" as const, text: content }], details };
}

function duration(job: BackgroundJob): string {
  const milliseconds = Math.max(0, Date.parse(job.endedAt ?? new Date().toISOString()) - Date.parse(job.startedAt));
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatJob(job: BackgroundJob, includeCommand = true): string {
  const lines = [
    `${job.id} — ${job.name}`,
    `Status: ${job.status}`,
    `Elapsed: ${duration(job)}`,
  ];
  if (includeCommand) lines.push(`Command: ${job.command}`, `Working directory: ${job.cwd}`);
  if (job.workerPid) lines.push(`Worker PID: ${job.workerPid}`);
  if (job.childPid) lines.push(`Command PID: ${job.childPid}`);
  if (job.exitCode !== undefined) lines.push(`Exit code: ${job.exitCode ?? "unknown"}`);
  if (job.signal) lines.push(`Signal: ${job.signal}`);
  if (job.error) lines.push(`Error: ${job.error}`);
  lines.push(`Output: ${formatSize(job.outputBytes)}`);
  return lines.join("\n");
}

export function createBackgroundJobTools(options: BackgroundJobToolsOptions): ToolDefinition[] {
  const service = options.service ?? backgroundJobService;

  const run = defineTool({
    name: "bg_run",
    label: "Background Run",
    description: "Start a named long-running shell command in this session's workspace and return immediately. Sylph persists output and terminal state outside the Pi runtime, then sends a completion message that wakes a follow-up turn. Commands use the same permission policy and scratch environment as bash. Output is capped at 20 MiB.",
    promptSnippet: "Start a long-running shell command without blocking the current turn",
    promptGuidelines: [
      "Use bg_run instead of bash for commands expected to run for a long time, including builds, test suites, and development servers.",
      "After bg_run returns, continue only independent useful work. Do not sleep or poll bg_status/bg_logs merely to wait; Sylph sends a completion message and wakes a follow-up turn.",
      "Give every bg_run job a short human-readable name.",
    ],
    parameters: Type.Object({
      name: Type.String({ description: "Short human-readable job name, preferably 2-6 words." }),
      command: Type.String({ description: "Shell command to run in the background." }),
      timeoutSeconds: Type.Optional(Type.Number({ minimum: 1, maximum: 604800, description: "Optional timeout in seconds; omitted means no timeout." })),
    }),
    async execute(_toolCallId, params) {
      const job = service.startJob({
        sessionId: options.sessionId,
        name: params.name,
        command: params.command,
        cwd: options.cwd,
        environment: options.environment,
        shellPath: options.shellPath,
        commandPrefix: options.commandPrefix,
        timeoutSeconds: params.timeoutSeconds,
      });
      return text(
        `Started background job ${job.name} (${job.id}).\nStatus: ${job.status}\nDo not poll merely to wait; Sylph will deliver terminal status and wake a follow-up turn.`,
        { job },
      );
    },
  });

  const status = defineTool({
    name: "bg_status",
    label: "Background Status",
    description: "Inspect one background job or list this session's recent jobs. This is a point-in-time inspection tool, not a waiting primitive.",
    promptSnippet: "Inspect point-in-time background job status without polling",
    promptGuidelines: [
      "Use bg_status only for a deliberate status request or suspected hung job; never poll it while waiting for automatic completion delivery.",
    ],
    parameters: Type.Object({
      jobId: Type.Optional(Type.String({ description: "Exact background job id. Omit to list this session's recent jobs." })),
    }),
    async execute(_toolCallId, params) {
      if (params.jobId) {
        const job = service.getJob(options.sessionId, params.jobId);
        if (!job) throw new Error(`Background job ${params.jobId} was not found in this session`);
        return text(formatJob(job), { jobs: [job] });
      }
      const jobs = service.listJobs(options.sessionId);
      if (jobs.length === 0) return text("No background jobs found for this session.", { jobs });
      return text(jobs.map((job) => formatJob(job, false)).join("\n\n"), { jobs });
    },
  });

  const logs = defineTool({
    name: "bg_logs",
    label: "Background Logs",
    description: `Read a bounded tail of one background job's output. The result is capped at ${formatSize(MAX_VISIBLE_LOG_BYTES)} and 2,000 lines. This is not a polling primitive.`,
    promptSnippet: "Read a bounded background job log tail when its output is needed",
    promptGuidelines: [
      "Use bg_logs only when background output is needed. Do not repeatedly call bg_logs to wait for completion.",
    ],
    parameters: Type.Object({
      jobId: Type.String({ description: "Exact background job id." }),
      maxBytes: Type.Optional(Type.Number({ minimum: 1, maximum: MAX_VISIBLE_LOG_BYTES, description: "Maximum trailing bytes to return; defaults to 20 KiB." })),
    }),
    async execute(_toolCallId, params) {
      const result = service.readLogs(options.sessionId, params.jobId, params.maxBytes);
      const header = `[${result.job.name} · ${result.job.status} · ${formatSize(result.bytesRead)}${result.truncated ? ` of ${formatSize(result.totalBytes)}` : ""}]`;
      const suffix = result.truncated ? "\n\n[Earlier output omitted. Call bg_logs with a larger maxBytes only if needed.]" : "";
      return text(`${header}\n${result.text || "(no output yet)"}${suffix}`, result);
    },
  });

  const kill = defineTool({
    name: "bg_kill",
    label: "Background Kill",
    description: "Stop a running background job owned by this session. Sylph terminates its process tree and suppresses a redundant completion wakeup.",
    promptSnippet: "Stop a running background job owned by this session",
    promptGuidelines: ["Use bg_kill when the user asks to stop a background job or the job is no longer needed."],
    parameters: Type.Object({ jobId: Type.String({ description: "Exact background job id." }) }),
    async execute(_toolCallId, params) {
      const job = await service.killJob(options.sessionId, params.jobId);
      return text(`Stopped background job ${job.name} (${job.id}).\nStatus: ${job.status}`, { job });
    },
  });

  return [run, status, logs, kill] as ToolDefinition[];
}
