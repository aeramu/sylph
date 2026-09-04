export type BackgroundJobStatus = "running" | "completed" | "failed" | "killed";

export interface BackgroundJob {
  id: string;
  sessionId: string;
  name: string;
  command: string;
  cwd: string;
  status: BackgroundJobStatus;
  startedAt: string;
  endedAt?: string;
  workerPid?: number;
  childPid?: number;
  exitCode?: number | null;
  signal?: string | null;
  error?: string;
  timeoutSeconds?: number;
  outputBytes: number;
  killRequestedAt?: string;
  completionDeliveredAt?: string;
  completionSuppressedAt?: string;
}

export interface StartBackgroundJobInput {
  sessionId: string;
  name: string;
  command: string;
  cwd: string;
  environment?: Record<string, string>;
  shellPath?: string;
  commandPrefix?: string;
  timeoutSeconds?: number;
}

export interface BackgroundJobLog {
  job: BackgroundJob;
  text: string;
  bytesRead: number;
  totalBytes: number;
  truncated: boolean;
}

export interface BackgroundJobWorkerSpec {
  command: string;
  cwd: string;
  shell: string;
  shellArgs: string[];
  outputPath: string;
  resultPath: string;
  runtimePath: string;
  timeoutSeconds?: number;
  maxOutputBytes: number;
}

export interface BackgroundJobWorkerResult {
  status: Exclude<BackgroundJobStatus, "running">;
  endedAt: string;
  childPid?: number;
  exitCode: number | null;
  signal: string | null;
  error?: string;
  outputBytes: number;
}

export interface BackgroundJobWorkerRuntime {
  childPid?: number;
}
