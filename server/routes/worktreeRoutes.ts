import express from "express";
import { getWorktreeStatus, recreateSessionWorktrees, removeSessionWorktrees } from "../services/worktreeService.ts";
import { handleError } from "./routeHelpers.ts";

export function registerWorktreeRoutes(router: express.Router): void {
  router.get("/api/sessions/:sessionId/worktree", async (req, res) => {
    try {
      res.json(await getWorktreeStatus(req.params.sessionId));
    } catch (error) {
      handleError(res, error);
    }
  });

  router.delete("/api/sessions/:sessionId/worktree", async (req, res) => {
    try {
      res.json(await removeSessionWorktrees(req.params.sessionId, req.query.confirmUnmerged === "true"));
    } catch (error) {
      handleError(res, error);
    }
  });

  router.post("/api/sessions/:sessionId/worktree/recreate", async (req, res) => {
    try {
      res.json(await recreateSessionWorktrees(req.params.sessionId));
    } catch (error) {
      handleError(res, error);
    }
  });
}
