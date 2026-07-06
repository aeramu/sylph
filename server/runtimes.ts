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
import { getProjects } from "./projects.ts";
import { broadcast } from "./sse.ts";
import { createExtensionUiContext, rejectPendingForSession } from "./uiBridge.ts";

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

  // Broadcast events to all SSE clients with sessionId attached.
  runtime.session.subscribe((event: AgentSessionEvent) => {
    broadcast({ sessionId: sessionManager.getSessionId(), ...event });
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
        try {
          entry.runtime.dispose?.();
        } catch (err) {
          console.error(`Failed to dispose runtime ${id}:`, err);
        }
      }
    }
  }, EVICTION_INTERVAL_MS).unref();
}
