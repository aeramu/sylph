// OAuth login flows.
//
// pi's authStorage.login() drives an interactive OAuth handshake through
// callbacks (open this URL, paste this code, pick an account). The browser
// isn't on the other end of those callbacks synchronously, so each login is
// modeled as a long-lived "flow": the callbacks record the current step, the
// client polls GET /flows/:id to render it, and POST /flows/:id/respond feeds
// user input back into whichever callback is awaiting it.

import { randomUUID } from "crypto";
import { authStorage, refreshAuthState } from "../../integrations/pi/auth.ts";
import { getIntrospectionRuntime } from "../../integrations/pi/runtime/runtimeManager.ts";

type OAuthFlowStep =
  | { type: "auth_url"; url: string; instructions?: string; progress: string[] }
  | { type: "device_code"; userCode: string; verificationUri: string; intervalSeconds?: number; expiresInSeconds?: number; progress: string[] }
  | { type: "prompt"; message: string; placeholder?: string; allowEmpty?: boolean; progress: string[] }
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
// keep authStorage.login() hanging on input forever; time them out.
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

function createOAuthInputPromise(flow: OAuthFlow) {
  return new Promise<string | undefined>((resolve, reject) => {
    flow.resolveInput = resolve;
    flow.rejectInput = reject;
  }).finally(() => {
    flow.resolveInput = undefined;
    flow.rejectInput = undefined;
  });
}

// Begin an OAuth login. Returns the flow id the client will poll, or an error
// if the provider doesn't support OAuth. The login itself proceeds in the
// background, advancing the flow's step as pi's callbacks fire.
export async function startOAuthLogin(provider: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  refreshAuthState();
  // Ensure extension-registered providers are loaded before we check OAuth
  // support (extensions register providers at session_start).
  const runtime = await getIntrospectionRuntime();
  runtime.session.modelRegistry.refresh?.();
  const oauthProvider = authStorage.getOAuthProviders().find((p: any) => p.id === provider);
  if (!oauthProvider) {
    return { ok: false, error: `Provider ${provider} does not support OAuth` };
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

  authStorage.login(provider as any, {
    signal: flow.abortController.signal,
    onAuth(info) {
      flow.authUrl = info.url;
      flow.authInstructions = info.instructions;
      setOAuthStep(flow, { type: "auth_url", url: info.url, instructions: info.instructions });
    },
    onDeviceCode(info) {
      setOAuthStep(flow, {
        type: "device_code",
        userCode: info.userCode,
        verificationUri: info.verificationUri,
        intervalSeconds: info.intervalSeconds,
        expiresInSeconds: info.expiresInSeconds,
      });
    },
    onProgress(message) {
      appendOAuthProgress(flow, message);
    },
    async onManualCodeInput() {
      setOAuthStep(flow, { type: "manual_code", message: "Paste the authorization code or callback URL:" });
      const value = await createOAuthInputPromise(flow);
      if (value === undefined) throw new Error("Login cancelled");
      return value;
    },
    async onPrompt(prompt) {
      setOAuthStep(flow, {
        type: "prompt",
        message: prompt.message,
        placeholder: prompt.placeholder,
        allowEmpty: prompt.allowEmpty,
      });
      const value = await createOAuthInputPromise(flow);
      if (value === undefined) throw new Error("Login cancelled");
      return value;
    },
    async onSelect(prompt) {
      setOAuthStep(flow, {
        type: "select",
        message: prompt.message,
        options: prompt.options,
      });
      return await createOAuthInputPromise(flow);
    },
  }).then(() => {
    flow.status = "success";
    flow.step = undefined;
    refreshAuthState();
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
