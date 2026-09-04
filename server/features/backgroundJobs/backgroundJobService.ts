import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BACKGROUND_JOBS_DIR } from "../../config.ts";
import { BackgroundJobRepository } from "./backgroundJobRepository.ts";
import type {
  BackgroundJob, BackgroundJobLog, BackgroundJobWorkerResult, BackgroundJobWorkerSpec, StartBackgroundJobInput,
} from "./backgroundJobTypes.ts";

const DEFAULT_MAX_OUTPUT_BYTES = 20 * 1024 * 1024;
const DEFAULT_LOG_BYTES = 20 * 1024;
const MAX_LOG_BYTES = 50 * 1024;
const MAX_LOG_LINES = 2_000;
const DEFAULT_MONITOR_INTERVAL_MS = 250;
const DEFAULT_TERMINAL_RETENTION = 100;
const WORKER_PATH = fileURLToPath(new URL("./backgroundJobWorker.mjs", import.meta.url));

type TerminalListener = (job: BackgroundJob) => void | Promise<void>;

export interface BackgroundJobServiceOptions {
  baseDirectory?: string;
  workerPath?: string;
  monitorIntervalMs?: number;
  maxOutputBytes?: number;
  terminalRetention?: number;
  now?: () => Date;
}

export interface BackgroundJobServicePort {
  startJob(input: StartBackgroundJobInput): BackgroundJob;
  listJobs(sessionId: string): BackgroundJob[];
  getJob(sessionId: string, jobId: string): BackgroundJob | undefined;
  readLogs(sessionId: string, jobId: string, maxBytes?: number): BackgroundJobLog;
  killJob(sessionId: string, jobId: string): Promise<BackgroundJob>;
}

function positiveInteger(value: unknown, maximum: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.min(maximum, Math.floor(value));
}

