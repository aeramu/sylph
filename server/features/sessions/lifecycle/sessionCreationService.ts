import fs from "node:fs";
import path from "node:path";
import { WORKTREES_DIR } from "../../../config.ts";
import { getProjectDirectory } from "../../projects/projectRepository.ts";
import type { Project } from "../../projects/projectTypes.ts";
import type { SessionHistoryPort } from "./sessionHistoryPort.ts";
import { createScratchSessionManager } from "../scratch/sessionScratch.ts";
import { appendWorkspaceMetadata } from "../workspace/piSessionMetadata.ts";
import { saveSessionBinding } from "../workspace/workspaceBindingRepository.ts";
import type { SessionBinding, SessionDirectoryBinding } from "../workspace/workspaceTypes.ts";
import {
  createProjectWorktrees, discardProjectWorktrees,
} from "../worktrees/projectWorktrees.ts";
import type { NewSessionOptions, ResolvedSessionRuntime } from "./sessionWorkflowTypes.ts";
import { workspaceProject } from "../workspace/sessionProject.ts";

function initialDirectories(project: Project | undefined, scratch: boolean, cwd: string): SessionDirectoryBinding[] {
  if (project?.directories.length) {
    return project.directories.map((directory) => ({
      directoryId: directory.id,
      name: directory.name,
      sourcePath: directory.path,
      path: directory.path,
    }));
  }
  return scratch ? [] : [{ directoryId: "root", name: path.basename(cwd) || "workspace", sourcePath: cwd, path: cwd }];
}

export async function createSession(
  projectId: string | undefined,
  projects: Project[],
  options: NewSessionOptions,
  history: SessionHistoryPort,
): Promise<ResolvedSessionRuntime> {
  const project = projectId ? projects.find((entry) => entry.id === projectId) : undefined;
  if (project?.directories.length && typeof options.directoryId !== "string") throw new Error("Select a starting directory");
  const projectDirectory = project?.directories.length ? getProjectDirectory(project, options.directoryId) : undefined;
  if (project?.directories.length && projectDirectory?.id !== options.directoryId) throw new Error("Project directory not found");

  const standalonePath = typeof options.standalonePath === "string" ? options.standalonePath.trim() : "";
  const scratchWorkspace = (!project || project.directories.length === 0) && !standalonePath;
  let targetCwd = projectDirectory?.path ?? process.cwd();
  if ((!project || project.directories.length === 0) && standalonePath) {
    targetCwd = path.resolve(standalonePath);
    if (!fs.existsSync(targetCwd) || !fs.statSync(targetCwd).isDirectory()) throw new Error("Starting directory not found");
  }
  let runtimeDirectoryId = projectDirectory?.id ?? (scratchWorkspace ? undefined : "root");
  const directories = initialDirectories(project, scratchWorkspace, targetCwd);
  if (!runtimeDirectoryId && directories.length === 1) runtimeDirectoryId = directories[0].directoryId;

  let createdWorktrees: SessionDirectoryBinding[] = [];
  let runtimeProject: Project | undefined;
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
      Object.assign(directories.find((entry) => entry.directoryId === createdDirectory.directoryId)!, createdDirectory);
    }
    targetCwd = directories.find((entry) => entry.directoryId === projectDirectory!.id)!.path;
    runtimeProject = {
      ...project,
      path: targetCwd,
      directories: project.directories.map((directory) => ({
        ...directory,
        path: directories.find((entry) => entry.directoryId === directory.id)!.path,
      })),
    };
  }

  try {
    const sessionManager = scratchWorkspace ? createScratchSessionManager() : history.create(targetCwd);
    if (scratchWorkspace) targetCwd = sessionManager.getCwd?.() || targetCwd;
    const sessionId = sessionManager.getSessionId();
    const active = directories.find((entry) => entry.directoryId === runtimeDirectoryId);
    const binding: SessionBinding = {
      sessionId,
      workspaceKind: scratchWorkspace ? "scratch" : "directories",
      ...(project ? { projectId: project.id } : {}),
      ...(active ? { directoryId: active.directoryId } : {}),
      directories,
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
    return { sessionManager, targetCwd, runtimeProject, runtimeDirectoryId, created: true };
  } catch (error) {
    if (project && createdWorktrees.length) {
      try { await discardProjectWorktrees(project, createdWorktrees, WORKTREES_DIR); }
      catch (cleanupError) {
        throw new AggregateError([
          error instanceof Error ? error : new Error(String(error)),
          cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError)),
        ], "Session creation failed and one or more worktrees could not be rolled back");
      }
    }
    throw error;
  }
}
