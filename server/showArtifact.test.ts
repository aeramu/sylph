import { afterAll, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "sylph-show-artifact-test-"));
vi.mock("./config.ts", () => ({ SCRATCH_DIR: path.join(root, "scratch") }));

const { ensureSessionArtifacts } = await import("./artifacts.ts");
const { showArtifactExtension } = await import("./showArtifact.ts");

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("show_artifact tool", () => {
  it("validates an existing artifact and emits a browser presentation request", async () => {
    const artifacts = ensureSessionArtifacts("session-123");
    fs.writeFileSync(path.join(artifacts, "report.md"), "# Report");
    let definition: any;
    showArtifactExtension({ registerTool: (value: any) => { definition = value; } } as any);
    const showArtifact = vi.fn();

    const result = await definition.execute("call-1", { path: "report.md" }, undefined, undefined, {
      hasUI: true,
      sessionManager: { getSessionId: () => "session-123" },
      ui: { showArtifact },
    });

    expect(showArtifact).toHaveBeenCalledWith("report.md");
    expect(result.details).toEqual({ shown: true, path: "report.md" });
  });

  it("does not emit a request for a missing file", async () => {
    let definition: any;
    showArtifactExtension({ registerTool: (value: any) => { definition = value; } } as any);
    const showArtifact = vi.fn();

    const result = await definition.execute("call-1", { path: "missing.md" }, undefined, undefined, {
      hasUI: true,
      sessionManager: { getSessionId: () => "session-123" },
      ui: { showArtifact },
    });

    expect(showArtifact).not.toHaveBeenCalled();
    expect(result.details).toEqual({ shown: false, path: "missing.md" });
  });
});
