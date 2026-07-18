import express from "express";
import { handleError } from "./routeHelpers.ts";
import fs from "fs";
import path from "path";
import os from "os";
import { getProjectById, projectAtDirectory } from "../projects.ts";
import { getSessionBinding } from "../sessionBindings.ts";
import { projectForSession, projectFromSessionBinding } from "../sessionWorkspace.ts";
import { walkProject, fuzzyPathScore, MENTION_MAX_RESULTS, type MentionEntry } from "../mentions.ts";
import { artifactMimeType, isTextArtifact, resolveArtifactPath } from "../artifacts.ts";

const MAX_FILE_READ_BYTES = 10 * 1024 * 1024;

export function registerFilesystemRoutes(router: express.Router): void {
  // Read a file through an explicitly scoped filesystem root. Artifacts use
  // paths relative to the current session's private artifact directory.
  router.get("/api/fs/read", async (req, res) => {
    try {
      if (req.query.scope !== "artifacts") return res.status(400).json({ error: "Unsupported filesystem scope" });
      const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : "";
      if (!getSessionBinding(sessionId)) return res.status(404).json({ error: "Session not found" });
      const requestedPath = typeof req.query.path === "string" ? req.query.path : "";
      let resolved: ReturnType<typeof resolveArtifactPath>;
      try {
        resolved = resolveArtifactPath(sessionId, requestedPath);
      } catch (error) {
        return res.status(400).json({ error: error instanceof Error ? error.message : "Invalid file path" });
      }
      if (!fs.existsSync(resolved.absolutePath) || !fs.statSync(resolved.absolutePath).isFile()) {
        return res.status(404).json({ error: "File not found" });
      }
      const stat = await fs.promises.stat(resolved.absolutePath);
      if (stat.size > MAX_FILE_READ_BYTES) return res.status(413).json({ error: "File is too large to preview" });
      const mimeType = artifactMimeType(resolved.absolutePath);
      const text = isTextArtifact(resolved.absolutePath, mimeType);
      const content = await fs.promises.readFile(resolved.absolutePath, text ? "utf8" : "base64");
      res.json({
        path: resolved.relativePath,
        mimeType,
        size: stat.size,
        encoding: text ? "utf8" : "base64",
        content,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.get("/api/fs/files", async (req, res) => {
    try {
      const binding = getSessionBinding(req.query.sessionId);
      if (binding?.workspaceKind === "scratch") return res.json({ files: [] });
      const project = binding ? projectFromSessionBinding(binding) : getProjectById(req.query.projectId);
      if (!project) return res.status(404).json({ error: "Project not found" });
      if (binding && req.query.projectId && binding.projectId && binding.projectId !== req.query.projectId) {
        return res.status(400).json({ error: "Session does not belong to this project" });
      }
      if (!binding && typeof req.query.directoryId === "string"
        && !project.directories.some((directory) => directory.id === req.query.directoryId)) {
        return res.status(400).json({ error: "Project directory not found" });
      }
      const mentionProject = binding ? projectForSession(project, binding) : projectAtDirectory(project, req.query.directoryId);
      if (!fs.existsSync(mentionProject.path)) return res.status(404).json({ error: "Project path not found" });

      const query = typeof req.query.q === "string" ? req.query.q : "";
      const entries = await walkProject(mentionProject);
      const scored = entries
        .map((entry) => ({ entry, score: fuzzyPathScore(query, entry.path) }))
        .filter((x): x is { entry: MentionEntry; score: number } => x.score !== null)
        .sort((a, b) => {
          if (a.entry.kind !== b.entry.kind) return a.entry.kind === "directory" ? -1 : 1;
          return b.score - a.score || a.entry.path.localeCompare(b.entry.path);
        })
        .slice(0, MENTION_MAX_RESULTS)
        .map(({ entry }) => entry);

      res.json({ files: scored });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.get("/api/fs/list", async (req, res) => {
    try {
      const requested = typeof req.query.path === "string" && req.query.path.trim()
        ? path.resolve(req.query.path.trim())
        : os.homedir();
      let directoryPath = requested;
      let prefix = "";
      try {
        if (!fs.statSync(requested).isDirectory()) {
          directoryPath = path.dirname(requested);
          prefix = path.basename(requested).toLowerCase();
        }
      } catch {
        directoryPath = path.dirname(requested);
        prefix = path.basename(requested).toLowerCase();
      }
      if (!fs.existsSync(directoryPath) || !fs.statSync(directoryPath).isDirectory()) {
        return res.status(404).json({ error: "Directory not found" });
      }

      const entries = await fs.promises.readdir(directoryPath, { withFileTypes: true });
      const directories = entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && (!prefix || entry.name.toLowerCase().startsWith(prefix)))
        .map((entry) => ({ name: entry.name, path: path.join(directoryPath, entry.name) }))
        .sort((a, b) => a.name.localeCompare(b.name));

      res.json({ directories, currentPath: directoryPath });
    } catch (err) {
      handleError(res, err);
    }
  });

}
