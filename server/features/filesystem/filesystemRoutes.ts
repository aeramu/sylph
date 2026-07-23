import express from "express";
import { asyncRoute } from "../../platform/http/routeError.ts";
import { createDirectory, listDirectories, readScopedFile, searchWorkspaceFiles } from "./filesystemService.ts";

export function registerFilesystemRoutes(router: express.Router): void {
  router.get("/api/fs/read", asyncRoute(async (req, res) => {
    res.json(await readScopedFile({ scope: req.query.scope, sessionId: req.query.sessionId, path: req.query.path }));
  }));

  router.get("/api/fs/files", asyncRoute(async (req, res) => {
    const files = await searchWorkspaceFiles({
      sessionId: req.query.sessionId,
      projectId: req.query.projectId,
      directoryId: req.query.directoryId,
      query: req.query.q,
    });
    res.json({ files });
  }));

  router.get("/api/fs/list", asyncRoute(async (req, res) => {
    res.json(await listDirectories(req.query.path));
  }));

  router.post("/api/fs/directories", asyncRoute(async (req, res) => {
    res.status(201).json({ directory: await createDirectory(req.body ?? {}) });
  }));
}
