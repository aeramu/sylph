import { describe, expect, it, vi } from "vitest";
import type { BackgroundJob } from "../../../features/backgroundJobs/backgroundJobTypes.ts";
import { deliverBackgroundJobsToRuntime, deliverPendingBackgroundJobsToRuntime } from "./backgroundJobDelivery.ts";

function job(id: string, overrides: Partial<BackgroundJob> = {}): BackgroundJob {
  return {
    id,
    sessionId: "session-a",
    name: `Job ${id}`,
    command: "npm test",
    cwd: "/workspace",
    status: "completed",
    startedAt: new Date(0).toISOString(),
    endedAt: new Date(1_000).toISOString(),
    exitCode: 0,
    outputBytes: 100,
    ...overrides,
  };
}

function store(pending: BackgroundJob[] = []) {
  return {
    pendingTerminalJobs: vi.fn(() => pending),
    markCompletionDelivered: vi.fn(),
  };
}

describe("background job completion delivery", () => {
  it("batches durable terminal jobs into one follow-up wakeup", async () => {
    const sendCustomMessage = vi.fn(async () => undefined);
    const runtime = { session: { sendCustomMessage } };
    const completionStore = store();
    const jobs = [job("bg-1"), job("bg-2", { status: "failed", exitCode: 1, error: "failed" })];

    await deliverBackgroundJobsToRuntime(runtime, jobs, completionStore as any);

    expect(sendCustomMessage).toHaveBeenCalledOnce();
    expect(sendCustomMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        customType: "sylph.background-jobs",
        display: true,
        content: expect.stringContaining("<background-jobs-completed>"),
        details: { jobs },
      }),
      { deliverAs: "followUp", triggerTurn: true },
    );
    expect(completionStore.markCompletionDelivered).toHaveBeenCalledTimes(2);
  });

  it("reads pending jobs from the session-scoped store", async () => {
    const pending = [job("bg-3")];
    const completionStore = store(pending);
    const runtime = { session: { sendCustomMessage: vi.fn(async () => undefined) } };

    await deliverPendingBackgroundJobsToRuntime(runtime, "session-a", completionStore as any);

    expect(completionStore.pendingTerminalJobs).toHaveBeenCalledWith("session-a");
    expect(completionStore.markCompletionDelivered).toHaveBeenCalledWith("session-a", "bg-3");
  });

  it("does not mark failed handoffs delivered and allows retry", async () => {
    const sendCustomMessage = vi.fn()
      .mockRejectedValueOnce(new Error("runtime unavailable"))
      .mockResolvedValueOnce(undefined);
    const runtime = { session: { sendCustomMessage } };
    const completionStore = store();
    const completed = job("bg-4");

    await expect(deliverBackgroundJobsToRuntime(runtime, [completed], completionStore as any)).rejects.toThrow("runtime unavailable");
    expect(completionStore.markCompletionDelivered).not.toHaveBeenCalled();

    await deliverBackgroundJobsToRuntime(runtime, [completed], completionStore as any);
    expect(sendCustomMessage).toHaveBeenCalledTimes(2);
    expect(completionStore.markCompletionDelivered).toHaveBeenCalledWith("session-a", "bg-4");
  });
});
