import express from "express";
import { registerArtifactRoutes } from "../../features/artifacts/artifactRoutes.ts";
import { registerAuthRoutes } from "../../features/auth/authRoutes.ts";
import { registerChatRoutes } from "../../features/chat/chatRoutes.ts";
import { registerFilesystemRoutes } from "../../features/filesystem/filesystemRoutes.ts";
import { registerProjectGitRoutes } from "../../features/git/projectGitRoutes.ts";
import { registerProjectRoutes } from "../../features/projects/projectRoutes.ts";
import { registerResourceRoutes } from "../../features/resources/resourceRoutes.ts";
import { registerSessionRoutes } from "../../features/sessions/lifecycle/sessionRoutes.ts";
import { registerSessionWorkspaceRoutes } from "../../features/sessions/workspace/sessionWorkspaceRoutes.ts";
import { registerWorktreeRoutes } from "../../features/sessions/worktrees/worktreeRoutes.ts";
import { registerSettingsRoutes } from "../../features/settings/settingsRoutes.ts";
import { registerDashboardRoutes } from "../../integrations/agent-browser/dashboardRoutes.ts";
import { registerStreamRoutes } from "../events/streamRoutes.ts";

/** Composition root for the HTTP API. Route definitions remain feature-owned. */
export function createApiRouter(): express.Router {
  const router = express.Router();
  registerDashboardRoutes(router);
  registerSettingsRoutes(router);
  registerAuthRoutes(router);
  registerStreamRoutes(router);
  registerProjectRoutes(router);
  registerFilesystemRoutes(router);
  registerArtifactRoutes(router);
  registerSessionRoutes(router);
  registerSessionWorkspaceRoutes(router);
  registerWorktreeRoutes(router);
  registerResourceRoutes(router);
  registerProjectGitRoutes(router);
  registerChatRoutes(router);
  return router;
}
