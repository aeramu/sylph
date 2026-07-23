import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { SessionManager } from "../../integrations/pi/sessionSdk.ts";
import type { SessionBinding } from "../sessions/workspace/workspaceTypes.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "sylph-project-delete-test-"));
const projectsFile = path.join(root, "projects.json");
const bindingsFile = path.join(root, "bindings.json");
const sessionsRoot = path.join(root, "sessions");

vi.mock("../../config.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../config.ts")>()),
  SYLPH_DIR: root,
  PROJECTS_FILE: projectsFile,
  SESSION_BINDINGS_FILE: bindingsFile,
}));

const projects = await import("./projectRepository.ts");
const bindings = await import("../sessions/workspace/workspaceBindingRepository.ts");
const metadata = await import("../sessions/workspace/piSessionMetadata.ts");
const { deleteProject } = await import("./projectService.ts");

function persistedSession(cwd: string) {
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(sessionsRoot, { recursive: true });
  const manager = SessionManager.create(cwd, sessionsRoot);
  manager.appendMessage({ role: "user", content: "hello", timestamp: Date.now() });
  manager.appendMessage({
    role: "assistant", content: [{ type: "text", text: "hi" }], api: "test", provider: "test", model: "test",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop", timestamp: Date.now(),
  });
  return manager;
}

function setupScratchProject() {
  const project = projects.createProject({ name: "Ideas", directories: [] });
  projects.saveProjects([project]);
  const manager = persistedSession(path.join(root, "scratch", "session"));
  const binding: SessionBinding = {
    sessionId: manager.getSessionId(), projectId: project.id, workspaceKind: "scratch", cwd: manager.getCwd(),
    directories: [], sessionFile: manager.getSessionFile(), worktree: false,
  };
  metadata.appendWorkspaceMetadata(manager, binding);
  bindings.saveSessionBinding(binding);
  return { project, manager, binding };
}

afterEach(() => {
  for (const entry of fs.readdirSync(root)) fs.rmSync(path.join(root, entry), { recursive: true, force: true });
});

describe("project deletion", () => {
  it("preserves complete detached metadata and disposes cached runtimes", async () => {
    const { project, manager, binding } = setupScratchProject();
    const dispose = vi.fn();

    await deleteProject(project.id, {
      recover: async () => [], getRuntime: async () => undefined, dispose,
    });

    expect(projects.getProjectById(project.id)).toBeUndefined();
    expect(bindings.getSessionBinding(binding.sessionId)).toMatchObject({ workspaceKind: "scratch", cwd: binding.cwd });
    expect(bindings.getSessionBinding(binding.sessionId)).not.toHaveProperty("projectId");
    expect(dispose).toHaveBeenCalledWith(binding.sessionId, "project deleted");
    const embedded = metadata.getWorkspaceMetadata(SessionManager.open(manager.getSessionFile()!));
    expect(embedded).toMatchObject({ workspaceKind: "scratch", cwd: binding.cwd, worktree: false });
    expect(embedded).not.toHaveProperty("projectId");
  });

  it("rejects deletion before mutation when an owned session is streaming", async () => {
    const { project, binding } = setupScratchProject();
    const dispose = vi.fn();

    await expect(deleteProject(project.id, {
      recover: async () => [], getRuntime: async () => ({ session: { isStreaming: true } }), dispose,
    })).rejects.toThrow(/Stop project sessions/);

    expect(projects.getProjectById(project.id)).toBeDefined();
    expect(bindings.getSessionBinding(binding.sessionId)?.projectId).toBe(project.id);
    expect(dispose).not.toHaveBeenCalled();
  });
});
