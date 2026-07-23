import { getOrInitRuntime, touchRuntime } from "../../integrations/pi/runtime/runtimeManager.ts";
import { findDanglingQuestion, formatAnswersAsUserReply } from "./questionService.ts";

// In-memory by design: this suppresses a dismissed reconstructed dialog for
// the current process without mutating portable session history.
const dismissedInterruptedQuestions = new Set<string>();

export interface ReconstructedQuestionRequest extends Record<string, unknown> {
  sessionId: string;
  type: "extension_ui_request";
  id: string;
  method: "questions";
  questions: unknown[];
  reconstructed: true;
}

export function reconstructInterruptedQuestion(sessionId: string, session: any): ReconstructedQuestionRequest | undefined {
  if (session.isStreaming) return undefined;
  const dangling = findDanglingQuestion(session.messages || []);
  if (!dangling || dismissedInterruptedQuestions.has(dangling.toolCallId)) return undefined;
  return {
    sessionId,
    type: "extension_ui_request",
    id: dangling.toolCallId,
    method: "questions",
    questions: dangling.params?.questions ?? [],
    reconstructed: true,
  };
}

export async function resumeInterruptedQuestion(body: any): Promise<boolean> {
  const { sessionId, id, cancelled, answers } = body ?? {};
  if (typeof sessionId !== "string" || typeof id !== "string") return false;
  let runtime;
  try { runtime = await getOrInitRuntime(sessionId); }
  catch { return false; }
  if (runtime.session.isStreaming) return false;
  const dangling = findDanglingQuestion(runtime.session.messages || []);
  if (!dangling || dangling.toolCallId !== id) return false;
  dismissedInterruptedQuestions.add(id);
  if (cancelled) return true;
  touchRuntime(sessionId);
  const reply = formatAnswersAsUserReply(dangling.params, Array.isArray(answers) ? answers : []);
  runtime.session.prompt(reply).catch((error: unknown) => console.error("Resumed question prompt error:", error));
  return true;
}
