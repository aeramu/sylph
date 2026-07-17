import express from "express";
import { handleError } from "./routeHelpers.ts";
import fs from "fs";
import path from "path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createProject, getProjects, saveProjects, getProjectById, updateProject, type ProjectDirectoryInput } from "../projects.ts";
import { getProjectSessionBindings, saveSessionBinding } from "../sessionBindings.ts";
import { recoverSessionBindingsFromPi } from "../piSessionMetadata.ts";

export function registerProjectRoutes(router: express.Router): void {
  router.get("/api/projects", (_req, res) => {
    res.json({ projects: getProjects() });
  });

  function validateProjectDirectories(requestedDirectories: unknown): { directories: ProjectDirectoryInput[]; paths: Set<string> } | { error: string } {
    if (!Array.isArray(requestedDirectories) || requestedDirectories.length === 0) return { error: "At least one directory is required" };
    const directories: ProjectDirectoryInput[] = [];
    const paths = new Set<string>();
    for (const entry of requestedDirectories) {
      if (!entry || typeof entry.path !== "string") return { error: "Invalid directory path" };
      const normalized = path.resolve(entry.path);
      let stat: fs.Stats;
      try { stat = fs.statSync(normalized); } catch { return { error: `Directory not found: ${normalized}` }; }
      if (!stat.isDirectory()) return { error: `Not a directory: ${normalized}` };
      if (paths.has(normalized)) return { error: `Duplicate directory: ${normalized}` };
      paths.add(normalized);
      directories.push({ id: entry.id, name: entry.name, path: normalized });
    }
    return { directories, paths };
  }

  router.post("/api/projects", (req, res) => {
    const { path: legacyPath, name } = req.body ?? {};
    const requestedDirectories = Array.isArray(req.body?.directories)
      ? req.body.directories
      : typeof legacyPath === "string" ? [{ path: legacyPath }] : [];
    const validated = validateProjectDirectories(requestedDirectories);
    if ("error" in validated) return res.status(400).json({ error: validated.error });

    const projects = getProjects();
    const existing = projects.find((project) => project.directories.some((directory) => validated.paths.has(path.resolve(directory.path))));
    if (existing) return res.status(409).json({ error: "A directory is already part of another project", project: existing });
    const newProject = createProject({ name, directories: validated.directories });
    projects.push(newProject);
    saveProjects(projects);
    res.json(newProject);
  });

  router.put("/api/projects/:id", (req, res) => {
    const projects = getProjects();
    const index = projects.findIndex((project) => project.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: "Project not found" });
    const existing = projects[index];
    const validated = validateProjectDirectories(req.body?.directories);
    if ("error" in validated) return res.status(400).json({ error: validated.error });
    const conflict = projects.find((project) => project.id !== existing.id
      && project.directories.some((directory) => validated.paths.has(path.resolve(directory.path))));
    if (conflict) return res.status(409).json({ error: `A directory is already part of ${conflict.name}`, project: conflict });

    const retainedIds = new Set(validated.directories.map((directory) => directory.id).filter((id): id is string => typeof id === "string"));
    const removedIds = existing.directories.filter((directory) => !retainedIds.has(directory.id)).map((directory) => directory.id);
    const blocking = getProjectSessionBindings(existing.id).find((binding) =>
      (binding.directoryId ? removedIds.includes(binding.directoryId) : false)
      || binding.directories?.some((directory) => removedIds.includes(directory.directoryId)));
    if (blocking) return res.status(409).json({ error: "Cannot remove a directory while a saved session still references it" });

    const updated = updateProject(existing, { name: req.body?.name, directories: validated.directories });
    projects[index] = updated;
    saveProjects(projects);
    res.json(updated);
  });

  router.delete("/api/projects/:id", async (req, res) => {
    const project = getProjectById(req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found" });
    try {
      // Sessions retain their workspace snapshots; only their organizational
      // project link is removed, so they move into the virtual No Project group.
      await recoverSessionBindingsFromPi(project.id);
      for (const binding of getProjectSessionBindings(project.id)) {
        const detached = { ...binding, projectId: undefined };
        if (binding.sessionFile && fs.existsSync(binding.sessionFile)) {
          const manager = SessionManager.open(binding.sessionFile);
          manager.appendCustomEntry("sylph.workspace", {
            version: 1,
            directoryId: detached.directoryId,
            cwd: detached.cwd,
            directories: detached.directories,
            branch: detached.branch,
            baseBranch: detached.baseBranch,
            worktree: detached.worktree,
            managedWorktreeRoot: detached.managedWorktreeRoot,
          });
        }
        saveSessionBinding(detached);
      }
      saveProjects(getProjects().filter((entry) => entry.id !== project.id));
      res.json({ success: true });
    } catch (err) { handleError(res, err); }
  });

}