function processExists(pid: number | undefined): boolean {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function processCommand(pid: number): string | undefined {
  if (process.platform === "linux") {
    try { return fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\u0000", " "); } catch { return undefined; }
  }
  if (process.platform === "win32") return undefined;
  const result = spawnSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8", windowsHide: true });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

function shellInvocation(shellPath?: string): { shell: string; args: string[] } {
  if (process.platform === "win32") {
    return { shell: shellPath?.trim() || process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c"] };
  }
  return { shell: shellPath?.trim() || process.env.SHELL || "/bin/bash", args: ["-lc"] };
}

function compactName(value: string): string {
  const name = value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  if (!name) throw new Error("Background job name is required");
  return name.slice(0, 100);
}

function validatedInput(input: StartBackgroundJobInput): StartBackgroundJobInput {
  if (!input.sessionId || path.basename(input.sessionId) !== input.sessionId) throw new Error("Invalid background job session id");
  if (typeof input.command !== "string" || !input.command.trim()) throw new Error("Background job command is required");
  if (input.command.length > 64 * 1024) throw new Error("Background job command is too long");
  let stat: fs.Stats;
  try { stat = fs.statSync(input.cwd); } catch { throw new Error("Background job working directory does not exist"); }
  if (!stat.isDirectory()) throw new Error("Background job working directory is not a directory");
  return {
    ...input,
    name: compactName(input.name),
    command: input.command.trim(),
    cwd: fs.realpathSync(input.cwd),
    timeoutSeconds: positiveInteger(input.timeoutSeconds, 7 * 24 * 60 * 60),
  };
}

export class BackgroundJobService implements BackgroundJobServicePort {
  readonly repository: BackgroundJobRepository;
  private readonly workerPath: string;
  private readonly monitorIntervalMs: number;
  private readonly maxOutputBytes: number;
  private readonly terminalRetention: number;
  private readonly now: () => Date;
  private readonly monitored = new Set<string>();
  private readonly listeners = new Set<TerminalListener>();
  private readonly notifying = new Set<string>();
  private monitorTimer?: NodeJS.Timeout;
  private started = false;

  constructor(options: BackgroundJobServiceOptions = {}) {
    this.repository = new BackgroundJobRepository(options.baseDirectory ?? BACKGROUND_JOBS_DIR);
    this.workerPath = options.workerPath ?? WORKER_PATH;
    this.monitorIntervalMs = options.monitorIntervalMs ?? DEFAULT_MONITOR_INTERVAL_MS;
    this.maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    this.terminalRetention = options.terminalRetention ?? DEFAULT_TERMINAL_RETENTION;
    this.now = options.now ?? (() => new Date());
  }

  start(listener?: TerminalListener): void {
    if (listener) this.listeners.add(listener);
    if (this.started) {
      this.notifyPending();
      return;
    }
    this.started = true;
    for (const job of this.repository.listAll()) {
      if (job.status === "running") this.monitored.add(this.jobKey(job));
      else this.notifyTerminal(job);
    }
    this.sweep();
    this.ensureMonitor();
  }

  stop(): void {
    if (this.monitorTimer) clearInterval(this.monitorTimer);
    this.monitorTimer = undefined;
    this.monitored.clear();
    this.started = false;
  }

  onTerminal(listener: TerminalListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  startJob(rawInput: StartBackgroundJobInput): BackgroundJob {
    const input = validatedInput(rawInput);
    const id = this.repository.createId();
    const startedAt = this.now().toISOString();
    const invocation = shellInvocation(input.shellPath);
    const command = input.commandPrefix?.trim()
      ? `${input.commandPrefix.trim()}\n${input.command}`
      : input.command;
    const job: BackgroundJob = {
      id,
      sessionId: input.sessionId,
      name: input.name,
      command: input.command,
      cwd: input.cwd,
      status: "running",
      startedAt,
      timeoutSeconds: input.timeoutSeconds,
      outputBytes: 0,
    };
    const spec: BackgroundJobWorkerSpec = {
      command,
      cwd: input.cwd,
      shell: invocation.shell,
      shellArgs: invocation.args,
      outputPath: this.repository.outputPath(input.sessionId, id),
      resultPath: this.repository.resultPath(input.sessionId, id),
      runtimePath: this.repository.runtimePath(input.sessionId, id),
      timeoutSeconds: input.timeoutSeconds,
      maxOutputBytes: this.maxOutputBytes,
    };
    this.repository.prepare(job, spec);

    try {
      const worker = spawn(process.execPath, [this.workerPath, this.repository.specPath(input.sessionId, id)], {
        cwd: input.cwd,
        detached: true,
        env: { ...process.env, ...(input.environment ?? {}), PI_SESSION_ID: input.sessionId },
        stdio: "ignore",
        windowsHide: true,
      });
      worker.unref();
      job.workerPid = worker.pid;
      this.repository.write(job);
      worker.once("error", (error) => {
        this.finalize(job, {
          status: "failed", endedAt: this.now().toISOString(), exitCode: null, signal: null,
          error: `Background worker failed to start: ${error.message}`, outputBytes: this.outputSize(job),
        });
      });
      this.monitored.add(this.jobKey(job));
      this.ensureMonitor();
      this.pruneSession(input.sessionId);
      return job;
    } catch (error) {
      const failed = this.finalize(job, {
        status: "failed",
        endedAt: this.now().toISOString(),
        exitCode: null,
        signal: null,
        error: `Could not launch background worker: ${error instanceof Error ? error.message : String(error)}`,
        outputBytes: 0,
      });
      return failed;
    }
  }

  listJobs(sessionId: string): BackgroundJob[] {
    return this.repository.listSession(sessionId).slice(0, 20).map((job) => {
      const current = job.status === "running" ? this.reconcile(job) : job;
      return { ...current, outputBytes: this.outputSize(current) };
    });
  }

  hasRunningJobs(sessionId: string): boolean {
    for (const job of this.repository.listSession(sessionId)) {
      if (job.status === "running") this.reconcile(job);
    }
    return this.repository.listSession(sessionId).some((job) => job.status === "running");
  }

  getJob(sessionId: string, jobId: string): BackgroundJob | undefined {
    const job = this.repository.read(sessionId, jobId);
    if (!job) return undefined;
    const current = job.status === "running" ? this.reconcile(job) : job;
    return { ...current, outputBytes: this.outputSize(current) };
  }

  readLogs(sessionId: string, jobId: string, requestedBytes = DEFAULT_LOG_BYTES): BackgroundJobLog {
    const job = this.getJob(sessionId, jobId);
    if (!job) throw new Error(`Background job ${jobId} was not found in this session`);
    const outputPath = this.repository.outputPath(sessionId, jobId);
    let totalBytes = 0;
    try { totalBytes = fs.statSync(outputPath).size; } catch { /* empty/not created yet */ }
    const limit = positiveInteger(requestedBytes, MAX_LOG_BYTES) ?? DEFAULT_LOG_BYTES;
    const bytesToRead = Math.min(totalBytes, limit);
    let text = "";
    if (bytesToRead > 0) {
      const descriptor = fs.openSync(outputPath, "r");
      try {
        const buffer = Buffer.alloc(bytesToRead);
        const read = fs.readSync(descriptor, buffer, 0, bytesToRead, totalBytes - bytesToRead);
        text = buffer.subarray(0, read).toString("utf8");
      } finally {
        fs.closeSync(descriptor);
      }
    }
    const lines = text.split(/\r?\n/);
    if (lines.length > MAX_LOG_LINES) text = lines.slice(-MAX_LOG_LINES).join("\n");
    const truncated = totalBytes > bytesToRead || lines.length > MAX_LOG_LINES;
    return {
      job: { ...job, outputBytes: totalBytes },
      text,
      bytesRead: Buffer.byteLength(text),
      totalBytes,
      truncated,
    };
  }

  async killJob(sessionId: string, jobId: string): Promise<BackgroundJob> {
    let job = this.getJob(sessionId, jobId);
    if (!job) throw new Error(`Background job ${jobId} was not found in this session`);
    if (job.status !== "running") throw new Error(`Background job ${jobId} is already ${job.status}`);
    job.killRequestedAt = this.now().toISOString();
    this.repository.write(job);
    this.signalWorker(job, false);

    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      this.reconcile(job);
      job = this.repository.read(sessionId, jobId) ?? job;
      if (job.status !== "running") return job;
    }

    this.signalWorker(job, true);
    const result = this.repository.readResult(job);
    if (result) return this.finalize(job, result);
    return this.finalize(job, {
      status: "killed",
      endedAt: this.now().toISOString(),
      childPid: this.repository.readRuntime(job)?.childPid,
      exitCode: null,
      signal: "SIGKILL",
      error: "Background worker did not stop gracefully and was force-killed",
      outputBytes: this.outputSize(job),
    });
  }

  async removeSessionJobs(sessionId: string): Promise<void> {
    const running = this.repository.listSession(sessionId).filter((job) => job.status === "running");
    const stopped = await Promise.allSettled(running.map((job) => this.killJob(sessionId, job.id)));
    const failures = stopped.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
    if (failures.length > 0) {
      throw new AggregateError(failures, "Could not stop every background job; session job records were preserved");
    }
    for (const job of running) this.monitored.delete(this.jobKey(job));
    this.repository.removeSession(sessionId);
  }

  pendingTerminalJobs(sessionId: string): BackgroundJob[] {
    return this.repository.listSession(sessionId)
      .filter((job) => job.status !== "running" && !job.completionDeliveredAt && !job.completionSuppressedAt)
      .sort((left, right) => (left.endedAt ?? left.startedAt).localeCompare(right.endedAt ?? right.startedAt));
  }

  markCompletionDelivered(sessionId: string, jobId: string): void {
    const job = this.repository.read(sessionId, jobId);
    if (!job || job.status === "running" || job.completionDeliveredAt) return;
    job.completionDeliveredAt = this.now().toISOString();
    this.repository.write(job);
  }

  private ensureMonitor(): void {
    if (this.monitorTimer || this.monitored.size === 0) return;
    this.monitorTimer = setInterval(() => this.sweep(), this.monitorIntervalMs);
    this.monitorTimer.unref();
  }

  private sweep(): void {
    for (const key of [...this.monitored]) {
      const separator = key.indexOf("\u0000");
      const sessionId = key.slice(0, separator);
      const jobId = key.slice(separator + 1);
      const job = this.repository.read(sessionId, jobId);
      if (!job || job.status !== "running") {
        this.monitored.delete(key);
        continue;
      }
      this.reconcile(job);
    }
    if (this.monitored.size === 0 && this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = undefined;
    }
  }

  private reconcile(job: BackgroundJob): BackgroundJob {
    const result = this.repository.readResult(job);
    if (result) return this.finalize(job, result);
    const runtime = this.repository.readRuntime(job);
    if (runtime?.childPid && job.childPid !== runtime.childPid) {
      job.childPid = runtime.childPid;
      this.repository.write(job);
    }
    if (this.workerIsRunning(job)) return job;
    // The worker atomically publishes result.json before exiting. Read once more
    // after the liveness check to close the tiny exit/publication race.
    const afterExit = this.repository.readResult(job);
    if (afterExit) return this.finalize(job, afterExit);
    return this.finalize(job, {
      status: job.killRequestedAt ? "killed" : "failed",
      endedAt: this.now().toISOString(),
      childPid: runtime?.childPid,
      exitCode: null,
      signal: null,
      error: job.killRequestedAt
        ? "Background worker stopped before publishing its final result"
        : "Background worker is no longer running and did not publish a final result",
      outputBytes: this.outputSize(job),
    });
  }

  private finalize(job: BackgroundJob, result: BackgroundJobWorkerResult): BackgroundJob {
    const current = this.repository.read(job.sessionId, job.id) ?? job;
    if (current.status !== "running") return current;
    const terminal: BackgroundJob = {
      ...current,
      status: result.status,
      endedAt: result.endedAt,
      childPid: result.childPid ?? current.childPid,
      exitCode: result.exitCode,
      signal: result.signal,
      error: result.error,
      outputBytes: result.outputBytes,
      ...(result.status === "killed" ? { completionSuppressedAt: this.now().toISOString() } : {}),
    };
    this.repository.write(terminal);
    this.monitored.delete(this.jobKey(terminal));
    this.notifyTerminal(terminal);
    return terminal;
  }

  private notifyPending(): void {
    for (const job of this.repository.listAll()) if (job.status !== "running") this.notifyTerminal(job);
  }

  private notifyTerminal(job: BackgroundJob): void {
    if (job.status === "running" || job.completionDeliveredAt || job.completionSuppressedAt || this.listeners.size === 0) return;
    const key = this.jobKey(job);
    if (this.notifying.has(key)) return;
    this.notifying.add(key);
    void Promise.all([...this.listeners].map((listener) => Promise.resolve(listener(job))))
      .catch((error) => console.error(`[background-jobs] completion delivery failed for ${job.id}:`, error))
      .finally(() => this.notifying.delete(key));
  }

  private workerIsRunning(job: BackgroundJob): boolean {
    if (!processExists(job.workerPid)) return false;
    if (process.platform === "win32") return true;
    const command = processCommand(job.workerPid!);
    return !!command
      && command.includes(this.workerPath)
      && command.includes(this.repository.specPath(job.sessionId, job.id));
  }

  private signalWorker(job: BackgroundJob, force: boolean): void {
    if (!this.workerIsRunning(job)) return;
    const childPid = this.repository.readRuntime(job)?.childPid;
    if (process.platform === "win32") {
      for (const pid of [childPid, job.workerPid].filter((value): value is number => !!value)) {
        spawnSync("taskkill.exe", ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])], { stdio: "ignore", windowsHide: true });
      }
      return;
    }
    if (childPid && force) {
      try { process.kill(-childPid, "SIGKILL"); } catch { /* already stopped */ }
    }
    if (job.workerPid) {
      try { process.kill(job.workerPid, force ? "SIGKILL" : "SIGTERM"); } catch { /* reconcile records terminal state */ }
    }
  }

  private outputSize(job: BackgroundJob): number {
    try { return fs.statSync(this.repository.outputPath(job.sessionId, job.id)).size; } catch { return 0; }
  }

  private jobKey(job: Pick<BackgroundJob, "sessionId" | "id">): string {
    return `${job.sessionId}\u0000${job.id}`;
  }

  private pruneSession(sessionId: string): void {
    const terminal = this.repository.listSession(sessionId).filter((job) =>
      job.status !== "running" && (!!job.completionDeliveredAt || !!job.completionSuppressedAt));
    for (const job of terminal.slice(this.terminalRetention)) {
      fs.rmSync(this.repository.jobDirectory(sessionId, job.id), { recursive: true, force: true });
    }
  }
}

export const backgroundJobService = new BackgroundJobService();

export function startBackgroundJobService(listener?: TerminalListener): void {
  backgroundJobService.start(listener);
}

export function hasRunningBackgroundJobs(sessionId: string): boolean {
  return backgroundJobService.hasRunningJobs(sessionId);
}

export function removeBackgroundJobsForSession(sessionId: string): Promise<void> {
  return backgroundJobService.removeSessionJobs(sessionId);
}
