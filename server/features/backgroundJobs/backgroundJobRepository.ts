import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  BackgroundJob, BackgroundJobWorkerResult, BackgroundJobWorkerRuntime, BackgroundJobWorkerSpec,
} from "./backgroundJobTypes.ts";

const JOB_ID_PATTERN = /^bg-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TERMINAL_STATUSES = new Set(["completed", "failed", "killed"]);

function privateDirectory(directory: string): void {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(directory, 0o700); } catch { /* best effort on non-Unix filesystems */ }
}

function atomicJsonWrite(filePath: string, value: unknown): void {
  privateDirectory(path.dirname(filePath));
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, filePath);
    try { fs.chmodSync(filePath, 0o600); } catch { /* best effort on non-Unix filesystems */ }
  } finally {
    try { fs.rmSync(temporary, { force: true }); } catch { /* best effort */ }
  }
}

function readJson(filePath: string): unknown {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return undefined; }
}

function sessionDirectoryName(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("hex");
}

function normalizedJob(value: unknown): BackgroundJob | undefined {
  if (!value || typeof value !== "object") return undefined;
  const job = value as Partial<BackgroundJob>;
  if (!JOB_ID_PATTERN.test(String(job.id ?? ""))
      || typeof job.sessionId !== "string" || !job.sessionId
      || typeof job.name !== "string" || typeof job.command !== "string" || typeof job.cwd !== "string"
      || (job.status !== "running" && !TERMINAL_STATUSES.has(String(job.status)))) return undefined;
  return {
    ...job,
    id: job.id!, sessionId: job.sessionId, name: job.name, command: job.command, cwd: job.cwd,
    status: job.status!, startedAt: typeof job.startedAt === "string" ? job.startedAt : new Date(0).toISOString(),
    outputBytes: Number.isFinite(job.outputBytes) ? Number(job.outputBytes) : 0,
  } as BackgroundJob;
}

export class BackgroundJobRepository {
  readonly baseDirectory: string;

  constructor(baseDirectory: string) {
    this.baseDirectory = baseDirectory;
  }

  createId(): string {
    return `bg-${randomUUID()}`;
  }

  sessionDirectory(sessionId: string): string {
    return path.join(this.baseDirectory, sessionDirectoryName(sessionId));
  }

  jobDirectory(sessionId: string, jobId: string): string {
    if (!JOB_ID_PATTERN.test(jobId)) throw new Error("Invalid background job id");
    return path.join(this.sessionDirectory(sessionId), jobId);
  }

  metadataPath(sessionId: string, jobId: string): string {
    return path.join(this.jobDirectory(sessionId, jobId), "job.json");
  }

  outputPath(sessionId: string, jobId: string): string {
    return path.join(this.jobDirectory(sessionId, jobId), "output.log");
  }

  resultPath(sessionId: string, jobId: string): string {
    return path.join(this.jobDirectory(sessionId, jobId), "result.json");
  }

  runtimePath(sessionId: string, jobId: string): string {
    return path.join(this.jobDirectory(sessionId, jobId), "runtime.json");
  }

  specPath(sessionId: string, jobId: string): string {
    return path.join(this.jobDirectory(sessionId, jobId), "spec.json");
  }

  prepare(job: BackgroundJob, spec: BackgroundJobWorkerSpec): void {
    privateDirectory(this.jobDirectory(job.sessionId, job.id));
    atomicJsonWrite(this.specPath(job.sessionId, job.id), spec);
    this.write(job);
  }

  read(sessionId: string, jobId: string): BackgroundJob | undefined {
    const job = normalizedJob(readJson(this.metadataPath(sessionId, jobId)));
    return job?.sessionId === sessionId && job.id === jobId ? job : undefined;
  }

  write(job: BackgroundJob): void {
    atomicJsonWrite(this.metadataPath(job.sessionId, job.id), job);
  }

  readResult(job: Pick<BackgroundJob, "sessionId" | "id">): BackgroundJobWorkerResult | undefined {
    const value = readJson(this.resultPath(job.sessionId, job.id));
    if (!value || typeof value !== "object") return undefined;
    const result = value as Partial<BackgroundJobWorkerResult>;
    if (!TERMINAL_STATUSES.has(String(result.status)) || typeof result.endedAt !== "string") return undefined;
    return {
      status: result.status as BackgroundJobWorkerResult["status"],
      endedAt: result.endedAt,
      childPid: Number.isInteger(result.childPid) ? result.childPid : undefined,
      exitCode: Number.isInteger(result.exitCode) ? Number(result.exitCode) : null,
      signal: typeof result.signal === "string" ? result.signal : null,
      error: typeof result.error === "string" ? result.error : undefined,
      outputBytes: Number.isFinite(result.outputBytes) ? Number(result.outputBytes) : 0,
    };
  }

  readRuntime(job: Pick<BackgroundJob, "sessionId" | "id">): BackgroundJobWorkerRuntime | undefined {
    const value = readJson(this.runtimePath(job.sessionId, job.id));
    if (!value || typeof value !== "object") return undefined;
    const childPid = (value as BackgroundJobWorkerRuntime).childPid;
    return Number.isInteger(childPid) && Number(childPid) > 0 ? { childPid: Number(childPid) } : undefined;
  }

  listSession(sessionId: string): BackgroundJob[] {
    let ids: string[];
    try { ids = fs.readdirSync(this.sessionDirectory(sessionId)); } catch { return []; }
    return ids
      .filter((id) => JOB_ID_PATTERN.test(id))
      .map((id) => this.read(sessionId, id))
      .filter((job): job is BackgroundJob => !!job)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }

  listAll(): BackgroundJob[] {
    let sessionDirectories: string[];
    try { sessionDirectories = fs.readdirSync(this.baseDirectory); } catch { return []; }
    const jobs: BackgroundJob[] = [];
    for (const directory of sessionDirectories) {
      let ids: string[];
      const sessionPath = path.join(this.baseDirectory, directory);
      try { ids = fs.readdirSync(sessionPath); } catch { continue; }
      for (const id of ids) {
        if (!JOB_ID_PATTERN.test(id)) continue;
        const job = normalizedJob(readJson(path.join(sessionPath, id, "job.json")));
        if (job && sessionDirectoryName(job.sessionId) === directory && job.id === id) jobs.push(job);
      }
    }
    return jobs.sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }

  removeSession(sessionId: string): void {
    fs.rmSync(this.sessionDirectory(sessionId), { recursive: true, force: true });
  }
}
