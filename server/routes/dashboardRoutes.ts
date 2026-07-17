import express from "express";
import { getAgentBrowserDashboardStatus, startAgentBrowserDashboard } from "../agentBrowserDashboard.ts";

export function registerDashboardRoutes(router: express.Router): void {
  router.get("/api/agent-browser/dashboard", async (_req, res) => {
    res.json(await getAgentBrowserDashboardStatus());
  });

  router.post("/api/agent-browser/dashboard/start", async (_req, res) => {
    res.json(await startAgentBrowserDashboard());
  });

}
