import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createPermissionExtension, evaluateToolCall, isThirdPartyPermissionExtension, parseCommandUnits, type PermissionPolicy } from "./permissions.ts";

const temporaryRoots: string[] = [];
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function workspace() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "sylph-permissions-test-"));
  temporaryRoots.push(parent);
  const frontend = path.join(parent, "frontend");
  const api = path.join(parent, "api");
  fs.mkdirSync(frontend);
  fs.mkdirSync(api);
  const policy: PermissionPolicy = {
    roots: [
      { id: "frontend", name: "frontend", path: frontend },
      { id: "api", name: "api", path: api },
    ],
    externalAccess: "ask",
  };
  return { parent, frontend, api, policy };
}

const tool = (toolName: string, input: Record<string, unknown>) => ({ toolName, input } as any);

describe("Sylph permissions", () => {
  it("allows file access in every workspace root", () => {
    const { frontend, api, policy } = workspace();
    expect(evaluateToolCall(policy, tool("write", { path: path.join(frontend, "src.ts") }), frontend).decision).toBe("allow");
    expect(evaluateToolCall(policy, tool("edit", { path: path.join(api, "routes.ts") }), frontend).decision).toBe("allow");
  });

  it("asks for external and sensitive paths", () => {
    const { parent, frontend, api, policy } = workspace();
    expect(evaluateToolCall(policy, tool("read", { path: path.join(parent, "outside.txt") }), frontend)).toMatchObject({ decision: "ask" });
    expect(evaluateToolCall(policy, tool("write", { path: path.join(api, ".env") }), frontend)).toMatchObject({ decision: "ask" });
  });

  it("allows reads within loaded structured skill directories", () => {
    const { parent, frontend, policy } = workspace();
    const skillDir = path.join(parent, "external-skill");
    const referencesDir = path.join(skillDir, "references");
    fs.mkdirSync(referencesDir, { recursive: true });
    const skillFile = path.join(skillDir, "SKILL.md");
    const referenceFile = path.join(referencesDir, "reference.md");
    const siblingFile = path.join(parent, "sibling.txt");
    fs.writeFileSync(skillFile, "# Skill");
    fs.writeFileSync(referenceFile, "reference");
    fs.writeFileSync(siblingFile, "secret");
    policy.allowedReadRoots = new Set([fs.realpathSync(skillDir)]);

    expect(evaluateToolCall(policy, tool("read", { path: skillFile }), frontend)).toMatchObject({ decision: "allow" });
    expect(evaluateToolCall(policy, tool("read", { path: referenceFile }), frontend)).toMatchObject({ decision: "allow" });
    expect(evaluateToolCall(policy, tool("ls", { path: referencesDir }), frontend)).toMatchObject({ decision: "allow" });
    expect(evaluateToolCall(policy, tool("bash", { command: `cat ${JSON.stringify(referenceFile)}` }), frontend)).toMatchObject({ decision: "allow" });
    expect(evaluateToolCall(policy, tool("read", { path: siblingFile }), frontend)).toMatchObject({ decision: "ask" });
    expect(evaluateToolCall(policy, tool("write", { path: referenceFile }), frontend)).toMatchObject({ decision: "ask" });
    expect(evaluateToolCall(policy, tool("bash", { command: `cd ${JSON.stringify(referencesDir)} && cat ./reference.md` }), frontend)).toMatchObject({ decision: "ask" });
    expect(evaluateToolCall(policy, tool("bash", { command: JSON.stringify(path.join(skillDir, "scripts", "run.sh")) }), frontend)).toMatchObject({ decision: "ask" });
    expect(evaluateToolCall(policy, tool("bash", { command: `node ${JSON.stringify(path.join(skillDir, "scripts", "run.js"))}` }), frontend)).toMatchObject({ decision: "ask" });
  });

  it("keeps sensitive files in loaded skill directories gated", () => {
    const { parent, frontend, policy } = workspace();
    const skillDir = path.join(parent, "external-skill");
    fs.mkdirSync(skillDir);
    const envFile = path.join(skillDir, ".env");
    fs.writeFileSync(envFile, "TOKEN=secret");
    policy.allowedReadRoots = [fs.realpathSync(skillDir)];

    expect(evaluateToolCall(policy, tool("read", { path: envFile }), frontend)).toMatchObject({ decision: "ask" });
  });

  it("matches explicitly loaded skill files by canonical path", () => {
    const { parent, frontend, policy } = workspace();
    const skillDir = path.join(parent, "external-skill");
    fs.mkdirSync(skillDir);
    const skillFile = path.join(skillDir, "SKILL.md");
    fs.writeFileSync(skillFile, "# Skill");
    const link = path.join(parent, "skill-link.md");
    fs.symlinkSync(skillFile, link);
    policy.allowedReadFiles = [fs.realpathSync(skillFile)];

    expect(evaluateToolCall(policy, tool("read", { path: link }), frontend)).toMatchObject({ decision: "allow" });
  });

  it("does not follow a swapped skill-file symlink", () => {
    const { parent, frontend, policy } = workspace();
    const original = path.join(parent, "original-skill.md");
    const replacement = path.join(parent, "replacement.md");
    const link = path.join(parent, "SKILL.md");
    fs.writeFileSync(original, "# Skill");
    fs.writeFileSync(replacement, "secret");
    fs.symlinkSync(original, link);
    policy.allowedReadFiles = [fs.realpathSync(link)];
    fs.unlinkSync(link);
    fs.symlinkSync(replacement, link);

    expect(evaluateToolCall(policy, tool("read", { path: link }), frontend)).toMatchObject({ decision: "ask" });
  });

  it("resolves symlinks before checking root containment", () => {
    const { parent, frontend, policy } = workspace();
    const outside = path.join(parent, "secret");
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(frontend, "linked"));
    const result = evaluateToolCall(policy, tool("read", { path: path.join(frontend, "linked", "value.txt") }), frontend);
    expect(result).toMatchObject({ decision: "ask" });
    expect(result.reason).toMatch(/outside every workspace root/);
  });

  it("denies writes to read-only roots", () => {
    const { frontend, api, policy } = workspace();
    policy.roots[1].access = "read-only";
    expect(evaluateToolCall(policy, tool("read", { path: path.join(api, "routes.ts") }), frontend).decision).toBe("allow");
    expect(evaluateToolCall(policy, tool("write", { path: path.join(api, "routes.ts") }), frontend).decision).toBe("deny");
  });

  it("tracks literal cd across workspace roots", () => {
    const { frontend, api, policy } = workspace();
    const result = evaluateToolCall(policy, tool("bash", { command: `cd ${JSON.stringify(api)} && cat ./routes.ts` }), frontend);
    expect(result.decision).toBe("allow");
    expect(result.summary).toContain("[api]");
  });

  it("asks for sensitive bare filenames in shell commands", () => {
    const { frontend, policy } = workspace();
    expect(evaluateToolCall(policy, tool("bash", { command: "cat .env" }), frontend)).toMatchObject({ decision: "ask" });
    expect(evaluateToolCall(policy, tool("bash", { command: "cp id_ed25519 ./backup" }), frontend)).toMatchObject({ decision: "ask" });
  });

  it("asks for network, recursive delete, and opaque shell commands", () => {
    const { frontend, policy } = workspace();
    expect(evaluateToolCall(policy, tool("bash", { command: "curl https://example.com" }), frontend).decision).toBe("ask");
    expect(evaluateToolCall(policy, tool("bash", { command: "rm ./file.txt" }), frontend).decision).toBe("ask");
    expect(evaluateToolCall(policy, tool("bash", { command: "rm -rf ./dist" }), frontend).decision).toBe("ask");
    expect(evaluateToolCall(policy, tool("bash", { command: "git pull" }), frontend).decision).toBe("ask");
    expect(evaluateToolCall(policy, tool("bash", { command: "bash -c 'cat /tmp/x'" }), frontend).decision).toBe("ask");
    expect(evaluateToolCall(policy, tool("bash", { command: "cat \"$FILE\"" }), frontend).decision).toBe("ask");
    expect(evaluateToolCall(policy, tool("bash", { command: "cd \"$DIR\" && cat file" }), frontend).decision).toBe("ask");
    expect(evaluateToolCall(policy, tool("bash", { command: "cat `printf /tmp/secret`" }), frontend).decision).toBe("ask");
  });

  it("denies catastrophic commands and force pushes", () => {
    const { frontend, policy } = workspace();
    expect(evaluateToolCall(policy, tool("bash", { command: "shutdown -h now" }), frontend).decision).toBe("deny");
    expect(evaluateToolCall(policy, tool("bash", { command: "rm -rf /" }), frontend).decision).toBe("deny");
    expect(evaluateToolCall(policy, tool("bash", { command: ":(){:|:&};:" }), frontend).decision).toBe("deny");
    expect(evaluateToolCall(policy, tool("bash", { command: "git push --force origin main" }), frontend).decision).toBe("deny");
    expect(evaluateToolCall(policy, tool("bash", { command: "dd if=/dev/zero of=/dev/disk0" }), frontend).decision).toBe("deny");
    expect(evaluateToolCall(policy, tool("bash", { command: "chmod 777 ./script.sh" }), frontend).decision).toBe("deny");
  });

  it("asks before unknown custom tools and scopes grants to their inputs", () => {
    const { frontend, policy } = workspace();
    const production = evaluateToolCall(policy, tool("deploy", { target: "production" }), frontend);
    const staging = evaluateToolCall(policy, tool("deploy", { target: "staging" }), frontend);
    expect(production.decision).toBe("ask");
    expect(production.approvalKey).not.toBe(staging.approvalKey);
    expect(production.approvalKey).not.toContain("production");
  });

  it("parses command chains and flags opaque expansions", () => {
    expect(parseCommandUnits("cd api && npm test").units).toHaveLength(2);
    expect(parseCommandUnits("echo $(cat /tmp/secret)").opaque).toBe(true);
  });

  it("persists a session approval and reuses it without prompting", async () => {
    const { frontend, policy } = workspace();
    let handler: any;
    const approvals: string[] = [];
    const audits: string[] = [];
    createPermissionExtension(policy, {
      onApproval: (key) => approvals.push(key),
      audit: (event) => audits.push(event.decision),
    })({ on: (event: string, callback: any) => { if (event === "tool_call") handler = callback; } } as any);
    let prompts = 0;
    const ctx = {
      cwd: frontend,
      hasUI: true,
      ui: {
        select: async () => { prompts++; return "Allow matching access for this session"; },
        input: async () => undefined,
      },
    };
    const event = tool("bash", { command: "curl https://example.com" });
    expect(await handler(event, ctx)).toBeUndefined();
    expect(await handler(event, ctx)).toBeUndefined();
    expect(prompts).toBe(1);
    expect(approvals).toHaveLength(1);
    expect(audits).toEqual(["approved_for_session", "approved_for_session"]);
  });

  it("fails closed when an ask needs UI but none is available", async () => {
    const { frontend, policy } = workspace();
    let handler: any;
    createPermissionExtension(policy)({ on: (_event: string, callback: any) => { handler = callback; } } as any);
    const result = await handler(tool("read", { path: "/outside/secret" }), { cwd: frontend, hasUI: false, ui: {} });
    expect(result).toMatchObject({ block: true });
    expect(result.reason).toMatch(/Confirmation unavailable/);
  });

  it("recognizes the third-party permission extension without matching unrelated extensions", () => {
    expect(isThirdPartyPermissionExtension({ path: "npm:@gotgenes/pi-permission-system", resolvedPath: "/pkg/src/index.ts" })).toBe(true);
    expect(isThirdPartyPermissionExtension({ path: "/extensions/permission-gate.ts", resolvedPath: "/extensions/permission-gate.ts" })).toBe(false);
  });
});
