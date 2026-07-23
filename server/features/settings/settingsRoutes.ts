import express from "express";
import { asyncRoute } from "../../platform/http/routeError.ts";
import { getSettings } from "./settingsRepository.ts";
import { listModels, saveSettings } from "./settingsService.ts";

export function registerSettingsRoutes(router: express.Router): void {
  router.get("/api/settings", (_req, res) => res.json(getSettings()));
  router.patch("/api/settings", asyncRoute(async (req, res) => res.json(await saveSettings(req.body ?? {}))));
  router.get("/api/models", asyncRoute(async (_req, res) => res.json({ models: await listModels() })));
}
