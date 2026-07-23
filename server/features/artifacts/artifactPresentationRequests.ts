export interface ArtifactPresentationRequest extends Record<string, unknown> {
  sessionId: string;
  type: "extension_ui_request";
  id: string;
  method: "showArtifact";
  path: string;
}

const pending = new Map<string, ArtifactPresentationRequest>();

export function rememberArtifactPresentation(request: ArtifactPresentationRequest) {
  pending.set(request.sessionId, request);
}

export function getPendingArtifactRequest(sessionId: string): ArtifactPresentationRequest | undefined {
  return pending.get(sessionId);
}

export function acknowledgeArtifactRequest(sessionId: string, requestId: string): boolean {
  const request = pending.get(sessionId);
  if (!request || request.id !== requestId) return false;
  pending.delete(sessionId);
  return true;
}

export function clearSessionArtifactRequest(sessionId: string) {
  pending.delete(sessionId);
}
