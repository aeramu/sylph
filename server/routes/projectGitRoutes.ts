import express from "express";
import { handleError } from "./routeHelpers.ts";
import { getProjectById, projectAtDirectory } from "../projects.ts";
import { getSessionBinding } from "../sessionBindings.ts";
import { getSessionDirectory, projectFromSessionBinding } from "../sessionWorkspace.ts";
import { listGitBranches } from "../git.ts";
import { createGitRouter } from "./gitRoutes.ts";

export function registerProjectGitRoutes(router: express.Router): void {
  router.get("/api/projects/:id/git/branches", async (req, res) => {
    const binding = getSessionBinding(req.query.sessionId);
    const project = getProjectById(req.params.id) ?? (binding ? projectFromSessionBinding(binding) : undefined);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (binding && binding.projectId && binding.projectId !== req.params.id) return res.status(400).json({ error: "Session does not belong to this project" });
    if (!binding && typeof req.query.directoryId === "string"
      && !project.directories.some((directory) => directory.id === req.query.directoryId)) {
      return res.status(400).json({ error: "Project directory not found" });
    }
    const gitProject = binding
      ? (() => {
          const directory = getSessionDirectory(project, binding, req.query.directoryId);
          return projectAtDirectory(project, directory.directoryId, directory.path);
        })()
      : projectAtDirectory(project, req.query.directoryId);
    try {
      res.json({ branches: await listGitBranches(gitProject) });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.use(createGitRouter());

}
