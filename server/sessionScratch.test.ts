import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "sylph-scratch-test-"));
const scratchRoot = path.join(root, "scratch");

vi.mock("./config.ts", () => ({ SCRATCH_DIR: scratchRoot }));
const { ensureSessionScratch, removeSessionScratch } = await import("./sessionScratch.ts");

afterEach(() => fs.rmSync(scratchRoot, { recursive: true, force: true }));

describe("session scratch", () => {
  it("creates a stable private directory for each session", () => {
    const first = ensureSessionScratch("session-123");
    const second = ensureSessionScratch("session-123");

    expect(first).toBe(path.join(scratchRoot, "session-123"));
    expect(second).toBe(first);
    expect(fs.statSync(first).isDirectory()).toBe(true);
    if (process.platform !== "win32") expect(fs.statSync(first).mode & 0o777).toBe(0o700);
  });

  it("removes scratch data when its owning session is deleted", () => {
    const scratch = ensureSessionScratch("session-123");
    fs.writeFileSync(path.join(scratch, "temporary.txt"), "data");

    removeSessionScratch("session-123");

    expect(fs.existsSync(scratch)).toBe(false);
  });

  it("rejects ids that could escape the scratch root", () => {
    expect(() => ensureSessionScratch("../outside")).toThrow(/Invalid session id/);
    expect(() => ensureSessionScratch("nested/session")).toThrow(/Invalid session id/);
    removeSessionScratch("../outside");
    expect(fs.existsSync(root)).toBe(true);
  });
});
