import path from "path";
import { randomUUID } from "crypto";
import type { Project } from "./projects.ts";
import { projectAtDirectory } from "./projects.ts";
import type { SessionDirectoryBinding } from "./sessionBindings.ts";
import { createManagedWorktree, discardManagedWorktree, worktreeBranchName } from "./git.ts";

export interface CreateProjectWorktreesOptions {
  managedRoot: string;
  baseBranches?: Record<string, string>;
  legacyBaseBranch?: string;
  branchPrompt: string;
  key?: string;
}

export interface CreatedProjectWorktrees {
  key: string;
  branch: string;
  directories: SessionDirectoryBinding[];
}

/**
 * Create one isolated checkout per project root. The operation is atomic from
 * Sylph's perspective: any failure removes all worktrees and generated branches
 * created earlier in this attempt, in reverse order.
 */
export async function createProjectWorktrees(
  project: Project,
  options: CreateProjectWorktreesOptions,
): Promise<CreatedProjectWorktrees> {
  const key = options.key ?? randomUUID();
  const branch = worktreeBranchName(options.branchPrompt || "chat", key);
  const created: Array<{ binding: SessionDirectoryBinding; project: Project }> = [];
  try {
    for (const directory of project.directories) {
      const baseBranch = options.baseBranches?.[directory.id] ?? options.legacyBaseBranch;
      if (!baseBranch) throw new Error(`Select a base branch for ${directory.name}`);
      const directoryProject = projectAtDirectory(project, directory.id);
      const worktree = await createManagedWorktree(
        directoryProject,
        path.join(options.managedRoot, project.id, key, directory.id),
        baseBranch,
        branch,
      );
      created.push({
        project: directoryProject,
        binding: {
          directoryId: directory.id,
          name: directory.name,
          path: worktree.path,
          branch: worktree.branch,
          baseBranch: worktree.baseBranch,
          worktreeRoot: worktree.worktreeRoot,
        },
      });
    }
    return { key, branch, directories: created.map((entry) => entry.binding) };
  } catch (error) {
    for (const entry of [...created].reverse()) {
      await discardManagedWorktree(entry.project, {
        path: entry.binding.path,
        worktreeRoot: entry.binding.worktreeRoot!,
        branch: entry.binding.branch!,
        baseBranch: entry.binding.baseBranch!,
      }, options.managedRoot).catch(() => {});
    }
    throw error;
  }
}

export async function discardProjectWorktrees(
  project: Project,
  directories: SessionDirectoryBinding[],
  managedRoot: string,
) {
  const errors: Error[] = [];
  for (const directory of [...directories].reverse()) {
    if (!directory.worktreeRoot || !directory.branch || !directory.baseBranch) continue;
    try {
      await discardManagedWorktree(projectAtDirectory(project, directory.directoryId), {
        path: directory.path,
        worktreeRoot: directory.worktreeRoot,
        branch: directory.branch,
        baseBranch: directory.baseBranch,
      }, managedRoot);
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)));
    }
  }
  if (errors.length) throw new AggregateError(errors, "Failed to discard one or more project worktrees");
}
