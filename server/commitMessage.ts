import { completeSimple, type AssistantMessage, type Model } from "@earendil-works/pi-ai/compat";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { findAvailableModel } from "./modelSelection.ts";

const MAX_DIFF_CHARS = 120_000;

export function commitMessagePrompt(diff: string) {
  const clipped = diff.length > MAX_DIFF_CHARS
    ? `${diff.slice(0, MAX_DIFF_CHARS)}\n\n[Diff truncated after ${MAX_DIFF_CHARS.toLocaleString()} characters]`
    : diff;
  return [
    "Write a Git commit message for the staged changes below.",
    "Return only the commit message: no Markdown, quotes, commentary, or code fences.",
    "Use an imperative subject no longer than 72 characters. Add a short body only when it explains important context not obvious from the subject.",
    "Describe only changes supported by the diff.",
    "",
    "STAGED DIFF:",
    clipped,
  ].join("\n");
}

export function textFromAssistantMessage(message: AssistantMessage) {
  if (message.stopReason === "error" || message.stopReason === "aborted") {
    throw new Error(message.errorMessage || "The model could not generate a commit message");
  }
  const text = message.content
    .filter((part): part is Extract<AssistantMessage["content"][number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim()
    .replace(/^```(?:text)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  if (!text) throw new Error("The model returned an empty commit message");
  return text;
}

export async function generateCommitMessage(
  registry: ModelRegistry,
  modelValue: string,
  stagedDiff: string,
) {
  if (!modelValue) throw new Error("Select a commit message model in Settings");
  if (!stagedDiff.trim()) throw new Error("Stage changes before generating a commit message");

  const model = findAvailableModel(registry.getAvailable(), modelValue) as Model<any> | undefined;
  if (!model) throw new Error(`Unknown or unavailable model: ${modelValue}`);
  const auth = await registry.getApiKeyAndHeaders(model);
  if (!auth.ok) throw new Error(auth.error);

  const response = await completeSimple(model, {
    systemPrompt: "You write accurate, concise Git commit messages from staged diffs.",
    messages: [{ role: "user", content: commitMessagePrompt(stagedDiff), timestamp: Date.now() }],
  }, {
    apiKey: auth.apiKey,
    headers: auth.headers,
    env: auth.env,
    maxTokens: 256,
  });
  return textFromAssistantMessage(response);
}
