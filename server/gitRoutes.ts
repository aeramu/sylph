import express from "express";
import { applyToIndex, commit, fetchRemote, getGitDivergence, getGitLog, getGitStatus, getStagedDiff, pull, push, stageAll, stageFile, unstageAll, unstageFile } from "./git.ts";
import { generateCommitMessage } from "./commitMessage.ts";
import { getProjectById, projectAtDirectory } from "./projects.ts";
import { getIntrospectionRuntime } from "./runtimes.ts";
import { getSettings } from "./settings.ts";
import { getSessionBinding } from "./sessionBindings.ts";
import { getSessionDirectory } from "./sessionWorkspace.ts";

function handleError(res: express.Response, error: unknown) {
  console.error(error);
  res.status(500).json({ error: error instanceof Error ? error.message : "Internal error" });
}

function parseLimit(value: unknown) {
  const limit = Number(value ?? 30);
  return Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : 30;
}

export function createGitRouter(): express.Router {
  const router = express.Router();

  router.use("/api/projects/:id/git", (req, res, next) => {
    const project = getProjectById(req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found" });
    const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : undefined;
    const binding = getSessionBinding(sessionId);
    if (binding && binding.projectId !== project.id) {
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
      res.locals.directoryId = res.locals.project.primaryDirectoryId;
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
      const stagedDiff = await getStagedDiff(res.locals.project);
      if (!stagedDiff.trim()) return res.status(400).json({ error: "Stage changes before generating a commit message" });
      const selectedModel = getSettings().commitMessageModel;
      if (!selectedModel) return res.status(400).json({ error: "Select a commit message model in Settings" });
      const runtime = await getIntrospectionRuntime();
      const message = await generateCommitMessage(runtime.session.modelRegistry, selectedModel, stagedDiff);
      res.json({ message });
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

  return router;
}
