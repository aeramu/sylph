import express from "express";
import { asyncRoute } from "../../../platform/http/routeError.ts";
import { abortSession, acknowledgeSessionArtifact, getSessionDetail, respondToSessionUi } from "./sessionDetailService.ts";
import { deleteSession, moveSessionToProject, renameSession, setSessionModel, setSessionPermissionMode } from "./sessionMutationService.ts";
import { listSessions } from "./sessionQueryService.ts";

export function registerSessionRoutes(router: express.Router): void {
  router.post("/api/sessions/:sessionId/artifact-response", (req, res) => {
    const requestId = req.body?.id;
    if (typeof requestId !== "string") return res.status(400).json({ error: "id is required" });
    if (!acknowledgeSessionArtifact(String(req.params.sessionId), requestId)) return res.status(404).json({ error: "no pending artifact request for this id" });
    res.json({ ok: true });
  });
  router.post("/api/sessions/:sessionId/ui-response", asyncRoute(async (req, res) => {
    if (typeof req.body?.id !== "string") return res.status(400).json({ error: "id is required" });
    if (!await respondToSessionUi(String(req.params.sessionId), req.body)) return res.status(404).json({ error: "no pending request for this id" });
    res.json({ ok: true });
  }));
  router.get("/api/sessions", asyncRoute(async (req, res) => {
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
    res.json({ sessions: await listSessions({ projectId, unprojected: req.query.scope === "unprojected" }) });
  }));
  router.get("/api/sessions/:sessionId", asyncRoute(async (req, res) => res.json(await getSessionDetail(String(req.params.sessionId)))));
  router.patch("/api/sessions/:sessionId/name", asyncRoute(async (req, res) => res.json(await renameSession(String(req.params.sessionId), req.body?.name))));
  router.patch("/api/sessions/:sessionId/project", asyncRoute(async (req, res) => res.json(await moveSessionToProject(String(req.params.sessionId), req.body?.projectId))));
  router.patch("/api/sessions/:sessionId/permission-mode", asyncRoute(async (req, res) => res.json(await setSessionPermissionMode(String(req.params.sessionId), req.body?.permissionMode))));
  router.patch("/api/sessions/:sessionId/model", asyncRoute(async (req, res) => res.json(await setSessionModel(String(req.params.sessionId), req.body?.modelId, undefined, req.body?.thinkingLevel))));
  router.delete("/api/sessions/:sessionId", asyncRoute(async (req, res) => res.json(await deleteSession(String(req.params.sessionId)))));
  router.post("/api/sessions/:sessionId/abort", asyncRoute(async (req, res) => res.json(await abortSession(String(req.params.sessionId)))));
}
