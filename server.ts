import express from "express";
import fs from "fs";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import {
  createAgentSessionRuntime,
  createAgentSessionServices,
  createAgentSessionFromServices,
  getAgentDir,
  SessionManager,
  ModelRegistry,
  AuthStorage
} from "@earendil-works/pi-coding-agent";
import type {
  CreateAgentSessionRuntimeFactory,
  AgentSessionEvent
} from "@earendil-works/pi-coding-agent";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT) || 3001;
const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const RUNTIME_IDLE_MS = 30 * 60 * 1000;
const EVICTION_INTERVAL_MS = 5 * 60 * 1000;

const SYLPH_DIR = path.join(os.homedir(), ".sylph");
const PROJECTS_FILE = path.join(SYLPH_DIR, "projects.json");

const app = express();
app.use(express.json({ limit: '25mb' }));

// Reject requests whose Host header isn't local (defends against DNS rebinding).
app.use((req, res, next) => {
  const host = (req.headers.host || "").replace(/:\d+$/, "");
  if (!ALLOWED_HOSTS.has(host)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
});

// ---------------------------------------------------------------------------
// Projects store
// ---------------------------------------------------------------------------

interface Project {
  id: string;
  name: string;
  path: string;
}

if (!fs.existsSync(SYLPH_DIR)) {
  fs.mkdirSync(SYLPH_DIR, { recursive: true });
}
if (!fs.existsSync(PROJECTS_FILE)) {
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify([]));
}

