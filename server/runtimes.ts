import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  createAgentSessionRuntime,
  createAgentSessionServices,
  createAgentSessionFromServices,
  getAgentDir,
  SessionManager,
  loadProjectContextFiles
} from "@earendil-works/pi-coding-agent";
import type {
  CreateAgentSessionRuntimeFactory,
  AgentSessionEvent
} from "@earendil-works/pi-coding-agent";
import { RUNTIME_IDLE_MS, EVICTION_INTERVAL_MS, WORKTREES_DIR } from "./config.ts";
import { authStorage, modelRegistry } from "./auth.ts";
import { findProjectDirectoryByPath, getProjectDirectory, getProjects, type Project } from "./projects.ts";
import { deleteSessionBinding, getSessionBinding, saveSessionBinding, type SessionBinding, type SessionDirectoryBinding } from "./sessionBindings.ts";
import { broadcast } from "./sse.ts";
import { clearSessionStatuses, createExtensionUiContext, rejectPendingForSession } from "./uiBridge.ts";
import { createPermissionExtension, isThirdPartyPermissionExtension } from "./permissions.ts";
import { getRawManagedDirectories } from "./sessionWorkspace.ts";
import { createProjectWorktrees, discardProjectWorktrees } from "./projectWorktrees.ts";
import { appendWorkspaceMetadata, getWorkspaceMetadata, reconcileSessionBinding } from "./piSessionMetadata.ts";

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

function workspacePrompt(project: Project | undefined, directoryId: string | undefined, cwd: string) {
  if (!project || project.directories.length < 2) return undefined;
  const active = getProjectDirectory(project, directoryId);
  const roots = project.directories.map((directory) =>
    `- ${directory.name}${directory.id === active.id ? " (active cwd)" : ""}: ${directory.id === active.id ? cwd : directory.path}`,
  );
  return [
    "This is a multi-directory Sylph project. The shell and relative file tools start in the active directory, but all listed roots belong to the same project and may be accessed with absolute paths.",
    "Project directories:",
    ...roots,
    "When discussing or editing files outside the active cwd, use the listed absolute path. @mentions use root aliases such as @root-name/path/to/file.",
    "Each directory is a separate Git repository; run Git commands in the directory they target.",
  ].join("\n");
}

