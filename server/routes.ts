import express from "express";
import fs from "fs";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import {
  getAgentDir,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { getProjects, saveProjects, type Project } from "./projects.ts";
import { addClient, removeClient } from "./sse.ts";
import { resolveUiRequest, getPendingUiRequests, getSessionStatuses } from "./uiBridge.ts";
import { getActiveRuntime, getOrInitRuntime, getIntrospectionRuntime, touchRuntime, getContextInfo } from "./runtimes.ts";
import { authStorage, modelRegistry, refreshAuthState } from "./auth.ts";
import { findDanglingQuestion, formatAnswersAsUserReply } from "./askUserQuestion.ts";

// Questions whose reconstructed dialog the user dismissed, so reopening the
// session doesn't re-show them forever. In-memory on purpose — it only needs
// to outlive the dialog, not the server.
const dismissedInterruptedQuestions = new Set<string>();

type OAuthFlowStep =
  | { type: "auth_url"; url: string; instructions?: string; progress: string[] }
  | { type: "device_code"; userCode: string; verificationUri: string; intervalSeconds?: number; expiresInSeconds?: number; progress: string[] }
  | { type: "prompt"; message: string; placeholder?: string; allowEmpty?: boolean; progress: string[] }
  | { type: "manual_code"; message: string; progress: string[] }
  | { type: "select"; message: string; options: Array<{ id: string; label: string }>; progress: string[] }
  | { type: "waiting"; message: string; progress: string[] };

type OAuthFlow = {
  id: string;
  provider: string;
  status: "pending" | "success" | "error" | "cancelled";
  step?: OAuthFlowStep;
  // Kept outside `step`: providers call onAuth and then immediately await
  // onManualCodeInput (racing a callback server against manual paste), so the
  // auth_url step is replaced within the same tick and polling clients would
  // never see the URL.
  authUrl?: string;
  authInstructions?: string;
  error?: string;
  progress: string[];
  abortController: AbortController;
  resolveInput?: (value: string | undefined) => void;
  rejectInput?: (error: Error) => void;
};

const oauthFlows = new Map<string, OAuthFlow>();
const OAUTH_FLOW_TTL_MS = 10 * 60 * 1000;
// Abandoned pending flows (client closed the tab mid-login) would otherwise
// keep authStorage.login() hanging on input forever; time them out.
const OAUTH_FLOW_PENDING_TIMEOUT_MS = 15 * 60 * 1000;

function serializeOAuthFlow(flow: OAuthFlow) {
  return {
    id: flow.id,
    provider: flow.provider,
    status: flow.status,
    step: flow.step,
    authUrl: flow.authUrl,
    authInstructions: flow.authInstructions,
    error: flow.error,
    progress: flow.progress,
  };
}

function cleanupOAuthFlowLater(id: string) {
  setTimeout(() => oauthFlows.delete(id), OAUTH_FLOW_TTL_MS).unref();
}

function expireOAuthFlowIfAbandoned(flow: OAuthFlow) {
  if (flow.status !== "pending") return;
  flow.status = "error";
  flow.error = "Login timed out";
  flow.abortController.abort();
  flow.rejectInput?.(new Error("Login timed out"));
  cleanupOAuthFlowLater(flow.id);
}

function setOAuthStep(flow: OAuthFlow, step: Record<string, unknown>) {
  flow.step = { ...step, progress: [...flow.progress] } as OAuthFlowStep;
}

function appendOAuthProgress(flow: OAuthFlow, message: string) {
  flow.progress.push(message);
  if (flow.progress.length > 20) flow.progress.shift();
  if (!flow.step) setOAuthStep(flow, { type: "waiting", message });
  else flow.step = { ...flow.step, progress: [...flow.progress] };
}

function createOAuthInputPromise(flow: OAuthFlow) {
  return new Promise<string | undefined>((resolve, reject) => {
    flow.resolveInput = resolve;
    flow.rejectInput = reject;
  }).finally(() => {
    flow.resolveInput = undefined;
    flow.rejectInput = undefined;
  });
}

// Build the dialog payload for a question that outlived its runtime (server
// restarted while the agent was blocked on it). Same shape as the live
// extension_ui_request broadcast, plus `reconstructed` so the client knows
// cancelling it leaves the session idle rather than resuming a turn.
function reconstructInterruptedQuestion(sessionId: string, session: any): Record<string, any> | undefined {
  if (session.isStreaming) return undefined;
  const dangling = findDanglingQuestion(session.messages || []);
  if (!dangling || dismissedInterruptedQuestions.has(dangling.toolCallId)) return undefined;
  return {
    sessionId,
    type: "extension_ui_request",
    id: dangling.toolCallId,
    method: "questions",
    questions: dangling.params?.questions ?? [],
    reconstructed: true,
  };
}

// Answer a reconstructed question: the original tool call can't be completed
// anymore (pi synthesizes an error result for it), so the answers are sent
// back to the model as a regular prompt, which also restarts the turn.
// Dismissals just stop the dialog from re-appearing.
async function resumeInterruptedQuestion(body: any): Promise<boolean> {
  const { sessionId, id, cancelled, answers } = body ?? {};
  if (typeof sessionId !== "string" || typeof id !== "string") return false;
  let runtime;
  try {
    runtime = await getOrInitRuntime(sessionId);
  } catch {
    return false;
  }
  if (runtime.session.isStreaming) return false;
  const dangling = findDanglingQuestion(runtime.session.messages || []);
  if (!dangling || dangling.toolCallId !== id) return false;
  dismissedInterruptedQuestions.add(id);
  if (cancelled) return true;
  touchRuntime(sessionId);
  const reply = formatAnswersAsUserReply(dangling.params, Array.isArray(answers) ? answers : []);
  runtime.session.prompt(reply).catch((err: any) => {
    console.error("Resumed question prompt error:", err);
  });
  return true;
}

function handleError(res: express.Response, err: any) {
  console.error(err);
  res.status(500).json({ error: err?.message || "Internal error" });
}

// Mirror of pi's stripJsonComments (not exported from the package): strip `//`
// line comments and trailing commas while leaving string literals untouched,
// so we accept exactly the same models.json files pi does.
function stripJsonComments(input: string) {
  return input
    .replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*/g, (m) => (m[0] === '"' ? m : ""))
    .replace(/"(?:\\.|[^"\\])*"|,(\s*[}\]])/g, (m, tail) => tail ?? (m[0] === '"' ? m : ""));
}

