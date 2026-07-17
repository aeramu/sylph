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
    expect(settings.getSettings()).toEqual({
      commitMessageModel: "",
      commitMessageThinkingLevel: "off",
      commitMessagePrompt: settings.DEFAULT_COMMIT_MESSAGE_PROMPT,
    });
  });

  it("persists all commit message preferences across reads", () => {
    settings.updateSettings({
      commitMessageModel: "anthropic/claude-sonnet",
      commitMessageThinkingLevel: "high",
      commitMessagePrompt: "Use conventional commits.\n\n{{diff}}",
    });
    expect(settings.getSettings()).toEqual({
      commitMessageModel: "anthropic/claude-sonnet",
      commitMessageThinkingLevel: "high",
      commitMessagePrompt: "Use conventional commits.\n\n{{diff}}",
    });
    expect(fs.statSync(storeFile).mode & 0o777).toBe(0o600);
  });

  it("migrates the original model-only settings file with defaults", () => {
    fs.writeFileSync(storeFile, JSON.stringify({ commitMessageModel: "minimax/MiniMax-M2.7" }));
    expect(settings.getSettings()).toEqual({
      commitMessageModel: "minimax/MiniMax-M2.7",
      commitMessageThinkingLevel: "off",
      commitMessagePrompt: settings.DEFAULT_COMMIT_MESSAGE_PROMPT,
    });
  });

  it("normalizes malformed values without losing valid settings", () => {
    fs.writeFileSync(storeFile, JSON.stringify({
      commitMessageModel: "provider/model",
      commitMessageThinkingLevel: "absurd",
      commitMessagePrompt: "  ",
    }));
    expect(settings.getSettings()).toEqual({
      commitMessageModel: "provider/model",
      commitMessageThinkingLevel: "off",
      commitMessagePrompt: settings.DEFAULT_COMMIT_MESSAGE_PROMPT,
    });
  });
});
