import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { SessionHistoryHandle } from "../../../features/sessions/lifecycle/sessionHistoryPort.ts";
import { broadcast } from "../../../platform/events/sseHub.ts";
import { getContextInfo } from "./contextUsage.ts";
import { consumePendingUserMessage } from "./pendingUserMessages.ts";
import type { SessionRuntimeEvents } from "./sessionRuntimeTypes.ts";

const CONTEXT_EVENT_TYPES = new Set(["message_end", "agent_end", "compaction_end"]);

/** Keep cumulative partial messages out of token events; the delta is sufficient. */
export function projectRuntimeEvent(event: any, session: object): Record<string, unknown> {
  if (event.type === "message_start" && event.message?.role === "user") {
    const pending = consumePendingUserMessage(session);
    if (pending) {
      // Pi persists this same object after subscribers return, making the
      // client id, display text, and steering badge durable across reloads.
      if (pending.clientMessageId) event.message.clientMessageId = pending.clientMessageId;
      if (pending.displayText !== undefined) event.message.displayText = pending.displayText;
      if (pending.steered) event.message.steered = true;
    }
  }

  if (event.type === "message_update") {
    const { partial: _partial, ...assistantMessageEvent } = event.assistantMessageEvent ?? {};
    return { type: event.type, assistantMessageEvent };
  }
  if (event.type === "agent_end") {
    const { messages: _messages, ...rest } = event;
    return rest;
  }
  return event;
}

export function subscribeRuntimeEvents(
  runtime: any,
  sessionManager: SessionHistoryHandle,
  events: SessionRuntimeEvents,
) {
  runtime.session.subscribe((event: AgentSessionEvent) => {
    const sessionId = sessionManager.getSessionId();
    const projected = projectRuntimeEvent(event, runtime.session);
    const payload: Record<string, unknown> = {
      sessionId,
      eventSeq: events.nextSequence(sessionId),
      ...projected,
    };
    if (CONTEXT_EVENT_TYPES.has(event.type)) {
      const context = getContextInfo(runtime.session);
      if (context) payload.context = context;
    }
    broadcast(payload);
  });
}
