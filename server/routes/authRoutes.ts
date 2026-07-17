import express from "express";
import { handleError } from "./routeHelpers.ts";
import { authStorage, modelRegistry, refreshAuthState } from "../auth.ts";
import { getIntrospectionRuntime } from "../runtime/index.ts";
import { readModelsJson, writeModelsJson } from "../modelsConfig.ts";
import { startOAuthLogin, getSerializedOAuthFlow, respondToOAuthFlow, cancelOAuthFlow } from "../oauthFlows.ts";

export function registerAuthRoutes(router: express.Router): void {
  router.get("/api/auth/providers", async (_req, res) => {
    try {
      refreshAuthState();
      const runtime = await getIntrospectionRuntime();
      const registry = runtime.session.modelRegistry;
      registry.refresh?.();

      const models = registry.getAll();
      const providerIds = Array.from(new Set<string>(models.map((m: any) => String(m.provider)))).sort((a, b) => a.localeCompare(b));
      const oauthIds = new Set(authStorage.getOAuthProviders().map((p: any) => p.id));
      const storedProviders = new Set(authStorage.list());

      res.json({
        providers: providerIds.map((id) => {
          const status = registry.getProviderAuthStatus(id);
          const credential = authStorage.get(id);
          return {
            id,
            name: registry.getProviderDisplayName(id),
            authType: oauthIds.has(id) ? "oauth" : "api_key",
            configured: !!status.configured,
            source: status.source,
            label: status.label,
            stored: storedProviders.has(id),
            storedType: credential?.type,
          };
        }),
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post("/api/auth/:provider/api-key", async (req, res) => {
    const { provider } = req.params;
    const { apiKey } = req.body ?? {};
    if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
      return res.status(400).json({ error: "apiKey is required" });
    }

    try {
      authStorage.set(provider, { type: "api_key", key: apiKey.trim() });
      refreshAuthState();
      res.json({ ok: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post("/api/auth/providers", async (req, res) => {
    const { providerId, name, baseUrl, modelId, modelName, apiKey } = req.body ?? {};
    const provider = typeof providerId === "string" ? providerId.trim() : "";
    const endpoint = typeof baseUrl === "string" ? baseUrl.trim() : "";
    const model = typeof modelId === "string" ? modelId.trim() : "";
    const displayName = typeof name === "string" && name.trim() ? name.trim() : provider;
    const modelDisplayName = typeof modelName === "string" && modelName.trim() ? modelName.trim() : model;

    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(provider)) {
      return res.status(400).json({ error: "providerId must start with a letter/number and contain only letters, numbers, dots, underscores, or dashes" });
    }
    if (!endpoint) return res.status(400).json({ error: "baseUrl is required" });
    if (!model) return res.status(400).json({ error: "modelId is required" });

    try {
      const config = readModelsJson();
      if (config.providers[provider]) {
        return res.status(409).json({ error: `Provider ${provider} already exists in models.json` });
      }
      // A models.json provider entry also overrides built-in models of the same
      // provider (baseUrl/apiKey), so block ids like "openai" or "anthropic"
      // that already exist in the registry.
      if (modelRegistry.getAll().some((m) => m.provider === provider)) {
        return res.status(409).json({ error: `Provider ${provider} already exists; pick a different id` });
      }

      config.providers[provider] = {
        name: displayName,
        baseUrl: endpoint,
        api: "openai-completions",
        apiKey: `$${provider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`,
        models: [
          {
            id: model,
            name: modelDisplayName,
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128000,
            maxTokens: 4096,
          },
        ],
      };

      writeModelsJson(config);
      if (typeof apiKey === "string" && apiKey.trim()) {
        authStorage.set(provider, { type: "api_key", key: apiKey.trim() });
      }
      refreshAuthState();
      res.json({ ok: true, provider });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post("/api/auth/:provider/oauth/start", async (req, res) => {
    try {
      const result = await startOAuthLogin(req.params.provider);
      if (!result.ok) return res.status(400).json({ error: result.error });
      res.json({ id: result.id });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.get("/api/auth/oauth/flows/:id", (req, res) => {
    const flow = getSerializedOAuthFlow(req.params.id);
    if (!flow) return res.status(404).json({ error: "OAuth flow not found" });
    res.json(flow);
  });

  router.post("/api/auth/oauth/flows/:id/respond", (req, res) => {
    const result = respondToOAuthFlow(req.params.id, req.body ?? {});
    switch (result.status) {
      case "not_found":
        return res.status(404).json({ error: "OAuth flow not found" });
      case "not_pending":
        return res.status(400).json({ error: `OAuth flow is ${result.flowStatus}` });
      case "not_waiting":
        return res.status(409).json({ error: "OAuth flow is not waiting for input" });
      case "ok":
        return res.json({ ok: true });
    }
  });

  router.post("/api/auth/oauth/flows/:id/cancel", (req, res) => {
    if (!cancelOAuthFlow(req.params.id)) {
      return res.status(404).json({ error: "OAuth flow not found" });
    }
    res.json({ ok: true });
  });

  router.post("/api/auth/:provider/logout", async (req, res) => {
    const { provider } = req.params;
    try {
      authStorage.logout(provider);
      refreshAuthState();
      res.json({ ok: true });
    } catch (err) {
      handleError(res, err);
    }
  });

}
