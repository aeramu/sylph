import express from "express";
import { asyncRoute } from "../../platform/http/routeError.ts";
import { createProvider, listProviderModels, listProviders, logoutProvider, saveProviderApiKey } from "./authService.ts";
import { cancelOAuthFlow, getSerializedOAuthFlow, respondToOAuthFlow, startOAuthLogin } from "./oauthFlowService.ts";

export function registerAuthRoutes(router: express.Router): void {
  router.get("/api/auth/providers", asyncRoute(async (_req, res) => res.json({ providers: await listProviders() })));
  router.get("/api/auth/providers/:provider/models", asyncRoute(async (req, res) => res.json({ models: await listProviderModels(String(req.params.provider)) })));
  router.post("/api/auth/:provider/api-key", asyncRoute(async (req, res) => {
    saveProviderApiKey(String(req.params.provider), req.body?.apiKey);
    res.json({ ok: true });
  }));
  router.post("/api/auth/providers", asyncRoute(async (req, res) => {
    const provider = createProvider(req.body ?? {});
    res.json({ ok: true, provider });
  }));
  router.post("/api/auth/:provider/oauth/start", asyncRoute(async (req, res) => {
    const result = await startOAuthLogin(String(req.params.provider));
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ id: result.id });
  }));
  router.get("/api/auth/oauth/flows/:id", (req, res) => {
    const flow = getSerializedOAuthFlow(String(req.params.id));
    if (!flow) return res.status(404).json({ error: "OAuth flow not found" });
    res.json(flow);
  });
  router.post("/api/auth/oauth/flows/:id/respond", (req, res) => {
    const result = respondToOAuthFlow(String(req.params.id), req.body ?? {});
    switch (result.status) {
      case "not_found": return res.status(404).json({ error: "OAuth flow not found" });
      case "not_pending": return res.status(400).json({ error: `OAuth flow is ${result.flowStatus}` });
      case "not_waiting": return res.status(409).json({ error: "OAuth flow is not waiting for input" });
      case "ok": return res.json({ ok: true });
    }
  });
  router.post("/api/auth/oauth/flows/:id/cancel", (req, res) => {
    if (!cancelOAuthFlow(String(req.params.id))) return res.status(404).json({ error: "OAuth flow not found" });
    res.json({ ok: true });
  });
  router.post("/api/auth/:provider/logout", asyncRoute(async (req, res) => {
    logoutProvider(String(req.params.provider));
    res.json({ ok: true });
  }));
}
