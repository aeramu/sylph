import fs from "fs";
import { SETTINGS_FILE, SYLPH_DIR } from "./config.ts";

export const COMMIT_MESSAGE_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type CommitMessageThinkingLevel = typeof COMMIT_MESSAGE_THINKING_LEVELS[number];

export const DEFAULT_COMMIT_MESSAGE_PROMPT = [
  "Write a Git commit message for the staged changes below.",
  "Return only the commit message: no Markdown, quotes, commentary, or code fences.",
  "Use an imperative subject no longer than 72 characters. Add a short body only when it explains important context not obvious from the subject.",
  "Describe only changes supported by the diff.",
  "",
  "STAGED DIFF:",
  "{{diff}}",
].join("\n");

export interface SylphSettings {
  /** Provider/model used for the Git panel's generated commit messages. */
  commitMessageModel: string;
  commitMessageThinkingLevel: CommitMessageThinkingLevel;
  /** User-editable template. {{diff}} is replaced with the staged patch. */
  commitMessagePrompt: string;
}

const DEFAULT_SETTINGS: SylphSettings = {
  commitMessageModel: "",
  commitMessageThinkingLevel: "off",
  commitMessagePrompt: DEFAULT_COMMIT_MESSAGE_PROMPT,
};

function normalizeSettings(value: unknown): SylphSettings {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const thinkingLevel = typeof record.commitMessageThinkingLevel === "string"
    && COMMIT_MESSAGE_THINKING_LEVELS.includes(record.commitMessageThinkingLevel as CommitMessageThinkingLevel)
    ? record.commitMessageThinkingLevel as CommitMessageThinkingLevel
    : DEFAULT_SETTINGS.commitMessageThinkingLevel;
  return {
    commitMessageModel: typeof record.commitMessageModel === "string" ? record.commitMessageModel : "",
    commitMessageThinkingLevel: thinkingLevel,
    commitMessagePrompt: typeof record.commitMessagePrompt === "string" && record.commitMessagePrompt.trim()
      ? record.commitMessagePrompt
      : DEFAULT_SETTINGS.commitMessagePrompt,
  };
}

export function getSettings(): SylphSettings {
  try {
    return normalizeSettings(JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8")));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: SylphSettings) {
  fs.mkdirSync(SYLPH_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(SETTINGS_FILE, `${JSON.stringify(normalizeSettings(settings), null, 2)}\n`, {
    encoding: "utf-8",
    mode: 0o600,
  });
  try { fs.chmodSync(SETTINGS_FILE, 0o600); } catch { /* ignore chmod failures */ }
}

export function updateSettings(patch: Partial<SylphSettings>): SylphSettings {
  const current = getSettings();
  const next = normalizeSettings({ ...current, ...patch });
  saveSettings(next);
  return next;
}
