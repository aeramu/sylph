import express from "express";
import { handleError } from "./routeHelpers.ts";
import fs from "fs";
import path from "path";
import { getProjects, getProjectById, projectAtDirectory } from "../projects.ts";
import { getSessionBinding } from "../sessionBindings.ts";
import { projectForSession, projectFromSessionBinding } from "../sessionWorkspace.ts";
import { getOrInitRuntime, rollbackNewWorktreeSession, touchRuntime } from "../runtime/index.ts";
import { findAvailableModel, isSameModel } from "../modelSelection.ts";
import { resolveMentionsInPrompt } from "../mentions.ts";

export function registerChatRoutes(router: express.Router): void {
  router.post("/api/chat", async (req, res) => {
    const { sessionId, prompt, mentionText, projectId, directoryId, standalonePath, modelId, thinkingLevel, images, useWorktree, baseBranches, baseBranch } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: "prompt is required" });
    }

    let newWorktreeSessionId: string | undefined;
    try {
      if (!sessionId && projectId) {
        const project = getProjectById(projectId);
        if (!project) return res.status(400).json({ error: "Project not found" });
        if (typeof directoryId !== "string" || !project.directories.some((directory) => directory.id === directoryId)) {
          return res.status(400).json({ error: "Select a starting directory" });
        }
      }
      if (!sessionId && !projectId) {
        if (typeof standalonePath !== "string" || !standalonePath.trim()) return res.status(400).json({ error: "Select a starting directory" });
        const resolved = path.resolve(standalonePath.trim());
        if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) return res.status(400).json({ error: "Starting directory not found" });
      }
      if (!sessionId && useWorktree) {
        const project = getProjectById(projectId);
        if (!project) return res.status(400).json({ error: "Select a project before creating worktrees" });
        const supplied = baseBranches && typeof baseBranches === "object" ? baseBranches as Record<string, unknown> : undefined;
        const missing = project.directories.filter((directory) => {
          const value = supplied?.[directory.id] ?? baseBranch;
          return typeof value !== "string" || !value.trim();
        });
        if (missing.length) return res.status(400).json({ error: `Base branch required for: ${missing.map((directory) => directory.name).join(", ")}` });
      }
      const runtime = await getOrInitRuntime(sessionId, projectId, {
        directoryId: typeof directoryId === "string" ? directoryId : undefined,
        standalonePath: typeof standalonePath === "string" ? standalonePath.trim() : undefined,
        useWorktree: !sessionId && useWorktree === true,
        baseBranches: baseBranches && typeof baseBranches === "object"
          ? Object.fromEntries(Object.entries(baseBranches).filter((entry): entry is [string, string] => typeof entry[1] === "string" && !!entry[1].trim()).map(([key, value]) => [key, value.trim()]))
          : undefined,
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
      const runtimeCwd = binding?.cwd ?? runtime.session.cwd;
      // A binding without projectId is explicitly a No Project session; do not
      // silently reattach it just because its standalone cwd is also configured
      // as a project directory. Some Pi runtime versions also omit session.cwd,
      // so never pass it unchecked to path.resolve.
      const resolvedProject = binding
        ? (binding.projectId ? projects.find((entry) => entry.id === binding.projectId) : undefined)
        : (typeof runtimeCwd === "string"
            ? projects.find((entry) => entry.directories.some((directory) => path.resolve(directory.path) === path.resolve(runtimeCwd)))
            : undefined);
      // Mentions must resolve inside the checkout used by this session. A No
      // Project session still gets its standalone directory as a virtual root.
      const mentionProject = binding
        ? projectForSession(resolvedProject ?? projectFromSessionBinding(binding), binding)
        : resolvedProject && typeof runtimeCwd === "string"
          ? projectAtDirectory(resolvedProject, directoryId, runtimeCwd)
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
        directoryId: binding?.directoryId,
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

}
