import express from "express";
import { handleError } from "./routeHelpers.ts";
import fs from "fs";
import { WORKTREES_DIR } from "../config.ts";
import { getProjectById, projectAtDirectory } from "../projects.ts";
import { getSessionBinding } from "../sessionBindings.ts";
import { getRawManagedDirectories, hasManagedWorktrees } from "../sessionWorkspace.ts";
import { disposeRuntime, getSettledRuntime } from "../runtime/index.ts";
import { getManagedWorktreeRemovalStatus, recreateManagedWorktree, removeManagedWorktree } from "../git.ts";

export function registerWorktreeRoutes(router: express.Router): void {
  router.get("/api/sessions/:sessionId/worktree", async (req, res) => {
    const binding = getSessionBinding(req.params.sessionId);
    if (!binding || !hasManagedWorktrees(binding)) return res.status(404).json({ error: "Managed worktrees not found" });
    const project = getProjectById(binding.projectId);
    if (!project) return res.status(409).json({ error: "This worktree session no longer has a project configuration" });
    try {
      const roots = await Promise.all(getRawManagedDirectories(binding).map(async (directory) => {
        if (!directory.worktreeRoot || !directory.branch || !directory.baseBranch) throw new Error(`Incomplete worktree binding for ${directory.name}`);
        const status = await getManagedWorktreeRemovalStatus(
          projectAtDirectory(project, directory.directoryId), directory.worktreeRoot, directory.branch, directory.baseBranch, WORKTREES_DIR,
        );
        return { ...status, directoryId: directory.directoryId, name: directory.name, cwd: directory.path, worktreeRoot: directory.worktreeRoot, baseBranch: directory.baseBranch };
      }));
      res.json({ roots, dirty: roots.some((root) => root.dirty), merged: roots.every((root) => root.merged) });
    } catch (err) { handleError(res, err); }
  });

  router.delete("/api/sessions/:sessionId/worktree", async (req, res) => {
    const { sessionId } = req.params;
    const binding = getSessionBinding(sessionId);
    if (!binding || !hasManagedWorktrees(binding)) return res.status(404).json({ error: "Managed worktrees not found" });
    const project = getProjectById(binding.projectId);
    if (!project) return res.status(409).json({ error: "This worktree session no longer has a project configuration" });
    const runtime = await getSettledRuntime(sessionId);
    if (runtime?.session?.isStreaming) return res.status(409).json({ error: "Stop the session before removing its worktrees" });
    try {
      const managed = getRawManagedDirectories(binding);
      const statuses = await Promise.all(managed.map(async (directory) => {
        if (!directory.worktreeRoot || !directory.branch || !directory.baseBranch) throw new Error(`Incomplete worktree binding for ${directory.name}`);
        return { directory, status: await getManagedWorktreeRemovalStatus(
          projectAtDirectory(project, directory.directoryId), directory.worktreeRoot, directory.branch, directory.baseBranch, WORKTREES_DIR,
        ) };
      }));
      const dirty = statuses.filter((entry) => entry.status.dirty);
      if (dirty.length) return res.status(409).json({ error: `Worktrees have uncommitted changes: ${dirty.map((entry) => entry.directory.name).join(", ")}`, code: "dirty" });
      const unmerged = statuses.filter((entry) => !entry.status.merged);
      if (unmerged.length && req.query.confirmUnmerged !== "true") {
        return res.status(409).json({ error: `Branches are not merged: ${unmerged.map((entry) => entry.directory.name).join(", ")}`, code: "unmerged", branches: unmerged.map((entry) => entry.directory.branch) });
      }
      for (const { directory } of [...statuses].reverse()) {
        await removeManagedWorktree(projectAtDirectory(project, directory.directoryId), directory.worktreeRoot!, directory.branch!, directory.baseBranch!, WORKTREES_DIR);
      }
      disposeRuntime(sessionId);
      res.json({ success: true, branches: managed.map((directory) => directory.branch), branchKept: true });
    } catch (err) { handleError(res, err); }
  });

  router.post("/api/sessions/:sessionId/worktree/recreate", async (req, res) => {
    const binding = getSessionBinding(req.params.sessionId);
    if (!binding || !hasManagedWorktrees(binding)) return res.status(404).json({ error: "Managed worktrees not found" });
    const project = getProjectById(binding.projectId);
    if (!project) return res.status(409).json({ error: "This worktree session no longer has a project configuration" });
    const recreated: typeof binding.directories = [];
    try {
      for (const directory of getRawManagedDirectories(binding)) {
        if (!directory.worktreeRoot || !directory.branch) throw new Error(`Incomplete worktree binding for ${directory.name}`);
        if (fs.existsSync(directory.path)) continue;
        await recreateManagedWorktree(projectAtDirectory(project, directory.directoryId), directory.worktreeRoot, directory.path, directory.branch, WORKTREES_DIR);
        recreated?.push(directory);
      }
      res.json({ success: true, roots: getRawManagedDirectories(binding) });
    } catch (err) {
      // Recreate is all-or-nothing for roots added by this request.
      for (const directory of [...(recreated ?? [])].reverse()) {
        if (!directory.worktreeRoot || !directory.branch || !directory.baseBranch) continue;
        await removeManagedWorktree(projectAtDirectory(project, directory.directoryId), directory.worktreeRoot, directory.branch, directory.baseBranch, WORKTREES_DIR).catch(() => {});
      }
      handleError(res, err);
    }
  });

}
