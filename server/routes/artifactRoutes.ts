import express from "express";
import { listSessionArtifacts } from "../artifacts.ts";
import { getSessionBinding } from "../sessionBindings.ts";
import { handleError } from "./routeHelpers.ts";

export function registerArtifactRoutes(router: express.Router): void {
  // Metadata only. Artifact contents are read through /api/fs/read.
  router.get("/api/sessions/:sessionId/artifacts", async (req, res) => {
    try {
      const { sessionId } = req.params;
      if (!getSessionBinding(sessionId)) return res.status(404).json({ error: "Session not found" });
      res.json({ artifacts: await listSessionArtifacts(sessionId) });
    } catch (error) {
      handleError(res, error);
    }
  });
}
