import fs from "fs";
import { SETTINGS_FILE, SYLPH_DIR } from "./config.ts";

export interface SylphSettings {
  /** Provider/model used for the Git panel's generated commit messages. */
  commitMessageModel: string;
}

const DEFAULT_SETTINGS: SylphSettings = {
  commitMessageModel: "",
};

function normalizeSettings(value: unknown): SylphSettings {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    commitMessageModel: typeof record.commitMessageModel === "string" ? record.commitMessageModel : "",
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
