import { getSupportedThinkingLevels as getThinkingLevels } from "@earendil-works/pi-ai";
export { completeSimple } from "@earendil-works/pi-ai/compat";
export type { AssistantMessage, Model } from "@earendil-works/pi-ai/compat";

/** Normalize the Pi model helper behind a Sylph-owned integration boundary. */
export function getSupportedThinkingLevels(model: any): string[] {
  return getThinkingLevels(model) as string[];
}
