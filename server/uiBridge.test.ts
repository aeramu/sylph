import { afterEach, describe, expect, it, vi } from "vitest";

const broadcast = vi.fn();
vi.mock("./sse.ts", () => ({ broadcast }));

const {
  acknowledgeArtifactRequest,
  clearSessionArtifactRequest,
  createExtensionUiContext,
  getPendingArtifactRequest,
} = await import("./uiBridge.ts");

const sessions = ["session-a", "session-b"];
afterEach(() => {
  broadcast.mockClear();
  for (const sessionId of sessions) clearSessionArtifactRequest(sessionId);
});

describe("artifact presentation requests", () => {
  it("keeps a showArtifact request available until the browser acknowledges it", () => {
    createExtensionUiContext("session-a").showArtifact("report.md");

    const pending = getPendingArtifactRequest("session-a");
    expect(pending).toMatchObject({
      sessionId: "session-a",
      type: "extension_ui_request",
      method: "showArtifact",
      path: "report.md",
      id: expect.any(String),
    });
    expect(broadcast).toHaveBeenCalledWith(pending);

    expect(acknowledgeArtifactRequest("session-a", pending!.id)).toBe(true);
    expect(getPendingArtifactRequest("session-a")).toBeUndefined();
  });

  it("does not let a stale acknowledgement clear a newer request", () => {
    const ui = createExtensionUiContext("session-a");
    ui.showArtifact("first.md");
    const first = getPendingArtifactRequest("session-a")!;
    ui.showArtifact("second.md");
    const second = getPendingArtifactRequest("session-a")!;

    expect(acknowledgeArtifactRequest("session-a", first.id)).toBe(false);
    expect(getPendingArtifactRequest("session-a")).toEqual(second);
    expect(acknowledgeArtifactRequest("session-a", second.id)).toBe(true);
  });

  it("isolates pending artifacts by session", () => {
    createExtensionUiContext("session-a").showArtifact("a.md");
    createExtensionUiContext("session-b").showArtifact("b.md");

    expect(getPendingArtifactRequest("session-a")?.path).toBe("a.md");
    expect(getPendingArtifactRequest("session-b")?.path).toBe("b.md");
  });
});
