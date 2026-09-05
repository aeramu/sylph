export interface PendingUserMessage {
  clientMessageId?: string;
  displayText?: string;
  images?: unknown[];
  steered: boolean;
}

export interface PendingUserMessageToken extends PendingUserMessage {
  consumed: boolean;
}

const pendingBySession = new WeakMap<object, PendingUserMessageToken[]>();

export function registerPendingUserMessage(session: object, message: PendingUserMessage): PendingUserMessageToken {
  const token = { ...message, consumed: false };
  const pending = pendingBySession.get(session) ?? [];
  pending.push(token);
  pendingBySession.set(session, pending);
  return token;
}

export function cancelPendingUserMessage(session: object, token: PendingUserMessageToken): void {
  if (token.consumed) return;
  const pending = pendingBySession.get(session);
  if (!pending) return;
  const index = pending.indexOf(token);
  if (index >= 0) pending.splice(index, 1);
  if (pending.length === 0) pendingBySession.delete(session);
}

export function consumePendingUserMessage(session: object): PendingUserMessage | undefined {
  const pending = pendingBySession.get(session);
  const token = pending?.shift();
  if (!token) return undefined;
  token.consumed = true;
  if (pending?.length === 0) pendingBySession.delete(session);
  return {
    clientMessageId: token.clientMessageId,
    displayText: token.displayText,
    images: token.images,
    steered: token.steered,
  };
}

export function clearPendingUserMessages(session: object): void {
  pendingBySession.delete(session);
}

export function getPendingUserMessages(session: object): PendingUserMessage[] {
  return (pendingBySession.get(session) ?? []).map(({ clientMessageId, displayText, images, steered }) => ({
    clientMessageId,
    displayText,
    images,
    steered,
  }));
}
