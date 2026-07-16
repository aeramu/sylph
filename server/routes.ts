import express from "express";
import fs from "fs";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { getProjects, saveProjects, getProjectById, type Project } from "./projects.ts";
import { addClient, removeClient } from "./sse.ts";
import { resolveUiRequest, getPendingUiRequests, getSessionStatuses } from "./uiBridge.ts";
import { disposeRuntime, getActiveRuntime, getOrInitRuntime, getIntrospectionRuntime, rollbackNewWorktreeSession, touchRuntime, getContextInfo, getSessionEventSequence } from "./runtimes.ts";
import { authStorage, modelRegistry, refreshAuthState } from "./auth.ts";
import { reconstructInterruptedQuestion, resumeInterruptedQuestion } from "./interruptedQuestions.ts";
import { walkProject, resolveMentionsInPrompt, fuzzyPathScore, MENTION_MAX_RESULTS, type MentionEntry } from "./mentions.ts";
import { readModelsJson, writeModelsJson } from "./modelsConfig.ts";
import { startOAuthLogin, getSerializedOAuthFlow, respondToOAuthFlow, cancelOAuthFlow } from "./oauthFlows.ts";
import { createGitRouter } from "./gitRoutes.ts";
import { findAvailableModel, isSameModel } from "./modelSelection.ts";
import { getAgentBrowserDashboardStatus, startAgentBrowserDashboard } from "./agentBrowserDashboard.ts";
import { getManagedWorktreeRemovalStatus, listGitBranches, recreateManagedWorktree, removeManagedWorktree } from "./git.ts";
import { getProjectSessionBindings, getSessionBinding } from "./sessionBindings.ts";
import { WORKTREES_DIR } from "./config.ts";

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

function getLoadedSkills(session: any) {
  return session._resourceLoader?.getSkills()?.skills || [];
}

function getLoadedExtensions(session: any) {
  return session._resourceLoader?.getExtensions()?.extensions || [];
}

// Routes that only read from the shared introspection runtime: resolve it,
// hand the session to the handler, and serialize whatever comes back.
function introspectionRoute(handler: (session: any) => unknown): express.RequestHandler {
  return async (_req, res) => {
    try {
      const runtime = await getIntrospectionRuntime();
      res.json(handler(runtime.session as any));
    } catch (err) {
      handleError(res, err);
    }
  };
}

