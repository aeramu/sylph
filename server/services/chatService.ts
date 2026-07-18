import fs from "fs";
import path from "path";
import { getProjects, getProjectById, projectAtDirectory } from "../projects.ts";
import { getSessionBinding } from "../sessionBindings.ts";
import { projectForSession, projectFromSessionBinding } from "../sessionWorkspace.ts";
import { getOrInitRuntime, rollbackNewWorktreeSession, touchRuntime } from "../runtime/index.ts";
import { findAvailableModel, isSameModel } from "../modelSelection.ts";
import { resolveMentionsInPrompt } from "../mentions.ts";
import { badRequest } from "./errors.ts";

export interface SendChatCommand {
  sessionId?: string;
  prompt: string;
  mentionText?: string;
  projectId?: string;
  directoryId?: string;
  standalonePath?: string;
  modelId?: string;
  thinkingLevel?: unknown;
  images?: unknown[];
  useWorktree?: boolean;
  baseBranches?: Record<string, unknown>;
  baseBranch?: string;
}

export interface SendChatResult {
  success: true;
  sessionId: string;
  workspaceKind?: "directories" | "scratch";
  projectId?: string;
  directoryId?: string;
  branch?: string;
  worktree?: boolean;
}

function normalizeCommand(input: unknown): SendChatCommand {
  const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
  if (typeof body.prompt !== "string" || !body.prompt) badRequest("prompt is required");
  return body as unknown as SendChatCommand;
}

export async function sendChat(input: unknown): Promise<SendChatResult> {
  const command = normalizeCommand(input);
  const { sessionId, prompt, mentionText, projectId, directoryId, standalonePath, modelId, thinkingLevel, images, useWorktree, baseBranches, baseBranch } = command;
  let newWorktreeSessionId: string | undefined;

  try {
    if (!sessionId && projectId) {
      const project = getProjectById(projectId);
      if (!project) badRequest("Project not found");
      if (project.directories.length > 0 && (typeof directoryId !== "string" || !project.directories.some((directory) => directory.id === directoryId))) {
        badRequest("Select a starting directory");
      }
    }
    if (!sessionId && typeof standalonePath === "string" && standalonePath.trim()) {
      const project = projectId ? getProjectById(projectId) : undefined;
      if (!projectId || project?.directories.length === 0) {
        const resolved = path.resolve(standalonePath.trim());
        if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) badRequest("Starting directory not found");
      }
    }
    if (!sessionId && useWorktree) {
      const project = getProjectById(projectId);
      if (!project?.directories.length) badRequest("Add a project directory before creating worktrees");
      const missing = project.directories.filter((directory) => {
        const value = baseBranches?.[directory.id] ?? baseBranch;
        return typeof value !== "string" || !value.trim();
      });
      if (missing.length) badRequest(`Base branch required for: ${missing.map((directory) => directory.name).join(", ")}`);
    }

    const runtime = await getOrInitRuntime(sessionId, projectId, {
      directoryId: typeof directoryId === "string" ? directoryId : undefined,
      standalonePath: typeof standalonePath === "string" ? standalonePath.trim() : undefined,
      useWorktree: !sessionId && useWorktree === true,
      baseBranches: baseBranches
        ? Object.fromEntries(Object.entries(baseBranches).filter((entry): entry is [string, string] => typeof entry[1] === "string" && !!entry[1].trim()).map(([key, value]) => [key, value.trim()]))
        : undefined,
      baseBranch: typeof baseBranch === "string" ? baseBranch.trim() : undefined,
      branchPrompt: typeof mentionText === "string" ? mentionText : prompt,
    });
    const resolvedSessionId = runtime.session.sessionId;
    if (!sessionId && useWorktree === true) newWorktreeSessionId = resolvedSessionId;
    touchRuntime(resolvedSessionId);

    if (modelId) {
      const targetModel = findAvailableModel(runtime.session.modelRegistry.getAvailable(), modelId);
      if (!targetModel) {
        if (!sessionId && useWorktree === true) await rollbackNewWorktreeSession(resolvedSessionId);
        badRequest(`Unknown or unavailable model: ${modelId}`);
      }
      if (!isSameModel(runtime.session.model, targetModel)) await runtime.session.setModel(targetModel);
    }

    if (thinkingLevel !== undefined) {
      if (typeof thinkingLevel !== "string") {
        if (!sessionId && useWorktree === true) await rollbackNewWorktreeSession(resolvedSessionId);
        badRequest("thinkingLevel must be a string");
      }
      const availableThinkingLevels = runtime.session.getAvailableThinkingLevels();
      if (!availableThinkingLevels.includes(thinkingLevel)) {
        if (!sessionId && useWorktree === true) await rollbackNewWorktreeSession(resolvedSessionId);
        badRequest(`Thinking level ${thinkingLevel} is not supported by ${runtime.session.model?.id || "the selected model"}`, { availableThinkingLevels });
      }
      runtime.session.setThinkingLevel(thinkingLevel);
    }

    const projects = getProjects();
    const binding = getSessionBinding(resolvedSessionId);
    const runtimeCwd = binding?.cwd ?? runtime.session.cwd;
    const resolvedProject = binding
      ? (binding.projectId ? projects.find((entry) => entry.id === binding.projectId) : undefined)
      : (typeof runtimeCwd === "string"
          ? projects.find((entry) => entry.directories.some((directory) => path.resolve(directory.path) === path.resolve(runtimeCwd)))
          : undefined);
    const mentionProject = binding?.workspaceKind === "scratch"
      ? undefined
      : binding
        ? projectForSession(resolvedProject ?? projectFromSessionBinding(binding), binding)
      : resolvedProject && typeof runtimeCwd === "string"
        ? projectAtDirectory(resolvedProject, directoryId, runtimeCwd)
        : undefined;
    const mentionSource = typeof mentionText === "string" ? mentionText : prompt;
    const promptText = await resolveMentionsInPrompt(mentionProject, prompt, mentionSource);
    const promptOptions = Array.isArray(images) && images.length > 0 ? { images } : undefined;

    if (runtime.session.isStreaming) {
      runtime.session.steer(promptText, promptOptions?.images).catch((err: unknown) => console.error("Prompt error:", err));
    } else {
      runtime.session.prompt(promptText, promptOptions).catch((err: unknown) => console.error("Prompt error:", err));
    }

    return {
      success: true,
      sessionId: resolvedSessionId,
      workspaceKind: binding?.workspaceKind,
      projectId: resolvedProject?.id,
      directoryId: binding?.directoryId,
      branch: binding?.branch,
      worktree: binding?.worktree,
    };
  } catch (error) {
    if (newWorktreeSessionId) {
      await rollbackNewWorktreeSession(newWorktreeSessionId)
        .catch((rollbackError) => console.error("Failed to roll back new worktree session:", rollbackError));
    }
    throw error;
  }
}
