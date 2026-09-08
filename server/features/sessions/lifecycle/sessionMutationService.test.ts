import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { SessionManager } from "../../../integrations/pi/sessionSdk.ts";
import type { SessionBinding } from "../workspace/workspaceTypes.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "sylph-session-mutation-test-"));
const projectsFile = path.join(root, "projects.json");
const bindingsFile = path.join(root, "bindings.json");
const sessionsRoot = path.join(root, "sessions");

vi.mock("../../../config.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../config.ts")>()),
  SYLPH_DIR: root,
  PROJECTS_FILE: projectsFile,
  SESSION_BINDINGS_FILE: bindingsFile,
  SCRATCH_DIR: path.join(root, "scratch"),
}));

const projects = await import("../../projects/projectRepository.ts");
const bindings = await import("../workspace/workspaceBindingRepository.ts");
const metadata = await import("../workspace/piSessionMetadata.ts");
const { deleteSession, moveSessionToProject, renameSession, setSessionModel, setSessionPermissionMode } = await import("./sessionMutationService.ts");

function persistedSession(): { manager: SessionManager; binding: SessionBinding } {
  const cwd = path.join(root, "workspace");
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(sessionsRoot, { recursive: true });
  const manager = SessionManager.create(cwd, sessionsRoot);
  manager.appendMessage({ role: "user", content: "hello", timestamp: Date.now() });
  manager.appendMessage({
    role: "assistant", content: [{ type: "text", text: "hi" }], api: "test", provider: "test", model: "test",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop", timestamp: Date.now(),
  });
  const binding: SessionBinding = {
    sessionId: manager.getSessionId(), workspaceKind: "directories", directoryId: "root", cwd,
    directories: [{ directoryId: "root", name: "workspace", sourcePath: cwd, path: cwd }],
    sessionFile: manager.getSessionFile(), worktree: false,
  };
  metadata.appendWorkspaceMetadata(manager, binding);
  bindings.saveSessionBinding(binding);
  return { manager, binding };
}

afterEach(() => {
  for (const entry of fs.readdirSync(root)) fs.rmSync(path.join(root, entry), { recursive: true, force: true });
});

describe("session mutations", () => {
  it("persists a normalized session name in its history", async () => {
    const { manager, binding } = persistedSession();

    await expect(renameSession(binding.sessionId, "  Release plan\nfollow-up  ", {
      recover: async () => [], getRuntime: async () => undefined,
    })).resolves.toEqual({ success: true, name: "Release plan follow-up" });

    expect(SessionManager.open(manager.getSessionFile()!).getSessionName()).toBe("Release plan follow-up");
  });

  it("renames through a live runtime so its session tree stays current", async () => {
    const { binding } = persistedSession();
    const setSessionName = vi.fn();

    await renameSession(binding.sessionId, "Live title", {
      recover: async () => [], getRuntime: async () => ({ session: { setSessionName, isStreaming: true } }),
    });

    expect(setSessionName).toHaveBeenCalledWith("Live title");
  });

  it("rejects blank and overlong session names", async () => {
    const { binding } = persistedSession();
    const dependencies = { recover: async () => [], getRuntime: async () => undefined };

    await expect(renameSession(binding.sessionId, "   ", dependencies)).rejects.toThrow(/required/);
    await expect(renameSession(binding.sessionId, "x".repeat(121), dependencies)).rejects.toThrow(/120 characters/);
  });

  it("persists permission mode and requires an idle session", async () => {
    const { manager, binding } = persistedSession();
    const dispose = vi.fn();

    await expect(setSessionPermissionMode(binding.sessionId, "safe", {
      recover: async () => [], getRuntime: async () => undefined, dispose,
    })).resolves.toEqual({ success: true, permissionMode: "safe" });

    expect(bindings.getSessionBinding(binding.sessionId)?.permissionMode).toBe("safe");
    expect(metadata.getWorkspaceMetadata(SessionManager.open(manager.getSessionFile()!))?.permissionMode).toBe("safe");
    expect(dispose).toHaveBeenCalledWith(binding.sessionId, "permission mode changed");

    await expect(setSessionPermissionMode(binding.sessionId, "unsafe", {
      recover: async () => [], getRuntime: async () => undefined,
    })).rejects.toThrow(/read-only, safe, ai, or relaxed/);
    await expect(setSessionPermissionMode(binding.sessionId, "relaxed", {
      recover: async () => [], getRuntime: async () => ({ session: { isStreaming: true } }),
    })).rejects.toThrow(/Stop the session/);
  });

  it("moves a session by updating its indexed and embedded project ownership", async () => {
    const { manager, binding } = persistedSession();
    const project = projects.createProject({ name: "Roadmap", directories: [] });
    projects.saveProjects([project]);
    const dispose = vi.fn();

    await moveSessionToProject(binding.sessionId, project.id, {
      recover: async () => [], getRuntime: async () => undefined, dispose,
    });

    expect(bindings.getSessionBinding(binding.sessionId)?.projectId).toBe(project.id);
    expect(metadata.getWorkspaceMetadata(SessionManager.open(manager.getSessionFile()!))?.projectId).toBe(project.id);
    expect(dispose).toHaveBeenCalledWith(binding.sessionId, "session moved to another project");
  });

  it("rejects moving an active session before changing ownership", async () => {
    const { binding } = persistedSession();
    const project = projects.createProject({ name: "Roadmap", directories: [] });
    projects.saveProjects([project]);

    await expect(moveSessionToProject(binding.sessionId, project.id, {
      recover: async () => [], getRuntime: async () => ({ session: { isStreaming: true } }),
    })).rejects.toThrow(/Stop the session/);
    expect(bindings.getSessionBinding(binding.sessionId)?.projectId).toBeUndefined();
  });

  it("permanently deletes an idle session file and binding", async () => {
    const { manager, binding } = persistedSession();
    const sessionFile = manager.getSessionFile()!;
    const dispose = vi.fn();
    const removeBackgroundJobs = vi.fn(async () => undefined);

    await deleteSession(binding.sessionId, {
      recover: async () => [], getRuntime: async () => undefined, dispose,
      hasRunningBackgroundJobs: () => false, removeBackgroundJobs,
    });

    expect(fs.existsSync(sessionFile)).toBe(false);
    expect(bindings.getSessionBinding(binding.sessionId)).toBeUndefined();
    expect(dispose).toHaveBeenCalledWith(binding.sessionId, "session deleted");
    expect(removeBackgroundJobs).toHaveBeenCalledWith(binding.sessionId);
  });

  it("does not delete an active session", async () => {
    const { binding } = persistedSession();
    await expect(deleteSession(binding.sessionId, {
      recover: async () => [], getRuntime: async () => ({ session: { isStreaming: true } }),
    })).rejects.toThrow(/Stop the session/);
    expect(bindings.getSessionBinding(binding.sessionId)).toBeDefined();
    expect(fs.existsSync(binding.sessionFile!)).toBe(true);
  });

  it("does not delete a session while one of its background jobs is running", async () => {
    const { binding } = persistedSession();
    const dispose = vi.fn();

    await expect(deleteSession(binding.sessionId, {
      recover: async () => [], getRuntime: async () => undefined, dispose,
      hasRunningBackgroundJobs: () => true,
    })).rejects.toThrow(/Stop background jobs/);

    expect(bindings.getSessionBinding(binding.sessionId)).toBeDefined();
    expect(fs.existsSync(binding.sessionFile!)).toBe(true);
    expect(dispose).not.toHaveBeenCalled();
  });
});

