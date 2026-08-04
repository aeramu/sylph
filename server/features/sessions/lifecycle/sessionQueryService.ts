import fs from "fs";
import path from "path";
import { getPendingUiRequests } from "../../interactions/uiRequestBroker.ts";
import { getActiveRuntime } from "../../../integrations/pi/runtime/runtimeManager.ts";
import { getProjects, getProjectById } from "../../projects/projectRepository.ts";
import { getRawManagedDirectories, getSessionDirectories, hasManagedWorktrees } from "../workspace/sessionWorkspace.ts";
import { recoverSessionBindingsFromPi } from "../workspace/piSessionMetadata.ts";
import { notFound } from "../../../platform/http/errors.ts";
import { collectSessionSummaries } from "./sessionRepository.ts";

export interface SessionListQuery {
  projectId?: string;
  unprojected?: boolean;
}

export async function listSessions(query: SessionListQuery = {}): Promise<any[]> {
  const { projectId, unprojected = false } = query;
  let targetDir = process.cwd();
  let bindings = await recoverSessionBindingsFromPi();

  if (projectId) {
    const project = getProjects().find((entry) => entry.id === projectId);
    if (!project) notFound("Project not found");
    if (project.path) targetDir = project.path;
    bindings = bindings.filter((binding) => binding.projectId === projectId);
  } else if (unprojected) {
    bindings = bindings.filter((binding) => !binding.projectId);
  }

  const selectedProject = projectId ? getProjectById(projectId) : undefined;
  const directories = new Set<string>(selectedProject
    ? selectedProject.directories.map((entry) => entry.path)
    : bindings.map((binding) => binding.cwd).filter((directory) => fs.existsSync(directory)));
  if (!projectId && !unprojected) directories.add(targetDir);
  for (const binding of bindings) if (fs.existsSync(binding.cwd)) directories.add(binding.cwd);

  const byId = await collectSessionSummaries(bindings, directories, !projectId);

  const allBindings = await recoverSessionBindingsFromPi();
  bindings = projectId
    ? allBindings.filter((binding) => binding.projectId === projectId)
    : unprojected
      ? allBindings.filter((binding) => !binding.projectId)
      : allBindings;
  const bindingById = new Map(bindings.map((binding) => [binding.sessionId, binding]));
  const allBindingById = new Map(allBindings.map((binding) => [binding.sessionId, binding]));
  const projectsById = new Map(getProjects().map((project) => [project.id, project]));

  return Array.from(byId.values())
    .filter((session) => projectId ? bindingById.has(session.id) : unprojected ? !allBindingById.get(session.id)?.projectId : true)
    .map((session) => {
      const binding = allBindingById.get(session.id);
      const status = getPendingUiRequests(session.id).length > 0
        ? "needsInput"
        : getActiveRuntime(session.id)?.session?.isStreaming ? "working" : undefined;
      const project = binding?.projectId ? projectsById.get(binding.projectId) : selectedProject;
      const sessionDirectories = binding?.directories ?? (binding && project ? getSessionDirectories(project, binding) : undefined);
      const directoryNames = sessionDirectories?.map((directory) => directory.name);
      const activeDirectory = sessionDirectories?.find((directory) => directory.directoryId === binding?.directoryId) ?? sessionDirectories?.[0];
      const configuredDirectory = project?.directories.find((directory) => directory.id === (activeDirectory?.directoryId ?? binding?.directoryId));
      const sourcePath = binding?.workspaceKind === "scratch" ? undefined : activeDirectory?.sourcePath ?? configuredDirectory?.path ?? binding?.cwd ?? session.cwd;
      // SessionManager summaries include allMessagesText for Pi's terminal
      // session search. The web sidebar never uses it, and returning it made
      // this endpoint grow with the full text of every conversation.
      return {
        id: session.id,
        ...(session.name ? { name: session.name } : {}),
        modified: session.modified,
        created: session.created,
        messageCount: session.messageCount,
        firstMessage: session.firstMessage,
        ...(status ? { status } : {}),
        projectId: binding?.projectId,
        projectName: project?.name,
        directoryName: binding?.workspaceKind === "scratch" ? "Temporary" : activeDirectory?.name || path.basename(binding?.cwd || session.cwd || "") || "Workspace",
        cwd: binding?.cwd || session.cwd,
        ...(sourcePath ? { sourcePath } : {}),
        ...(binding?.workspaceKind ? { workspaceKind: binding.workspaceKind } : {}),
        ...(binding?.directoryId ? { directoryId: binding.directoryId } : {}),
        ...(directoryNames?.length ? { directoryNames } : {}),
        ...(binding?.branch ? { branch: binding.branch } : {}),
        ...(binding && hasManagedWorktrees(binding) ? {
          worktree: true,
          worktreeMissing: getRawManagedDirectories(binding).some((directory) => !fs.existsSync(directory.path)),
        } : {}),
      };
    })
    .sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
}
