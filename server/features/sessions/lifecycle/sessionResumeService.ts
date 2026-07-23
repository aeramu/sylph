import fs from "node:fs";
import path from "node:path";
import type { Project } from "../../projects/projectTypes.ts";
import { findProjectDirectoryByPath } from "../../projects/projectRepository.ts";
import type { SessionHistoryHandle, SessionHistoryPort } from "./sessionHistoryPort.ts";
import {
  appendWorkspaceMetadata, reconcileSessionBinding,
} from "../workspace/piSessionMetadata.ts";
import { getSessionBinding, saveSessionBinding } from "../workspace/workspaceBindingRepository.ts";
import type { SessionBinding } from "../workspace/workspaceTypes.ts";
import { workspaceProject } from "../workspace/sessionProject.ts";
import type { ResolvedSessionRuntime } from "./sessionWorkflowTypes.ts";

function projectDirectoryId(project: Project | undefined, binding: SessionBinding) {
  const selected = binding.directoryId
    ?? (project ? findProjectDirectoryByPath(project, binding.cwd)?.id : undefined)
    ?? project?.directories[0]?.id;
  return project && !project.directories.some((directory) => directory.id === selected)
    ? project.directories[0]?.id
    : selected;
}

function fromBinding(binding: SessionBinding, manager: SessionHistoryHandle, projects: Project[]): ResolvedSessionRuntime {
  const project = workspaceProject(binding, projects.find((entry) => entry.id === binding.projectId));
  return {
    sessionManager: manager,
    targetCwd: binding.cwd,
    runtimeProject: project,
    runtimeDirectoryId: projectDirectoryId(project, binding),
    created: false,
  };
}

export async function resumeSession(
  sessionId: string,
  projects: Project[],
  history: SessionHistoryPort,
): Promise<ResolvedSessionRuntime> {
  let binding = getSessionBinding(sessionId);
  let manager: SessionHistoryHandle | undefined;

  if (binding?.sessionFile && fs.existsSync(binding.sessionFile)) {
    const embedded = history.open(binding.sessionFile);
    if (embedded.getSessionId() === sessionId) {
      binding = reconcileSessionBinding(embedded, binding.sessionFile) ?? binding;
      manager = embedded;
    }
  }
  if (binding) {
    if (!fs.existsSync(binding.cwd)) throw new Error(`Session working directory no longer exists: ${binding.cwd}`);
    if (!manager) {
      const info = (await history.list(binding.cwd)).find((entry) => entry.id === sessionId);
      if (info) manager = history.open(info.path);
    }
    if (manager) return fromBinding(binding, manager, projects);
  }

  // Recover by portable embedded metadata when the external binding was lost.
  try {
    const info = (await history.listAll()).find((entry) => entry.id === sessionId);
    if (info?.path && fs.existsSync(info.path)) {
      const candidate = history.open(info.path);
      const recovered = reconcileSessionBinding(candidate, info.path);
      if (recovered) return fromBinding(recovered, candidate, projects);
    }
  } catch { /* continue with legacy directory-scoped discovery */ }

  const searchDirectories = [
    ...projects.flatMap((project) => project.directories.map((directory) => directory.path)).filter(fs.existsSync),
    process.cwd(),
  ];
  for (const directoryPath of searchDirectories) {
    try {
      const info = (await history.list(directoryPath)).find((entry) => entry.id === sessionId);
      if (!info) continue;
      const candidate = history.open(info.path);
      const recovered = reconcileSessionBinding(candidate, info.path);
      if (recovered) return fromBinding(recovered, candidate, projects);
      const project = projects.find((entry) => entry.directories.some((directory) => path.resolve(directory.path) === path.resolve(directoryPath)));
      const directory = project ? findProjectDirectoryByPath(project, directoryPath) : undefined;
      if (project) {
        const directoryId = directory?.id ?? project.directories[0]?.id;
        saveSessionBinding({ sessionId, projectId: project.id, directoryId, cwd: directoryPath, sessionFile: info.path });
        return { sessionManager: candidate, targetCwd: directoryPath, runtimeProject: project, runtimeDirectoryId: directoryId, created: false };
      }
      manager = candidate;
      break;
    } catch { /* ignore unreadable roots */ }
  }
  if (!manager) throw new Error(`Session ${sessionId} not found`);

  // A raw Pi session becomes a standalone Sylph session only when opened.
  const cwd = manager.getCwd?.() || process.cwd();
  const standalone: SessionBinding = {
    sessionId,
    directoryId: "root",
    cwd,
    directories: [{ directoryId: "root", name: path.basename(cwd) || "workspace", sourcePath: cwd, path: cwd }],
    sessionFile: manager.getSessionFile?.(),
    worktree: false,
  };
  appendWorkspaceMetadata(manager, standalone);
  saveSessionBinding(standalone);
  return { sessionManager: manager, targetCwd: cwd, runtimeProject: workspaceProject(standalone), runtimeDirectoryId: "root", created: false };
}