describe("session model selection", () => {
  it("writes the selected model to the session history without a prompt", async () => {
    const { manager, binding } = persistedSession();
    const model = { provider: "test", id: "large" };
    const setModel = vi.fn(async () => { manager.appendModelChange(model.provider, model.id); });
    const getRuntime = async () => ({ session: {
      model: { provider: "test", id: "flash" },
      modelRuntime: { getAvailable: async () => [model] }, setModel,
    } });
    await expect(setSessionModel(binding.sessionId, "test/large", getRuntime as any))
      .resolves.toEqual({ modelId: "test/large", thinkingLevel: undefined });
    expect(setModel).toHaveBeenCalledWith(model);
    expect(SessionManager.open(manager.getSessionFile()!).buildSessionContext().model)
      .toEqual({ provider: "test", modelId: "large" });
  });

  it("rejects invalid and unavailable models without changing the session", async () => {
    const setModel = vi.fn();
    const getRuntime = vi.fn(async () => ({ session: {
      modelRuntime: { getAvailable: async () => [] }, setModel,
    } }));
    await expect(setSessionModel("session", "", getRuntime as any)).rejects.toThrow(/required/);
    expect(getRuntime).not.toHaveBeenCalled();
    await expect(setSessionModel("session", "test/missing", getRuntime as any)).rejects.toThrow(/unavailable/);
    expect(setModel).not.toHaveBeenCalled();
  });
});

it.each(["high", "max"])("persists model and effort %s together in the session history", async (effort) => {
  const { manager, binding } = persistedSession();
  const model = { provider: "test", id: "large" };
  const session = {
    model: { provider: "test", id: "flash" }, thinkingLevel: "medium",
    modelRuntime: { getAvailable: async () => [model] },
    setModel: async () => { manager.appendModelChange(model.provider, model.id); },
    setThinkingLevel: (level: string) => { session.thinkingLevel = level; manager.appendThinkingLevelChange(level as any); },
  };
  await expect(setSessionModel(binding.sessionId, "test/large", (async () => ({ session })) as any, effort))
    .resolves.toEqual({ modelId: "test/large", thinkingLevel: effort });
  const context = SessionManager.open(manager.getSessionFile()!).buildSessionContext();
  expect(context.model).toEqual({ provider: "test", modelId: "large" });
  expect(context.thinkingLevel).toBe(effort);
});
