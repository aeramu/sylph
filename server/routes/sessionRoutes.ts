import express from "express";
import { handleError } from "./routeHelpers.ts";
import fs from "fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  acknowledgeArtifactRequest, getPendingArtifactRequest, getPendingUiRequests, getSessionStatuses, resolveUiRequest,
} from "../uiBridge.ts";
import { getActiveRuntime, getOrInitRuntime, getContextInfo, getSessionEventSequence } from "../runtime/index.ts";
import { reconstructInterruptedQuestion, resumeInterruptedQuestion } from "../interruptedQuestions.ts";
import { getSessionBinding } from "../sessionBindings.ts";
import { getRawManagedDirectories, hasManagedWorktrees } from "../sessionWorkspace.ts";
import { listSessions } from "../services/sessionQueryService.ts";
import { deleteSession, moveSessionToProject } from "../services/sessionMutationService.ts";

export function registerSessionRoutes(router: express.Router): void {
  router.post("/api/sessions/:sessionId/artifact-response", (req, res) => {
    const requestId = req.body?.id;
    if (typeof requestId !== "string") return res.status(400).json({ error: "id is required" });
    if (!acknowledgeArtifactRequest(req.params.sessionId, requestId)) {
      return res.status(404).json({ error: "no pending artifact request for this id" });
    }
    res.json({ ok: true });
  });

  router.post("/api/sessions/:sessionId/ui-response", async (req, res) => {
    const { sessionId } = req.params;
    const { id } = req.body;
    if (typeof id !== "string") {
      return res.status(400).json({ error: "id is required" });
    }
    const body = { ...req.body, sessionId };
    if (resolveUiRequest(id, body)) {
      return res.json({ ok: true });
    }
    // Nothing live is waiting on this id — it may be a question dialog
    // rebuilt after a server restart (see /api/sessions/:sessionId).
    if (await resumeInterruptedQuestion(body)) {
      return res.json({ ok: true });
    }
    res.status(404).json({ error: "no pending request for this id" });
  });


  router.get("/api/sessions", async (req, res) => {
    try {
      const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
      const sessions = await listSessions({ projectId, unprojected: req.query.scope === "unprojected" });
      res.json({ sessions });
    } catch (error) {
      handleError(res, error);
    }
  });


  router.get("/api/sessions/:sessionId", async (req, res) => {
    const { sessionId } = req.params;
    try {
      const binding = getSessionBinding(sessionId);
      const worktreeMissing = !!binding && hasManagedWorktrees(binding)
        && getRawManagedDirectories(binding).some((directory) => !fs.existsSync(directory.path));
      const responseBinding = binding ? { ...binding, worktreeMissing } : binding;

      // A removed worktree cannot host a Pi runtime, but its JSONL session is
      // still readable. Return detached history so the chat can render the
      // Restore worktree action instead of failing runtime initialization.
      if (worktreeMissing) {
        if (!binding?.sessionFile || !fs.existsSync(binding.sessionFile)) {
          return res.status(404).json({ error: "Session history not found" });
        }
        const detached = SessionManager.open(binding.sessionFile);
        return res.json({
          messages: detached.buildSessionContext().messages || [],
          eventSeq: getSessionEventSequence(sessionId),
          isStreaming: false,
          pendingUiRequests: [],
          pendingArtifactRequest: getPendingArtifactRequest(sessionId),
          statuses: getSessionStatuses(sessionId),
          context: undefined,
          binding: responseBinding,
        });
      }

      const runtime = await getOrInitRuntime(sessionId);
      // Dialogs the agent is still blocked on; their SSE broadcast was a
      // one-shot the client may have missed while on another session.
      const pendingUiRequests = getPendingUiRequests(sessionId);
      if (pendingUiRequests.length === 0) {
        // A question interrupted by a server restart: the dialog's promise
        // died with the old process, but the question spec survives in the
        // session file as a tool call without a result. Rebuild the dialog so
        // the user can still answer (see /api/sessions/:sessionId/ui-response for the resume).
        const interrupted = reconstructInterruptedQuestion(sessionId, runtime.session);
        if (interrupted) pendingUiRequests.push(interrupted);
      }
      res.json({
        messages: runtime.session.messages || [],
        eventSeq: getSessionEventSequence(sessionId),
        // Lets the client restore the working indicator when it opens a
        // session that is currently mid-turn.
        isStreaming: !!runtime.session.isStreaming,
        pendingUiRequests,
        // show_artifact is also a one-shot SSE event, but unlike transient UI
        // updates its latest unviewed request survives in memory until the
        // browser opens the artifact and acknowledges it.
        pendingArtifactRequest: getPendingArtifactRequest(sessionId),
        // Latest extension statuses (ctx.ui.setStatus); their live SSE
        // broadcasts are one-shot and were dropped while this session wasn't
        // the active one.
        statuses: getSessionStatuses(sessionId),
        // Seed for the composer's context-window indicator; kept fresh after
        // load by the context snapshots attached to SSE events.
        context: getContextInfo(runtime.session),
        binding: responseBinding,
      });
    } catch (err) {
      handleError(res, err);
    }
  });


  router.patch("/api/sessions/:sessionId/project", async (req, res) => {
    try {
      res.json(await moveSessionToProject(req.params.sessionId, req.body?.projectId));
    } catch (error) {
      handleError(res, error);
    }
  });

  router.delete("/api/sessions/:sessionId", async (req, res) => {
    try {
      res.json(await deleteSession(req.params.sessionId));
    } catch (error) {
      handleError(res, error);
    }
  });

  router.post("/api/sessions/:sessionId/abort", async (req, res) => {
    const { sessionId } = req.params;
    try {
      const runtime = getActiveRuntime(sessionId);
      if (!runtime) {
        return res.status(404).json({ error: "Session not found" });
      }
      await runtime.session.abort();
      res.json({ success: true });
    } catch (err) {
      handleError(res, err);
    }
  });

}
