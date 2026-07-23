import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { SessionManager } from "../../../integrations/pi/sessionSdk.ts";
import type { SessionBinding } from "./workspaceTypes.ts";

const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sylph-pi-metadata-test-"));
const bindingsFile = path.join(storeRoot, "session-bindings.json");
const sessionsRoot = path.join(storeRoot, "sessions");

vi.mock("../../../config.ts", () => ({
  SYLPH_DIR: storeRoot,
  SESSION_BINDINGS_FILE: bindingsFile,
}));

const bindings = await import("./workspaceBindingRepository.ts");
const metadata = await import("./piSessionMetadata.ts");

function createSession() {
  fs.mkdirSync(sessionsRoot, { recursive: true });
  return SessionManager.create("/tmp/backend", sessionsRoot);
}

afterEach(() => {
  fs.rmSync(bindingsFile, { force: true });
  fs.rmSync(sessionsRoot, { recursive: true, force: true });
});

describe("embedded Sylph workspace metadata", () => {
  it("persists portable workspace data without entering model context", () => {
    const manager = createSession();
    manager.appendMessage({ role: "user", content: "hello", timestamp: Date.now() });
    const binding: SessionBinding = {
      sessionId: manager.getSessionId(),
      projectId: "project-a",
      directoryId: "backend",
      cwd: "/tmp/backend",
      sessionFile: manager.getSessionFile(),
      directories: [
        { directoryId: "backend", name: "backend", path: "/tmp/backend" },
        { directoryId: "web", name: "web", path: "/tmp/web" },
      ],
      worktree: false,
      permissionApprovals: ["not-portable"],
    };

    metadata.appendWorkspaceMetadata(manager, binding);

    expect(metadata.getWorkspaceMetadata(manager)).toEqual(expect.objectContaining({
      version: 1,
      projectId: "project-a",
      directoryId: "backend",
      cwd: "/tmp/backend",
      worktree: false,
    }));
    expect(metadata.getWorkspaceMetadata(manager)).not.toHaveProperty("sessionFile");
    expect(metadata.getWorkspaceMetadata(manager)).not.toHaveProperty("permissionApprovals");
    expect(manager.buildSessionContext().messages).toHaveLength(1);
  });

  it("rebuilds the binding index from an embedded session", () => {
    const manager = createSession();
    const binding: SessionBinding = {
      sessionId: manager.getSessionId(),
      projectId: "project-a",
      directoryId: "backend",
      cwd: "/tmp/backend",
      sessionFile: manager.getSessionFile(),
    };
    metadata.appendWorkspaceMetadata(manager, binding);

    const reconciled = metadata.reconcileSessionBinding(manager);

    expect(reconciled).toEqual(expect.objectContaining({
      sessionId: manager.getSessionId(),
      projectId: "project-a",
      directoryId: "backend",
      cwd: "/tmp/backend",
      sessionFile: manager.getSessionFile(),
    }));
    expect(bindings.getSessionBinding(manager.getSessionId())).toEqual(reconciled);
  });

  it("repairs a stale binding and preserves index-only approvals", () => {
    const manager = createSession();
    const original: SessionBinding = {
      sessionId: manager.getSessionId(),
      projectId: "project-old",
      directoryId: "backend",
      cwd: "/tmp/old",
      sessionFile: manager.getSessionFile(),
      permissionApprovals: ["approval-1"],
    };
    bindings.saveSessionBinding(original);
    metadata.appendWorkspaceMetadata(manager, {
      ...original,
      projectId: "project-new",
      cwd: "/tmp/new",
    });
    // Pi delays creating a persisted session file until the first assistant
    // message; all earlier entries are flushed with it.
    manager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "hi" }],
      api: "test",
      provider: "test",
      model: "test",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop",
      timestamp: Date.now(),
    });

    const reconciled = metadata.reconcileSessionBinding(SessionManager.open(manager.getSessionFile()!));

    expect(reconciled).toEqual(expect.objectContaining({
      projectId: "project-new",
      cwd: "/tmp/new",
      permissionApprovals: ["approval-1"],
      sessionFile: manager.getSessionFile(),
    }));
    expect(bindings.getProjectSessionBindings("project-new").map((entry) => entry.sessionId)).toEqual([manager.getSessionId()]);
    expect(bindings.getProjectSessionBindings("project-old")).toEqual([]);
  });

  it("supports a standalone workspace without project ownership", () => {
    const manager = createSession();
    const binding: SessionBinding = {
      sessionId: manager.getSessionId(),
      directoryId: "root",
      cwd: "/tmp/backend",
      directories: [{ directoryId: "root", name: "backend", sourcePath: "/tmp/backend", path: "/tmp/backend" }],
      sessionFile: manager.getSessionFile(),
    };

    metadata.appendWorkspaceMetadata(manager, binding);
    const stored = metadata.getWorkspaceMetadata(manager);
    const reconciled = metadata.reconcileSessionBinding(manager);

    expect(stored).not.toHaveProperty("projectId");
    expect(reconciled).toEqual(expect.objectContaining({ directoryId: "root", cwd: "/tmp/backend" }));
    expect(reconciled).not.toHaveProperty("projectId");
  });

  it("round-trips a directoryless scratch workspace", () => {
    const manager = createSession();
    const binding: SessionBinding = {
      sessionId: manager.getSessionId(),
      workspaceKind: "scratch",
      cwd: "/tmp/private-scratch",
      directories: [],
      sessionFile: manager.getSessionFile(),
    };

    metadata.appendWorkspaceMetadata(manager, binding);
    const reconciled = metadata.reconcileSessionBinding(manager);

    expect(metadata.getWorkspaceMetadata(manager)).toEqual(expect.objectContaining({ workspaceKind: "scratch" }));
    expect(metadata.getWorkspaceMetadata(manager)).not.toHaveProperty("directories");
    expect(reconciled).toEqual(expect.objectContaining({ workspaceKind: "scratch", cwd: "/tmp/private-scratch" }));
    expect(reconciled?.directories).toBeUndefined();
  });

  it("uses the latest valid append-only metadata entry", () => {
    const manager = createSession();
    const base: SessionBinding = {
      sessionId: manager.getSessionId(),
      projectId: "project-a",
      cwd: "/tmp/a",
    };
    metadata.appendWorkspaceMetadata(manager, base);
    metadata.appendWorkspaceMetadata(manager, { ...base, projectId: "project-b", cwd: "/tmp/b" });

    expect(metadata.getWorkspaceMetadata(manager)).toEqual(expect.objectContaining({
      projectId: "project-b",
      cwd: "/tmp/b",
    }));
  });
});