async function buildRuntime(sessionManager: any, cwd: string, opts?: { uiContext?: any; project?: Project; directoryId?: string; sessionId?: string }) {
  const factory: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
    const permissionRoots = (opts?.project?.directories ?? [{ id: "cwd", name: "workspace", path: cwd }]).map((directory) => ({
      id: directory.id,
      name: directory.name,
      path: directory.path,
      access: "read-write" as const,
    }));
    const boundSessionId = opts?.sessionId ?? sessionManager.getSessionId?.();
    const initialApprovals = getSessionBinding(boundSessionId)?.permissionApprovals ?? [];
    const auditFile = path.join(getAgentDir(), "logs", "sylph-permissions.jsonl");
    const services = await createAgentSessionServices({
      cwd,
      authStorage,
      modelRegistry,
      // Register sylph's native, browser-rendered ask_user_question tool in
      // every runtime (replaces the TUI-only @juicesharp version). Use a real
      // extension path instead of an inline factory so /api/resources can show
      // the filename rather than pi's synthetic <inline:1> id.
      resourceLoaderOptions: {
        additionalExtensionPaths: [askUserQuestionExtensionPath],
        extensionFactories: opts?.project ? [{
          name: "sylph-permissions",
          factory: createPermissionExtension(
            { roots: permissionRoots, externalAccess: "ask" },
            {
              initialApprovals,
              onApproval: (approvalKey) => {
                const binding = getSessionBinding(boundSessionId);
                if (!binding) return;
                const permissionApprovals = Array.from(new Set([...(binding.permissionApprovals ?? []), approvalKey]));
                saveSessionBinding({ ...binding, permissionApprovals });
              },
              audit: (event) => {
                try {
                  fs.mkdirSync(path.dirname(auditFile), { recursive: true });
                  fs.appendFileSync(auditFile, JSON.stringify({ sessionId: boundSessionId, ...event }) + "\n", { mode: 0o600 });
                  fs.chmodSync(auditFile, 0o600);
                } catch (error) {
                  console.error("Failed to write Sylph permission audit:", error);
                }
              },
            },
          ),
        }] : [],
        // Sylph owns authorization for project runtimes. Remove the global
        // third-party permission extension here to avoid duplicate/conflicting
        // prompts while leaving the user's normal Pi installation untouched.
        extensionsOverride: (base) => opts?.project ? ({
          ...base,
          extensions: base.extensions.filter((extension) => !isThirdPartyPermissionExtension(extension)),
        }) : base,
        // Pi normally loads AGENTS.md/CLAUDE.md from only one cwd. Merge the
        // context chain from every workspace root and label paths by root.
        agentsFilesOverride: (base) => {
          if (!opts?.project || opts.project.directories.length < 2) return base;
          const files = [...base.agentsFiles];
          const seen = new Set(files.map((file) => path.resolve(file.path)));
          for (const directory of opts.project.directories) {
            for (const file of loadProjectContextFiles({ cwd: directory.path, agentDir: getAgentDir() })) {
              const resolved = path.resolve(file.path);
              if (seen.has(resolved)) continue;
              seen.add(resolved);
              files.push({ path: `${directory.name}:${file.path}`, content: file.content });
            }
          }
          return { agentsFiles: files };
        },
        appendSystemPromptOverride: (base) => {
          const workspace = workspacePrompt(opts?.project, opts?.directoryId, cwd);
          return workspace ? [...base, workspace] : base;
        },
      },
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

// Waits out any in-flight build for this session; undefined when nothing is
// registered or the build failed.
export function getSettledRuntime(sessionId: string): Promise<any> {
  const entry = activeRuntimes.get(sessionId);
  if (!entry) return Promise.resolve(undefined);
  entry.lastUsed = Date.now();
  return entry.promise.catch(() => undefined);
}

export function disposeRuntime(sessionId: string) {
  const entry = activeRuntimes.get(sessionId);
  if (!entry) return;
  activeRuntimes.delete(sessionId);
  sessionEventSequences.delete(sessionId);
  rejectPendingForSession(sessionId, "session worktree removed");
  clearSessionStatuses(sessionId);
  if (entry.runtime) {
    try { entry.runtime.dispose?.(); } catch (error) { console.error(`Failed to dispose runtime ${sessionId}:`, error); }
  } else {
    // Still building: dispose once it settles so an orphaned runtime doesn't
    // keep its SSE subscription alive after the session was torn down.
    entry.promise?.then((runtime) => runtime?.dispose?.()).catch(() => {});
  }
}

export async function rollbackNewWorktreeSession(sessionId: string) {
  const binding = getSessionBinding(sessionId);
  if (!binding) return;
  const managedDirectories = getRawManagedDirectories(binding);
  if (managedDirectories.length === 0) return;
  disposeRuntime(sessionId);
  const project = getProjects().find((entry) => entry.id === binding.projectId);
  if (!project) throw new Error("The project configuration for this managed worktree no longer exists");
  // discardProjectWorktrees aggregates failures and throws. Do not delete the
  // binding/session file unless it fully succeeds: they are the recovery
  // metadata for any checkout that remains.
  await discardProjectWorktrees(project, managedDirectories, WORKTREES_DIR);
  if (binding.sessionFile) fs.rmSync(binding.sessionFile, { force: true });
  deleteSessionBinding(sessionId);
}

export function getSessionEventSequence(sessionId: string) {
  return sessionEventSequences.get(sessionId) ?? 0;
}

// Build a runtime and wire up its SSE broadcast. Does not touch activeRuntimes;
// registration (and dedup) is the caller's responsibility.
export interface NewSessionOptions {
  directoryId?: string;
  /** Standalone cwd when creating a session without a project. */
  standalonePath?: string;
  useWorktree?: boolean;
  /** Base branch per project directory; legacy baseBranch applies to all roots. */
  baseBranches?: Record<string, string>;
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
  let runtimeProject: Project | undefined;
  let runtimeDirectoryId: string | undefined;

  const workspaceProject = (binding: SessionBinding, configured?: Project): Project => {
    const roots = binding.directories?.length
      ? binding.directories.map((directory) => ({ id: directory.directoryId, name: directory.name, path: directory.path }))
      : configured?.directories ?? [{ id: binding.directoryId || "root", name: path.basename(binding.cwd) || "workspace", path: binding.cwd }];
    const activeId = binding.directoryId && roots.some((directory) => directory.id === binding.directoryId)
      ? binding.directoryId
      : roots[0].id;
    const active = roots.find((directory) => directory.id === activeId)!;
    return {
      id: binding.projectId || `standalone:${binding.sessionId}`,
      name: configured?.name || "No Project",
      path: active.path,
      directories: roots,
      activeDirectoryId: active.id,
    };
  };

  if (sessionId) {
    // New Sylph sessions have a direct cwd/session-file binding. Legacy
    // sessions fall back to scanning project roots and are bound on resume.
    let binding = getSessionBinding(sessionId);
    if (binding?.sessionFile && fs.existsSync(binding.sessionFile)) {
      const embeddedManager = SessionManager.open(binding.sessionFile);
      if (embeddedManager.getSessionId() === sessionId) binding = reconcileSessionBinding(embeddedManager, binding.sessionFile) ?? binding;
    }
    if (binding) {
      if (!fs.existsSync(binding.cwd)) throw new Error(`Session working directory no longer exists: ${binding.cwd}`);
      targetCwd = binding.cwd;
      const configuredProject = projects.find((entry) => entry.id === binding.projectId);
      runtimeProject = workspaceProject(binding, configuredProject);
      runtimeDirectoryId = binding.directoryId
        ?? findProjectDirectoryByPath(runtimeProject, binding.cwd)?.id
        ?? runtimeProject.directories[0]?.id;
      if (runtimeProject && !runtimeProject.directories.some((directory) => directory.id === runtimeDirectoryId)) {
        runtimeDirectoryId = runtimeProject.directories[0]?.id;
      }
      if (binding.sessionFile && fs.existsSync(binding.sessionFile)) {
        sessionManager = SessionManager.open(binding.sessionFile);
      } else {
        const sessionInfo = (await SessionManager.list(targetCwd)).find((entry) => entry.id === sessionId);
        if (sessionInfo) sessionManager = SessionManager.open(sessionInfo.path);
      }
    }

    if (!sessionManager) {
      // If the external binding index was lost, embedded Sylph metadata can
      // recover a session by ID even when its cwd is a detached worktree.
      try {
        const sessionInfo = (await SessionManager.listAll()).find((entry) => entry.id === sessionId);
        if (sessionInfo?.path && fs.existsSync(sessionInfo.path)) {
          const manager = SessionManager.open(sessionInfo.path);
          const embeddedBinding = reconcileSessionBinding(manager, sessionInfo.path);
          if (embeddedBinding) {
            sessionManager = manager;
            targetCwd = embeddedBinding.cwd;
            runtimeProject = workspaceProject(embeddedBinding, projects.find((entry) => entry.id === embeddedBinding.projectId));
            runtimeDirectoryId = embeddedBinding.directoryId;
          }
        }
      } catch { /* fall through to legacy cwd-scoped discovery */ }
    }

    if (!sessionManager) {
      const searchDirs = [
        ...projects.flatMap((project) => project.directories.map((directory) => directory.path)).filter((directory) => fs.existsSync(directory)),
        process.cwd(),
      ];
      for (const dir of searchDirs) {
        try {
          const sessions = await SessionManager.list(dir);
          const sessionInfo = sessions.find((entry) => entry.id === sessionId);
          if (sessionInfo) {
            sessionManager = SessionManager.open(sessionInfo.path);
            const embeddedBinding = reconcileSessionBinding(sessionManager, sessionInfo.path);
            if (embeddedBinding) {
              targetCwd = embeddedBinding.cwd;
              runtimeProject = workspaceProject(embeddedBinding, projects.find((entry) => entry.id === embeddedBinding.projectId));
              runtimeDirectoryId = embeddedBinding.directoryId;
            } else {
              targetCwd = dir;
              const project = projects.find((entry) => entry.directories.some((directory) => path.resolve(directory.path) === path.resolve(dir)));
              const directory = project ? findProjectDirectoryByPath(project, dir) : undefined;
              if (project) {
                runtimeProject = project;
                runtimeDirectoryId = directory?.id ?? project.directories[0]?.id;
                saveSessionBinding({ sessionId, projectId: project.id, directoryId: runtimeDirectoryId, cwd: dir, sessionFile: sessionInfo.path });
              }
            }
            break;
          }
        } catch { /* ignore unreadable dirs */ }
      }
    }
    if (!sessionManager) throw new Error(`Session ${sessionId} not found`);
    if (!getSessionBinding(sessionId)) {
      // Raw Pi sessions become standalone only when explicitly opened; listing
      // sessions remains read-only.
      const cwd = sessionManager.getCwd?.() || targetCwd;
      const standalone: SessionBinding = {
        sessionId,
        directoryId: "root",
        cwd,
        directories: [{ directoryId: "root", name: path.basename(cwd) || "workspace", sourcePath: cwd, path: cwd }],
        sessionFile: sessionManager.getSessionFile?.(),
        worktree: false,
      };
      appendWorkspaceMetadata(sessionManager, standalone);
      saveSessionBinding(standalone);
      targetCwd = cwd;
      runtimeDirectoryId = "root";
      runtimeProject = workspaceProject(standalone);
    }
  } else {
    const project = projectId ? projects.find((entry) => entry.id === projectId) : undefined;
    if (project && typeof options.directoryId !== "string") throw new Error("Select a starting directory");
    const projectDirectory = project ? getProjectDirectory(project, options.directoryId) : undefined;
    if (project && projectDirectory?.id !== options.directoryId) throw new Error("Project directory not found");
    if (!project) {
      if (typeof options.standalonePath !== "string" || !options.standalonePath.trim()) throw new Error("Select a starting directory");
      targetCwd = path.resolve(options.standalonePath);
      if (!fs.existsSync(targetCwd) || !fs.statSync(targetCwd).isDirectory()) throw new Error("Starting directory not found");
    }
    runtimeDirectoryId = projectDirectory?.id ?? "root";
    if (projectDirectory) targetCwd = projectDirectory.path;

    const sessionDirectories: SessionDirectoryBinding[] = project?.directories.map((directory) => ({
      directoryId: directory.id, name: directory.name, sourcePath: directory.path, path: directory.path,
    })) ?? [{ directoryId: "root", name: path.basename(targetCwd) || "workspace", sourcePath: targetCwd, path: targetCwd }];
    let createdWorktrees: SessionDirectoryBinding[] = [];
    if (options.useWorktree) {
      if (!project) throw new Error("Select a project before creating worktrees");
      const created = await createProjectWorktrees(project, {
        managedRoot: WORKTREES_DIR,
        baseBranches: options.baseBranches,
        legacyBaseBranch: options.baseBranch,
        branchPrompt: options.branchPrompt || "chat",
      });
      createdWorktrees = created.directories;
      for (const createdDirectory of created.directories) {
        const bindingDirectory = sessionDirectories.find((entry) => entry.directoryId === createdDirectory.directoryId)!;
        Object.assign(bindingDirectory, createdDirectory);
      }
      targetCwd = sessionDirectories.find((entry) => entry.directoryId === projectDirectory!.id)!.path;
      runtimeProject = {
        ...project,
        path: targetCwd,
        directories: project.directories.map((directory) => ({
          ...directory,
          path: sessionDirectories.find((entry) => entry.directoryId === directory.id)!.path,
        })),
      };
    }

    try {
      sessionManager = SessionManager.create(targetCwd);
      const resolvedSessionId = sessionManager.getSessionId();
      const active = sessionDirectories.find((entry) => entry.directoryId === runtimeDirectoryId)!;
      const binding: SessionBinding = {
        sessionId: resolvedSessionId,
        ...(project ? { projectId: project.id } : {}),
        directoryId: active.directoryId,
        directories: sessionDirectories,
        cwd: targetCwd,
        sessionFile: sessionManager.getSessionFile?.(),
        branch: active.branch,
        baseBranch: active.baseBranch,
        worktree: createdWorktrees.length > 0,
        managedWorktreeRoot: active.worktreeRoot,
      };
      appendWorkspaceMetadata(sessionManager, binding);
      saveSessionBinding(binding);
      runtimeProject = workspaceProject(binding, project);
    } catch (error) {
      if (project && createdWorktrees.length) {
        try {
          await discardProjectWorktrees(project, createdWorktrees, WORKTREES_DIR);
        } catch (cleanupError) {
          throw new AggregateError([
            error instanceof Error ? error : new Error(String(error)),
            cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError)),
          ], "Session creation failed and one or more worktrees could not be rolled back");
        }
      }
      throw error;
    }
  }

  let runtime: any;
  try {
    runtime = await buildRuntime(sessionManager, targetCwd, {
      uiContext: createExtensionUiContext(sessionManager.getSessionId()),
      project: runtimeProject,
      directoryId: runtimeDirectoryId,
      sessionId: sessionManager.getSessionId(),
    });
  } catch (error) {
    // A newly-created worktree is not useful without a runtime. Roll back its
    // checkout, generated branch, and Sylph binding atomically.
    if (!sessionId && sessionManager?.getSessionId?.()) {
      await rollbackNewWorktreeSession(sessionManager.getSessionId())
        .catch((rollbackError) => console.error("Failed to roll back worktree:", rollbackError));
    }
    throw error;
  }

  const savedBinding = reconcileSessionBinding(sessionManager, sessionManager.getSessionFile?.());
  // Lazily make legacy externally-bound sessions self-describing when resumed.
  if (savedBinding && !getWorkspaceMetadata(sessionManager)) appendWorkspaceMetadata(sessionManager, savedBinding);
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
      const cwd = projects.flatMap((project) => project.directories).find((directory) => fs.existsSync(directory.path))?.path || process.cwd();
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
