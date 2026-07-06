import express from "express";
import fs from "fs";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import {
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { getProjects, saveProjects, type Project } from "./projects.ts";
import { addClient, removeClient } from "./sse.ts";
import { resolveUiRequest, getPendingUiRequests } from "./uiBridge.ts";
import { getActiveRuntime, getOrInitRuntime, getIntrospectionRuntime, touchRuntime } from "./runtimes.ts";

function handleError(res: express.Response, err: any) {
  console.error(err);
  res.status(500).json({ error: err?.message || "Internal error" });
}

function extensionDisplayName(extensionOrPath: string | {
  path: string;
  tools?: Map<string, unknown>;
  commands?: Map<string, unknown>;
}): string {
  const pathStr = typeof extensionOrPath === "string" ? extensionOrPath : extensionOrPath.path;

  // Inline extension factories are assigned synthetic paths by pi, e.g.
  // "<inline:1>". pi does not currently attach a first-class extension name
  // to inline factories, so derive a stable display name from the single thing
  // the inline extension contributes when possible.
  if (pathStr.startsWith("<inline:") && typeof extensionOrPath !== "string") {
    const toolNames = Array.from(extensionOrPath.tools?.keys() ?? []);
    if (toolNames.length === 1) return toolNames[0];

    const commandNames = Array.from(extensionOrPath.commands?.keys() ?? []);
    if (commandNames.length === 1) return commandNames[0];
  }

  if (!pathStr.includes("node_modules/")) {
    return pathStr.split(/[\\/]/).pop() || pathStr;
  }
  const parts = pathStr.split("node_modules/")[1].split("/");
  let pkgName = parts[0];
  let restIndex = 1;
  if (pkgName.startsWith("@")) {
    pkgName = parts[0] + "/" + parts[1];
    restIndex = 2;
  }
  const rest = parts.slice(restIndex);
  if (rest.length === 1 && (rest[0] === "index.ts" || rest[0] === "index.js")) {
    return pkgName;
  }
  const basename = rest[rest.length - 1];
  if (basename === "index.ts" || basename === "index.js") {
    return `${pkgName}:${rest[rest.length - 2]}`;
  }
  return `${pkgName}:${basename}`;
}

export function createRouter(): express.Router {
  const router = express.Router();

  router.get("/api/models", async (_req, res) => {
    try {
      // Use the introspection runtime's session registry, not a standalone
      // ModelRegistry. Extension-registered providers (e.g. pi-9router-ext)
      // call pi.registerProvider() at session_start, which adds their models
      // to the session's registry only. A standalone registry would only see
      // built-in models and models.json — missing all extension providers.
      const runtime = await getIntrospectionRuntime();
      const available = runtime.session.modelRegistry.getAvailable();
      res.json({
        models: available.map((m: any) => ({
          id: m.id,
          provider: m.provider,
          value: `${m.provider}/${m.id}`,
          label: m.id,
        })),
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.get("/api/stream", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    res.write(`data: ${JSON.stringify({ type: "connection_established" })}\n\n`);

    const keepAlive = setInterval(() => {
      res.write(": keepalive\n\n");
    }, 15000);

    addClient(res);

    req.on("close", () => {
      removeClient(res);
      clearInterval(keepAlive);
    });
  });

  router.post("/api/ui-response", (req, res) => {
    const { id } = req.body;
    if (typeof id !== "string") {
      return res.status(400).json({ error: "id is required" });
    }
    if (!resolveUiRequest(id, req.body)) {
      return res.status(404).json({ error: "no pending request for this id" });
    }
    res.json({ ok: true });
  });

  router.get("/api/projects", (_req, res) => {
    res.json({ projects: getProjects() });
  });

  router.post("/api/projects", (req, res) => {
    const { path: dirPath, name } = req.body;
    if (!dirPath || typeof dirPath !== "string" || !fs.existsSync(dirPath)) {
      return res.status(400).json({ error: "Invalid path" });
    }
    const normalized = path.resolve(dirPath);
    const projects = getProjects();
    const existing = projects.find(p => path.resolve(p.path) === normalized);
    if (existing) {
      return res.status(409).json({ error: "Project already added", project: existing });
    }
    const newProj: Project = {
      id: "proj-" + randomUUID(),
      name: name || path.basename(normalized),
      path: normalized,
    };
    projects.push(newProj);
    saveProjects(projects);
    res.json(newProj);
  });

  router.delete("/api/projects/:id", (req, res) => {
    saveProjects(getProjects().filter(p => p.id !== req.params.id));
    res.json({ success: true });
  });

  router.get("/api/fs/list", async (req, res) => {
    try {
      const dirPath = (req.query.path as string) || os.homedir();
      if (!fs.existsSync(dirPath)) {
        return res.status(404).json({ error: "Directory not found" });
      }

      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      const directories = entries
        .filter(dirent => dirent.isDirectory() && !dirent.name.startsWith("."))
        .map(dirent => ({
          name: dirent.name,
          path: path.join(dirPath, dirent.name),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      res.json({ directories, currentPath: dirPath });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.get("/api/sessions", async (req, res) => {
    try {
      const projectId = req.query.project_id as string;
      let targetDir = process.cwd();

      if (projectId) {
        const proj = getProjects().find(p => p.id === projectId);
        if (!proj) {
          return res.status(404).json({ error: "Project not found" });
        }
        targetDir = proj.path;
      }

      if (!fs.existsSync(targetDir)) {
        return res.json({ sessions: [] });
      }

      const sessions = await SessionManager.list(targetDir);
      sessions.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
      res.json({ sessions });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.get("/api/history", async (req, res) => {
    const sessionId = req.query.sessionId as string;
    if (!sessionId) {
      return res.json({ messages: [] });
    }
    try {
      const runtime = await getOrInitRuntime(sessionId);
      res.json({
        messages: runtime.session.messages || [],
        // Lets the client restore the working indicator when it opens a
        // session that is currently mid-turn.
        isStreaming: !!runtime.session.isStreaming,
        // Dialogs the agent is still blocked on; their SSE broadcast was a
        // one-shot the client may have missed while on another session.
        pendingUiRequests: getPendingUiRequests(sessionId),
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.get("/api/commands", async (_req, res) => {
    try {
      const runtime = await getIntrospectionRuntime();
      const session = runtime.session as any;

      const extensionCommands = session.extensionRunner.getRegisteredCommands().map((c: any) => ({
        name: c.invocationName,
        description: c.description,
        source: "extension",
      }));
      const templates = (session.promptTemplates || []).map((t: any) => ({
        name: t.name,
        description: t.description,
        source: "prompt",
      }));
      const skills = (session._resourceLoader?.getSkills()?.skills || []).map((s: any) => ({
        name: `skill:${s.name}`,
        description: s.description,
        source: "skill",
      }));

      res.json({ commands: [...extensionCommands, ...templates, ...skills] });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.get("/api/resources", async (_req, res) => {
    try {
      const runtime = await getIntrospectionRuntime();
      const session = runtime.session as any;

      const extensions = (session._resourceLoader?.getExtensions()?.extensions || []).map((e: any) => ({
        name: extensionDisplayName(e),
        source: "extension",
      }));
      const templates = (session.promptTemplates || []).map((t: any) => ({
        name: t.name,
        description: t.description,
        source: "prompt",
      }));
      const skills = (session._resourceLoader?.getSkills()?.skills || []).map((s: any) => ({
        name: s.name,
        description: s.description,
        source: "skill",
      }));

      res.json({ resources: [...extensions, ...templates, ...skills] });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post("/api/chat", async (req, res) => {
    const { sessionId, prompt, project_id, modelId, thinkingLevel, images } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: "prompt is required" });
    }

    try {
      const runtime = await getOrInitRuntime(sessionId, project_id);
      const resolvedSessionId = runtime.session.sessionId;
      touchRuntime(resolvedSessionId);

      if (modelId) {
        const available = runtime.session.modelRegistry.getAvailable();
        // Accept either "provider/id" (the select value) or a bare id.
        const targetModel = modelId.includes("/")
          ? available.find((m: any) => `${m.provider}/${m.id}` === modelId)
          : available.find((m: any) => m.id === modelId);
        if (!targetModel) {
          return res.status(400).json({ error: `Unknown or unavailable model: ${modelId}` });
        }
        const current = runtime.session.model;
        if (!current || current.id !== targetModel.id) {
          await runtime.session.setModel(targetModel);
        }
      }

      if (thinkingLevel && typeof thinkingLevel === "string") {
        runtime.session.setThinkingLevel(thinkingLevel);
      }

      const resolvedProject = getProjects().find(p => p.path === runtime.session.cwd);

      const promptOptions = Array.isArray(images) && images.length > 0 ? { images } : undefined;

      if (runtime.session.isStreaming) {
        runtime.session.steer(prompt, promptOptions?.images).catch((err: any) => {
          console.error("Prompt error:", err);
        });
      } else {
        runtime.session.prompt(prompt, promptOptions).catch((err: any) => {
          console.error("Prompt error:", err);
        });
      }

      res.json({ success: true, sessionId: resolvedSessionId, projectId: resolvedProject?.id });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post("/api/chat/:sessionId/abort", async (req, res) => {
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

  return router;
}
