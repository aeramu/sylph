import { completeSimple, getSupportedThinkingLevels, type AssistantMessage, type Model } from "../../integrations/pi/modelSdk.ts";
import type { ModelRegistry } from "../../integrations/pi/sessionSdk.ts";
import { findAvailableModel } from "../../integrations/pi/modelSelection.ts";
import type { CommitMessageThinkingLevel } from "../settings/settingsTypes.ts";

const MAX_DIFF_CHARS = 120_000;
const DIFF_PLACEHOLDER = "{{diff}}";

function clippedDiff(diff: string) {
  return diff.length > MAX_DIFF_CHARS
    ? `${diff.slice(0, MAX_DIFF_CHARS)}\n\n[Diff truncated after ${MAX_DIFF_CHARS.toLocaleString()} characters]`
    : diff;
}

export function commitMessagePrompt(template: string, diff: string) {
  const clipped = clippedDiff(diff);
  return template.includes(DIFF_PLACEHOLDER)
    ? template.split(DIFF_PLACEHOLDER).join(clipped)
    : `${template.trimEnd()}\n\nSTAGED DIFF:\n${clipped}`;
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
  settings: {
    model: string;
    thinkingLevel: CommitMessageThinkingLevel;
    prompt: string;
  },
  stagedDiff: string,
) {
  if (!settings.model) throw new Error("Select a commit message model in Settings");
  if (!settings.prompt.trim()) throw new Error("Enter a commit message prompt in Settings");
  if (!stagedDiff.trim()) throw new Error("Stage changes before generating a commit message");

  const model = findAvailableModel(registry.getAvailable(), settings.model) as Model<any> | undefined;
  if (!model) throw new Error(`Unknown or unavailable model: ${settings.model}`);
  const supportedThinkingLevels = getSupportedThinkingLevels(model);
  if (!supportedThinkingLevels.includes(settings.thinkingLevel)) {
    throw new Error(`Thinking level ${settings.thinkingLevel} is not supported by ${model.id}`);
  }
  const auth = await registry.getApiKeyAndHeaders(model);
  if (!auth.ok) throw new Error(auth.error);

  const response = await completeSimple(model, {
    systemPrompt: "You write accurate Git commit messages from staged diffs and follow the user's requested format exactly.",
    messages: [{ role: "user", content: commitMessagePrompt(settings.prompt, stagedDiff), timestamp: Date.now() }],
  }, {
    apiKey: auth.apiKey,
    headers: auth.headers,
    env: auth.env,
    maxTokens: 256,
    ...(settings.thinkingLevel === "off" ? {} : { reasoning: settings.thinkingLevel }),
  });
  return textFromAssistantMessage(response);
}
