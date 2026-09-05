import fs from "node:fs";
import { SessionManager } from "../../../integrations/pi/sessionSdk.ts";
import { getActiveRuntime, getContextInfo, getOrInitRuntime, getSessionEventSequence } from "../../../integrations/pi/runtime/runtimeManager.ts";
import { reconstructInterruptedQuestion, resumeInterruptedQuestion } from "../../questions/interruptedQuestionService.ts";
import { acknowledgeArtifactRequest, getPendingArtifactRequest } from "../../artifacts/artifactPresentationRequests.ts";
import { getPendingUiRequests, resolveUiRequest } from "../../interactions/uiRequestBroker.ts";
import { getSessionStatuses } from "../../interactions/sessionStatusStore.ts";
import { notFound } from "../../../platform/http/errors.ts";
import { getRawManagedDirectories, hasManagedWorktrees } from "../workspace/sessionWorkspace.ts";
import { getSessionBinding } from "../workspace/workspaceBindingRepository.ts";
import { getPendingUserMessages } from "../../../integrations/pi/runtime/pendingUserMessages.ts";

export async function getSessionDetail(sessionId: string) {
  const binding = getSessionBinding(sessionId);
  const worktreeMissing = !!binding && hasManagedWorktrees(binding)
    && getRawManagedDirectories(binding).some((directory) => !fs.existsSync(directory.path));
  const responseBinding = binding ? { ...binding, worktreeMissing } : binding;
  if (worktreeMissing) {
    if (!binding?.sessionFile || !fs.existsSync(binding.sessionFile)) notFound("Session history not found");
    const detached = SessionManager.open(binding.sessionFile);
    return {
      messages: detached.buildSessionContext().messages || [], eventSeq: getSessionEventSequence(sessionId),
      name: detached.getSessionName(), isStreaming: false, pendingUiRequests: [],
      pendingArtifactRequest: getPendingArtifactRequest(sessionId), statuses: getSessionStatuses(sessionId),
      context: undefined, binding: responseBinding,
    };
  }
  const runtime = await getOrInitRuntime(sessionId);
  const pendingUiRequests = getPendingUiRequests(sessionId);
  if (pendingUiRequests.length === 0) {
    const interrupted = reconstructInterruptedQuestion(sessionId, runtime.session);
    if (interrupted) pendingUiRequests.push(interrupted);
  }
  // Clone live state before reading eventSeq. These operations are synchronous,
  // so the returned sequence describes exactly this snapshot; later events are
  // captured and replayed by the client's history buffer without gaps.
  const messages = structuredClone(runtime.session.messages || []);
  const streamingMessage = runtime.session.state?.streamingMessage
    ? structuredClone(runtime.session.state.streamingMessage)
    : undefined;
  const pendingUserMessages = structuredClone(getPendingUserMessages(runtime.session));
  const pendingToolCalls = runtime.session.state?.pendingToolCalls;
  const activeToolCallIds = pendingToolCalls instanceof Set ? [...pendingToolCalls] : [];
  const eventSeq = getSessionEventSequence(sessionId);
  return {
    messages, eventSeq,
    name: runtime.session.sessionManager?.getSessionName?.(), isStreaming: !!runtime.session.isStreaming, pendingUiRequests,
    pendingArtifactRequest: getPendingArtifactRequest(sessionId), statuses: getSessionStatuses(sessionId),
    context: getContextInfo(runtime.session), binding: responseBinding,
    ...(streamingMessage ? { streamingMessage } : {}),
    pendingUserMessages: pendingUserMessages.map((message) => ({
      role: "user",
      content: [
        { type: "text", text: message.displayText ?? "" },
        ...(message.images ?? []),
      ],
      clientMessageId: message.clientMessageId,
      steered: message.steered,
    })),
    activeToolCallIds,
  };
}

export async function respondToSessionUi(sessionId: string, input: Record<string, unknown>) {
  if (typeof input.id !== "string") return false;
  const response = { ...input, sessionId };
  return resolveUiRequest(input.id, response) || await resumeInterruptedQuestion(response);
}

export function acknowledgeSessionArtifact(sessionId: string, requestId: string) {
  return acknowledgeArtifactRequest(sessionId, requestId);
}

export async function abortSession(sessionId: string) {
  const runtime = getActiveRuntime(sessionId);
  if (!runtime) notFound("Session not found");
  await runtime.session.abort();
  return { success: true as const };
}
