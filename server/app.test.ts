import type { Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createApp().listen(0, "127.0.0.1");
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

describe("HTTP application", () => {
  it("serves project data through the composed router", async () => {
    const response = await fetch(`${baseUrl}/api/projects`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ projects: expect.any(Array) });
  });

  it("serializes project validation errors", async () => {
    const response = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ directories: [] }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "At least one directory is required" });
  });

  it("rejects chat requests without a prompt before initializing a runtime", async () => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "prompt is required" });
  });

  it("returns 404 for unknown API routes instead of the SPA", async () => {
    expect((await fetch(`${baseUrl}/api/does-not-exist`)).status).toBe(404);
  });
});
