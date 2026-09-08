import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "sylph-scheduler-test-"));
const schedulesFile = path.join(root, "schedules.json");
const bindingsFile = path.join(root, "bindings.json");
const projectsFile = path.join(root, "projects.json");

vi.mock("../../config.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../config.ts")>()),
  SYLPH_DIR: root,
  SCHEDULES_FILE: schedulesFile,
  SESSION_BINDINGS_FILE: bindingsFile,
  PROJECTS_FILE: projectsFile,
}));

const scheduler = await import("./schedulerService.ts");
const repository = await import("./schedulerRepository.ts");
const { runDueSchedules } = await import("./schedulerRunner.ts");
const bindings = await import("../sessions/workspace/workspaceBindingRepository.ts");
const { schedulerExtension } = await import("../../integrations/pi/extensions/schedulerExtension.ts");

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
beforeEach(() => {
  fs.rmSync(schedulesFile, { force: true });
  fs.rmSync(bindingsFile, { force: true });
  fs.rmSync(projectsFile, { force: true });
});

function tomorrow(): string {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
}

describe("scheduler service", () => {
  it("persists the creating chat ownership without exposing a target parameter", () => {
    const schedule = scheduler.createSchedule({
      name: "Review CI",
      prompt: "Review the latest CI failures.",
      kind: "cron",
      cron: "0 8 * * 1-5",
      timezone: "Europe/London",
    }, { projectId: "project-1", directoryId: "frontend" });

    expect(schedule).toMatchObject({
      projectId: "project-1",
      directoryId: "frontend",
      kind: "cron",
      enabled: true,
    });
    expect(schedule.nextRunAt).toBeTruthy();
    expect(repository.getSchedule(schedule.id)).toMatchObject({ projectId: "project-1", directoryId: "frontend" });
  });

  it("lists schedules across projects for the management screen", () => {
    scheduler.createSchedule({
      name: "Project schedule", prompt: "Review the project.", kind: "once", runAt: tomorrow(), timezone: "UTC",
    }, { projectId: "project-1", directoryId: "frontend" });
    scheduler.createSchedule({
      name: "Projectless schedule", prompt: "Prepare a digest.", kind: "once", runAt: tomorrow(), timezone: "UTC",
    });

    expect(scheduler.listAllSchedules().map((schedule) => schedule.name).sort()).toEqual([
      "Project schedule", "Projectless schedule",
    ]);
    expect(scheduler.listSchedules("project-1")).toHaveLength(1);
    expect(scheduler.listSchedules(undefined)).toHaveLength(1);
  });

  it("keeps projectless schedules projectless", () => {
    const schedule = scheduler.createSchedule({
      name: "Reminder",
      prompt: "Prepare a morning summary.",
      kind: "once",
      runAt: tomorrow(),
      timezone: "UTC",
    });

    expect(schedule).not.toHaveProperty("projectId");
    expect(schedule).not.toHaveProperty("directoryId");
    expect(scheduler.listSchedules(undefined)).toHaveLength(1);
    expect(scheduler.listSchedules("project-1")).toHaveLength(0);
  });

  it("rejects malformed timing instead of guessing", () => {
    expect(() => scheduler.createSchedule({
      name: "Bad cron", prompt: "Do something", kind: "cron", cron: "every day", timezone: "UTC",
    })).toThrow(/five fields/);
    expect(() => scheduler.createSchedule({
      name: "Bad zone", prompt: "Do something", kind: "once", runAt: tomorrow(), timezone: "Moon/Sea",
    })).toThrow(/IANA timezone/);
  });

  it("claims a due one-time schedule once and launches a new projectless chat", async () => {
    const schedule = scheduler.createSchedule({
      name: "Summary", prompt: "Create the summary.", kind: "once", runAt: tomorrow(), timezone: "UTC",
    });
    const sender = vi.fn().mockResolvedValue({ success: true, sessionId: "session-run-1" });
    const runAt = new Date(new Date(schedule.runAt!).getTime() + 1000);

    const first = await runDueSchedules({ sender, now: runAt });
    const second = await runDueSchedules({ sender, now: runAt });

    expect(first).toEqual([{ scheduleId: schedule.id, launched: true, sessionId: "session-run-1" }]);
    expect(second).toEqual([]);
    expect(sender).toHaveBeenCalledWith({ prompt: "Create the summary." });
    expect(repository.getSchedule(schedule.id)).toMatchObject({
      enabled: false,
      lastRunSessionId: "session-run-1",
    });
    expect(repository.getSchedule(schedule.id)).not.toHaveProperty("runningAt");
  });

  it("passes inherited project ownership into the scheduled chat", async () => {
    fs.writeFileSync(projectsFile, JSON.stringify([{
      id: "project-2",
      name: "Product",
      path: root,
      directories: [{ id: "backend", name: "Backend", path: root }],
    }]));
    const schedule = scheduler.createSchedule({
      name: "Backend check", prompt: "Check the backend.", kind: "once", runAt: tomorrow(), timezone: "UTC",
    }, { projectId: "project-2", directoryId: "backend" });
    const sender = vi.fn().mockResolvedValue({ success: true, sessionId: "session-project-run" });

    await runDueSchedules({ sender, now: new Date(new Date(schedule.runAt!).getTime() + 1000) });

    expect(sender).toHaveBeenCalledWith({
      prompt: "Check the backend.", projectId: "project-2", directoryId: "backend",
    });
  });

  it("automatically inherits ownership in the AI create_schedule tool", async () => {
    bindings.saveSessionBinding({
      sessionId: "chat-1",
      workspaceKind: "directories",
      projectId: "project-7",
      directoryId: "api",
      cwd: root,
    });
    const tools = new Map<string, any>();
    schedulerExtension({ registerTool: (tool: any) => tools.set(tool.name, tool) } as any);

    expect(Array.from(tools.keys())).toEqual([
      "create_schedule", "list_schedules", "update_schedule", "delete_schedule",
    ]);
    const result = await tools.get("create_schedule").execute("call-1", {
      name: "API check",
      prompt: "Run the API checks and summarize failures.",
      kind: "once",
      runAt: tomorrow(),
      timezone: "UTC",
    }, undefined, undefined, { sessionManager: { getSessionId: () => "chat-1" } });

    expect(result.details.schedule).toMatchObject({ projectId: "project-7", directoryId: "api" });
    expect(tools.get("create_schedule").parameters.properties).not.toHaveProperty("projectId");
    expect(tools.get("create_schedule").parameters.properties).not.toHaveProperty("directoryId");
  });
});

it("persists an edited model and passes it to scheduled runs", async () => {
  const schedule = scheduler.createSchedule({ name: "Model test", prompt: "Summarize", kind: "once", runAt: tomorrow(), timezone: "UTC" });
  scheduler.updateSchedule(schedule.id, { modelId: "provider/model" });
  scheduler.updateSchedule(schedule.id, { name: "Renamed" });
  expect(repository.getSchedule(schedule.id)?.modelId).toBe("provider/model");
  const sender = vi.fn().mockResolvedValue({ success: true, sessionId: "result" });
  await runDueSchedules({ sender, now: new Date(new Date(schedule.runAt!).getTime() + 1000) });
  expect(sender).toHaveBeenCalledWith({ prompt: "Summarize", modelId: "provider/model" });
  scheduler.updateSchedule(schedule.id, { modelId: null });
  expect(repository.getSchedule(schedule.id)?.modelId).toBeUndefined();
  expect(() => scheduler.updateSchedule(schedule.id, { modelId: 42 })).toThrow(/modelId/);
});
