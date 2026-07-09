import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  createAgentSessionRuntime,
  createAgentSessionServices,
  createAgentSessionFromServices,
  getAgentDir,
  SessionManager
} from "@earendil-works/pi-coding-agent";
import type {
  CreateAgentSessionRuntimeFactory,
  AgentSessionEvent
} from "@earendil-works/pi-coding-agent";
import { RUNTIME_IDLE_MS, EVICTION_INTERVAL_MS } from "./config.ts";
import { authStorage, modelRegistry } from "./auth.ts";
import { getProjects } from "./projects.ts";
import { broadcast } from "./sse.ts";
import { clearSessionStatuses, createExtensionUiContext, rejectPendingForSession } from "./uiBridge.ts";

interface RuntimeEntry {
  runtime: any;
  lastUsed: number;
}

const activeRuntimes = new Map<string, RuntimeEntry>();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const askUserQuestionExtensionPath = path.join(__dirname, "askUserQuestion.ts");

async function buildRuntime(sessionManager: any, cwd: string, opts?: { uiContext?: any }) {
  const factory: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
    const services = await createAgentSessionServices({
      cwd,
      authStorage,
      modelRegistry,
      // Register sylph's native, browser-rendered ask_user_question tool in
      // every runtime (replaces the TUI-only @juicesharp version). Use a real
      // extension path instead of an inline factory so /api/resources can show
      // the filename rather than pi's synthetic <inline:1> id.
      resourceLoaderOptions: { additionalExtensionPaths: [askUserQuestionExtensionPath] },
    });

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

// Snapshot of how full the session's context window is, plus enough detail
// for the client's context popover. Token counts for the system prompt and
// tool definitions are chars/4 estimates (pi doesn't report a per-section
// breakdown); the authoritative numbers are tokens/contextWindow/percent,
// which come from the last assistant message's usage.
export function getContextInfo(session: any) {
  try {
    const usage = session.getContextUsage?.();
    if (!usage) return undefined;

    const estimateTokens = (text: string) => Math.ceil((text?.length || 0) / 4);
    let systemPromptTokens = 0;
    try { systemPromptTokens = estimateTokens(session.systemPrompt); } catch { /* no system prompt yet */ }
    let toolTokens = 0;
    try {
      for (const tool of session.getAllTools?.() || []) {
        toolTokens += estimateTokens(`${tool.name} ${tool.description || ""}`)
          + estimateTokens(JSON.stringify(tool.parameters || {}));
      }
    } catch { /* tool registry unavailable */ }

    const stats = session.getSessionStats?.();
    return {
      tokens: usage.tokens,
      contextWindow: usage.contextWindow,
      percent: usage.percent,
      systemPromptTokens,
      toolTokens,
      stats: stats
        ? {
            userMessages: stats.userMessages,
            assistantMessages: stats.assistantMessages,
            toolCalls: stats.toolCalls,
            totalMessages: stats.totalMessages,
            tokens: stats.tokens,
            cost: stats.cost,
          }
        : undefined,
    };
  } catch {
    return undefined;
  }
}

export function touchRuntime(sessionId: string) {
  const entry = activeRuntimes.get(sessionId);
  if (entry) entry.lastUsed = Date.now();
}

export function getActiveRuntime(sessionId: string) {
  return activeRuntimes.get(sessionId)?.runtime;
}

export async function getOrInitRuntime(sessionId?: string, projectId?: string) {
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

  // Broadcast events to all SSE clients with sessionId attached. Events that
  // land after an assistant message completes also carry a fresh context
  // snapshot so the composer's context indicator stays live mid-turn.
  runtime.session.subscribe((event: AgentSessionEvent) => {
    const payload: any = { sessionId: sessionManager.getSessionId(), ...event };
    if (event.type === "message_end" || event.type === "agent_end" || event.type === "compaction_end") {
      const context = getContextInfo(runtime.session);
      if (context) payload.context = context;
    }
    broadcast(payload);
  });

  const resolvedSessionId = sessionManager.getSessionId();
  activeRuntimes.set(resolvedSessionId, { runtime, lastUsed: Date.now() });
  return runtime;
}

// A single cached runtime used only to introspect commands/skills/extensions,
// so listing them doesn't create a new session per request.
let introspectionRuntimePromise: Promise<any> | null = null;

export function getIntrospectionRuntime() {
  if (!introspectionRuntimePromise) {
    introspectionRuntimePromise = (async () => {
      const projects = getProjects();
      const cwd = projects.find(p => fs.existsSync(p.path))?.path || process.cwd();
      return buildRuntime(SessionManager.inMemory(cwd), cwd);
    })().catch(err => {
      introspectionRuntimePromise = null; // allow retry on failure
      throw err;
    });
  }
  return introspectionRuntimePromise;
}

// Evict idle, non-streaming runtimes.
export function startEvictionTimer() {
  setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of activeRuntimes) {
      if (entry.runtime.session?.isStreaming) continue;
      if (now - entry.lastUsed > RUNTIME_IDLE_MS) {
        activeRuntimes.delete(id);
        rejectPendingForSession(id, "session evicted");
        clearSessionStatuses(id);
        try {
          entry.runtime.dispose?.();
        } catch (err) {
          console.error(`Failed to dispose runtime ${id}:`, err);
        }
      }
    }
  }, EVICTION_INTERVAL_MS).unref();
}
