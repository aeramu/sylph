import { SETTINGS_FILE } from "../../config.ts";
import { JsonFileStore } from "../../platform/filesystem/jsonFileStore.ts";
import {
  COMMIT_MESSAGE_THINKING_LEVELS, DEFAULT_COMMIT_MESSAGE_PROMPT,
  type CommitMessageThinkingLevel, type SylphSettings,
} from "./settingsTypes.ts";

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

const settingsStore = new JsonFileStore<SylphSettings>({
  filePath: SETTINGS_FILE,
  defaultValue: () => ({ ...DEFAULT_SETTINGS }),
  normalize: normalizeSettings,
});

export function getSettings(): SylphSettings {
  return settingsStore.read();
}

export function saveSettings(settings: SylphSettings) {
  settingsStore.write(settings);
}

export function updateSettings(patch: Partial<SylphSettings>): SylphSettings {
  const current = getSettings();
  const next = normalizeSettings({ ...current, ...patch });
  saveSettings(next);
  return next;
}
