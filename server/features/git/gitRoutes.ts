import express from "express";
import { handleError } from "../../platform/http/routeError.ts";
import { applyToIndex, commit, fetchRemote, getGitDivergence, getGitLog, getGitStatus, pull, push, stageAll, stageFile, unstageAll, unstageFile } from "./index.ts";
import { getProjectById, projectAtDirectory } from "../projects/projectRepository.ts";
import { generateProjectCommitMessage } from "./gitService.ts";
import { getSessionBinding } from "../sessions/workspace/workspaceBindingRepository.ts";
import { getSessionDirectory, projectFromSessionBinding } from "../sessions/workspace/sessionWorkspace.ts";
import { createPullRequest, getPullRequestContext } from "./pullRequestService.ts";

function parseLimit(value: unknown) {
  const limit = Number(value ?? 30);
  return Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : 30;
}

export function createGitRouter(): express.Router {
  const router = express.Router();

  router.use("/api/projects/:id/git", (req, res, next) => {
    const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : undefined;
    const binding = getSessionBinding(sessionId);
    if (binding?.workspaceKind === "scratch") return res.status(409).json({ error: "Add a folder to use Git" });
    const project = binding ? projectFromSessionBinding(binding) : getProjectById(req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (binding && binding.projectId && binding.projectId !== req.params.id) {
      return res.status(400).json({ error: "Session does not belong to this project" });
    }
    if (!binding && typeof req.query.directoryId === "string"
      && !project.directories.some((directory) => directory.id === req.query.directoryId)) {
      return res.status(400).json({ error: "Project directory not found" });
    }
    if (binding) {
      const sessionDirectory = getSessionDirectory(project, binding, req.query.directoryId);
      res.locals.project = projectAtDirectory(project, sessionDirectory.directoryId, sessionDirectory.path);
      res.locals.directoryId = sessionDirectory.directoryId;
    } else {
      res.locals.project = projectAtDirectory(project, req.query.directoryId);
      res.locals.directoryId = res.locals.project.activeDirectoryId;
    }
    next();
  });

  router.get("/api/projects/:id/git/status", async (_req, res) => {
    try {
      res.json(await getGitStatus(res.locals.project));
    } catch (error) {
      handleError(res, error);
    }
  });

  router.get("/api/projects/:id/git/log", async (req, res) => {
    try {
      res.json({ commits: await getGitLog(res.locals.project, parseLimit(req.query.limit)) });
    } catch (error) {
      handleError(res, error);
    }
  });

  router.get("/api/projects/:id/git/divergence", async (req, res) => {
    try {
      res.json(await getGitDivergence(res.locals.project, parseLimit(req.query.limit)));
    } catch (error) {
      handleError(res, error);
    }
  });

  for (const [route, action] of [["fetch", fetchRemote], ["pull", pull], ["push", push], ["stage-all", stageAll], ["unstage-all", unstageAll]] as const) {
    router.post(`/api/projects/:id/git/${route}`, async (_req, res) => {
      try {
        await action(res.locals.project);
        res.json({ success: true });
      } catch (error) {
        handleError(res, error);
      }
    });
  }

  router.post("/api/projects/:id/git/stage-file", async (req, res) => {
    const { path: filePath } = req.body ?? {};
    if (typeof filePath !== "string" || !filePath) return res.status(400).json({ error: "path is required" });
    try {
      await stageFile(res.locals.project, filePath);
      res.json({ success: true });
    } catch (error) {
      handleError(res, error);
    }
  });

  router.post("/api/projects/:id/git/unstage-file", async (req, res) => {
    const { path: filePath } = req.body ?? {};
    if (typeof filePath !== "string" || !filePath) return res.status(400).json({ error: "path is required" });
    try {
      await unstageFile(res.locals.project, filePath);
      res.json({ success: true });
    } catch (error) {
      handleError(res, error);
    }
  });

  router.post("/api/projects/:id/git/apply", async (req, res) => {
    const { path: filePath, patch, reverse } = req.body ?? {};
    if (typeof filePath !== "string" || !filePath) return res.status(400).json({ error: "path is required" });
    if (typeof patch !== "string" || !patch.trim()) return res.status(400).json({ error: "patch is required" });
    try {
      await applyToIndex(res.locals.project, filePath, patch, !!reverse);
      res.json({ success: true });
    } catch (error) {
      handleError(res, error);
    }
  });

  router.post("/api/projects/:id/git/generate-commit-message", async (_req, res) => {
    try {
      res.json({ message: await generateProjectCommitMessage(res.locals.project) });
    } catch (error) {
      handleError(res, error);
    }
  });

  router.post("/api/projects/:id/git/commit", async (req, res) => {
    const { message } = req.body ?? {};
    if (typeof message !== "string" || !message.trim()) return res.status(400).json({ error: "message is required" });
    try {
      await commit(res.locals.project, message);
      res.json({ success: true });
    } catch (error) {
      handleError(res, error);
    }
  });

  router.get("/api/projects/:id/git/pull-request-context", async (_req, res) => {
    try {
      res.json(await getPullRequestContext(res.locals.project));
    } catch (error) {
      handleError(res, error);
    }
  });

  router.post("/api/projects/:id/git/pull-request", async (req, res) => {
    const { title, body, base, draft, publishBranch } = req.body ?? {};
    if (typeof title !== "string" || !title.trim()) return res.status(400).json({ error: "title is required" });
    if (typeof base !== "string" || !base.trim()) return res.status(400).json({ error: "base is required" });
    if (body != null && typeof body !== "string") return res.status(400).json({ error: "body must be a string" });
    try {
      res.json(await createPullRequest(res.locals.project, {
        title, body: body ?? "", base, draft: !!draft, publishBranch: !!publishBranch,
      }));
    } catch (error) {
      handleError(res, error);
    }
  });

  return router;
}
