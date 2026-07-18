import fs from "fs";
import path from "path";
import { SessionManager, type AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { WORKTREES_DIR } from "../config.ts";
import { createScratchSessionManager } from "../sessionScratch.ts";
import { findProjectDirectoryByPath, getProjectDirectory, getProjects, type Project } from "../projects.ts";
import { getSessionBinding, saveSessionBinding, type SessionBinding, type SessionDirectoryBinding } from "../sessionBindings.ts";
import { createExtensionUiContext } from "../uiBridge.ts";
import { createProjectWorktrees, discardProjectWorktrees } from "../projectWorktrees.ts";
import { appendWorkspaceMetadata, getWorkspaceMetadata, reconcileSessionBinding } from "../piSessionMetadata.ts";
import { projectForSession } from "../sessionWorkspace.ts";
import { broadcast } from "../sse.ts";
import { buildRuntime } from "./runtimeFactory.ts";
import { getContextInfo } from "./contextUsage.ts";

export interface SessionRuntimeEvents {
  nextSequence: (sessionId: string) => number;
}

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

export async function buildSessionRuntime(
  sessionId: string | undefined,
  projectId: string | undefined,
  options: NewSessionOptions = {},
  rollbackNewWorktreeSession: (sessionId: string) => Promise<void>,
  events: SessionRuntimeEvents,
): Promise<{ runtime: any; resolvedSessionId: string }> {
  const projects = getProjects();
  let sessionManager: any;
  let targetCwd = process.cwd();
  let runtimeProject: Project | undefined;
  let runtimeDirectoryId: string | undefined;

  const workspaceProject = (binding: SessionBinding, configured?: Project): Project | undefined => binding.workspaceKind === "scratch" ? undefined : projectForSession(configured ?? {
    id: binding.projectId || `standalone:${binding.sessionId}`,
    name: "No Project",
    path: binding.cwd,
    directories: [{ id: binding.directoryId || "root", name: path.basename(binding.cwd) || "workspace", path: binding.cwd }],
  }, binding);

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
        ?? (runtimeProject ? findProjectDirectoryByPath(runtimeProject, binding.cwd)?.id : undefined)
        ?? runtimeProject?.directories[0]?.id;
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
    if (project?.directories.length && typeof options.directoryId !== "string") throw new Error("Select a starting directory");
    const projectDirectory = project?.directories.length ? getProjectDirectory(project, options.directoryId) : undefined;
    if (project?.directories.length && projectDirectory?.id !== options.directoryId) throw new Error("Project directory not found");
    const standalonePath = typeof options.standalonePath === "string" ? options.standalonePath.trim() : "";
    const scratchWorkspace = (!project || project.directories.length === 0) && !standalonePath;
    if ((!project || project.directories.length === 0) && standalonePath) {
      targetCwd = path.resolve(standalonePath);
      if (!fs.existsSync(targetCwd) || !fs.statSync(targetCwd).isDirectory()) throw new Error("Starting directory not found");
    }
    runtimeDirectoryId = projectDirectory?.id ?? (scratchWorkspace ? undefined : "root");
    if (projectDirectory) targetCwd = projectDirectory.path;

    const sessionDirectories: SessionDirectoryBinding[] = project?.directories.length
      ? project.directories.map((directory) => ({ directoryId: directory.id, name: directory.name, sourcePath: directory.path, path: directory.path }))
      : (scratchWorkspace ? [] : [{ directoryId: "root", name: path.basename(targetCwd) || "workspace", sourcePath: targetCwd, path: targetCwd }]);
    if (!runtimeDirectoryId && sessionDirectories.length === 1) runtimeDirectoryId = sessionDirectories[0].directoryId;
    let createdWorktrees: SessionDirectoryBinding[] = [];
    if (options.useWorktree) {
      if (!project?.directories.length) throw new Error("Add a project directory before creating worktrees");
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
      // The private scratch path depends on the session id. Reserve the id in
      // memory first, create its directory, then create the persistent manager
      // with that same id so Pi's immutable header cwd is correct from birth.
      if (scratchWorkspace) {
        sessionManager = createScratchSessionManager();
        targetCwd = sessionManager.getCwd();
      } else {
        sessionManager = SessionManager.create(targetCwd);
      }
      const resolvedSessionId = sessionManager.getSessionId();
      const active = sessionDirectories.find((entry) => entry.directoryId === runtimeDirectoryId);
      const binding: SessionBinding = {
        sessionId: resolvedSessionId,
        workspaceKind: scratchWorkspace ? "scratch" : "directories",
        ...(project ? { projectId: project.id } : {}),
        ...(active ? { directoryId: active.directoryId } : {}),
        directories: sessionDirectories,
        cwd: targetCwd,
        sessionFile: sessionManager.getSessionFile?.(),
        branch: active?.branch,
        baseBranch: active?.baseBranch,
        worktree: createdWorktrees.length > 0,
        managedWorktreeRoot: active?.worktreeRoot,
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
    const eventSeq = events.nextSequence(currentSessionId);
    const payload: any = { sessionId: currentSessionId, eventSeq, ...event };
    if (event.type === "message_end" || event.type === "agent_end" || event.type === "compaction_end") {
      const context = getContextInfo(runtime.session);
      if (context) payload.context = context;
    }
    broadcast(payload);
  });

  return { runtime, resolvedSessionId: sessionManager.getSessionId() };
}
