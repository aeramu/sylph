import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sylph-settings-test-"));
const storeFile = path.join(storeRoot, "settings.json");

vi.mock("./config.ts", () => ({
  SYLPH_DIR: storeRoot,
  SETTINGS_FILE: storeFile,
}));

const settings = await import("./settings.ts");

describe("global settings", () => {
  beforeEach(() => fs.rmSync(storeFile, { force: true }));

  it("returns defaults when no settings have been saved", () => {
    expect(settings.getSettings()).toEqual({ commitMessageModel: "" });
  });

  it("persists the commit message model across reads", () => {
    settings.updateSettings({ commitMessageModel: "anthropic/claude-sonnet" });
    expect(settings.getSettings()).toEqual({ commitMessageModel: "anthropic/claude-sonnet" });
    expect(fs.statSync(storeFile).mode & 0o777).toBe(0o600);
  });

  it("normalizes malformed values without losing valid settings", () => {
    fs.writeFileSync(storeFile, JSON.stringify({ commitMessageModel: 42, ignored: true }));
    expect(settings.getSettings()).toEqual({ commitMessageModel: "" });
  });
});
