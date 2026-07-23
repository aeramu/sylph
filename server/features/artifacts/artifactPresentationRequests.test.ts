import { afterEach, describe, expect, it } from "vitest";
import {
  acknowledgeArtifactRequest, clearSessionArtifactRequest, getPendingArtifactRequest, rememberArtifactPresentation,
} from "./artifactPresentationRequests.ts";

const sessions = ["session-a", "session-b"];
afterEach(() => sessions.forEach(clearSessionArtifactRequest));

const request = (sessionId: string, id: string, path: string) => ({
  sessionId, id, path, type: "extension_ui_request" as const, method: "showArtifact" as const,
});

describe("artifact presentation requests", () => {
  it("keeps only the latest request per session until acknowledged", () => {
    rememberArtifactPresentation(request("session-a", "first", "first.md"));
    rememberArtifactPresentation(request("session-a", "second", "second.md"));
    expect(acknowledgeArtifactRequest("session-a", "first")).toBe(false);
    expect(getPendingArtifactRequest("session-a")?.path).toBe("second.md");
    expect(acknowledgeArtifactRequest("session-a", "second")).toBe(true);
  });

  it("isolates requests by session", () => {
    rememberArtifactPresentation(request("session-a", "a", "a.md"));
    rememberArtifactPresentation(request("session-b", "b", "b.md"));
    expect(getPendingArtifactRequest("session-a")?.path).toBe("a.md");
    expect(getPendingArtifactRequest("session-b")?.path).toBe("b.md");
  });
});
