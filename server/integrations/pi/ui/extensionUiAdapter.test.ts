import { afterEach, describe, expect, it, vi } from "vitest";
import { clearSessionArtifactRequest, getPendingArtifactRequest } from "../../../features/artifacts/artifactPresentationRequests.ts";

const broadcast = vi.fn();
vi.mock("../../../platform/events/sseHub.ts", () => ({ broadcast }));
const { createExtensionUiContext } = await import("./extensionUiAdapter.ts");

afterEach(() => {
  broadcast.mockClear();
  clearSessionArtifactRequest("session-a");
});

describe("Pi extension UI adapter", () => {
  it("publishes and remembers artifact presentation", () => {
    createExtensionUiContext("session-a").showArtifact("report.md");
    const pending = getPendingArtifactRequest("session-a");
    expect(pending).toMatchObject({ method: "showArtifact", path: "report.md" });
    expect(broadcast).toHaveBeenCalledWith(pending);
  });
});
