import type { Server } from "http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import fs from "fs";
import os from "os";
import path from "path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "sylph-artifact-routes-test-"));
const scratchRoot = path.join(root, "scratch");

vi.mock("../config.ts", async (importOriginal) => ({
  ...await importOriginal<typeof import("../config.ts")>(),
  SCRATCH_DIR: scratchRoot,
}));
vi.mock("../sessionBindings.ts", () => ({
  getSessionBinding: (sessionId: unknown) => sessionId === "session-123"
    ? { sessionId, workspaceKind: "scratch", cwd: path.join(scratchRoot, String(sessionId)), directories: [] }
    : undefined,
}));

const { ensureSessionArtifacts } = await import("../artifacts.ts");
const { registerArtifactRoutes } = await import("./artifactRoutes.ts");
const { registerFilesystemRoutes } = await import("./filesystemRoutes.ts");

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  const router = express.Router();
  registerFilesystemRoutes(router);
  registerArtifactRoutes(router);
  app.use(router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind a TCP port");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  fs.rmSync(scratchRoot, { recursive: true, force: true });
  const artifacts = ensureSessionArtifacts("session-123");
  fs.writeFileSync(path.join(artifacts, "report.md"), "# Report");
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  fs.rmSync(root, { recursive: true, force: true });
});

describe("artifact HTTP APIs", () => {
  it("lists artifact metadata without including file content", async () => {
    const response = await fetch(`${baseUrl}/api/sessions/session-123/artifacts`);
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.artifacts).toEqual([
      expect.objectContaining({ path: "report.md", name: "report.md", mimeType: "text/markdown", size: 8 }),
    ]);
    expect(JSON.stringify(body)).not.toContain("# Report");
  });

  it("reads artifact content through the scoped filesystem API", async () => {
    const query = new URLSearchParams({ scope: "artifacts", sessionId: "session-123", path: "report.md" });
    const response = await fetch(`${baseUrl}/api/fs/read?${query}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      path: "report.md",
      mimeType: "text/markdown",
      encoding: "utf8",
      content: "# Report",
    });
  });

  it("rejects traversal and unknown sessions", async () => {
    const traversal = new URLSearchParams({ scope: "artifacts", sessionId: "session-123", path: "../secret.txt" });
    expect((await fetch(`${baseUrl}/api/fs/read?${traversal}`)).status).toBe(400);
    expect((await fetch(`${baseUrl}/api/sessions/missing/artifacts`)).status).toBe(404);
  });
});
