import express from "express";
import { getProjects } from "../projects.ts";
import { createProjectFromInput, deleteProject, updateProjectFromInput } from "../services/projectService.ts";
import { handleError } from "./routeHelpers.ts";

export function registerProjectRoutes(router: express.Router): void {
  router.get("/api/projects", (_req, res) => {
    res.json({ projects: getProjects() });
  });

  router.post("/api/projects", (req, res) => {
    try {
      res.json(createProjectFromInput(req.body ?? {}));
    } catch (error) {
      handleError(res, error);
    }
  });

  router.put("/api/projects/:id", (req, res) => {
    try {
      res.json(updateProjectFromInput(req.params.id, req.body ?? {}));
    } catch (error) {
      handleError(res, error);
    }
  });

  router.delete("/api/projects/:id", async (req, res) => {
    try {
      await deleteProject(req.params.id);
      res.json({ success: true });
    } catch (error) {
      handleError(res, error);
    }
  });
}
