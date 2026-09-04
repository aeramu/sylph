import { readModelsJson, writeModelsJson } from "../../integrations/pi/modelsConfig.ts";
import { getIntrospectionRuntime } from "../../integrations/pi/runtime/runtimeManager.ts";
import { badRequest, conflict } from "../../platform/http/errors.ts";

async function currentModelRuntime(): Promise<any> {
  const runtime = await getIntrospectionRuntime();
  const modelRuntime = runtime.session.modelRuntime;
  await modelRuntime.refresh({ allowNetwork: false });
  return modelRuntime;
}

async function persistProviderApiKey(modelRuntime: any, provider: string, apiKey: string): Promise<void> {
  let keyUsed = false;
  await modelRuntime.login(provider, "api_key", {
    async prompt(prompt: any) {
      if (prompt.type === "select") {
        const preferred = prompt.options?.find((option: any) =>
          ["api-key", "bearer-token"].includes(String(option.id)));
        if (preferred) return String(preferred.id);
      }
      if (prompt.type === "secret" && !keyUsed) {
        keyUsed = true;
        return apiKey;
      }
      throw new Error(`${provider} requires additional interactive authentication fields that Sylph's API-key form does not collect`);
    },
    notify() {},
  });
}

export async function listProviders() {
  const modelRuntime = await currentModelRuntime();
  const credentials = await modelRuntime.listCredentials();
  const storedByProvider = new Map(credentials.map((credential: any) => [String(credential.providerId), credential]));
  return modelRuntime.getProviders()
    .map((provider: any) => {
      const id = String(provider.id);
      const status = modelRuntime.getProviderAuthStatus(id);
      const credential: any = storedByProvider.get(id);
      return {
        id,
        name: String(provider.name || id),
        authType: provider.auth?.oauth ? "oauth" : "api_key",
        configured: !!status.configured,
        source: status.source,
        label: status.label,
        stored: !!credential,
        storedType: credential?.type,
      };
    })
    .sort((a: any, b: any) => a.name.localeCompare(b.name));
}

export async function listProviderModels(provider: string) {
  const modelRuntime = await currentModelRuntime();
  return modelRuntime.getModels(provider)
    .sort((a: any, b: any) => String(a.name || a.id).localeCompare(String(b.name || b.id)))
    .map((model: any) => ({
      id: String(model.id),
      name: String(model.name || model.id),
      reasoning: !!model.reasoning,
      input: Array.isArray(model.input) ? model.input.filter((kind: unknown) => kind === "text" || kind === "image") : ["text"],
      contextWindow: Number.isFinite(model.contextWindow) ? model.contextWindow : undefined,
      maxTokens: Number.isFinite(model.maxTokens) ? model.maxTokens : undefined,
      available: modelRuntime.hasConfiguredAuth(provider),
    }));
}

export async function saveProviderApiKey(provider: string, apiKey: unknown) {
  if (typeof apiKey !== "string" || !apiKey.trim()) badRequest("apiKey is required");
  await persistProviderApiKey(await currentModelRuntime(), provider, apiKey.trim());
}

export async function createProvider(input: Record<string, unknown>) {
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
  const modelRuntime = await currentModelRuntime();
  if (modelRuntime.getModels().some((entry: any) => entry.provider === provider)) conflict(`Provider ${provider} already exists; pick a different id`);
  config.providers[provider] = {
    name: displayName, baseUrl: endpoint, api: "openai-completions",
    apiKey: `$${provider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`,
    models: [{
      id: model, name: modelDisplayName, reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096,
    }],
  };
  writeModelsJson(config);
  await modelRuntime.refresh({ allowNetwork: false });
  if (typeof input.apiKey === "string" && input.apiKey.trim()) {
    await persistProviderApiKey(modelRuntime, provider, input.apiKey.trim());
  }
  return provider;
}

export async function logoutProvider(provider: string) {
  await (await currentModelRuntime()).logout(provider);
}
