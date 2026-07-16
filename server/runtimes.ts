import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
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
import { RUNTIME_IDLE_MS, EVICTION_INTERVAL_MS, WORKTREES_DIR } from "./config.ts";
import { authStorage, modelRegistry } from "./auth.ts";
import { getProjects } from "./projects.ts";
import { createManagedWorktree, discardManagedWorktree, worktreeBranchName } from "./git.ts";
import { deleteSessionBinding, getSessionBinding, saveSessionBinding } from "./sessionBindings.ts";
import { broadcast } from "./sse.ts";
import { clearSessionStatuses, createExtensionUiContext, rejectPendingForSession } from "./uiBridge.ts";

interface RuntimeEntry {
  // Registered synchronously at the start of a build so concurrent callers for
  // the same session share one runtime; `runtime` is filled in once it settles.
  promise: Promise<any>;
  runtime?: any;
  lastUsed: number;
}

const activeRuntimes = new Map<string, RuntimeEntry>();
const sessionEventSequences = new Map<string, number>();
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

export function disposeRuntime(sessionId: string) {
  const entry = activeRuntimes.get(sessionId);
  if (!entry) return;
  activeRuntimes.delete(sessionId);
  sessionEventSequences.delete(sessionId);
  rejectPendingForSession(sessionId, "session worktree removed");
  clearSessionStatuses(sessionId);
  try { entry.runtime?.dispose?.(); } catch (error) { console.error(`Failed to dispose runtime ${sessionId}:`, error); }
}

export async function rollbackNewWorktreeSession(sessionId: string) {
  const binding = getSessionBinding(sessionId);
  if (!binding?.worktree || !binding.managedWorktreeRoot || !binding.branch || !binding.baseBranch) return;
  disposeRuntime(sessionId);
  const project = getProjects().find((entry) => entry.id === binding.projectId);
  if (project) {
    await discardManagedWorktree(project, {
      path: binding.cwd,
      worktreeRoot: binding.managedWorktreeRoot,
      branch: binding.branch,
      baseBranch: binding.baseBranch,
    }, WORKTREES_DIR);
  }
  if (binding.sessionFile) fs.rmSync(binding.sessionFile, { force: true });
  deleteSessionBinding(sessionId);
}

export function getSessionEventSequence(sessionId: string) {
  return sessionEventSequences.get(sessionId) ?? 0;
}

// Build a runtime and wire up its SSE broadcast. Does not touch activeRuntimes;
// registration (and dedup) is the caller's responsibility.
export interface NewSessionOptions {
  useWorktree?: boolean;
  baseBranch?: string;
  branchPrompt?: string;
}

