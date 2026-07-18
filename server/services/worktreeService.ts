import fs from "fs";
import { WORKTREES_DIR } from "../config.ts";
import { getProjectById, projectAtDirectory } from "../projects.ts";
import { getSessionBinding } from "../sessionBindings.ts";
import { getRawManagedDirectories, hasManagedWorktrees, sourceProjectForSession } from "../sessionWorkspace.ts";
import { disposeRuntime, getSettledRuntime } from "../runtime/index.ts";
import { getManagedWorktreeRemovalStatus, recreateManagedWorktree, removeManagedWorktree } from "../git.ts";
import { conflict, notFound } from "./errors.ts";

function getManagedSession(sessionId: string) {
  const binding = getSessionBinding(sessionId);
  if (!binding || !hasManagedWorktrees(binding)) notFound("Managed worktrees not found");
  const configuredProject = getProjectById(binding.projectId);
  const project = sourceProjectForSession(configuredProject, binding);
  return { binding, project, directories: getRawManagedDirectories(binding) };
}

export async function getWorktreeStatus(sessionId: string) {
  const { project, directories } = getManagedSession(sessionId);
  const roots = await Promise.all(directories.map(async (directory) => {
    if (!directory.worktreeRoot || !directory.branch || !directory.baseBranch) throw new Error(`Incomplete worktree binding for ${directory.name}`);
    const status = await getManagedWorktreeRemovalStatus(
      projectAtDirectory(project, directory.directoryId), directory.worktreeRoot, directory.branch, directory.baseBranch, WORKTREES_DIR,
    );
    return { ...status, directoryId: directory.directoryId, name: directory.name, cwd: directory.path, worktreeRoot: directory.worktreeRoot, baseBranch: directory.baseBranch };
  }));
  return { roots, dirty: roots.some((root) => root.dirty), merged: roots.every((root) => root.merged) };
}

export async function removeSessionWorktrees(sessionId: string, confirmUnmerged: boolean) {
  const { project, directories } = getManagedSession(sessionId);
  const runtime = await getSettledRuntime(sessionId);
  if (runtime?.session?.isStreaming) conflict("Stop the session before removing its worktrees");
  const statuses = await Promise.all(directories.map(async (directory) => {
    if (!directory.worktreeRoot || !directory.branch || !directory.baseBranch) throw new Error(`Incomplete worktree binding for ${directory.name}`);
    return { directory, status: await getManagedWorktreeRemovalStatus(
      projectAtDirectory(project, directory.directoryId), directory.worktreeRoot, directory.branch, directory.baseBranch, WORKTREES_DIR,
    ) };
  }));
  const dirty = statuses.filter((entry) => entry.status.dirty);
  if (dirty.length) conflict(`Worktrees have uncommitted changes: ${dirty.map((entry) => entry.directory.name).join(", ")}`, { code: "dirty" });
  const unmerged = statuses.filter((entry) => !entry.status.merged);
  if (unmerged.length && !confirmUnmerged) {
    conflict(`Branches are not merged: ${unmerged.map((entry) => entry.directory.name).join(", ")}`, {
      code: "unmerged",
      branches: unmerged.map((entry) => entry.directory.branch),
    });
  }
  for (const { directory } of [...statuses].reverse()) {
    await removeManagedWorktree(projectAtDirectory(project, directory.directoryId), directory.worktreeRoot!, directory.branch!, directory.baseBranch!, WORKTREES_DIR);
  }
  disposeRuntime(sessionId);
  return { success: true, branches: directories.map((directory) => directory.branch), branchKept: true };
}

export async function recreateSessionWorktrees(sessionId: string) {
  const { binding, project, directories } = getManagedSession(sessionId);
  const recreated: typeof binding.directories = [];
  try {
    for (const directory of directories) {
      if (!directory.worktreeRoot || !directory.branch) throw new Error(`Incomplete worktree binding for ${directory.name}`);
      if (fs.existsSync(directory.path)) continue;
      await recreateManagedWorktree(projectAtDirectory(project, directory.directoryId), directory.worktreeRoot, directory.path, directory.branch, WORKTREES_DIR);
      recreated?.push(directory);
    }
    return { success: true, roots: getRawManagedDirectories(binding) };
  } catch (error) {
    for (const directory of [...(recreated ?? [])].reverse()) {
      if (!directory.worktreeRoot || !directory.branch || !directory.baseBranch) continue;
      await removeManagedWorktree(projectAtDirectory(project, directory.directoryId), directory.worktreeRoot, directory.branch, directory.baseBranch, WORKTREES_DIR).catch(() => {});
    }
    throw error;
  }
}
