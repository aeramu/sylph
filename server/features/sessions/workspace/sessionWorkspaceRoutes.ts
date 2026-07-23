import express from "express";
import { attachFolderToSession, listAttachFolderBranches } from "./sessionWorkspaceService.ts";
import { handleError } from "../../../platform/http/routeError.ts";

export function registerSessionWorkspaceRoutes(router: express.Router): void {
  router.post("/api/sessions/:sessionId/folders/branches", async (req, res) => {
    try {
      res.json(await listAttachFolderBranches(req.params.sessionId, req.body ?? {}));
    } catch (error) {
      handleError(res, error);
    }
  });

  router.post("/api/sessions/:sessionId/folders", async (req, res) => {
    try {
      res.json(await attachFolderToSession(req.params.sessionId, req.body ?? {}));
    } catch (error) {
      handleError(res, error);
    }
  });
}
