import { afterEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BackgroundJobService } from "./backgroundJobService.ts";
import type { BackgroundJob } from "./backgroundJobTypes.ts";

const roots: string[] = [];
const services: BackgroundJobService[] = [];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sylph-background-jobs-test-"));
  roots.push(root);
  const cwd = path.join(root, "workspace");
  fs.mkdirSync(cwd);
  const service = new BackgroundJobService({
    baseDirectory: path.join(root, "jobs"), monitorIntervalMs: 20,
  });
  services.push(service);
  return { root, cwd, service };
}

function writeScript(cwd: string, name: string, source: string): string {
  const script = path.join(cwd, name);
  fs.writeFileSync(script, source);
  return script;
}

async function waitForTerminal(service: BackgroundJobService, sessionId: string, jobId: string): Promise<BackgroundJob> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const job = service.getJob(sessionId, jobId);
    if (job && job.status !== "running") return job;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${jobId}`);
}

afterEach(async () => {
  for (const service of services.splice(0)) {
    for (const job of service.repository.listAll()) {
      if (job.status === "running") await service.killJob(job.sessionId, job.id).catch(() => undefined);
    }
    service.stop();
  }
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("BackgroundJobService", () => {
  it("returns immediately, propagates the session environment, and captures durable output", async () => {
    const { cwd, service } = fixture();
    const script = writeScript(cwd, "environment.mjs", `console.log(JSON.stringify({ cwd: process.cwd(), scratch: process.env.SYLPH_SCRATCH_DIR }));`);
    const completed = vi.fn();
    service.start(completed);

    const job = service.startJob({
      sessionId: "session-a", name: "Environment check", command: `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`,
      cwd, environment: { SYLPH_SCRATCH_DIR: "/private/session-scratch" },
    });

    expect(job.status).toBe("running");
    const terminal = await waitForTerminal(service, "session-a", job.id);
    expect(terminal).toMatchObject({ status: "completed", exitCode: 0 });
    expect(service.readLogs("session-a", job.id).text).toContain(JSON.stringify({ cwd, scratch: "/private/session-scratch" }));
    await vi.waitFor(() => expect(completed).toHaveBeenCalledWith(expect.objectContaining({ id: job.id, status: "completed" })));
  });

  it("records nonzero exits and timeout failures", async () => {
    const { cwd, service } = fixture();
    const failure = writeScript(cwd, "failure.mjs", "console.error('bad news'); process.exit(7);");
    const hanging = writeScript(cwd, "hanging.mjs", "setInterval(() => {}, 1000);");
    service.start();

    const failed = service.startJob({
      sessionId: "session-a", name: "Failing job", command: `${JSON.stringify(process.execPath)} ${JSON.stringify(failure)}`, cwd,
    });
    const timedOut = service.startJob({
      sessionId: "session-a", name: "Timed job", command: `${JSON.stringify(process.execPath)} ${JSON.stringify(hanging)}`, cwd, timeoutSeconds: 1,
    });

    await expect(waitForTerminal(service, "session-a", failed.id)).resolves.toMatchObject({
      status: "failed", exitCode: 7, error: expect.stringContaining("code 7"),
    });
    await expect(waitForTerminal(service, "session-a", timedOut.id)).resolves.toMatchObject({
      status: "failed", error: "Timed out after 1s",
    });
  });

  it("fails jobs that exceed the durable output cap", async () => {
    const { root, cwd, service: original } = fixture();
    original.stop();
    const service = new BackgroundJobService({
      baseDirectory: path.join(root, "capped-jobs"), monitorIntervalMs: 20, maxOutputBytes: 1_024,
    });
    services.push(service);
    const noisy = writeScript(cwd, "noisy.mjs", "process.stdout.write('x'.repeat(4096));");
    service.start();

    const job = service.startJob({
      sessionId: "session-a", name: "Noisy job", command: `${JSON.stringify(process.execPath)} ${JSON.stringify(noisy)}`, cwd,
    });

    await expect(waitForTerminal(service, "session-a", job.id)).resolves.toMatchObject({
      status: "failed", error: "Output exceeded 1024 bytes",
    });
  });

  it("kills the process tree without scheduling a redundant completion", async () => {
    const { cwd, service } = fixture();
    const hanging = writeScript(cwd, "hanging.mjs", "setInterval(() => {}, 1000);");
    const completed = vi.fn();
    service.start(completed);
    const job = service.startJob({
      sessionId: "session-a", name: "Long server", command: `${JSON.stringify(process.execPath)} ${JSON.stringify(hanging)}`, cwd,
    });

    const killed = await service.killJob("session-a", job.id);

    expect(killed).toMatchObject({ status: "killed", completionSuppressedAt: expect.any(String) });
    expect(service.pendingTerminalJobs("session-a")).toEqual([]);
    expect(completed).not.toHaveBeenCalled();
  });

  it("recovers an exact worker result after its original monitor is disposed", async () => {
    const { root, cwd, service: first } = fixture();
    const script = writeScript(cwd, "delayed.mjs", "setTimeout(() => { console.log('recovered'); }, 250);");
    first.start();
    const job = first.startJob({
      sessionId: "session-a", name: "Recovered job", command: `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`, cwd,
    });
    first.stop();

    const second = new BackgroundJobService({ baseDirectory: path.join(root, "jobs"), monitorIntervalMs: 20 });
    services.push(second);
    const completed = vi.fn();
    second.start(completed);

    const terminal = await waitForTerminal(second, "session-a", job.id);
    expect(terminal).toMatchObject({ status: "completed", exitCode: 0 });
    expect(second.readLogs("session-a", job.id).text).toContain("recovered");
    await vi.waitFor(() => expect(completed).toHaveBeenCalledOnce());
  });

  it("recovers a detached worker after the launching server process exits", async () => {
    const { root, cwd, service: unused } = fixture();
    unused.stop();
    const jobsDirectory = path.join(root, "restart-jobs");
    const commandScript = writeScript(cwd, "after-restart.mjs", "setTimeout(() => console.log('survived restart'), 350);");
    const serviceUrl = new URL("./backgroundJobService.ts", import.meta.url).href;
    const launcher = writeScript(cwd, "launcher.mjs", `
      import { BackgroundJobService } from ${JSON.stringify(serviceUrl)};
      const service = new BackgroundJobService({ baseDirectory: ${JSON.stringify(jobsDirectory)}, monitorIntervalMs: 20 });
      const job = service.startJob({
        sessionId: "session-a", name: "Restart job",
        command: ${JSON.stringify(`${process.execPath} ${JSON.stringify(commandScript)}`)},
        cwd: ${JSON.stringify(cwd)}
      });
      console.log(JSON.stringify(job));
    `);

    const launched = spawnSync(process.execPath, ["--import", "tsx", launcher], {
      cwd: process.cwd(), encoding: "utf8", timeout: 5_000,
    });
    expect(launched.status, launched.stderr).toBe(0);
    const job = JSON.parse(launched.stdout.trim().split(/\r?\n/).at(-1)!) as BackgroundJob;

    const recovered = new BackgroundJobService({ baseDirectory: jobsDirectory, monitorIntervalMs: 20 });
    services.push(recovered);
    recovered.start();
    const terminal = await waitForTerminal(recovered, "session-a", job.id);

    expect(terminal).toMatchObject({ status: "completed", exitCode: 0 });
    expect(recovered.readLogs("session-a", job.id).text).toContain("survived restart");
  });

  it("keeps lookup, logs, and cancellation scoped to the owning session", async () => {
    const { cwd, service } = fixture();
    const hanging = writeScript(cwd, "hanging.mjs", "setInterval(() => {}, 1000);");
    service.start();
    const job = service.startJob({
      sessionId: "session-a", name: "Private job", command: `${JSON.stringify(process.execPath)} ${JSON.stringify(hanging)}`, cwd,
    });

    expect(service.getJob("session-b", job.id)).toBeUndefined();
    expect(() => service.readLogs("session-b", job.id)).toThrow(/not found in this session/);
    await expect(service.killJob("session-b", job.id)).rejects.toThrow(/not found in this session/);
  });

  it("does not adopt an unrelated process whose pid was recycled", () => {
    const { cwd, service } = fixture();
    const id = service.repository.createId();
    const stale: BackgroundJob = {
      id, sessionId: "session-a", name: "Stale job", command: "sleep 1", cwd,
      status: "running", startedAt: new Date().toISOString(), workerPid: process.pid, outputBytes: 0,
    };
    service.repository.prepare(stale, {
      command: stale.command, cwd, shell: "/bin/sh", shellArgs: ["-c"],
      outputPath: service.repository.outputPath(stale.sessionId, id),
      resultPath: service.repository.resultPath(stale.sessionId, id),
      runtimePath: service.repository.runtimePath(stale.sessionId, id),
      maxOutputBytes: 1024,
    });

    expect(service.hasRunningJobs("session-a")).toBe(false);
    expect(service.getJob("session-a", id)).toMatchObject({
      status: "failed", error: expect.stringContaining("did not publish a final result"),
    });
  });

  it("tracks durable completion delivery", async () => {
    const { cwd, service } = fixture();
    const script = writeScript(cwd, "done.mjs", "console.log('done');");
    service.start();
    const job = service.startJob({
      sessionId: "session-a", name: "Done job", command: `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`, cwd,
    });
    await waitForTerminal(service, "session-a", job.id);

    expect(service.pendingTerminalJobs("session-a").map((entry) => entry.id)).toEqual([job.id]);
    service.markCompletionDelivered("session-a", job.id);
    expect(service.pendingTerminalJobs("session-a")).toEqual([]);
    expect(service.getJob("session-a", job.id)?.completionDeliveredAt).toEqual(expect.any(String));
  });
});
