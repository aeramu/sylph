// OAuth login flows.
//
// Pi's ModelRuntime.login() drives an interactive OAuth handshake through
// prompt/notification callbacks (open this URL, paste this code, pick an account).
// The browser isn't on the other end synchronously, so each login is
// modeled as a long-lived "flow": the callbacks record the current step, the
// client polls GET /flows/:id to render it, and POST /flows/:id/respond feeds
// user input back into whichever callback is awaiting it.

import { randomUUID } from "crypto";
import { getIntrospectionRuntime } from "../../integrations/pi/runtime/runtimeManager.ts";

type OAuthFlowStep =
  | { type: "auth_url"; url: string; instructions?: string; progress: string[] }
  | { type: "device_code"; userCode: string; verificationUri: string; intervalSeconds?: number; expiresInSeconds?: number; progress: string[] }
  | { type: "prompt"; message: string; placeholder?: string; allowEmpty?: boolean; secret?: boolean; progress: string[] }
  | { type: "manual_code"; message: string; progress: string[] }
  | { type: "select"; message: string; options: Array<{ id: string; label: string }>; progress: string[] }
  | { type: "waiting"; message: string; progress: string[] };

interface OAuthFlow {
  id: string;
  provider: string;
  status: "pending" | "success" | "error" | "cancelled";
  step?: OAuthFlowStep;
  // Kept outside `step`: providers call onAuth and then immediately await
  // onManualCodeInput (racing a callback server against manual paste), so the
  // auth_url step is replaced within the same tick and polling clients would
  // never see the URL.
  authUrl?: string;
  authInstructions?: string;
  error?: string;
  progress: string[];
  abortController: AbortController;
  resolveInput?: (value: string | undefined) => void;
  rejectInput?: (error: Error) => void;
}

const oauthFlows = new Map<string, OAuthFlow>();
const OAUTH_FLOW_TTL_MS = 10 * 60 * 1000;
// Abandoned pending flows (client closed the tab mid-login) would otherwise
// keep ModelRuntime.login() hanging on input forever; time them out.
const OAUTH_FLOW_PENDING_TIMEOUT_MS = 15 * 60 * 1000;

export function serializeOAuthFlow(flow: OAuthFlow) {
  return {
    id: flow.id,
    provider: flow.provider,
    status: flow.status,
    step: flow.step,
    authUrl: flow.authUrl,
    authInstructions: flow.authInstructions,
    error: flow.error,
    progress: flow.progress,
  };
}

export function getSerializedOAuthFlow(id: string) {
  const flow = oauthFlows.get(id);
  return flow ? serializeOAuthFlow(flow) : undefined;
}

function cleanupOAuthFlowLater(id: string) {
  setTimeout(() => oauthFlows.delete(id), OAUTH_FLOW_TTL_MS).unref();
}

function expireOAuthFlowIfAbandoned(flow: OAuthFlow) {
  if (flow.status !== "pending") return;
  flow.status = "error";
  flow.error = "Login timed out";
  flow.abortController.abort();
  flow.rejectInput?.(new Error("Login timed out"));
  cleanupOAuthFlowLater(flow.id);
}

function setOAuthStep(flow: OAuthFlow, step: Record<string, unknown>) {
  flow.step = { ...step, progress: [...flow.progress] } as OAuthFlowStep;
}

function appendOAuthProgress(flow: OAuthFlow, message: string) {
  flow.progress.push(message);
  if (flow.progress.length > 20) flow.progress.shift();
  if (!flow.step) setOAuthStep(flow, { type: "waiting", message });
  else flow.step = { ...flow.step, progress: [...flow.progress] };
}

function createOAuthInputPromise(flow: OAuthFlow, signal?: AbortSignal) {
  let onAbort: (() => void) | undefined;
  return new Promise<string | undefined>((resolve, reject) => {
    flow.resolveInput = resolve;
    flow.rejectInput = reject;
    onAbort = () => reject(signal?.reason ?? new Error("Authentication prompt cancelled"));
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  }).finally(() => {
    if (onAbort) signal?.removeEventListener("abort", onAbort);
    flow.resolveInput = undefined;
    flow.rejectInput = undefined;
  });
}

type LoginMethod = "oauth" | "api_key";

