import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { SessionManager } from "../../../integrations/pi/sessionSdk.ts";
import type { SessionBinding } from "./workspaceTypes.ts";

const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sylph-attach-folder-test-"));
const bindingsFile = path.join(storeRoot, "bindings.json");
const sessionsRoot = path.join(storeRoot, "sessions");

vi.mock("../../../config.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../config.ts")>()),
  SYLPH_DIR: storeRoot,
  SESSION_BINDINGS_FILE: bindingsFile,
  WORKTREES_DIR: path.join(storeRoot, "worktrees"),
}));

const bindings = await import("./workspaceBindingRepository.ts");
const { attachFolderToSession } = await import("./sessionWorkspaceService.ts");

function folder(name: string) {
  const target = path.join(storeRoot, name);
  fs.mkdirSync(target, { recursive: true });
  return target;
}

function git(cwd: string, ...args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

function repository(name: string) {
  const target = folder(name);
  git(target, "init", "-q");
  git(target, "config", "user.name", "Test User");
  git(target, "config", "user.email", "test@example.com");
  fs.writeFileSync(path.join(target, "README.md"), name);
  git(target, "add", ".");
  git(target, "commit", "-qm", "initial");
  return target;
}

function sessionBinding(): SessionBinding {
  const workspace = folder("workspace");
  fs.mkdirSync(sessionsRoot, { recursive: true });
  const manager = SessionManager.create(workspace, sessionsRoot);
  // Force the physical JSONL file to exist for detached mutation.
  manager.appendMessage({ role: "user", content: "hello", timestamp: Date.now() });
  manager.appendMessage({
    role: "assistant", content: [{ type: "text", text: "hi" }], api: "test", provider: "test", model: "test",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop", timestamp: Date.now(),
  });
  const binding: SessionBinding = {
    sessionId: manager.getSessionId(), directoryId: "root", cwd: workspace, sessionFile: manager.getSessionFile(),
    directories: [{ directoryId: "root", name: "workspace", sourcePath: workspace, path: workspace }], worktree: false,
  };
  bindings.saveSessionBinding(binding);
  return binding;
}

afterEach(() => {
  for (const entry of fs.readdirSync(storeRoot)) fs.rmSync(path.join(storeRoot, entry), { recursive: true, force: true });
});

describe("attach folder to session", () => {
  it("persists a session-only root and rebuilds the runtime", async () => {
    const original = sessionBinding();
    const docs = folder("docs");
    const initialize = vi.fn(async () => ({}));
    const dispose = vi.fn();

    const result = await attachFolderToSession(original.sessionId, { path: docs, name: "documentation" }, {
      getBinding: bindings.getSessionBinding,
      getRuntime: async () => undefined,
      dispose,
      initialize,
    });

    expect(result.directory).toMatchObject({ name: "documentation", sourcePath: fs.realpathSync(docs), path: fs.realpathSync(docs) });
    expect(bindings.getSessionBinding(original.sessionId)?.directories).toHaveLength(2);
    expect(dispose).toHaveBeenCalledWith(original.sessionId);
    expect(initialize).toHaveBeenCalledWith(original.sessionId);
    const manager = SessionManager.open(original.sessionFile!);
    expect((manager.getEntries().filter((entry: any) => entry.customType === "sylph.workspace").at(-1) as any)?.data.directories).toHaveLength(2);
  });

  it("rejects duplicate folders and aliases without rebuilding", async () => {
    const original = sessionBinding();
    const other = folder("other");
    const dependencies = { getBinding: bindings.getSessionBinding, getRuntime: async () => undefined, initialize: vi.fn(async () => ({})) };

    await expect(attachFolderToSession(original.sessionId, { path: original.cwd }, dependencies)).rejects.toThrow(/already attached/);
    await expect(attachFolderToSession(original.sessionId, { path: other, name: "workspace" }, dependencies)).rejects.toThrow(/alias.*already in use/i);
    expect(dependencies.initialize).not.toHaveBeenCalled();
  });

  it("promotes the first folder of a scratch session to its active cwd", async () => {
    const original = sessionBinding();
    bindings.saveSessionBinding({ ...original, workspaceKind: "scratch", directoryId: undefined, directories: [] });
    const docs = folder("scratch-promotion-docs");

    const result = await attachFolderToSession(original.sessionId, { path: docs }, {
      getBinding: bindings.getSessionBinding,
      getRuntime: async () => undefined,
      dispose: () => {},
      initialize: async () => ({}),
    });

    expect(result.binding).toMatchObject({
      workspaceKind: "directories",
      directoryId: result.directory.directoryId,
      cwd: fs.realpathSync(docs),
    });
    expect(result.binding.directories).toHaveLength(1);
  });

  it("creates the new repository's worktree on the existing session branch", async () => {
    const original = sessionBinding();
    const existingRoot = path.join(storeRoot, "worktrees", "project", "session", "root");
    const branch = "sylph/session-task";
    bindings.saveSessionBinding({
      ...original,
      projectId: "project",
      branch,
      worktree: true,
      directories: [{
        ...original.directories![0], path: existingRoot, worktreeRoot: existingRoot, branch, baseBranch: "main",
      }],
    });
    const repo = repository("new-repository");
    const baseBranch = git(repo, "branch", "--show-current");

    const result = await attachFolderToSession(original.sessionId, { path: repo, name: "new-root", baseBranch }, {
      getBinding: bindings.getSessionBinding,
      getRuntime: async () => undefined,
      dispose: () => {},
      initialize: async () => ({}),
    });

    expect(result.directory.worktreeRoot).toBe(path.join(path.dirname(existingRoot), result.directory.directoryId));
    expect(git(result.directory.path, "branch", "--show-current")).toBe(branch);
    expect(result.directory.baseBranch).toBe(baseBranch);
  });

  it("requires an idle session", async () => {
    const original = sessionBinding();
    await expect(attachFolderToSession(original.sessionId, { path: folder("docs") }, {
      getBinding: bindings.getSessionBinding,
      getRuntime: async () => ({ session: { isStreaming: true } }),
    })).rejects.toThrow(/Stop the session/);
  });
});
