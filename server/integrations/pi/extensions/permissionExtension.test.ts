import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PermissionPolicy } from "../../../features/permissions/permissionPolicy.ts";
import { createWriteToolDefinition } from "@earendil-works/pi-coding-agent";
import { evaluateToolCall } from "../../../features/permissions/permissionPolicy.ts";
import { canonicalizeExistingPrefix } from "../../../features/permissions/pathPolicy.ts";
import { pathToFileURL } from "node:url";
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
  it("reviews every AI-mode command, including statically allowed commands", async () => {
    const { root, policy } = workspace();
    policy.mode = "ai";
    const review = vi.fn().mockResolvedValue({ decision: "allow", reason: "Safe inspection" });
    const handler = register(policy, { review });
    const event = tool("bash", { command: "cat ./file.txt" });
    const ctx = { cwd: root, hasUI: false, ui: {} };
    expect(await handler(event, ctx)).toBeUndefined();
    expect(await handler(event, ctx)).toBeUndefined();
    expect(review).toHaveBeenCalledTimes(2);
    review.mockResolvedValue({ decision: "deny", reason: "Unsafe" });
    expect(await handler(event, ctx)).toMatchObject({ block: true, reason: expect.stringContaining("Unsafe") });
  });

  it("asks on uncertain AI reviews and never lets AI override catastrophe rules", async () => {
    const { root, policy } = workspace();
    policy.mode = "ai";
    const review = vi.fn().mockResolvedValue({ decision: "ask", reason: "Uncertain" });
    const select = vi.fn().mockResolvedValue("Allow once");
    const handler = register(policy, { review });
    expect(await handler(tool("bash", { command: "npm test" }), { cwd: root, hasUI: true, ui: { select } })).toBeUndefined();
    expect(select.mock.calls[0][1]).not.toContain("Allow matching access for this session");
    review.mockClear().mockResolvedValue({ decision: "allow", reason: "approved" });
    expect(await handler(tool("bash", { command: "env bash -c 'rm -rf /'" }), { cwd: root, hasUI: false, ui: {} })).toMatchObject({ block: true });
    expect(review).not.toHaveBeenCalled();
  });

  it("does not call an AI reviewer in other modes and blocks read-only writes", async () => {
    const { root, policy } = workspace();
    const review = vi.fn();
    for (const mode of ["read-only", "safe", "relaxed"] as const) {
      const result = await register({ ...policy, mode }, { review })(tool("write", { path: "./file.txt", content: "data" }), { cwd: root, hasUI: false, ui: {} });
      if (mode === "read-only") expect(result).toMatchObject({ block: true });
      else expect(result).toBeUndefined();
    }
    expect(review).not.toHaveBeenCalled();
  });

  it("checks the same normalized destination that the Pi write tool uses", async () => {
    const { root, policy } = workspace();
    const outside = path.join(path.dirname(root), "outside file.txt");
    let destination: string | undefined;
    const writer = createWriteToolDefinition(root, { operations: {
      mkdir: async () => {},
      writeFile: async (filePath) => { destination = filePath; },
    } });
    for (const rawPath of ["~/sylph-review.txt", `@${outside}`, pathToFileURL(outside).href, `@${outside.replace(" ", "\u202f")}`]) {
      const input = { path: rawPath, content: "fixture" };
      const evaluation = evaluateToolCall(policy, tool("write", input), root);
      await writer.execute("test", input, undefined, undefined, { cwd: root } as any);
      expect(evaluation.decision).toBe("ask");
      expect(evaluation.intents[0].canonicalPath).toBe(canonicalizeExistingPrefix(destination!));
    }
  });

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

  it("requires renewed approval for old command-only shell keys", async () => {
    const { root, policy } = workspace();
    const event = tool("bash", { command: "wget https://example.com" });
    for (const key of ["bash:wget https://example.com", "balanced:bash:wget https://example.com"]) {
      const result = await register(policy, { initialApprovals: [key] })(event, { cwd: root, hasUI: false, ui: {} });
      expect(result).toMatchObject({ block: true });
    }
  });

  it("rechecks approved shell access when a symlink target changes", async () => {
    const { root, policy } = workspace();
    const first = path.join(root, ".env.first");
    const second = path.join(root, ".env.second");
    const link = path.join(root, "link");
    fs.writeFileSync(first, "first");
    fs.writeFileSync(second, "second");
    fs.symlinkSync(first, link);
    const approvals: string[] = [];
    const handler = register(policy, { onApproval: (key: string) => approvals.push(key) });
    const event = tool("bash", { command: "cat ./link" });
    await handler(event, { cwd: root, hasUI: true, ui: { select: async () => "Allow matching access for this session" } });
    const resumed = register(policy, { initialApprovals: approvals });
    expect(await resumed(event, { cwd: root, hasUI: false, ui: {} })).toBeUndefined();
    fs.unlinkSync(link);
    fs.symlinkSync(second, link);
    expect(await resumed(event, { cwd: root, hasUI: false, ui: {} })).toMatchObject({ block: true });
  });

  it("rechecks shell approvals when cwd or configured environment changes", async () => {
    const { root, policy } = workspace();
    const nested = path.join(root, "nested");
    fs.mkdirSync(nested);
    policy.mode = "safe";
    policy.shellEnvironment = { TMPDIR: root };
    const approvals: string[] = [];
    const event = tool("bash", { command: "git pull" });
    await register(policy, { onApproval: (key: string) => approvals.push(key) })(event, {
      cwd: root, hasUI: true, ui: { select: async () => "Allow matching access for this session" },
    });
    expect(await register(policy, { initialApprovals: approvals })(event, { cwd: nested, hasUI: false, ui: {} })).toMatchObject({ block: true });
    policy.shellEnvironment.TMPDIR = nested;
    expect(await register(policy, { initialApprovals: approvals })(event, { cwd: root, hasUI: false, ui: {} })).toMatchObject({ block: true });
  });

  it("never lets a persisted approval override a hard denial", async () => {
    const { root, policy } = workspace();
    const denied = tool("bash", { command: "rm -rf /" });
    const approvalKey = `balanced:bash:rm -rf /`;
    const result = await register(policy, { initialApprovals: [approvalKey] })(denied, { cwd: root, hasUI: false, ui: {} });
    expect(result).toMatchObject({ block: true });
    expect(result.reason).toMatch(/recursive deletion/);
  });

  it("fails closed when confirmation needs UI but none is available", async () => {
    const { root, policy } = workspace();
    const handler = register(policy);
    const context = { cwd: root, hasUI: false, ui: {} };
    const read = await handler(tool("read", { path: "/outside/secret" }), context);
    const background = await handler(tool("bg_run", { name: "Pull", command: "git pull" }), context);
    expect(read).toMatchObject({ block: true });
    expect(read.reason).toMatch(/Confirmation unavailable/);
    expect(background).toMatchObject({ block: true });
    expect(background.reason).toMatch(/networked Git operation pull/);
  });
});
