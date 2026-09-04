import { ModelRuntime } from "@earendil-works/pi-coding-agent";

// Share one lazy model/auth runtime across Sylph sessions. ModelRuntime uses
// Pi's default ~/.pi/agent/auth.json and models.json paths, so the web UI and
// Pi TUI continue to share credentials and custom providers.
let modelRuntimePromise: Promise<ModelRuntime> | undefined;

export function getModelRuntime(): Promise<ModelRuntime> {
  if (!modelRuntimePromise) {
    modelRuntimePromise = ModelRuntime.create({
      allowModelNetwork: false,
      signal: AbortSignal.timeout(15_000),
    }).catch((error) => {
      modelRuntimePromise = undefined;
      throw error;
    });
  }
  return modelRuntimePromise;
}

export async function refreshAuthState(): Promise<ModelRuntime> {
  const modelRuntime = await getModelRuntime();
  await modelRuntime.refresh({ allowNetwork: false });
  return modelRuntime;
}
