import { getSupportedThinkingLevels } from "../../integrations/pi/modelSdk.ts";
import { getIntrospectionRuntime } from "../../integrations/pi/runtime/runtimeManager.ts";
import { badRequest } from "../../platform/http/errors.ts";
import { findAvailableModel } from "../../integrations/pi/modelSelection.ts";
import { getSettings, updateSettings } from "./settingsRepository.ts";
import { COMMIT_MESSAGE_THINKING_LEVELS, type CommitMessageThinkingLevel } from "./settingsTypes.ts";

export async function saveSettings(input: Record<string, unknown>) {
  const { permissionReviewModel, commitMessageModel, commitMessageThinkingLevel, commitMessagePrompt } = input;
  if (commitMessageModel !== undefined && typeof commitMessageModel !== "string") badRequest("commitMessageModel must be a string");
  if (commitMessageThinkingLevel !== undefined && (typeof commitMessageThinkingLevel !== "string"
    || !COMMIT_MESSAGE_THINKING_LEVELS.includes(commitMessageThinkingLevel as CommitMessageThinkingLevel))) {
    badRequest("Invalid commitMessageThinkingLevel");
  }
  if (commitMessagePrompt !== undefined && (typeof commitMessagePrompt !== "string" || !commitMessagePrompt.trim())) {
    badRequest("commitMessagePrompt must be a non-empty string");
  }
  if (permissionReviewModel !== undefined && typeof permissionReviewModel !== "string") badRequest("permissionReviewModel must be a string");
  if (typeof permissionReviewModel === "string" && permissionReviewModel) {
    const runtime = await getIntrospectionRuntime();
    if (!findAvailableModel(await runtime.session.modelRuntime.getAvailable(), permissionReviewModel)) {
      badRequest(`Unknown or unavailable approval model: ${permissionReviewModel}`);
    }
  }
  const current = getSettings();
  const requestedModel = (commitMessageModel as string | undefined) ?? current.commitMessageModel;
  const requestedThinkingLevel = ((commitMessageThinkingLevel as string | undefined) ?? current.commitMessageThinkingLevel) as CommitMessageThinkingLevel;
  if (requestedModel) {
    const runtime = await getIntrospectionRuntime();
    const model = findAvailableModel(await runtime.session.modelRuntime.getAvailable(), requestedModel);
    if (!model) badRequest(`Unknown or unavailable model: ${requestedModel}`);
    const thinkingLevels = getSupportedThinkingLevels(model as any);
    if (!thinkingLevels.includes(requestedThinkingLevel)) {
      badRequest(`Thinking level ${requestedThinkingLevel} is not supported by ${model.id}`, { availableThinkingLevels: thinkingLevels });
    }
  }
  return updateSettings({
    permissionReviewModel: (permissionReviewModel as string | undefined) ?? current.permissionReviewModel,
    commitMessageModel: requestedModel,
    commitMessageThinkingLevel: requestedThinkingLevel,
    commitMessagePrompt: (commitMessagePrompt as string | undefined) ?? current.commitMessagePrompt,
  });
}

export async function listModels() {
  const runtime = await getIntrospectionRuntime();
  return (await runtime.session.modelRuntime.getAvailable()).map((model: any) => ({
    id: model.id,
    provider: model.provider,
    value: `${model.provider}/${model.id}`,
    label: model.id,
    reasoning: !!model.reasoning,
    thinkingLevels: getSupportedThinkingLevels(model),
  }));
}
