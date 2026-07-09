// Restoring ask_user_question dialogs that outlived their runtime.
//
// If the server restarts (or the runtime is evicted) while the agent is blocked
// on a question, the dialog's promise dies but the question spec survives in the
// session file as a tool call with no result. These helpers rebuild the dialog
// so the user can still answer, and route the answer back into the session.

import { getOrInitRuntime, touchRuntime } from "./runtimes.ts";
import { findDanglingQuestion, formatAnswersAsUserReply } from "./askUserQuestion.ts";

// Questions whose reconstructed dialog the user dismissed, so reopening the
// session doesn't re-show them forever. In-memory on purpose — it only needs
// to outlive the dialog, not the server.
const dismissedInterruptedQuestions = new Set<string>();

// Build the dialog payload for a question that outlived its runtime (server
// restarted while the agent was blocked on it). Same shape as the live
// extension_ui_request broadcast, plus `reconstructed` so the client knows
// cancelling it leaves the session idle rather than resuming a turn.
export function reconstructInterruptedQuestion(sessionId: string, session: any): Record<string, any> | undefined {
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

// Answer a reconstructed question: the original tool call can't be completed
// anymore (pi synthesizes an error result for it), so the answers are sent
// back to the model as a regular prompt, which also restarts the turn.
// Dismissals just stop the dialog from re-appearing.
export async function resumeInterruptedQuestion(body: any): Promise<boolean> {
  const { sessionId, id, cancelled, answers } = body ?? {};
  if (typeof sessionId !== "string" || typeof id !== "string") return false;
  let runtime;
  try {
    runtime = await getOrInitRuntime(sessionId);
  } catch {
    return false;
  }
  if (runtime.session.isStreaming) return false;
  const dangling = findDanglingQuestion(runtime.session.messages || []);
  if (!dangling || dangling.toolCallId !== id) return false;
  dismissedInterruptedQuestions.add(id);
  if (cancelled) return true;
  touchRuntime(sessionId);
  const reply = formatAnswersAsUserReply(dangling.params, Array.isArray(answers) ? answers : []);
  runtime.session.prompt(reply).catch((err: any) => {
    console.error("Resumed question prompt error:", err);
  });
  return true;
}
