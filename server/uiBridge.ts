// Extension UI bridge
//
// Extensions (e.g. pi-permission-system) request user input via
// ctx.ui.select() / input() / confirm() / editor(). In the embedded SDK these
// are plain async calls, not the RPC stdin/stdout sub-protocol. We bridge them
// to the browser by broadcasting an extension_ui_request over SSE, then
// resolving the promise when POST /api/ui-response arrives with the same id.

import { randomUUID } from "crypto";
import { broadcast } from "./sse.ts";

interface PendingUiRequest {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
  sessionId: string;
  // The broadcast event, kept so a client that missed (or discarded) the
  // one-shot SSE broadcast can re-show the dialog later.
  payload: Record<string, any>;
}

const pendingUiRequests = new Map<string, PendingUiRequest>();

// Unanswered dialog payloads for a session, oldest first.
export function getPendingUiRequests(sessionId: string): Record<string, any>[] {
  const out: Record<string, any>[] = [];
  for (const req of pendingUiRequests.values()) {
    if (req.sessionId === sessionId) out.push(req.payload);
  }
  return out;
}

// Resolve the pending request matching this browser response. Returns false
// if nothing is waiting on that id.
export function resolveUiRequest(id: string, response: any): boolean {
  const pending = pendingUiRequests.get(id);
  if (!pending) return false;
  pendingUiRequests.delete(id);
  pending.resolve(response);
  return true;
}

// Reject any still-pending UI prompts for this session so the agent turn
// unblocks instead of hanging forever.
export function rejectPendingForSession(sessionId: string, reason: string) {
  for (const [reqId, req] of pendingUiRequests) {
    if (req.sessionId === sessionId) {
      pendingUiRequests.delete(reqId);
      req.reject(new Error(reason));
    }
  }
}

export function createExtensionUiContext(sessionId: string): any {
  // Dialog method: broadcast, block until the browser responds.
  const requestAndWait = (method: string, fields: Record<string, any>): Promise<any> => {
    const id = randomUUID();
    const payload = { sessionId, type: "extension_ui_request", id, method, ...fields };
    return new Promise((resolve, reject) => {
      pendingUiRequests.set(id, { resolve, reject, sessionId, payload });
      broadcast(payload);
    });
  };

  // Fire-and-forget: broadcast, return immediately.
  const fire = (method: string, fields: Record<string, any>) => {
    broadcast({ sessionId, type: "extension_ui_request", id: randomUUID(), method, ...fields });
  };

  // --- Dialog methods ---

  const select = async (prompt: string, options: string[]) => {
    const newlineIdx = prompt.indexOf("\n");
    const title = newlineIdx >= 0 ? prompt.slice(0, newlineIdx) : prompt;
    const body = newlineIdx >= 0 ? prompt.slice(newlineIdx + 1).trim() : undefined;
    const res = await requestAndWait("select", {
      title, ...(body ? { body } : {}), options,
    });
    return res?.cancelled ? undefined : res?.value;
  };

  const confirm = async (title: string, message: string) => {
    const res = await requestAndWait("confirm", { title, message });
    return res?.cancelled ? false : Boolean(res?.confirmed);
  };

  const input = async (title: string, placeholder?: string) => {
    const res = await requestAndWait("input", { title, ...(placeholder ? { placeholder } : {}) });
    return res?.cancelled ? undefined : res?.value;
  };

  const editor = async (title: string, prefill?: string) => {
    const res = await requestAndWait("editor", { title, ...(prefill ? { prefill } : {}) });
    return res?.cancelled ? undefined : res?.value;
  };

  // Rich multi-question dialog for sylph's native ask_user_question tool (see
  // server/askUserQuestion.ts). Broadcasts the full structured spec — including
  // per-option descriptions and previews — and resolves with the user's answers
  // (index-aligned with spec.questions) or a cancellation.
  const questions = async (spec: any) => {
    const res = await requestAndWait("questions", { questions: spec?.questions ?? [] });
    if (!res || res.cancelled) return { cancelled: true, answers: [] };
    return { cancelled: false, answers: Array.isArray(res.answers) ? res.answers : [] };
  };

  // --- Fire-and-forget: notifications, status, widgets, editor ---

  const notify = (message: string, type?: string) =>
    fire("notify", { message, ...(type ? { notifyType: type } : {}) });

  const setStatus = (key: string, text: string | undefined) =>
    fire("setStatus", { statusKey: key, ...(text !== undefined ? { statusText: text } : {}) });

  const setWidget = (key: string, content: any, options?: any) =>
    fire("setWidget", {
      widgetKey: key,
      ...(content ? { widgetLines: content } : {}),
      ...(options?.placement ? { widgetPlacement: options.placement } : {}),
    });

  const setWorkingMessage = (message?: string) =>
    fire("setWorkingMessage", { ...(message !== undefined ? { message } : {}) });

  const setWorkingVisible = (visible: boolean) =>
    fire("setWorkingVisible", { visible });

  const setWorkingIndicator = (options?: any) =>
    fire("setWorkingIndicator", { ...(options ? options : {}) });

  const setHiddenThinkingLabel = (label?: string) =>
    fire("setHiddenThinkingLabel", { ...(label !== undefined ? { label } : {}) });

  const setTitle = (title: string) =>
    fire("setTitle", { title });

  const pasteToEditor = (text: string) =>
    fire("pasteToEditor", { text });

  const setEditorText = (text: string) =>
    fire("setEditorText", { text });

  const setToolsExpanded = (expanded: boolean) =>
    fire("setToolsExpanded", { expanded });

  // --- Synchronous getters: no async round-trip possible, return defaults ---

  const getEditorText = () => "";
  const getToolsExpanded = () => false;

  // --- TUI-only methods: no-op or default (no terminal surface to target) ---

  const onTerminalInput = () => () => {};
  const setFooter = () => {};
  const setHeader = () => {};
  const addAutocompleteProvider = () => {};
  const setEditorComponent = () => {};
  const getEditorComponent = () => undefined;
  const getAllThemes = () => [];
  const getTheme = () => undefined;
  const setTheme = () => ({ success: false });

  return {
    // Dialog
    select, confirm, input, editor, questions,
    // Fire-and-forget
    notify, setStatus, setWidget,
    setWorkingMessage, setWorkingVisible, setWorkingIndicator,
    setHiddenThinkingLabel, setTitle, pasteToEditor, setEditorText,
    setToolsExpanded,
    // Sync getters
    getEditorText, getToolsExpanded,
    // TUI-only no-ops
    onTerminalInput, setFooter, setHeader, addAutocompleteProvider,
    setEditorComponent, getEditorComponent,
    get theme() { return undefined; },
    getAllThemes, getTheme, setTheme,
    // custom() — TUI overlay, unsupported
    custom: async () => undefined,
  };
}