function readModelsJson(): any {
  const modelsPath = path.join(getAgentDir(), "models.json");
  if (!fs.existsSync(modelsPath)) return { providers: {} };
  const text = fs.readFileSync(modelsPath, "utf8");
  const parsed = JSON.parse(stripJsonComments(text));
  if (!parsed.providers || typeof parsed.providers !== "object") parsed.providers = {};
  return parsed;
}

function writeModelsJson(config: any) {
  const modelsPath = path.join(getAgentDir(), "models.json");
  fs.mkdirSync(path.dirname(modelsPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(modelsPath, JSON.stringify(config, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  try { fs.chmodSync(modelsPath, 0o600); } catch { /* ignore chmod failures */ }
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
    const { provider } = req.params;
    try {
      refreshAuthState();
      const runtime = await getIntrospectionRuntime();
      runtime.session.modelRegistry.refresh?.();
      const oauthProvider = authStorage.getOAuthProviders().find((p: any) => p.id === provider);
      if (!oauthProvider) {
        return res.status(400).json({ error: `Provider ${provider} does not support OAuth` });
      }

      const id = randomUUID();
      const flow: OAuthFlow = {
        id,
        provider,
        status: "pending",
        progress: [],
        abortController: new AbortController(),
      };
      setOAuthStep(flow, { type: "waiting", message: "Starting OAuth login..." });
      oauthFlows.set(id, flow);
      setTimeout(() => expireOAuthFlowIfAbandoned(flow), OAUTH_FLOW_PENDING_TIMEOUT_MS).unref();

      authStorage.login(provider as any, {
        signal: flow.abortController.signal,
        onAuth(info) {
          flow.authUrl = info.url;
          flow.authInstructions = info.instructions;
          setOAuthStep(flow, { type: "auth_url", url: info.url, instructions: info.instructions });
        },
        onDeviceCode(info) {
          setOAuthStep(flow, {
            type: "device_code",
            userCode: info.userCode,
            verificationUri: info.verificationUri,
            intervalSeconds: info.intervalSeconds,
            expiresInSeconds: info.expiresInSeconds,
          });
        },
        onProgress(message) {
          appendOAuthProgress(flow, message);
        },
        async onManualCodeInput() {
          setOAuthStep(flow, { type: "manual_code", message: "Paste the authorization code or callback URL:" });
          const value = await createOAuthInputPromise(flow);
          if (value === undefined) throw new Error("Login cancelled");
          return value;
        },
        async onPrompt(prompt) {
          setOAuthStep(flow, {
            type: "prompt",
            message: prompt.message,
            placeholder: prompt.placeholder,
            allowEmpty: prompt.allowEmpty,
          });
          const value = await createOAuthInputPromise(flow);
          if (value === undefined) throw new Error("Login cancelled");
          return value;
        },
        async onSelect(prompt) {
          setOAuthStep(flow, {
            type: "select",
            message: prompt.message,
            options: prompt.options,
          });
          return await createOAuthInputPromise(flow);
        },
      }).then(() => {
        flow.status = "success";
        flow.step = undefined;
        refreshAuthState();
        cleanupOAuthFlowLater(id);
      }).catch((err: any) => {
        // Cancelled and timed-out flows already recorded their terminal state.
        if (flow.status !== "pending") return;
        flow.status = "error";
        flow.error = err?.message || String(err);
        cleanupOAuthFlowLater(id);
      });

      res.json({ id });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.get("/api/auth/oauth/flows/:id", (req, res) => {
    const flow = oauthFlows.get(req.params.id);
    if (!flow) return res.status(404).json({ error: "OAuth flow not found" });
    res.json(serializeOAuthFlow(flow));
  });

  router.post("/api/auth/oauth/flows/:id/respond", (req, res) => {
    const flow = oauthFlows.get(req.params.id);
    if (!flow) return res.status(404).json({ error: "OAuth flow not found" });
    if (flow.status !== "pending") return res.status(400).json({ error: `OAuth flow is ${flow.status}` });

    const { value, cancelled } = req.body ?? {};
    if (cancelled) {
      flow.status = "cancelled";
      flow.abortController.abort();
      flow.rejectInput?.(new Error("Login cancelled"));
      cleanupOAuthFlowLater(flow.id);
      return res.json({ ok: true });
    }

    // Without a pending input (double submit, stale client) accepting the value
    // would silently drop it and stomp whatever step the login flow set next.
    if (!flow.resolveInput) {
      return res.status(409).json({ error: "OAuth flow is not waiting for input" });
    }
    flow.resolveInput(typeof value === "string" ? value : undefined);
    flow.step = { type: "waiting", message: "Continuing OAuth login...", progress: [...flow.progress] };
    res.json({ ok: true });
  });

  router.post("/api/auth/oauth/flows/:id/cancel", (req, res) => {
    const flow = oauthFlows.get(req.params.id);
    if (!flow) return res.status(404).json({ error: "OAuth flow not found" });
    flow.status = "cancelled";
    flow.abortController.abort();
    flow.rejectInput?.(new Error("Login cancelled"));
    cleanupOAuthFlowLater(flow.id);
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
      // Attach live status so a page loaded mid-turn can badge sessions whose
      // SSE events it never saw. Errors are client-side only (they live in
      // the event stream, not the runtime), so 'error' is never reported here.
      res.json({
        sessions: sessions.map((s) => {
          const status = getPendingUiRequests(s.id).length > 0
            ? "needsInput"
            : getActiveRuntime(s.id)?.session?.isStreaming
              ? "working"
              : undefined;
          return status ? { ...s, status } : s;
        }),
      });
    } catch (err) {
      handleError(res, err);
    }
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

  router.post("/api/chat", async (req, res) => {
    const { sessionId, prompt, projectId, modelId, thinkingLevel, images } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: "prompt is required" });
    }

    try {
      const runtime = await getOrInitRuntime(sessionId, projectId);
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
