import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionHistoryHandle, SessionHistoryPort } from "./sessionHistoryPort.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "sylph-session-resume-test-"));
const bindingsFile = path.join(root, "bindings.json");
vi.mock("../../../config.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../config.ts")>()),
  SYLPH_DIR: root,
  PROJECTS_FILE: path.join(root, "projects.json"),
  SETTINGS_FILE: path.join(root, "settings.json"),
  SESSION_BINDINGS_FILE: bindingsFile,
}));

const bindings = await import("../workspace/workspaceBindingRepository.ts");
const { resumeSession } = await import("./sessionResumeService.ts");

afterEach(() => fs.rmSync(bindingsFile, { force: true }));

function handle(id: string, cwd: string, file: string): SessionHistoryHandle {
  return {
    getSessionId: () => id,
    getCwd: () => cwd,
    getSessionFile: () => file,
    getEntries: () => [],
    appendCustomEntry: () => undefined,
    buildSessionContext: () => ({ messages: [] }),
  };
}

describe("session resume", () => {
  it("uses a direct binding before scanning global session history", async () => {
    const cwd = path.join(root, "workspace");
    const file = path.join(root, "session.jsonl");
    fs.mkdirSync(cwd, { recursive: true });
    fs.writeFileSync(file, "");
    bindings.saveSessionBinding({ sessionId: "session-1", cwd, directoryId: "root", sessionFile: file });
    const manager = handle("session-1", cwd, file);
    const history: SessionHistoryPort = {
      open: vi.fn(() => manager),
      list: vi.fn(async () => []),
      listAll: vi.fn(async () => []),
      create: vi.fn(() => manager),
    };

    const result = await resumeSession("session-1", [], history);

    expect(result).toMatchObject({ sessionManager: manager, targetCwd: cwd, runtimeDirectoryId: "root", created: false });
    expect(history.open).toHaveBeenCalledWith(file);
    expect(history.listAll).not.toHaveBeenCalled();
  });

  it("rejects a binding whose workspace no longer exists", async () => {
    bindings.saveSessionBinding({ sessionId: "missing", cwd: path.join(root, "gone"), directoryId: "root" });
    const history = { open: vi.fn(), create: vi.fn(), list: vi.fn(), listAll: vi.fn() } as unknown as SessionHistoryPort;
    await expect(resumeSession("missing", [], history)).rejects.toThrow(/working directory no longer exists/);
  });
});
