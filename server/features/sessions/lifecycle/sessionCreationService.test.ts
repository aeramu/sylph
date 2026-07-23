import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionHistoryHandle, SessionHistoryPort } from "./sessionHistoryPort.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "sylph-session-create-test-"));
const bindingsFile = path.join(root, "bindings.json");
const scratchRoot = path.join(root, "scratch");
vi.mock("../../../config.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../config.ts")>()),
  SYLPH_DIR: root,
  PROJECTS_FILE: path.join(root, "projects.json"),
  SETTINGS_FILE: path.join(root, "settings.json"),
  SESSION_BINDINGS_FILE: bindingsFile,
  SCRATCH_DIR: scratchRoot,
  WORKTREES_DIR: path.join(root, "worktrees"),
}));

const bindings = await import("../workspace/workspaceBindingRepository.ts");
const { createSession } = await import("./sessionCreationService.ts");

afterEach(() => {
  fs.rmSync(bindingsFile, { force: true });
  fs.rmSync(scratchRoot, { recursive: true, force: true });
});

function handle(id: string, cwd: string): SessionHistoryHandle {
  return {
    getSessionId: () => id,
    getCwd: () => cwd,
    getSessionFile: () => path.join(root, `${id}.jsonl`),
    getEntries: () => [],
    appendCustomEntry: () => undefined,
    buildSessionContext: () => ({ messages: [] }),
  };
}

describe("session creation", () => {
  it("creates a standalone directory session through the history port", async () => {
    const cwd = path.join(root, "standalone");
    fs.mkdirSync(cwd, { recursive: true });
    const manager = handle("session-1", cwd);
    const history: SessionHistoryPort = {
      create: vi.fn(() => manager),
      open: vi.fn(),
      list: vi.fn(async () => []),
      listAll: vi.fn(async () => []),
    };

    const result = await createSession(undefined, [], { standalonePath: cwd }, history);

    expect(history.create).toHaveBeenCalledWith(cwd);
    expect(result).toMatchObject({ sessionManager: manager, targetCwd: cwd, runtimeDirectoryId: "root", created: true });
    expect(bindings.getSessionBinding("session-1")).toMatchObject({ workspaceKind: "directories", cwd, directoryId: "root" });
  });

  it("requires a starting directory for a project with roots", async () => {
    const project = { id: "project-1", name: "Project", path: root, directories: [{ id: "root", name: "root", path: root }] };
    const history = { create: vi.fn(), open: vi.fn(), list: vi.fn(), listAll: vi.fn() } as unknown as SessionHistoryPort;
    await expect(createSession(project.id, [project], {}, history)).rejects.toThrow(/Select a starting directory/);
  });
});
