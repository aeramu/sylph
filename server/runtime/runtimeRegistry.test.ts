import { describe, expect, it, vi } from "vitest";
import { RuntimeRegistry } from "./runtimeRegistry.ts";

describe("RuntimeRegistry", () => {
  it("deduplicates concurrent builds", async () => {
    const registry = new RuntimeRegistry();
    let resolve!: (runtime: any) => void;
    const build = vi.fn(() => new Promise<any>((done) => { resolve = done; }));
    const first = registry.getOrBuild("session", build);
    const second = registry.getOrBuild("session", build);
    expect(build).toHaveBeenCalledOnce();
    resolve({ session: {} });
    expect(await first).toBe(await second);
  });

  it("allows retry after a failed build", async () => {
    const registry = new RuntimeRegistry();
    await expect(registry.getOrBuild("session", async () => { throw new Error("failed"); })).rejects.toThrow("failed");
    await expect(registry.getOrBuild("session", async () => ({ session: {} }))).resolves.toBeDefined();
  });

  it("evicts idle non-streaming runtimes only", () => {
    let now = 0;
    const registry = new RuntimeRegistry(() => now);
    const idleDispose = vi.fn(), streamingDispose = vi.fn();
    registry.register("idle", { session: {}, dispose: idleDispose });
    registry.register("streaming", { session: { isStreaming: true }, dispose: streamingDispose });
    now = 100;
    expect(registry.evictIdle(50)).toEqual(["idle"]);
    expect(idleDispose).toHaveBeenCalledOnce();
    expect(streamingDispose).not.toHaveBeenCalled();
  });
});
