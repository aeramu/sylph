import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "sylph-artifacts-test-"));
const scratchRoot = path.join(root, "scratch");

vi.mock("../../config.ts", () => ({ SCRATCH_DIR: scratchRoot }));
const { ensureSessionArtifacts, listSessionArtifacts, resolveArtifactPath } = await import("./artifactStore.ts");

afterEach(() => fs.rmSync(scratchRoot, { recursive: true, force: true }));

describe("session artifacts", () => {
  it("lists nested files as metadata without their contents", async () => {
    const artifacts = ensureSessionArtifacts("session-123");
    fs.mkdirSync(path.join(artifacts, "images"));
    fs.writeFileSync(path.join(artifacts, "report.md"), "# Report");
    fs.writeFileSync(path.join(artifacts, "images", "chart.png"), Buffer.from([1, 2, 3]));

    expect(await listSessionArtifacts("session-123")).toEqual([
      expect.objectContaining({ path: "images/chart.png", name: "chart.png", size: 3, mimeType: "image/png" }),
      expect.objectContaining({ path: "report.md", name: "report.md", size: 8, mimeType: "text/markdown" }),
    ]);
  });

  it("rejects traversal and symlinks that escape the artifact directory", () => {
    const artifacts = ensureSessionArtifacts("session-123");
    const outside = path.join(root, "outside.txt");
    fs.writeFileSync(outside, "private");
    fs.symlinkSync(outside, path.join(artifacts, "outside.txt"));

    expect(() => resolveArtifactPath("session-123", "../outside.txt")).toThrow(/inside the artifact directory/);
    expect(() => resolveArtifactPath("session-123", "outside.txt")).toThrow(/escapes the artifact directory/);
  });

  it("does not expose symlinks in listings", async () => {
    const artifacts = ensureSessionArtifacts("session-123");
    fs.writeFileSync(path.join(root, "outside.txt"), "private");
    fs.symlinkSync(path.join(root, "outside.txt"), path.join(artifacts, "outside.txt"));

    expect(await listSessionArtifacts("session-123")).toEqual([]);
  });
});
