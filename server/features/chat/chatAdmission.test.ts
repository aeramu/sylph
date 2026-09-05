import { describe, expect, it, vi } from "vitest";
import { admitPrompt, withSessionAdmission } from "./chatAdmission.ts";
import { consumePendingUserMessage, getPendingUserMessages } from "../../integrations/pi/runtime/pendingUserMessages.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("chat prompt admission", () => {
  it("returns after idle preflight acceptance without waiting for the run", async () => {
    const run = deferred();
    const session: any = {
      isStreaming: false,
      prompt: vi.fn((_text: string, options: any) => {
        session.isStreaming = true;
        options.preflightResult(true);
        return run.promise.finally(() => { session.isStreaming = false; });
      }),
    };

    await expect(admitPrompt(session, "expanded", {
      clientMessageId: "client-1", displayText: "visible", images: [{ type: "image", data: "abc" }],
    })).resolves.toBe(false);
    expect(session.prompt).toHaveBeenCalledWith("expanded", expect.objectContaining({
      images: [{ type: "image", data: "abc" }], preflightResult: expect.any(Function),
    }));
    expect(getPendingUserMessages(session)).toEqual([expect.objectContaining({
      clientMessageId: "client-1", displayText: "visible", steered: false,
    })]);

    consumePendingUserMessage(session);
    run.resolve();
    await run.promise;
  });

  it("does not leave metadata queued when a handled command starts no run", async () => {
    const session: any = {
      isStreaming: false,
      prompt: vi.fn(async (_text: string, options: any) => { options.preflightResult(true); }),
    };

    await expect(admitPrompt(session, "/handled", { clientMessageId: "client-command" })).resolves.toBe(false);
    expect(getPendingUserMessages(session)).toEqual([]);
  });

  it("surfaces idle preflight failures instead of returning success", async () => {
    const session: any = {
      isStreaming: false,
      prompt: vi.fn(async (_text: string, options: any) => {
        options.preflightResult(false);
        throw new Error("No API key");
      }),
    };

    await expect(admitPrompt(session, "hello", { clientMessageId: "client-1" })).rejects.toThrow("No API key");
    await Promise.resolve();
    expect(getPendingUserMessages(session)).toEqual([]);
  });

  it("queues and marks steering input", async () => {
    const session: any = { isStreaming: true, steer: vi.fn(async () => undefined) };

    await expect(admitPrompt(session, "change course", {
      clientMessageId: "client-2", displayText: "Change course",
    })).resolves.toBe(true);
    expect(consumePendingUserMessage(session)).toEqual(expect.objectContaining({
      clientMessageId: "client-2", displayText: "Change course", steered: true,
    }));
  });

  it("serializes concurrent admission sections for one session", async () => {
    const session = {};
    const gate = deferred();
    const order: string[] = [];
    const first = withSessionAdmission(session, async () => {
      order.push("first:start");
      await gate.promise;
      order.push("first:end");
      return 1;
    });
    const second = withSessionAdmission(session, async () => {
      order.push("second");
      return 2;
    });

    await Promise.resolve();
    expect(order).toEqual(["first:start"]);
    gate.resolve();
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(order).toEqual(["first:start", "first:end", "second"]);
  });
});