function getProjects(): Project[] {
  try {
    return JSON.parse(fs.readFileSync(PROJECTS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function saveProjects(projects: Project[]) {
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2));
}

// ---------------------------------------------------------------------------
// Runtimes
// ---------------------------------------------------------------------------

interface RuntimeEntry {
  runtime: any;
  lastUsed: number;
}

const activeRuntimes = new Map<string, RuntimeEntry>();
const clients: Set<express.Response> = new Set();

async function buildRuntime(sessionManager: any, cwd: string, opts?: { uiContext?: any }) {
  const factory: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
    const services = await createAgentSessionServices({ cwd });

    return {
      ...(await createAgentSessionFromServices({
        services,
        sessionManager,
        sessionStartEvent,
      })),
      services,
      diagnostics: services.diagnostics,
    };
  };

  const runtime = await createAgentSessionRuntime(factory, {
    cwd,
    agentDir: getAgentDir(),
    sessionManager,
  });

  await runtime.session.bindExtensions(
    opts?.uiContext
      ? { mode: "rpc", uiContext: opts.uiContext }
      : {},
  );
  return runtime;
}

function touchRuntime(sessionId: string) {
  const entry = activeRuntimes.get(sessionId);
  if (entry) entry.lastUsed = Date.now();
}

async function getOrInitRuntime(sessionId?: string, projectId?: string) {
  if (sessionId && activeRuntimes.has(sessionId)) {
    touchRuntime(sessionId);
    return activeRuntimes.get(sessionId)!.runtime;
  }

  const projects = getProjects();
  let sessionManager: any;
  let targetCwd = process.cwd();

  if (sessionId) {
    // Resume: locate the session in a known project (or the server cwd).
    const searchDirs = [
      ...projects.filter(p => fs.existsSync(p.path)).map(p => p.path),
      process.cwd(),
    ];
    for (const dir of searchDirs) {
      try {
        const sessions = await SessionManager.list(dir);
        const sessionInfo = sessions.find((s) => s.id === sessionId);
        if (sessionInfo) {
          sessionManager = SessionManager.open(sessionInfo.path);
          targetCwd = dir;
          break;
        }
      } catch { /* ignore unreadable dirs */ }
    }
    if (!sessionManager) {
      throw new Error(`Session ${sessionId} not found in any project`);
    }
  } else {
    // New session.
    const proj = projectId ? projects.find(p => p.id === projectId) : undefined;
    if (proj) targetCwd = proj.path;
    sessionManager = SessionManager.create(targetCwd);
  }

  const runtime = await buildRuntime(sessionManager, targetCwd, {
    uiContext: createExtensionUiContext(sessionManager.getSessionId()),
  });

  // Broadcast events to all SSE clients with sessionId attached.
  runtime.session.subscribe((event: AgentSessionEvent) => {
    const data = JSON.stringify({ sessionId: sessionManager.getSessionId(), ...event });
    for (const client of clients) {
      client.write(`data: ${data}\n\n`);
    }
  });

  const resolvedSessionId = sessionManager.getSessionId();
  activeRuntimes.set(resolvedSessionId, { runtime, lastUsed: Date.now() });
  return runtime;
}

// ---------------------------------------------------------------------------
// Extension UI bridge
// ---------------------------------------------------------------------------
//
// Extensions (e.g. pi-permission-system) request user input via
// ctx.ui.select() / input() / confirm() / editor(). In the embedded SDK these
// are plain async calls, not the RPC stdin/stdout sub-protocol. We bridge them
// to the browser by broadcasting an extension_ui_request over SSE, then
// resolving the promise when POST /api/ui-response arrives with the same id.

interface PendingUiRequest {
  resolve: (value: any) => void;
}
const pendingUiRequests = new Map<string, PendingUiRequest>();

function broadcastToClients(payload: any) {
  const data = JSON.stringify(payload);
  for (const client of clients) {
    client.write(`data: ${data}\n\n`);
  }
}

function createExtensionUiContext(sessionId: string): any {
  // Dialog method: broadcast, block until the browser responds.
  const requestAndWait = (method: string, fields: Record<string, any>): Promise<any> => {
    const id = randomUUID();
    return new Promise((resolve) => {
      pendingUiRequests.set(id, { resolve });
      broadcastToClients({ sessionId, type: "extension_ui_request", id, method, ...fields });
    });
  };

  // Fire-and-forget: broadcast, return immediately.
  const fire = (method: string, fields: Record<string, any>) => {
    broadcastToClients({ sessionId, type: "extension_ui_request", id: randomUUID(), method, ...fields });
  };

  // --- Dialog methods ---

  const select = async (prompt: string, options: string[]) => {
    const newlineIdx = prompt.indexOf("\n");
    const title = newlineIdx >= 0 ? prompt.slice(0, newlineIdx) : prompt;
    const body = newlineIdx >= 0 ? prompt.slice(newlineIdx + 1).trim() : undefined;
    const res = await requestAndWait("select", {
      title, ...(body ? { body } : {}), options,
    });
    return res?.cancelled ? undefined : res?.value;
  };

  const confirm = async (title: string, message: string) => {
    const res = await requestAndWait("confirm", { title, message });
    return res?.cancelled ? false : Boolean(res?.confirmed);
  };

  const input = async (title: string, placeholder?: string) => {
    const res = await requestAndWait("input", { title, ...(placeholder ? { placeholder } : {}) });
    return res?.cancelled ? undefined : res?.value;
  };

  const editor = async (title: string, prefill?: string) => {
    const res = await requestAndWait("editor", { title, ...(prefill ? { prefill } : {}) });
    return res?.cancelled ? undefined : res?.value;
  };

  // --- Fire-and-forget: notifications, status, widgets, editor ---

  const notify = (message: string, type?: string) =>
    fire("notify", { message, ...(type ? { notifyType: type } : {}) });

  const setStatus = (key: string, text: string | undefined) =>
    fire("setStatus", { statusKey: key, ...(text !== undefined ? { statusText: text } : {}) });

  const setWidget = (key: string, content: any, options?: any) =>
    fire("setWidget", {
      widgetKey: key,
      ...(content ? { widgetLines: content } : {}),
      ...(options?.placement ? { widgetPlacement: options.placement } : {}),
    });

  const setWorkingMessage = (message?: string) =>
    fire("setWorkingMessage", { ...(message !== undefined ? { message } : {}) });

  const setWorkingVisible = (visible: boolean) =>
    fire("setWorkingVisible", { visible });

  const setWorkingIndicator = (options?: any) =>
    fire("setWorkingIndicator", { ...(options ? options : {}) });

  const setHiddenThinkingLabel = (label?: string) =>
    fire("setHiddenThinkingLabel", { ...(label !== undefined ? { label } : {}) });

  const setTitle = (title: string) =>
    fire("setTitle", { title });

  const pasteToEditor = (text: string) =>
    fire("pasteToEditor", { text });

  const setEditorText = (text: string) =>
    fire("setEditorText", { text });

  const setToolsExpanded = (expanded: boolean) =>
    fire("setToolsExpanded", { expanded });

  // --- Synchronous getters: no async round-trip possible, return defaults ---

  const getEditorText = () => "";
  const getToolsExpanded = () => false;

  // --- TUI-only methods: no-op or default (no terminal surface to target) ---

  const onTerminalInput = () => () => {};
  const setFooter = () => {};
  const setHeader = () => {};
  const addAutocompleteProvider = () => {};
  const setEditorComponent = () => {};
  const getEditorComponent = () => undefined;
  const getAllThemes = () => [];
  const getTheme = () => undefined;
  const setTheme = () => ({ success: false });

  return {
    // Dialog
    select, confirm, input, editor,
    // Fire-and-forget
    notify, setStatus, setWidget,
    setWorkingMessage, setWorkingVisible, setWorkingIndicator,
    setHiddenThinkingLabel, setTitle, pasteToEditor, setEditorText,
    setToolsExpanded,
    // Sync getters
    getEditorText, getToolsExpanded,
    // TUI-only no-ops
    onTerminalInput, setFooter, setHeader, addAutocompleteProvider,
    setEditorComponent, getEditorComponent,
    get theme() { return undefined; },
    getAllThemes, getTheme, setTheme,
    // custom() — TUI overlay, unsupported
    custom: async () => undefined,
  };
}

// A single cached runtime used only to introspect commands/skills/extensions,
// so listing them doesn't create a new session per request.
let introspectionRuntimePromise: Promise<any> | null = null;

function getIntrospectionRuntime() {
  if (!introspectionRuntimePromise) {
    introspectionRuntimePromise = (async () => {
      const projects = getProjects();
      const cwd = projects.find(p => fs.existsSync(p.path))?.path || process.cwd();
      return buildRuntime(SessionManager.create(cwd), cwd);
    })().catch(err => {
      introspectionRuntimePromise = null; // allow retry on failure
      throw err;
    });
  }
  return introspectionRuntimePromise;
}

// Evict idle, non-streaming runtimes.
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of activeRuntimes) {
    if (entry.runtime.session?.isStreaming) continue;
    if (now - entry.lastUsed > RUNTIME_IDLE_MS) {
      activeRuntimes.delete(id);
      try {
        entry.runtime.dispose?.();
      } catch (err) {
        console.error(`Failed to dispose runtime ${id}:`, err);
      }
    }
  }
}, EVICTION_INTERVAL_MS).unref();

