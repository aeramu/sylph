import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sylph-bindings-test-"));
const storeFile = path.join(storeRoot, "session-bindings.json");

vi.mock("./config.ts", () => ({
  SYLPH_DIR: storeRoot,
  SESSION_BINDINGS_FILE: storeFile,
}));

const bindings = await import("./sessionBindings.ts");

describe("session bindings", () => {
  beforeEach(() => {
    fs.rmSync(storeFile, { force: true });
  });

  afterEach(() => {
    for (const entry of fs.readdirSync(storeRoot)) {
      fs.rmSync(path.join(storeRoot, entry), { recursive: true, force: true });
    }
  });

  it("persists, replaces, filters, and deletes a session cwd binding", () => {
    bindings.saveSessionBinding({
      sessionId: "session-1",
      projectId: "project-a",
      cwd: "/tmp/checkout-a",
      worktree: true,
      branch: "sylph/fix-auth-1234",
    });
    bindings.saveSessionBinding({
      sessionId: "session-2",
      projectId: "project-b",
      cwd: "/tmp/checkout-b",
    });
    bindings.saveSessionBinding({
      sessionId: "session-1",
      projectId: "project-a",
      cwd: "/tmp/checkout-a-updated",
      worktree: true,
      branch: "sylph/fix-auth-1234",
    });

    expect(bindings.getSessionBinding("session-1")?.cwd).toBe("/tmp/checkout-a-updated");
    expect(bindings.getProjectSessionBindings("project-a").map((entry) => entry.sessionId)).toEqual(["session-1"]);
    expect(JSON.parse(fs.readFileSync(storeFile, "utf-8"))).toHaveLength(2);

    bindings.deleteSessionBinding("session-1");
    expect(bindings.getSessionBinding("session-1")).toBeUndefined();
    expect(bindings.getSessionBindings().map((entry) => entry.sessionId)).toEqual(["session-2"]);
    expect(fs.readdirSync(storeRoot).filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
  });
});
