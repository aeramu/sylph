import express from "express";
import { registerAuthRoutes } from "./authRoutes.ts";
import { registerChatRoutes } from "./chatRoutes.ts";
import { registerDashboardRoutes } from "./dashboardRoutes.ts";
import { registerFilesystemRoutes } from "./filesystemRoutes.ts";
import { registerProjectGitRoutes } from "./projectGitRoutes.ts";
import { registerProjectRoutes } from "./projectRoutes.ts";
import { registerResourceRoutes } from "./resourceRoutes.ts";
import { registerSessionRoutes } from "./sessionRoutes.ts";
import { registerSessionWorkspaceRoutes } from "./sessionWorkspaceRoutes.ts";
import { registerSettingsRoutes } from "./settingsRoutes.ts";
import { registerStreamRoutes } from "./streamRoutes.ts";
import { registerWorktreeRoutes } from "./worktreeRoutes.ts";

export function createRouter(): express.Router {
  const router = express.Router();
  registerDashboardRoutes(router);
  registerSettingsRoutes(router);
  registerAuthRoutes(router);
  registerStreamRoutes(router);
  registerProjectRoutes(router);
  registerFilesystemRoutes(router);
  registerSessionRoutes(router);
  registerSessionWorkspaceRoutes(router);
  registerWorktreeRoutes(router);
  registerResourceRoutes(router);
  registerProjectGitRoutes(router);
  registerChatRoutes(router);
  return router;
}