function handleError(res: express.Response, err: any) {
  console.error(err);
  res.status(500).json({ error: err?.message || "Internal error" });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.get("/api/models", (_req, res) => {
  try {
    const authStorage = AuthStorage.create(path.join(getAgentDir(), "auth.json"));
    const registry = ModelRegistry.create(authStorage, path.join(getAgentDir(), "models.json"));
    const available = registry.getAvailable();
    res.json({ models: available.map(m => ({ id: m.id, provider: m.provider, name: m.name || m.id })) });
  } catch (err) {
    handleError(res, err);
  }
});

app.get("/api/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  res.write(`data: ${JSON.stringify({ type: "connection_established" })}\n\n`);

  const keepAlive = setInterval(() => {
    res.write(": keepalive\n\n");
  }, 15000);

  clients.add(res);

  req.on("close", () => {
    clients.delete(res);
    clearInterval(keepAlive);
  });
});

app.post("/api/ui-response", (req, res) => {
  const { id } = req.body;
  if (typeof id !== "string") {
    return res.status(400).json({ error: "id is required" });
  }
  const pending = pendingUiRequests.get(id);
  if (!pending) {
    return res.status(404).json({ error: "no pending request for this id" });
  }
  pendingUiRequests.delete(id);
  pending.resolve(req.body);
  res.json({ ok: true });
});

app.get("/api/projects", (_req, res) => {
  res.json({ projects: getProjects() });
});

app.post("/api/projects", (req, res) => {
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
    id: "proj-" + Date.now().toString(),
    name: name || path.basename(normalized),
    path: normalized,
  };
  projects.push(newProj);
  saveProjects(projects);
  res.json(newProj);
});

app.delete("/api/projects/:id", (req, res) => {
  saveProjects(getProjects().filter(p => p.id !== req.params.id));
  res.json({ success: true });
});

app.get("/api/fs/list", async (req, res) => {
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

app.get("/api/sessions", async (req, res) => {
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

app.get("/api/history", async (req, res) => {
  const sessionId = req.query.sessionId as string;
  if (!sessionId) {
    return res.json({ messages: [] });
  }
  try {
    const runtime = await getOrInitRuntime(sessionId);
    res.json({ messages: runtime.session.messages || [] });
  } catch (err) {
    handleError(res, err);
  }
});

app.get("/api/commands", async (_req, res) => {
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

function extensionDisplayName(pathStr: string): string {
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

app.get("/api/resources", async (_req, res) => {
  try {
    const runtime = await getIntrospectionRuntime();
    const session = runtime.session as any;

    const extensions = (session._resourceLoader?.getExtensions()?.extensions || []).map((e: any) => ({
      name: extensionDisplayName(e.path),
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

app.post("/api/chat", async (req, res) => {
  const { sessionId, prompt, project_id, modelId, images } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: "prompt is required" });
  }

  try {
    const runtime = await getOrInitRuntime(sessionId, project_id);
    const resolvedSessionId = runtime.session.sessionId;
    touchRuntime(resolvedSessionId);

    if (modelId) {
      const targetModel = runtime.services.modelRegistry.getAvailable().find((m: any) => m.id === modelId);
      if (!targetModel) {
        return res.status(400).json({ error: `Unknown or unavailable model: ${modelId}` });
      }
      const current = runtime.session.model;
      if (!current || current.id !== modelId) {
        await runtime.session.setModel(targetModel);
      }
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

app.post("/api/chat/:sessionId/abort", async (req, res) => {
  const { sessionId } = req.params;
  try {
    const entry = activeRuntimes.get(sessionId);
    if (!entry) {
      return res.status(404).json({ error: "Session not found" });
    }
    await entry.runtime.session.abort();
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

app.listen(PORT, HOST, () => {
  console.log(`Backend server listening on http://${HOST}:${PORT}`);
});
