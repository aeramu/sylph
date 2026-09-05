import { describe, expect, it } from "vitest";
import { projectRuntimeEvent } from "./runtimeEventAdapter.ts";
import { registerPendingUserMessage } from "./pendingUserMessages.ts";

describe("runtime event projection", () => {
  it("strips cumulative assistant partials from delta events", () => {
    const session = {};
    const payload = projectRuntimeEvent({
      type: "message_update",
      message: { role: "assistant", content: [{ type: "text", text: "a very long response so far" }] },
      assistantMessageEvent: {
        type: "text_delta", delta: "far", contentIndex: 0,
        partial: { role: "assistant", content: [{ type: "text", text: "a very long response so far" }] },
      },
    }, session);

    expect(payload).toEqual({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "far", contentIndex: 0 },
    });
  });

  it("attaches durable client metadata to the accepted user message", () => {
    const session = {};
    registerPendingUserMessage(session, {
      clientMessageId: "client-1", displayText: "Visible text", steered: true,
    });
    const event: any = { type: "message_start", message: { role: "user", content: "expanded text" } };

    expect(projectRuntimeEvent(event, session)).toBe(event);
    expect(event.message).toMatchObject({
      clientMessageId: "client-1", displayText: "Visible text", steered: true,
    });
  });

  it("drops the redundant agent-end transcript", () => {
    expect(projectRuntimeEvent({ type: "agent_end", messages: [{ role: "user" }], willRetry: false }, {}))
      .toEqual({ type: "agent_end", willRetry: false });
  });
});
