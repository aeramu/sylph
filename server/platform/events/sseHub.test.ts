import { afterEach, describe, expect, it, vi } from "vitest";
import { addClient, broadcast, removeClient } from "./sseHub.ts";

function client(write: (data: string) => boolean) {
  const drainListeners: Array<() => void> = [];
  const writeMock = vi.fn<(data: string) => boolean>(write);
  return {
    write: writeMock,
    once: vi.fn((event: string, listener: () => void) => { if (event === "drain") drainListeners.push(listener); }),
    destroy: vi.fn(),
    drain: () => drainListeners.shift()?.(),
  };
}

const clients: any[] = [];
afterEach(() => {
  for (const value of clients.splice(0)) removeClient(value);
});

describe("SSE hub", () => {
  it("queues behind backpressure and flushes in order on drain", () => {
    let writable = false;
    const slow = client((_data) => writable);
    clients.push(slow);
    addClient(slow as any);

    broadcast({ value: 1 });
    broadcast({ value: 2 });
    expect(slow.write).toHaveBeenCalledTimes(1);

    writable = true;
    slow.drain();
    expect(slow.write.mock.calls.map(([value]) => value)).toEqual([
      'data: {"value":1}\n\n',
      'data: {"value":2}\n\n',
    ]);
  });

  it("removes clients whose writes throw", () => {
    const broken = client((_data) => { throw new Error("closed"); });
    clients.push(broken);
    addClient(broken as any);

    expect(() => broadcast({ type: "agent_end" })).not.toThrow();
    broadcast({ type: "agent_end" });

    expect(broken.write).toHaveBeenCalledTimes(1);
    expect(broken.destroy).toHaveBeenCalledOnce();
  });
});