export function createRouter(): express.Router {
  const router = express.Router();

  router.get("/api/agent-browser/dashboard", async (_req, res) => {
    res.json(await getAgentBrowserDashboardStatus());
  });

  router.post("/api/agent-browser/dashboard/start", async (_req, res) => {
    res.json(await startAgentBrowserDashboard());
  });

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
          reasoning: !!m.reasoning,
          thinkingLevels: getSupportedThinkingLevels(m),
        })),
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.get("/api/auth/providers", async (_req, res) => {
    try {
      refreshAuthState();
      const runtime = await getIntrospectionRuntime();
      const registry = runtime.session.modelRegistry;
      registry.refresh?.();

      const models = registry.getAll();
      const providerIds = Array.from(new Set<string>(models.map((m: any) => String(m.provider)))).sort((a, b) => a.localeCompare(b));
      const oauthIds = new Set(authStorage.getOAuthProviders().map((p: any) => p.id));
      const storedProviders = new Set(authStorage.list());

      res.json({
        providers: providerIds.map((id) => {
          const status = registry.getProviderAuthStatus(id);
          const credential = authStorage.get(id);
          return {
            id,
            name: registry.getProviderDisplayName(id),
            authType: oauthIds.has(id) ? "oauth" : "api_key",
            configured: !!status.configured,
            source: status.source,
            label: status.label,
            stored: storedProviders.has(id),
            storedType: credential?.type,
          };
        }),
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post("/api/auth/:provider/api-key", async (req, res) => {
    const { provider } = req.params;
    const { apiKey } = req.body ?? {};
    if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
      return res.status(400).json({ error: "apiKey is required" });
    }

    try {
      authStorage.set(provider, { type: "api_key", key: apiKey.trim() });
      refreshAuthState();
      res.json({ ok: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post("/api/auth/providers", async (req, res) => {
    const { providerId, name, baseUrl, modelId, modelName, apiKey } = req.body ?? {};
    const provider = typeof providerId === "string" ? providerId.trim() : "";
    const endpoint = typeof baseUrl === "string" ? baseUrl.trim() : "";
    const model = typeof modelId === "string" ? modelId.trim() : "";
    const displayName = typeof name === "string" && name.trim() ? name.trim() : provider;
    const modelDisplayName = typeof modelName === "string" && modelName.trim() ? modelName.trim() : model;

    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(provider)) {
      return res.status(400).json({ error: "providerId must start with a letter/number and contain only letters, numbers, dots, underscores, or dashes" });
    }
    if (!endpoint) return res.status(400).json({ error: "baseUrl is required" });
    if (!model) return res.status(400).json({ error: "modelId is required" });

    try {
      const config = readModelsJson();
      if (config.providers[provider]) {
        return res.status(409).json({ error: `Provider ${provider} already exists in models.json` });
      }
      // A models.json provider entry also overrides built-in models of the same
      // provider (baseUrl/apiKey), so block ids like "openai" or "anthropic"
      // that already exist in the registry.
      if (modelRegistry.getAll().some((m) => m.provider === provider)) {
        return res.status(409).json({ error: `Provider ${provider} already exists; pick a different id` });
      }

      config.providers[provider] = {
        name: displayName,
        baseUrl: endpoint,
        api: "openai-completions",
        apiKey: `$${provider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`,
        models: [
          {
            id: model,
            name: modelDisplayName,
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128000,
            maxTokens: 4096,
          },
        ],
      };

      writeModelsJson(config);
      if (typeof apiKey === "string" && apiKey.trim()) {
        authStorage.set(provider, { type: "api_key", key: apiKey.trim() });
      }
      refreshAuthState();
      res.json({ ok: true, provider });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post("/api/auth/:provider/oauth/start", async (req, res) => {
    try {
      const result = await startOAuthLogin(req.params.provider);
      if (!result.ok) return res.status(400).json({ error: result.error });
      res.json({ id: result.id });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.get("/api/auth/oauth/flows/:id", (req, res) => {
    const flow = getSerializedOAuthFlow(req.params.id);
    if (!flow) return res.status(404).json({ error: "OAuth flow not found" });
    res.json(flow);
  });

  router.post("/api/auth/oauth/flows/:id/respond", (req, res) => {
    const result = respondToOAuthFlow(req.params.id, req.body ?? {});
    switch (result.status) {
      case "not_found":
        return res.status(404).json({ error: "OAuth flow not found" });
      case "not_pending":
        return res.status(400).json({ error: `OAuth flow is ${result.flowStatus}` });
      case "not_waiting":
        return res.status(409).json({ error: "OAuth flow is not waiting for input" });
      case "ok":
        return res.json({ ok: true });
    }
  });

  router.post("/api/auth/oauth/flows/:id/cancel", (req, res) => {
    if (!cancelOAuthFlow(req.params.id)) {
      return res.status(404).json({ error: "OAuth flow not found" });
    }
    res.json({ ok: true });
  });

  router.post("/api/auth/:provider/logout", async (req, res) => {
    const { provider } = req.params;
    try {
      authStorage.logout(provider);
      refreshAuthState();
      res.json({ ok: true });
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

  router.get("/api/fs/files", async (req, res) => {
    try {
      const project = getProjectById(req.query.projectId);
      if (!project) return res.status(404).json({ error: "Project not found" });
      const binding = getSessionBinding(req.query.sessionId);
      if (binding && binding.projectId !== project.id) {
        return res.status(400).json({ error: "Session does not belong to this project" });
      }
      const mentionProject = binding ? { ...project, path: binding.cwd } : project;
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
      const projectId = req.query.projectId as string;
      let targetDir = process.cwd();
      let bindings = [] as ReturnType<typeof getProjectSessionBindings>;

      if (projectId) {
        const project = getProjects().find((entry) => entry.id === projectId);
        if (!project) return res.status(404).json({ error: "Project not found" });
        targetDir = project.path;
        bindings = getProjectSessionBindings(projectId);
      }

      const directories = new Set<string>([targetDir]);
      for (const binding of bindings) if (fs.existsSync(binding.cwd)) directories.add(binding.cwd);
      const byId = new Map<string, any>();
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

      const bindingById = new Map(bindings.map((binding) => [binding.sessionId, binding]));
      const sessions = Array.from(byId.values())
        .filter((session) => !projectId || !bindingById.has(session.id) || bindingById.get(session.id)?.projectId === projectId)
        .map((session) => {
          const binding = bindingById.get(session.id);
          const status = getPendingUiRequests(session.id).length > 0
            ? "needsInput"
            : getActiveRuntime(session.id)?.session?.isStreaming
              ? "working"
              : undefined;
          return {
            ...session,
            ...(status ? { status } : {}),
            ...(binding?.branch ? { branch: binding.branch } : {}),
            ...(binding?.worktree ? { worktree: true, worktreeMissing: !fs.existsSync(binding.cwd) } : {}),
          };
        })
        .sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());

      res.json({ sessions });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.get("/api/sessions/:sessionId/worktree", async (req, res) => {
    const binding = getSessionBinding(req.params.sessionId);
    if (!binding?.worktree || !binding.managedWorktreeRoot || !binding.branch || !binding.baseBranch) {
      return res.status(404).json({ error: "Managed worktree not found" });
    }
    const project = getProjectById(binding.projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });
    try {
      const status = await getManagedWorktreeRemovalStatus(
        project, binding.managedWorktreeRoot, binding.branch, binding.baseBranch, WORKTREES_DIR,
      );
      res.json({ ...status, cwd: binding.cwd, worktreeRoot: binding.managedWorktreeRoot, baseBranch: binding.baseBranch });
    } catch (err) { handleError(res, err); }
  });

  router.delete("/api/sessions/:sessionId/worktree", async (req, res) => {
    const { sessionId } = req.params;
    const binding = getSessionBinding(sessionId);
    if (!binding?.worktree || !binding.managedWorktreeRoot || !binding.branch || !binding.baseBranch) {
      return res.status(404).json({ error: "Managed worktree not found" });
    }
    const project = getProjectById(binding.projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });
    const runtime = getActiveRuntime(sessionId);
    if (runtime?.session?.isStreaming) return res.status(409).json({ error: "Stop the session before removing its worktree" });
    try {
      const status = await getManagedWorktreeRemovalStatus(
        project, binding.managedWorktreeRoot, binding.branch, binding.baseBranch, WORKTREES_DIR,
      );
      if (status.dirty) return res.status(409).json({ error: "Worktree has uncommitted changes; commit or discard them before removal", code: "dirty" });
      if (!status.merged && req.query.confirmUnmerged !== "true") {
        return res.status(409).json({ error: "Branch is not merged into its base branch", code: "unmerged", branch: status.branch });
      }
      await removeManagedWorktree(
        project, binding.managedWorktreeRoot, binding.branch, binding.baseBranch, WORKTREES_DIR,
      );
      disposeRuntime(sessionId);
      res.json({ success: true, branch: binding.branch, branchKept: true });
    } catch (err) { handleError(res, err); }
  });

  router.post("/api/sessions/:sessionId/worktree/recreate", async (req, res) => {
    const binding = getSessionBinding(req.params.sessionId);
    if (!binding?.worktree || !binding.managedWorktreeRoot || !binding.branch) {
      return res.status(404).json({ error: "Managed worktree not found" });
    }
    const project = getProjectById(binding.projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });
    try {
      await recreateManagedWorktree(
        project, binding.managedWorktreeRoot, binding.cwd, binding.branch, WORKTREES_DIR,
      );
      res.json({ success: true, branch: binding.branch, cwd: binding.cwd });
    } catch (err) { handleError(res, err); }
  });

  router.get("/api/sessions/:sessionId", async (req, res) => {
    const { sessionId } = req.params;
    try {
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
        binding: getSessionBinding(sessionId),
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.get("/api/commands", introspectionRoute((session) => ({
    commands: [
      ...session.extensionRunner.getRegisteredCommands().map((c: any) => ({
        name: c.invocationName,
        description: c.description,
        source: "extension",
      })),
      ...(session.promptTemplates || []).map((t: any) => ({
        name: t.name,
        description: t.description,
        source: "prompt",
      })),
      ...getLoadedSkills(session).map((s: any) => ({
        name: `skill:${s.name}`,
        description: s.description,
        source: "skill",
      })),
    ],
  })));

  router.get("/api/resources/skills", introspectionRoute((session) => ({
    resources: getLoadedSkills(session).map((s: any) => ({
      name: s.name,
      description: s.description,
    })),
  })));

  router.get("/api/resources/extensions", introspectionRoute((session) => ({
    resources: getLoadedExtensions(session).map((e: any) => ({
      name: extensionDisplayName(e),
    })),
  })));

  router.get("/api/resources/skills/:name", async (req, res) => {
    try {
      const runtime = await getIntrospectionRuntime();
      const session = runtime.session as any;
      const skill = getLoadedSkills(session).find((s: any) => s.name === req.params.name);

      if (!skill?.filePath) {
        return res.status(404).json({ error: "Skill not found" });
      }

      const content = await fs.promises.readFile(skill.filePath, "utf8");
      res.json({
        name: skill.name,
        description: skill.description,
        content,
        path: skill.filePath,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.get("/api/resources/extensions/:name", async (req, res) => {
    try {
      const runtime = await getIntrospectionRuntime();
      const session = runtime.session as any;
      const extension = getLoadedExtensions(session).find((e: any) => extensionDisplayName(e) === req.params.name);

      if (!extension) {
        return res.status(404).json({ error: "Extension not found" });
      }

      const mapValues = (map: Map<string, any> | undefined, mapper: (name: string, value: any) => any) =>
        Array.from(map?.entries() ?? []).map(([name, value]) => mapper(name, value));

      res.json({
        name: extensionDisplayName(extension),
        path: extension.path,
        resolvedPath: extension.resolvedPath,
        sourceInfo: extension.sourceInfo,
        tools: mapValues(extension.tools, (name, registered) => ({
          name,
          label: registered.definition?.label,
          description: registered.definition?.description,
          promptSnippet: registered.definition?.promptSnippet,
          promptGuidelines: registered.definition?.promptGuidelines,
          parameters: registered.definition?.parameters,
          sourceInfo: registered.sourceInfo,
        })),
        commands: mapValues(extension.commands, (name, command) => ({
          name,
          description: command.description,
          sourceInfo: command.sourceInfo,
        })),
        flags: mapValues(extension.flags, (name, flag) => ({
          name,
          description: flag.description,
          type: flag.type,
          default: flag.default,
        })),
        shortcuts: mapValues(extension.shortcuts, (shortcut, shortcutDef) => ({
          shortcut,
          description: shortcutDef.description,
        })),
        events: mapValues(extension.handlers, (event, handlers) => ({
          name: event,
          count: Array.isArray(handlers) ? handlers.length : 0,
        })),
        messageRenderers: Array.from(extension.messageRenderers?.keys() ?? []),
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.get("/api/projects/:id/git/branches", async (req, res) => {
    const project = getProjectById(req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found" });
    try {
      res.json({ branches: await listGitBranches(project) });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.use(createGitRouter());

  router.post("/api/chat", async (req, res) => {
    const { sessionId, prompt, mentionText, projectId, modelId, thinkingLevel, images, useWorktree, baseBranch } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: "prompt is required" });
    }

    let newWorktreeSessionId: string | undefined;
    try {
      if (!sessionId && useWorktree && (typeof baseBranch !== "string" || !baseBranch.trim())) {
        return res.status(400).json({ error: "baseBranch is required when useWorktree is enabled" });
      }
      const runtime = await getOrInitRuntime(sessionId, projectId, {
        useWorktree: !sessionId && useWorktree === true,
        baseBranch: typeof baseBranch === "string" ? baseBranch.trim() : undefined,
        branchPrompt: typeof mentionText === "string" ? mentionText : prompt,
      });
      const resolvedSessionId = runtime.session.sessionId;
      if (!sessionId && useWorktree === true) newWorktreeSessionId = resolvedSessionId;
      touchRuntime(resolvedSessionId);

      if (modelId) {
        const available = runtime.session.modelRegistry.getAvailable();
        const targetModel = findAvailableModel(available, modelId);
        if (!targetModel) {
          if (!sessionId && useWorktree === true) await rollbackNewWorktreeSession(resolvedSessionId);
          return res.status(400).json({ error: `Unknown or unavailable model: ${modelId}` });
        }
        if (!isSameModel(runtime.session.model, targetModel)) {
          await runtime.session.setModel(targetModel);
        }
      }

      if (thinkingLevel !== undefined) {
        if (typeof thinkingLevel !== "string") {
          if (!sessionId && useWorktree === true) await rollbackNewWorktreeSession(resolvedSessionId);
          return res.status(400).json({ error: "thinkingLevel must be a string" });
        }
        const availableThinkingLevels = runtime.session.getAvailableThinkingLevels();
        if (!availableThinkingLevels.includes(thinkingLevel)) {
          if (!sessionId && useWorktree === true) await rollbackNewWorktreeSession(resolvedSessionId);
          return res.status(400).json({
            error: `Thinking level ${thinkingLevel} is not supported by ${runtime.session.model?.id || "the selected model"}`,
            availableThinkingLevels,
          });
        }
        runtime.session.setThinkingLevel(thinkingLevel);
      }

      const projects = getProjects();
      const binding = getSessionBinding(resolvedSessionId);
      const resolvedProject = (binding ? projects.find((entry) => entry.id === binding.projectId) : undefined)
        || projects.find((entry) => path.resolve(entry.path) === path.resolve(runtime.session.cwd));
      // Mentions must resolve inside the checkout used by this session. Using
      // the saved project's main path here would quietly feed the model stale
      // files while it edits the worktree.
      const mentionProject = resolvedProject
        ? { ...resolvedProject, path: runtime.session.cwd }
        : undefined;
      // Scan only the user-typed text for @mentions when the client provides it,
      // so mentions inside inlined file attachments aren't resolved as well.
      const mentionSource = typeof mentionText === "string" ? mentionText : prompt;
      const promptText = await resolveMentionsInPrompt(mentionProject, prompt, mentionSource);

      const promptOptions = Array.isArray(images) && images.length > 0 ? { images } : undefined;

      if (runtime.session.isStreaming) {
        runtime.session.steer(promptText, promptOptions?.images).catch((err: any) => {
          console.error("Prompt error:", err);
        });
      } else {
        runtime.session.prompt(promptText, promptOptions).catch((err: any) => {
          console.error("Prompt error:", err);
        });
      }

      res.json({
        success: true,
        sessionId: resolvedSessionId,
        projectId: resolvedProject?.id,
        branch: binding?.branch,
        worktree: binding?.worktree,
      });
    } catch (err) {
      if (newWorktreeSessionId) {
        await rollbackNewWorktreeSession(newWorktreeSessionId)
          .catch((rollbackError) => console.error("Failed to roll back new worktree session:", rollbackError));
      }
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

  return router;
}
