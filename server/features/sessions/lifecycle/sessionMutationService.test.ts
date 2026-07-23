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
const { deleteSession, moveSessionToProject } = await import("./sessionMutationService.ts");

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

    await deleteSession(binding.sessionId, {
      recover: async () => [], getRuntime: async () => undefined, dispose,
    });

    expect(fs.existsSync(sessionFile)).toBe(false);
    expect(bindings.getSessionBinding(binding.sessionId)).toBeUndefined();
    expect(dispose).toHaveBeenCalledWith(binding.sessionId, "session deleted");
  });

  it("does not delete an active session", async () => {
    const { binding } = persistedSession();
    await expect(deleteSession(binding.sessionId, {
      recover: async () => [], getRuntime: async () => ({ session: { isStreaming: true } }),
    })).rejects.toThrow(/Stop the session/);
    expect(bindings.getSessionBinding(binding.sessionId)).toBeDefined();
    expect(fs.existsSync(binding.sessionFile!)).toBe(true);
  });
});
