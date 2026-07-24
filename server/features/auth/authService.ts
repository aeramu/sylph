import { authStorage, modelRegistry, refreshAuthState } from "../../integrations/pi/auth.ts";
import { readModelsJson, writeModelsJson } from "../../integrations/pi/modelsConfig.ts";
import { getIntrospectionRuntime } from "../../integrations/pi/runtime/runtimeManager.ts";
import { badRequest, conflict } from "../../platform/http/errors.ts";

export async function listProviders() {
  refreshAuthState();
  const runtime = await getIntrospectionRuntime();
  const registry = runtime.session.modelRegistry;
  registry.refresh?.();
  const providerIds = Array.from(new Set<string>(registry.getAll().map((model: any) => String(model.provider)))).sort((a, b) => a.localeCompare(b));
  const oauthIds = new Set(authStorage.getOAuthProviders().map((provider: any) => provider.id));
  const storedProviders = new Set(authStorage.list());
  return providerIds.map((id) => {
    const status = registry.getProviderAuthStatus(id);
    const credential = authStorage.get(id);
    return {
      id, name: registry.getProviderDisplayName(id), authType: oauthIds.has(id) ? "oauth" : "api_key",
      configured: !!status.configured, source: status.source, label: status.label,
      stored: storedProviders.has(id), storedType: credential?.type,
    };
  });
}

export async function listProviderModels(provider: string) {
  const runtime = await getIntrospectionRuntime();
  const registry = runtime.session.modelRegistry;
  registry.refresh?.();
  return registry.getAll()
    .filter((model: any) => String(model.provider) === provider)
    .sort((a: any, b: any) => String(a.name || a.id).localeCompare(String(b.name || b.id)))
    .map((model: any) => ({
      id: String(model.id),
      name: String(model.name || model.id),
      reasoning: !!model.reasoning,
      input: Array.isArray(model.input) ? model.input.filter((kind: unknown) => kind === "text" || kind === "image") : ["text"],
      contextWindow: Number.isFinite(model.contextWindow) ? model.contextWindow : undefined,
      maxTokens: Number.isFinite(model.maxTokens) ? model.maxTokens : undefined,
      available: registry.hasConfiguredAuth(model),
    }));
}

export function saveProviderApiKey(provider: string, apiKey: unknown) {
  if (typeof apiKey !== "string" || !apiKey.trim()) badRequest("apiKey is required");
  authStorage.set(provider, { type: "api_key", key: apiKey.trim() });
  refreshAuthState();
}

export function createProvider(input: Record<string, unknown>) {
  const provider = typeof input.providerId === "string" ? input.providerId.trim() : "";
  const endpoint = typeof input.baseUrl === "string" ? input.baseUrl.trim() : "";
  const model = typeof input.modelId === "string" ? input.modelId.trim() : "";
  const displayName = typeof input.name === "string" && input.name.trim() ? input.name.trim() : provider;
  const modelDisplayName = typeof input.modelName === "string" && input.modelName.trim() ? input.modelName.trim() : model;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(provider)) badRequest("providerId must start with a letter/number and contain only letters, numbers, dots, underscores, or dashes");
  if (!endpoint) badRequest("baseUrl is required");
  if (!model) badRequest("modelId is required");
  const config = readModelsJson();
  if (config.providers[provider]) conflict(`Provider ${provider} already exists in models.json`);
  if (modelRegistry.getAll().some((entry) => entry.provider === provider)) conflict(`Provider ${provider} already exists; pick a different id`);
  config.providers[provider] = {
    name: displayName, baseUrl: endpoint, api: "openai-completions",
    apiKey: `$${provider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`,
    models: [{
      id: model, name: modelDisplayName, reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096,
    }],
  };
  writeModelsJson(config);
  if (typeof input.apiKey === "string" && input.apiKey.trim()) authStorage.set(provider, { type: "api_key", key: input.apiKey.trim() });
  refreshAuthState();
  return provider;
}

export function logoutProvider(provider: string) {
  authStorage.logout(provider);
  refreshAuthState();
}
