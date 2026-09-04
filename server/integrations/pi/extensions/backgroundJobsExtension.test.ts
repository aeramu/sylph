import { describe, expect, it, vi } from "vitest";
import type { BackgroundJobServicePort } from "../../../features/backgroundJobs/backgroundJobService.ts";
import type { BackgroundJob } from "../../../features/backgroundJobs/backgroundJobTypes.ts";
import { createBackgroundJobTools } from "./backgroundJobsExtension.ts";

const job: BackgroundJob = {
  id: "bg-00000000-0000-4000-8000-000000000001",
  sessionId: "session-a",
  name: "Test suite",
  command: "npm test",
  cwd: "/workspace",
  status: "running",
  startedAt: new Date().toISOString(),
  outputBytes: 0,
};

function harness() {
  const service: BackgroundJobServicePort = {
    startJob: vi.fn(() => job),
    listJobs: vi.fn(() => [job]),
    getJob: vi.fn(() => job),
    readLogs: vi.fn(() => ({ job, text: "tests passed", bytesRead: 12, totalBytes: 12, truncated: false })),
    killJob: vi.fn(async () => ({ ...job, status: "killed" as const })),
  };
  const tools = createBackgroundJobTools({
    sessionId: "session-a",
    cwd: "/workspace",
    environment: { SYLPH_SCRATCH_DIR: "/scratch/session-a" },
    shellPath: "/bin/bash",
    commandPrefix: "source ~/.profile",
    service,
  });
  const tool = (name: string) => tools.find((entry) => entry.name === name)!;
  const execute = (name: string, params: any) => tool(name).execute("call", params, new AbortController().signal, undefined, {} as any);
  return { service, tools, execute };
}

describe("background job Pi tools", () => {
  it("registers the focused background job surface", () => {
    expect(harness().tools.map((tool) => tool.name)).toEqual(["bg_run", "bg_status", "bg_logs", "bg_kill"]);
  });

  it("starts jobs with the session workspace, scratch environment, and shell settings", async () => {
    const { service, execute } = harness();
    const result = await execute("bg_run", { name: "Test suite", command: "npm test", timeoutSeconds: 600 });

    expect(service.startJob).toHaveBeenCalledWith({
      sessionId: "session-a",
      name: "Test suite",
      command: "npm test",
      cwd: "/workspace",
      environment: { SYLPH_SCRATCH_DIR: "/scratch/session-a" },
      shellPath: "/bin/bash",
      commandPrefix: "source ~/.profile",
      timeoutSeconds: 600,
    });
    expect((result.content[0] as any).text).toContain("Do not poll");
  });

  it("keeps status, log, and kill operations session-scoped", async () => {
    const { service, execute } = harness();

    await execute("bg_status", { jobId: job.id });
    await execute("bg_logs", { jobId: job.id, maxBytes: 1000 });
    await execute("bg_kill", { jobId: job.id });

    expect(service.getJob).toHaveBeenCalledWith("session-a", job.id);
    expect(service.readLogs).toHaveBeenCalledWith("session-a", job.id, 1000);
    expect(service.killJob).toHaveBeenCalledWith("session-a", job.id);
  });
});
