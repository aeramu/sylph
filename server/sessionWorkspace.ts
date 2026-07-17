import path from "path";
import type { Project } from "./projects.ts";
import { getProjectDirectory } from "./projects.ts";
import type { SessionBinding, SessionDirectoryBinding } from "./sessionBindings.ts";

export function getSessionDirectories(project: Project, binding: SessionBinding): SessionDirectoryBinding[] {
  if (Array.isArray(binding.directories) && binding.directories.length > 0) return binding.directories;
  const active = getProjectDirectory(project, binding.directoryId);
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
  return directories.find((directory) => directory.directoryId === binding.directoryId) ?? directories[0];
}

export function projectFromSessionBinding(binding: SessionBinding, fallbackName = "No Project"): Project {
  const directories = binding.directories?.length
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
    path: active.path,
    directories,
    activeDirectoryId: active.id,
  };
}

export function projectForSession(project: Project, binding: SessionBinding): Project {
  const sessionDirectories = new Map(getSessionDirectories(project, binding).map((directory) => [directory.directoryId, directory]));
  const directories = project.directories.map((directory) => ({
    ...directory,
    path: path.resolve(sessionDirectories.get(directory.id)?.path ?? directory.path),
  }));
  const active = directories.find((directory) => directory.id === binding.directoryId) ?? directories[0];
  return { ...project, path: active.path, directories, activeDirectoryId: active.id };
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
