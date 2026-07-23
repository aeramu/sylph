import { getProjects } from "../../../features/projects/projectRepository.ts";
import { createSession } from "../../../features/sessions/lifecycle/sessionCreationService.ts";
import { resumeSession } from "../../../features/sessions/lifecycle/sessionResumeService.ts";
import { getWorkspaceMetadata, appendWorkspaceMetadata, reconcileSessionBinding } from "../../../features/sessions/workspace/piSessionMetadata.ts";
import { saveSessionBinding } from "../../../features/sessions/workspace/workspaceBindingRepository.ts";
import { piSessionHistory } from "../sessionHistoryAdapter.ts";
import { createExtensionUiContext } from "../ui/extensionUiAdapter.ts";
import { buildRuntime } from "./runtimeFactory.ts";
import { subscribeRuntimeEvents } from "./runtimeEventAdapter.ts";
import type { NewSessionOptions } from "../../../features/sessions/lifecycle/sessionWorkflowTypes.ts";
import type { SessionRuntimeEvents } from "./sessionRuntimeTypes.ts";

export type { NewSessionOptions } from "../../../features/sessions/lifecycle/sessionWorkflowTypes.ts";
export type { SessionRuntimeEvents } from "./sessionRuntimeTypes.ts";

export async function buildSessionRuntime(
  sessionId: string | undefined,
  projectId: string | undefined,
  options: NewSessionOptions = {},
  rollbackNewWorktreeSession: (sessionId: string) => Promise<void>,
  events: SessionRuntimeEvents,
): Promise<{ runtime: any; resolvedSessionId: string }> {
  const resolved = sessionId
    ? await resumeSession(sessionId, getProjects(), piSessionHistory)
    : await createSession(projectId, getProjects(), options, piSessionHistory);
  const resolvedSessionId = resolved.sessionManager.getSessionId();

  let runtime: any;
  try {
    runtime = await buildRuntime(resolved.sessionManager, resolved.targetCwd, {
      uiContext: createExtensionUiContext(resolvedSessionId),
      project: resolved.runtimeProject,
      directoryId: resolved.runtimeDirectoryId,
      sessionId: resolvedSessionId,
    });
  } catch (error) {
    if (resolved.created) {
      await rollbackNewWorktreeSession(resolvedSessionId)
        .catch((rollbackError) => console.error("Failed to roll back worktree:", rollbackError));
    }
    throw error;
  }

  const sessionFile = resolved.sessionManager.getSessionFile?.();
  const savedBinding = reconcileSessionBinding(resolved.sessionManager, sessionFile);
  // Lazily make externally-bound legacy sessions portable when resumed.
  if (savedBinding && !getWorkspaceMetadata(resolved.sessionManager)) {
    appendWorkspaceMetadata(resolved.sessionManager, savedBinding);
  }
  if (savedBinding && savedBinding.sessionFile !== sessionFile) {
    saveSessionBinding({ ...savedBinding, sessionFile });
  }

  subscribeRuntimeEvents(runtime, resolved.sessionManager, events);
  return { runtime, resolvedSessionId };
}