async function buildSessionRuntime(
  sessionId: string | undefined,
  projectId: string | undefined,
  options: NewSessionOptions = {},
): Promise<{ runtime: any; resolvedSessionId: string }> {
  const projects = getProjects();
  let sessionManager: any;
  let targetCwd = process.cwd();

  if (sessionId) {
    // New Sylph sessions have a direct cwd/session-file binding. Legacy
    // sessions fall back to scanning project roots and are bound on resume.
    const binding = getSessionBinding(sessionId);
    if (binding) {
      if (!fs.existsSync(binding.cwd)) throw new Error(`Session working directory no longer exists: ${binding.cwd}`);
      targetCwd = binding.cwd;
      if (binding.sessionFile && fs.existsSync(binding.sessionFile)) {
        sessionManager = SessionManager.open(binding.sessionFile);
      } else {
        const sessionInfo = (await SessionManager.list(targetCwd)).find((entry) => entry.id === sessionId);
        if (sessionInfo) sessionManager = SessionManager.open(sessionInfo.path);
      }
    }

    if (!sessionManager) {
      const searchDirs = [
        ...projects.filter(p => fs.existsSync(p.path)).map(p => p.path),
        process.cwd(),
      ];
      for (const dir of searchDirs) {
        try {
          const sessions = await SessionManager.list(dir);
          const sessionInfo = sessions.find((entry) => entry.id === sessionId);
          if (sessionInfo) {
            sessionManager = SessionManager.open(sessionInfo.path);
            targetCwd = dir;
            const project = projects.find((entry) => path.resolve(entry.path) === path.resolve(dir));
            if (project) {
              saveSessionBinding({ sessionId, projectId: project.id, cwd: dir, sessionFile: sessionInfo.path });
            }
            break;
          }
        } catch { /* ignore unreadable dirs */ }
      }
    }
    if (!sessionManager) throw new Error(`Session ${sessionId} not found in any project`);
  } else {
    const project = projectId ? projects.find((entry) => entry.id === projectId) : undefined;
    if (project) targetCwd = project.path;

    let worktree: Awaited<ReturnType<typeof createManagedWorktree>> | undefined;
    if (options.useWorktree) {
      if (!project) throw new Error("Select a project before creating a worktree");
      if (!options.baseBranch) throw new Error("Select a base branch for the worktree");
      const worktreeKey = randomUUID();
      worktree = await createManagedWorktree(
        project,
        path.join(WORKTREES_DIR, project.id, worktreeKey),
        options.baseBranch,
        worktreeBranchName(options.branchPrompt || "chat", worktreeKey),
      );
      targetCwd = worktree.path;
    }

    try {
      sessionManager = SessionManager.create(targetCwd);
      const resolvedSessionId = sessionManager.getSessionId();
      if (project) {
        saveSessionBinding({
          sessionId: resolvedSessionId,
          projectId: project.id,
          cwd: targetCwd,
          sessionFile: sessionManager.getSessionFile?.(),
          branch: worktree?.branch,
          baseBranch: worktree?.baseBranch,
          worktree: !!worktree,
          managedWorktreeRoot: worktree?.worktreeRoot,
        });
      }
    } catch (error) {
      if (project && worktree) await discardManagedWorktree(project, worktree, WORKTREES_DIR);
      throw error;
    }
  }

  let runtime: any;
  try {
    runtime = await buildRuntime(sessionManager, targetCwd, {
      uiContext: createExtensionUiContext(sessionManager.getSessionId()),
    });
  } catch (error) {
    // A newly-created worktree is not useful without a runtime. Roll back its
    // checkout, generated branch, and Sylph binding atomically.
    const binding = !sessionId ? getSessionBinding(sessionManager?.getSessionId?.()) : undefined;
    if (!sessionId && binding?.worktree && binding.managedWorktreeRoot && binding.branch && binding.baseBranch) {
      const project = projects.find((entry) => entry.id === binding.projectId);
      if (project) {
        await discardManagedWorktree(project, {
          path: binding.cwd,
          worktreeRoot: binding.managedWorktreeRoot,
          branch: binding.branch,
          baseBranch: binding.baseBranch,
        }, WORKTREES_DIR).catch((rollbackError) => console.error("Failed to roll back worktree:", rollbackError));
      }
      if (binding.sessionFile) fs.rmSync(binding.sessionFile, { force: true });
      deleteSessionBinding(binding.sessionId);
    }
    throw error;
  }

  const resolvedId = sessionManager.getSessionId();
  const savedBinding = !sessionId ? getSessionBinding(resolvedId) : undefined;
  if (savedBinding && savedBinding.sessionFile !== sessionManager.getSessionFile?.()) {
    saveSessionBinding({ ...savedBinding, sessionFile: sessionManager.getSessionFile?.() });
  }

  // Broadcast events to all SSE clients with sessionId attached. Events that
  // land after an assistant message completes also carry a fresh context
  // snapshot so the composer's context indicator stays live mid-turn.
  runtime.session.subscribe((event: AgentSessionEvent) => {
    const currentSessionId = sessionManager.getSessionId();
    const eventSeq = getSessionEventSequence(currentSessionId) + 1;
    sessionEventSequences.set(currentSessionId, eventSeq);
    const payload: any = { sessionId: currentSessionId, eventSeq, ...event };
    if (event.type === "message_end" || event.type === "agent_end" || event.type === "compaction_end") {
      const context = getContextInfo(runtime.session);
      if (context) payload.context = context;
    }
    broadcast(payload);
  });

  return { runtime, resolvedSessionId: sessionManager.getSessionId() };
}

export function getOrInitRuntime(sessionId?: string, projectId?: string, options: NewSessionOptions = {}): Promise<any> {
  // Known session: dedupe concurrent builds. Registering the in-flight promise
  // synchronously (before the first await) means a second request for the same
  // session shares this build instead of spinning up its own runtime — two
  // runtimes would both subscribe and double every SSE event to the browser.
  if (sessionId) {
    const existing = activeRuntimes.get(sessionId);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing.promise;
    }
    const entry: RuntimeEntry = { lastUsed: Date.now() } as RuntimeEntry;
    entry.promise = buildSessionRuntime(sessionId, projectId, options)
      .then(({ runtime }) => {
        entry.runtime = runtime;
        return runtime;
      })
      .catch((err) => {
        // Failed build: drop the entry so a later request can retry.
        if (activeRuntimes.get(sessionId) === entry) activeRuntimes.delete(sessionId);
        throw err;
      });
    activeRuntimes.set(sessionId, entry);
    return entry.promise;
  }

  // New session: the id only exists once SessionManager.create runs, so there
  // is no shared key for concurrent callers to race on — each request that
  // omits a sessionId is asking for its own new session. Register under the
  // resolved id after building.
  return buildSessionRuntime(undefined, projectId, options).then(({ runtime, resolvedSessionId }) => {
    activeRuntimes.set(resolvedSessionId, {
      promise: Promise.resolve(runtime),
      runtime,
      lastUsed: Date.now(),
    });
    return runtime;
  });
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
      if (!entry.runtime) continue; // still building; leave it be
      if (entry.runtime.session?.isStreaming) continue;
      if (now - entry.lastUsed > RUNTIME_IDLE_MS) {
        activeRuntimes.delete(id);
        sessionEventSequences.delete(id);
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
