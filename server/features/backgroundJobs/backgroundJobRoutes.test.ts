import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { registerBackgroundJobRoutes } from "./backgroundJobRoutes.ts";

const jobId = "bg-12345678-1234-4123-8123-123456789abc";
const job = (sessionId: string, id = jobId) => ({
  id, sessionId, name: "Build", command: "npm run build", cwd: "/workspace",
  status: "completed" as const, startedAt: new Date(0).toISOString(), outputBytes: 6,
});
const service = {
  getJob: vi.fn((sessionId: string, candidateId: string) => sessionId === "session-a" && candidateId === jobId
    ? job(sessionId, candidateId)
    : undefined),
  readLogs: vi.fn((sessionId: string, candidateId: string, maxBytes?: number) => ({
    job: job(sessionId, candidateId), text: "passed", bytesRead: 6, totalBytes: 6, truncated: false, maxBytes,
  })),
};

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  const router = express.Router();
  registerBackgroundJobRoutes(router, service);
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

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

describe("background-job HTTP APIs", () => {
  it("returns bounded output for the owning session", async () => {
    const response = await fetch(`${baseUrl}/api/sessions/session-a/background-jobs/${jobId}/logs?maxBytes=4096`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ text: "passed", bytesRead: 6, truncated: false });
    expect(service.readLogs).toHaveBeenCalledWith("session-a", jobId, 4096);
  });

  it("does not expose a job through another session", async () => {
    const response = await fetch(`${baseUrl}/api/sessions/session-b/background-jobs/${jobId}/logs`);
    expect(response.status).toBe(404);
    expect(service.readLogs).not.toHaveBeenCalledWith("session-b", jobId, expect.anything());
  });

  it("rejects malformed ids and oversized reads", async () => {
    expect((await fetch(`${baseUrl}/api/sessions/session-a/background-jobs/not-a-job/logs`)).status).toBe(400);
    expect((await fetch(`${baseUrl}/api/sessions/session-a/background-jobs/${jobId}/logs?maxBytes=999999`)).status).toBe(400);
  });
});
