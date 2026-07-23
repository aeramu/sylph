import path from "path";
import type { Project } from "../../projects/projectTypes.ts";
import { getProjectDirectory } from "../../projects/projectRepository.ts";
import type { SessionBinding, SessionDirectoryBinding } from "./workspaceTypes.ts";

export function getSessionDirectories(project: Project, binding: SessionBinding): SessionDirectoryBinding[] {
  if (binding.workspaceKind === "scratch") return [];
  if (Array.isArray(binding.directories) && binding.directories.length > 0) return binding.directories;
  const active = getProjectDirectory(project, binding.directoryId);
  if (!active) return [];
  return project.directories.map((directory) => ({
    directoryId: directory.id,
    name: directory.name,
    path: path.resolve(directory.id === active.id ? binding.cwd : directory.path),
    ...(directory.id === active.id && binding.worktree ? {
      branch: binding.branch,
      baseBranch: binding.baseBranch,
      worktreeRoot: binding.managedWorktreeRoot,
    } : {}),
  }));
}

export function getSessionDirectory(project: Project, binding: SessionBinding, directoryId: unknown): SessionDirectoryBinding {
  const directories = getSessionDirectories(project, binding);
  if (typeof directoryId === "string") {
    const match = directories.find((directory) => directory.directoryId === directoryId);
    if (!match) throw new Error("Project directory not found in session");
    return match;
  }
  const directory = directories.find((entry) => entry.directoryId === binding.directoryId) ?? directories[0];
  if (!directory) throw new Error("Session has no workspace directories");
  return directory;
}

export function projectFromSessionBinding(binding: SessionBinding, fallbackName = "No Project"): Project {
  const directories = binding.workspaceKind === "scratch"
    ? []
    : binding.directories?.length
      ? binding.directories.map((directory) => ({
          id: directory.directoryId,
          name: directory.name,
          path: path.resolve(directory.sourcePath ?? directory.path),
        }))
      : [{ id: binding.directoryId || "root", name: fallbackName, path: path.resolve(binding.cwd) }];
  const active = directories.find((directory) => directory.id === binding.directoryId) ?? directories[0];
  return {
    id: binding.projectId || `standalone:${binding.sessionId}`,
    name: fallbackName,
    path: active?.path ?? path.resolve(binding.cwd),
    directories,
    ...(active ? { activeDirectoryId: active.id } : {}),
  };
}

export function projectForSession(project: Project, binding: SessionBinding): Project {
  // The binding is a session-owned workspace snapshot and may contain roots
  // attached after the project was configured. Do not drop those roots merely
  // because they are absent from projects.json.
  const directories = getSessionDirectories(project, binding).map((directory) => ({
    id: directory.directoryId,
    name: directory.name,
    path: path.resolve(directory.path),
  }));
  const active = directories.find((directory) => directory.id === binding.directoryId) ?? directories[0];
  return { ...project, path: active?.path ?? path.resolve(binding.cwd), directories, ...(active ? { activeDirectoryId: active.id } : {}) };
}

/** Source checkouts for worktree lifecycle operations, including session-only roots. */
export function sourceProjectForSession(project: Project | undefined, binding: SessionBinding): Project {
  const fallback = projectFromSessionBinding(binding, project?.name);
  const configured = new Map(project?.directories.map((directory) => [directory.id, directory]) ?? []);
  const directories = getSessionDirectories(project ?? fallback, binding).map((directory) => ({
    id: directory.directoryId,
    name: directory.name,
    path: path.resolve(directory.sourcePath ?? configured.get(directory.directoryId)?.path ?? directory.path),
  }));
  const active = directories.find((directory) => directory.id === binding.directoryId) ?? directories[0];
  return {
    id: project?.id ?? fallback.id,
    name: project?.name ?? fallback.name,
    path: active?.path ?? path.resolve(binding.cwd),
    directories,
    ...(active ? { activeDirectoryId: active.id } : {}),
  };
}

export function hasManagedWorktrees(binding: SessionBinding) {
  return getRawManagedDirectories(binding).length > 0;
}

export function getRawManagedDirectories(binding: SessionBinding): SessionDirectoryBinding[] {
  if (binding.directories?.some((directory) => directory.worktreeRoot)) {
    return binding.directories.filter((directory) => !!directory.worktreeRoot);
  }
  if (binding.worktree && binding.managedWorktreeRoot) {
    return [{
      directoryId: binding.directoryId || "legacy",
      name: "root",
      path: binding.cwd,
      branch: binding.branch,
      baseBranch: binding.baseBranch,
      worktreeRoot: binding.managedWorktreeRoot,
    }];
  }
  return [];
}
