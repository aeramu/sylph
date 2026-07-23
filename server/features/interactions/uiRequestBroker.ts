import { randomUUID } from "node:crypto";

export interface UiRequestPayload extends Record<string, unknown> {
  sessionId: string;
  type: "extension_ui_request";
  id: string;
  method: string;
}

interface PendingUiRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  payload: UiRequestPayload;
}

const pending = new Map<string, PendingUiRequest>();

export function requestUi(
  sessionId: string,
  method: string,
  fields: Record<string, unknown>,
  publish: (payload: UiRequestPayload) => void,
): Promise<unknown> {
  const payload: UiRequestPayload = {
    sessionId, type: "extension_ui_request", id: randomUUID(), method, ...fields,
  };
  return new Promise((resolve, reject) => {
    pending.set(payload.id, { resolve, reject, payload });
    publish(payload);
  });
}

export function getPendingUiRequests(sessionId: string): UiRequestPayload[] {
  return Array.from(pending.values())
    .filter((request) => request.payload.sessionId === sessionId)
    .map((request) => request.payload);
}

export function resolveUiRequest(id: string, response: unknown): boolean {
  const request = pending.get(id);
  if (!request) return false;
  pending.delete(id);
  request.resolve(response);
  return true;
}

export function rejectPendingForSession(sessionId: string, reason: string) {
  for (const [id, request] of pending) {
    if (request.payload.sessionId !== sessionId) continue;
    pending.delete(id);
    request.reject(new Error(reason));
  }
}
