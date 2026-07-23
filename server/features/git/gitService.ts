import { getIntrospectionRuntime } from "../../integrations/pi/runtime/runtimeManager.ts";
import { badRequest } from "../../platform/http/errors.ts";
import type { Project } from "../projects/projectTypes.ts";
import { getSettings } from "../settings/settingsRepository.ts";
import { generateCommitMessage } from "./commitMessageService.ts";
import { getStagedDiff } from "./index.ts";

export async function generateProjectCommitMessage(project: Project) {
  const stagedDiff = await getStagedDiff(project);
  if (!stagedDiff.trim()) badRequest("Stage changes before generating a commit message");
  const settings = getSettings();
  if (!settings.commitMessageModel) badRequest("Select a commit message model in Settings");
  const runtime = await getIntrospectionRuntime();
  return generateCommitMessage(runtime.session.modelRegistry, {
    model: settings.commitMessageModel,
    thinkingLevel: settings.commitMessageThinkingLevel,
    prompt: settings.commitMessagePrompt,
  }, stagedDiff);
}
