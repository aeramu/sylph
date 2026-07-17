import fs from "fs";
import path from "path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { getPendingUiRequests } from "../uiBridge.ts";
import { getActiveRuntime } from "../runtime/index.ts";
import { getProjects, getProjectById } from "../projects.ts";
import { getRawManagedDirectories, getSessionDirectories, hasManagedWorktrees } from "../sessionWorkspace.ts";
import { reconcileSessionBinding, recoverSessionBindingsFromPi } from "../piSessionMetadata.ts";
import { notFound } from "./errors.ts";

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
    targetDir = project.path;
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

  const byId = new Map<string, any>();
  if (!projectId) {
    try { for (const session of await SessionManager.listAll()) byId.set(session.id, session); } catch { /* cwd fallback below */ }
  }
  for (const directory of directories) {
    if (!fs.existsSync(directory)) continue;
    try { for (const session of await SessionManager.list(directory)) byId.set(session.id, session); } catch { /* unavailable roots do not hide others */ }
  }
  for (const binding of bindings) {
    if (byId.has(binding.sessionId) || !binding.sessionFile || !fs.existsSync(binding.sessionFile)) continue;
    try {
      const detached = SessionManager.open(binding.sessionFile);
      const info = (await SessionManager.list(binding.cwd, path.dirname(binding.sessionFile))).find((entry) => entry.id === binding.sessionId);
      if (info) byId.set(info.id, info);
      else if (detached.getSessionId() === binding.sessionId) {
        const header = detached.getHeader();
        byId.set(binding.sessionId, {
          id: binding.sessionId,
          path: binding.sessionFile,
          cwd: binding.cwd,
          created: new Date(header?.timestamp || 0),
          modified: fs.statSync(binding.sessionFile).mtime,
          messageCount: detached.buildSessionContext().messages.length,
          firstMessage: "Worktree session",
          allMessagesText: "",
        });
      }
    } catch { /* malformed session binding */ }
  }

  for (const session of byId.values()) {
    if (session.path && fs.existsSync(session.path)) {
      try { reconcileSessionBinding(SessionManager.open(session.path), session.path); } catch { /* malformed legacy session */ }
    }
  }

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
      const sourcePath = activeDirectory?.sourcePath ?? configuredDirectory?.path ?? binding?.cwd ?? session.cwd;
      return {
        ...session,
        ...(status ? { status } : {}),
        projectId: binding?.projectId,
        projectName: project?.name,
        directoryName: activeDirectory?.name || path.basename(binding?.cwd || session.cwd || "") || "Workspace",
        cwd: binding?.cwd || session.cwd,
        ...(sourcePath ? { sourcePath } : {}),
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
