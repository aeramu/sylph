import { randomUUID } from "node:crypto";
import { rememberArtifactPresentation } from "../../../features/artifacts/artifactPresentationRequests.ts";
import { requestUi, type UiRequestPayload } from "../../../features/interactions/uiRequestBroker.ts";
import { setSessionStatus } from "../../../features/interactions/sessionStatusStore.ts";
import { broadcast } from "../../../platform/events/sseHub.ts";

const publish = (payload: UiRequestPayload | Record<string, unknown>) => broadcast(payload);

export function createExtensionUiContext(sessionId: string): any {
  const wait = (method: string, fields: Record<string, unknown>) => requestUi(sessionId, method, fields, publish);
  const fire = (method: string, fields: Record<string, unknown>) => publish({
    sessionId, type: "extension_ui_request", id: randomUUID(), method, ...fields,
  });
  const select = async (prompt: string, options: string[]) => {
    const newline = prompt.indexOf("\n");
    const title = newline >= 0 ? prompt.slice(0, newline) : prompt;
    const body = newline >= 0 ? prompt.slice(newline + 1).trim() : undefined;
    const response = await wait("select", { title, ...(body ? { body } : {}), options }) as any;
    return response?.cancelled ? undefined : response?.value;
  };
  const confirm = async (title: string, message: string) => {
    const response = await wait("confirm", { title, message }) as any;
    return response?.cancelled ? false : Boolean(response?.confirmed);
  };
  const input = async (title: string, placeholder?: string) => {
    const response = await wait("input", { title, ...(placeholder ? { placeholder } : {}) }) as any;
    return response?.cancelled ? undefined : response?.value;
  };
  const editor = async (title: string, prefill?: string) => {
    const response = await wait("editor", { title, ...(prefill ? { prefill } : {}) }) as any;
    return response?.cancelled ? undefined : response?.value;
  };
  const questions = async (spec: any) => {
    const response = await wait("questions", { questions: spec?.questions ?? [] }) as any;
    return !response || response.cancelled
      ? { cancelled: true, answers: [] }
      : { cancelled: false, answers: Array.isArray(response.answers) ? response.answers : [] };
  };
  const setStatus = (key: string, text: string | undefined) => {
    setSessionStatus(sessionId, key, text);
    fire("setStatus", { statusKey: key, ...(text !== undefined ? { statusText: text } : {}) });
  };
  const showArtifact = (path: string) => {
    const payload = { sessionId, type: "extension_ui_request" as const, id: randomUUID(), method: "showArtifact" as const, path };
    rememberArtifactPresentation(payload);
    publish(payload);
  };
  const noOp = () => {};
  return {
    select, confirm, input, editor, questions,
    notify: (message: string, type?: string) => fire("notify", { message, ...(type ? { notifyType: type } : {}) }),
    setStatus,
    setWidget: (key: string, content: unknown, options?: any) => fire("setWidget", { widgetKey: key, ...(content ? { widgetLines: content } : {}), ...(options?.placement ? { widgetPlacement: options.placement } : {}) }),
    setWorkingMessage: (message?: string) => fire("setWorkingMessage", { ...(message !== undefined ? { message } : {}) }),
    setWorkingVisible: (visible: boolean) => fire("setWorkingVisible", { visible }),
    setWorkingIndicator: (options?: Record<string, unknown>) => fire("setWorkingIndicator", options ?? {}),
    setHiddenThinkingLabel: (label?: string) => fire("setHiddenThinkingLabel", { ...(label !== undefined ? { label } : {}) }),
    setTitle: (title: string) => fire("setTitle", { title }),
    pasteToEditor: (text: string) => fire("pasteToEditor", { text }),
    setEditorText: (text: string) => fire("setEditorText", { text }),
    setToolsExpanded: (expanded: boolean) => fire("setToolsExpanded", { expanded }),
    showArtifact,
    getEditorText: () => "",
    getToolsExpanded: () => false,
    onTerminalInput: () => noOp,
    setFooter: noOp, setHeader: noOp, addAutocompleteProvider: noOp, setEditorComponent: noOp,
    getEditorComponent: () => undefined,
    get theme() { return undefined; },
    getAllThemes: () => [], getTheme: () => undefined, setTheme: () => ({ success: false }),
    custom: async () => undefined,
  };
}
