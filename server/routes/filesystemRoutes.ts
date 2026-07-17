import express from "express";
import { handleError } from "./routeHelpers.ts";
import fs from "fs";
import path from "path";
import os from "os";
import { getProjectById, projectAtDirectory } from "../projects.ts";
import { getSessionBinding } from "../sessionBindings.ts";
import { projectForSession, projectFromSessionBinding } from "../sessionWorkspace.ts";
import { walkProject, fuzzyPathScore, MENTION_MAX_RESULTS, type MentionEntry } from "../mentions.ts";

export function registerFilesystemRoutes(router: express.Router): void {
  router.get("/api/fs/files", async (req, res) => {
    try {
      const binding = getSessionBinding(req.query.sessionId);
      const project = getProjectById(req.query.projectId) ?? (binding ? projectFromSessionBinding(binding) : undefined);
      if (!project) return res.status(404).json({ error: "Project not found" });
      if (binding && req.query.projectId && binding.projectId !== req.query.projectId) {
        return res.status(400).json({ error: "Session does not belong to this project" });
      }
      if (!binding && typeof req.query.directoryId === "string"
        && !project.directories.some((directory) => directory.id === req.query.directoryId)) {
        return res.status(400).json({ error: "Project directory not found" });
      }
      const mentionProject = binding
        ? projectForSession(project, binding)
        : projectAtDirectory(project, req.query.directoryId);
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
