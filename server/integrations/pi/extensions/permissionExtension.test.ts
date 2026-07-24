import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PermissionPolicy } from "../../../features/permissions/permissionPolicy.ts";
import { createPermissionExtension } from "./permissionExtension.ts";

const temporaryRoots: string[] = [];
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sylph-permission-extension-test-"));
  temporaryRoots.push(root);
  const policy: PermissionPolicy = { roots: [{ id: "workspace", name: "workspace", path: root }], externalAccess: "ask" };
  return { root, policy };
}

const tool = (toolName: string, input: Record<string, unknown>) => ({ toolName, input } as any);

function register(policy: PermissionPolicy, options = {}) {
  let handler: any;
  createPermissionExtension(policy, options)({
    on: (event: string, callback: any) => { if (event === "tool_call") handler = callback; },
  } as any);
  return handler;
}

describe("Pi permission extension", () => {
  it("persists a session approval and reuses it without prompting", async () => {
    const { root, policy } = workspace();
    const approvals: string[] = [];
    const audits: string[] = [];
    const handler = register(policy, {
      onApproval: (key: string) => approvals.push(key),
      audit: (event: { decision: string }) => audits.push(event.decision),
    });
    let prompts = 0;
    const ctx = {
      cwd: root, hasUI: true,
      ui: { select: async () => { prompts++; return "Allow matching access for this session"; }, input: async () => undefined },
    };
    const event = tool("bash", { command: "wget https://example.com" });
    expect(await handler(event, ctx)).toBeUndefined();
    expect(await handler(event, ctx)).toBeUndefined();
    expect(prompts).toBe(1);
    expect(approvals).toHaveLength(1);
    expect(audits).toEqual(["approved_for_session", "approved_for_session"]);
  });

  it("fails closed when confirmation needs UI but none is available", async () => {
    const { root, policy } = workspace();
    const result = await register(policy)(tool("read", { path: "/outside/secret" }), { cwd: root, hasUI: false, ui: {} });
    expect(result).toMatchObject({ block: true });
    expect(result.reason).toMatch(/Confirmation unavailable/);
  });
});
