import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { SessionHistoryHandle } from "../../../features/sessions/lifecycle/sessionHistoryPort.ts";
import { broadcast } from "../../../platform/events/sseHub.ts";
import { getContextInfo } from "./contextUsage.ts";
import type { SessionRuntimeEvents } from "./sessionRuntimeTypes.ts";

const CONTEXT_EVENT_TYPES = new Set(["message_end", "agent_end", "compaction_end"]);

export function subscribeRuntimeEvents(
  runtime: any,
  sessionManager: SessionHistoryHandle,
  events: SessionRuntimeEvents,
) {
  runtime.session.subscribe((event: AgentSessionEvent) => {
    const sessionId = sessionManager.getSessionId();
    const payload: Record<string, unknown> = {
      sessionId,
      eventSeq: events.nextSequence(sessionId),
      ...event,
    };
    if (CONTEXT_EVENT_TYPES.has(event.type)) {
      const context = getContextInfo(runtime.session);
      if (context) payload.context = context;
    }
    broadcast(payload);
  });
}
