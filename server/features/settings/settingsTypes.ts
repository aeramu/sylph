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
  commitMessageModel: string;
  commitMessageThinkingLevel: CommitMessageThinkingLevel;
  commitMessagePrompt: string;
}
