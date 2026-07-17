import express from "express";
import { handleError } from "./routeHelpers.ts";
import fs from "fs";
import path from "path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { resolveUiRequest, getPendingUiRequests, getSessionStatuses } from "../uiBridge.ts";
import { getActiveRuntime, getOrInitRuntime, getContextInfo, getSessionEventSequence } from "../runtime/index.ts";
import { reconstructInterruptedQuestion, resumeInterruptedQuestion } from "../interruptedQuestions.ts";
import { getProjects, getProjectById } from "../projects.ts";
import { getSessionBinding } from "../sessionBindings.ts";
import { getRawManagedDirectories, getSessionDirectories, hasManagedWorktrees } from "../sessionWorkspace.ts";
import { reconcileSessionBinding, recoverSessionBindingsFromPi } from "../piSessionMetadata.ts";

export function registerSessionRoutes(router: express.Router): void {
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
      const unprojected = req.query.scope === "unprojected";
      let targetDir = process.cwd();
      let bindings = await recoverSessionBindingsFromPi();

      if (projectId) {
        const project = getProjects().find((entry) => entry.id === projectId);
        if (!project) return res.status(404).json({ error: "Project not found" });
        targetDir = project.path;
        bindings = bindings.filter((binding) => binding.projectId === projectId);
      } else if (unprojected) {
        bindings = bindings.filter((binding) => !binding.projectId);
      }

      const selectedProject = projectId ? getProjectById(projectId) : undefined;
      const directories = new Set<string>(selectedProject
        ? selectedProject.directories.map((entry) => entry.path)
        : bindings.map((binding) => binding.cwd).filter((directory) => fs.existsSync(directory)));
      if (!projectId && !unprojected) directories.add(targetDir);
      for (const binding of bindings) if (fs.existsSync(binding.cwd)) directories.add(binding.cwd);
      const byId = new Map<string, any>();
      if (!projectId) {
        try { for (const session of await SessionManager.listAll()) byId.set(session.id, session); } catch { /* retain cwd-scoped fallback */ }
      }
      for (const directory of directories) {
        if (!fs.existsSync(directory)) continue;
        try {
          for (const session of await SessionManager.list(directory)) byId.set(session.id, session);
        } catch { /* an unavailable worktree must not hide the rest */ }
      }
      // A removed worktree's pi session file lives outside the checkout and is
      // still valid. Load it directly so the sidebar can offer Recreate.
      for (const binding of bindings) {
        if (byId.has(binding.sessionId) || !binding.sessionFile || !fs.existsSync(binding.sessionFile)) continue;
        try {
          const detached = SessionManager.open(binding.sessionFile);
          const info = (await SessionManager.list(binding.cwd, path.dirname(binding.sessionFile)))
            .find((entry) => entry.id === binding.sessionId);
          if (info) byId.set(info.id, info);
          else if (detached.getSessionId() === binding.sessionId) {
            const header = detached.getHeader();
            byId.set(binding.sessionId, {
              id: binding.sessionId,
              path: binding.sessionFile,
              cwd: binding.cwd,
              created: new Date(header?.timestamp || 0),
              modified: fs.statSync(binding.sessionFile).mtime,
              messageCount: detached.buildSessionContext().messages.length,
              firstMessage: "Worktree session",
              allMessagesText: "",
            });
          }
        } catch { /* malformed session binding */ }
      }

      // Embedded Sylph metadata is authoritative when available. Reconcile the
      // fast binding index before project filtering. Sessions created before
      // Sylph metadata existed retain the old cwd-to-project migration path.
      for (const session of byId.values()) {
        if (session.path && fs.existsSync(session.path)) {
          try { reconcileSessionBinding(SessionManager.open(session.path), session.path); } catch { /* malformed legacy session */ }
        }

      }
      const allBindings = await recoverSessionBindingsFromPi();
      bindings = projectId
        ? allBindings.filter((binding) => binding.projectId === projectId)
        : unprojected
          ? allBindings.filter((binding) => !binding.projectId)
          : allBindings;
      const bindingById = new Map(bindings.map((binding) => [binding.sessionId, binding]));
      const allBindingById = new Map(allBindings.map((binding) => [binding.sessionId, binding]));
      const projectsById = new Map(getProjects().map((project) => [project.id, project]));
      const sessions = Array.from(byId.values())
        .filter((session) => projectId
          ? bindingById.has(session.id)
          : unprojected
            ? !allBindingById.get(session.id)?.projectId
            : true)
        .map((session) => {
          const binding = allBindingById.get(session.id);
          const status = getPendingUiRequests(session.id).length > 0
            ? "needsInput"
            : getActiveRuntime(session.id)?.session?.isStreaming
              ? "working"
              : undefined;
          const project = binding?.projectId ? projectsById.get(binding.projectId) : selectedProject;
          const sessionDirectories = binding?.directories ?? (binding && project ? getSessionDirectories(project, binding) : undefined);
          const directoryNames = sessionDirectories?.map((directory) => directory.name);
          const activeDirectory = sessionDirectories?.find((directory) => directory.directoryId === binding?.directoryId) ?? sessionDirectories?.[0];
          const configuredDirectory = project?.directories.find((directory) => directory.id === (activeDirectory?.directoryId ?? binding?.directoryId));
          // Keep the physical session cwd for execution, but expose the source
          // checkout separately so managed worktrees and ordinary sessions are
          // grouped under the same real directory in the sidebar.
          const sourcePath = activeDirectory?.sourcePath ?? configuredDirectory?.path ?? binding?.cwd ?? session.cwd;
          return {
            ...session,
            ...(status ? { status } : {}),
            projectId: binding?.projectId,
            projectName: project?.name,
            directoryName: activeDirectory?.name || path.basename(binding?.cwd || session.cwd || "") || "Workspace",
            cwd: binding?.cwd || session.cwd,
            ...(sourcePath ? { sourcePath } : {}),
            ...(binding?.directoryId ? { directoryId: binding.directoryId } : {}),
            ...(directoryNames?.length ? { directoryNames } : {}),
            ...(binding?.branch ? { branch: binding.branch } : {}),
            ...(binding && hasManagedWorktrees(binding) ? {
              worktree: true,
              worktreeMissing: getRawManagedDirectories(binding).some((directory) => !fs.existsSync(directory.path)),
            } : {}),
          };
        })
        .sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());

      res.json({ sessions });
    } catch (err) {
      handleError(res, err);
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