// Begin an interactive provider login. Both OAuth and API-key providers may
// ask multiple questions (for example OmniRoute asks for its base URL before
// the key), so they share the same browser-polled flow rather than assuming
// that API-key login consists of one secret field.
async function startProviderLogin(provider: string, method: LoginMethod): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const runtime = await getIntrospectionRuntime();
  const modelRuntime = runtime.session.modelRuntime;
  await modelRuntime.refresh({ allowNetwork: false });
  const auth = modelRuntime.getProvider(provider)?.auth;
  const supported = method === "oauth" ? auth?.oauth : auth?.apiKey;
  if (!supported) {
    const label = method === "oauth" ? "OAuth" : "API-key login";
    return { ok: false, error: `Provider ${provider} does not support ${label}` };
  }

  const id = randomUUID();
  const flow: OAuthFlow = {
    id,
    provider,
    status: "pending",
    progress: [],
    abortController: new AbortController(),
  };
  setOAuthStep(flow, { type: "waiting", message: "Starting OAuth login..." });
  oauthFlows.set(id, flow);
  setTimeout(() => expireOAuthFlowIfAbandoned(flow), OAUTH_FLOW_PENDING_TIMEOUT_MS).unref();

  void modelRuntime.login(provider, method, {
    signal: flow.abortController.signal,
    notify(event: any) {
      if (event.type === "auth_url") {
        flow.authUrl = event.url;
        flow.authInstructions = event.instructions;
        setOAuthStep(flow, { type: "auth_url", url: event.url, instructions: event.instructions });
      } else if (event.type === "device_code") {
        setOAuthStep(flow, {
          type: "device_code",
          userCode: event.userCode,
          verificationUri: event.verificationUri,
          intervalSeconds: event.intervalSeconds,
          expiresInSeconds: event.expiresInSeconds,
        });
      } else if (event.type === "info" || event.type === "progress") {
        appendOAuthProgress(flow, event.message);
      }
    },
    async prompt(prompt: any) {
      if (prompt.type === "select") {
        setOAuthStep(flow, {
          type: "select",
          message: prompt.message,
          options: Array.from(prompt.options ?? []),
        });
      } else if (prompt.type === "manual_code") {
        setOAuthStep(flow, {
          type: "manual_code",
          message: prompt.message,
        });
      } else {
        setOAuthStep(flow, {
          type: "prompt",
          message: prompt.message,
          placeholder: prompt.placeholder,
          // API-key providers own validation; some intentionally allow an
          // empty secret for public/local gateways such as OmniRoute.
          allowEmpty: method === "api_key",
          secret: prompt.type === "secret",
        });
      }
      const value = await createOAuthInputPromise(flow, prompt.signal);
      if (value === undefined) throw new Error("Login cancelled");
      return value;
    },
  }).then(() => {
    flow.status = "success";
    flow.step = undefined;
    cleanupOAuthFlowLater(id);
  }).catch((err: any) => {
    // Cancelled and timed-out flows already recorded their terminal state.
    if (flow.status !== "pending") return;
    flow.status = "error";
    flow.error = err?.message || String(err);
    cleanupOAuthFlowLater(id);
  });

  return { ok: true, id };
}

export function startOAuthLogin(provider: string) {
  return startProviderLogin(provider, "oauth");
}

export function startApiKeyLogin(provider: string) {
  return startProviderLogin(provider, "api_key");
}

export type OAuthRespondResult =
  | { status: "not_found" }
  | { status: "not_pending"; flowStatus: OAuthFlow["status"] }
  | { status: "not_waiting" }
  | { status: "ok" };

// Feed a client's input (or cancellation) into a pending flow.
export function respondToOAuthFlow(id: string, body: { value?: unknown; cancelled?: unknown }): OAuthRespondResult {
  const flow = oauthFlows.get(id);
  if (!flow) return { status: "not_found" };
  if (flow.status !== "pending") return { status: "not_pending", flowStatus: flow.status };

  if (body.cancelled) {
    flow.status = "cancelled";
    flow.abortController.abort();
    flow.rejectInput?.(new Error("Login cancelled"));
    cleanupOAuthFlowLater(flow.id);
    return { status: "ok" };
  }

  // Without a pending input (double submit, stale client) accepting the value
  // would silently drop it and stomp whatever step the login flow set next.
  if (!flow.resolveInput) return { status: "not_waiting" };
  flow.resolveInput(typeof body.value === "string" ? body.value : undefined);
  flow.step = { type: "waiting", message: "Continuing OAuth login...", progress: [...flow.progress] };
  return { status: "ok" };
}

// Cancel a flow. Returns false if no flow has that id.
export function cancelOAuthFlow(id: string): boolean {
  const flow = oauthFlows.get(id);
  if (!flow) return false;
  flow.status = "cancelled";
  flow.abortController.abort();
  flow.rejectInput?.(new Error("Login cancelled"));
  cleanupOAuthFlowLater(flow.id);
  return true;
}
