import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "node:url";
import { evaluateToolCall, parseCommandUnits, type PermissionPolicy } from "./permissionPolicy.ts";

import { isPermissionMode } from "./permissionTypes.ts";

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
  it("accepts the four public mode values and rejects legacy values at the API boundary", () => {
    for (const mode of ["read-only", "safe", "ai", "relaxed"]) expect(isPermissionMode(mode)).toBe(true);
    for (const mode of ["strict", "balanced", "unknown", null]) expect(isPermissionMode(mode)).toBe(false);
  });

  it("blocks uninspectable and mutating shell behavior in Read only", () => {
    const { frontend, policy } = workspace();
    policy.mode = "read-only";
    for (const command of ["bash -c 'touch file'", "cd $(touch file)", "printf x > ./file", "rg --pre ./script query .", "./cat file"]) {
      expect(evaluateToolCall(policy, tool("bash", { command }), frontend).decision).toBe("deny");
    }
  });

  it("keeps catastrophic denials in Relaxed, including common wrappers", () => {
    const { frontend, policy } = workspace();
    policy.mode = "relaxed";
    for (const command of ["env rm -rf /", "sudo bash -c 'rm -rf /'", "command reboot", "sh -lc 'dd of=/dev/disk0'", "rm -Rf ~"]) {
      expect(evaluateToolCall(policy, tool("bash", { command }), frontend).decision).toBe("deny");
    }
  });

  it("normalizes file-tool paths before checking workspace containment", () => {
    const { parent, frontend, policy } = workspace();
    const external = path.join(parent, "outside file.txt");
    for (const rawPath of ["~/sylph-review.txt", `@${external}`, pathToFileURL(external).href, `@${external.replace(" ", "\u202f")}`]) {
      for (const toolName of ["read", "write", "edit", "grep", "find", "ls"]) {
        expect(evaluateToolCall(policy, tool(toolName, { path: rawPath }), frontend).decision).toBe("ask");
      }
    }
    expect(evaluateToolCall(policy, tool("read", { path: "file:///%ZZ" }), frontend).decision).toBe("deny");
    expect(evaluateToolCall(policy, tool("write", { path: "@./local.txt" }), frontend).decision).toBe("allow");
  });

  it("resolves dangling symlink chains and denies resolution loops", () => {
    const { parent, frontend, policy } = workspace();
    const external = path.join(parent, "missing.txt");
    fs.symlinkSync("../missing.txt", path.join(frontend, "link"));
    fs.symlinkSync("link", path.join(frontend, "chain"));
    const result = evaluateToolCall(policy, tool("write", { path: "chain" }), frontend);
    expect(result.decision).toBe("ask");
    expect(result.intents[0].canonicalPath).toBe(path.join(fs.realpathSync(parent), "missing.txt"));
    fs.symlinkSync("local.txt", path.join(frontend, "local-link"));
    expect(evaluateToolCall(policy, tool("write", { path: "local-link" }), frontend).decision).toBe("allow");
    fs.symlinkSync("loop", path.join(frontend, "loop"));
    expect(evaluateToolCall(policy, tool("write", { path: "loop" }), frontend).decision).toBe("deny");
    expect(fs.existsSync(external)).toBe(false);
  });

  it("checks cd redirections against the directory before cd", () => {
    const { parent, frontend, api, policy } = workspace();
    for (const mode of ["safe", "ai"] as const) {
      for (const redirect of [">", ">>", "<"]) {
        const result = evaluateToolCall({ ...policy, mode }, tool("bash", {
          command: `cd . ${redirect} ${JSON.stringify(path.join(parent, ".env"))}`,
        }), frontend);
        expect(result.decision).toBe("ask");
      }
    }
    const result = evaluateToolCall(policy, tool("bash", { command: `cd ${JSON.stringify(api)} > ./output.txt` }), frontend);
    expect(result.intents.find((intent) => intent.operation === "write")?.canonicalPath)
      .toBe(path.join(fs.realpathSync(frontend), "output.txt"));
    policy.roots[1].access = "read-only";
    expect(evaluateToolCall(policy, tool("bash", { command: `cd . > ${JSON.stringify(path.join(api, "output.txt"))}` }), frontend).decision).toBe("deny");
  });

  it("gates in-place sed edits in Safe only and respects read-only roots", () => {
    const { parent, frontend, api, policy } = workspace();
    policy.mode = "safe";
    for (const flags of ["-i.bak", "-i", "-i ''", "-ni.bak", "--in-place", "--in-place=.bak"]) {
      const command = `sed ${flags} 's/a/b/' ${JSON.stringify(path.join(parent, "outside.txt"))}`;
      const result = evaluateToolCall(policy, tool("bash", { command }), frontend);
      expect(result.decision).toBe("ask");
      expect(result.intents.some((intent) => intent.operation === "write")).toBe(true);
    }
    policy.roots[1].access = "read-only";
    expect(evaluateToolCall(policy, tool("bash", { command: `sed -i.bak 's/a/b/' ${JSON.stringify(path.join(api, "file.txt"))}` }), frontend).decision).toBe("deny");
    expect(evaluateToolCall(policy, tool("bash", { command: "sed -n 's/a/b/p' ./file.txt" }), frontend).decision).toBe("allow");
  });

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

  it("keeps sensitive files and escaping symlinks in loaded skill directories gated", () => {
    const { parent, frontend, policy } = workspace();
    const skillDir = path.join(parent, "external-skill");
    fs.mkdirSync(skillDir);
    const envFile = path.join(skillDir, ".env");
    const outsideFile = path.join(parent, "outside.txt");
    const linkedOutsideFile = path.join(skillDir, "linked-outside.txt");
    fs.writeFileSync(envFile, "TOKEN=secret");
    fs.writeFileSync(outsideFile, "secret");
    fs.symlinkSync(outsideFile, linkedOutsideFile);
    policy.allowedReadRoots = [fs.realpathSync(skillDir)];

    expect(evaluateToolCall(policy, tool("read", { path: envFile }), frontend)).toMatchObject({ decision: "ask" });
    expect(evaluateToolCall(policy, tool("read", { path: linkedOutsideFile }), frontend)).toMatchObject({ decision: "ask" });
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

  it("does not treat numeric route arguments passed to scripts as filesystem paths", () => {
    const { frontend, policy } = workspace();
    const route = evaluateToolCall(policy, tool("bash", { command: "python ./fetch_ids.py /1000" }), frontend);
    expect(route).toMatchObject({ decision: "ask" });
    expect(route.intents.some((intent) => intent.canonicalPath === "/1000")).toBe(false);

    expect(evaluateToolCall(policy, tool("bash", { command: "python /1000" }), frontend)).toMatchObject({ decision: "ask" });
    expect(evaluateToolCall(policy, tool("bash", { command: "cat /1000" }), frontend)).toMatchObject({ decision: "ask" });
  });

  it("treats sed scripts and grep patterns as code, not filesystem paths", () => {
    const { frontend, policy } = workspace();
    const ledger = path.join(frontend, "08.bean");
    fs.writeFileSync(ledger, "2026-08-31 entry\n");

    const section = evaluateToolCall(policy, tool("bash", { command: `sed -n "/1a057c55baba16ce internal/,/^$/p" ${JSON.stringify(ledger)}` }), frontend);
    expect(section).toMatchObject({ decision: "allow" });
    expect(section.intents.some((intent) => intent.canonicalPath?.startsWith("/1a057c55baba16ce"))).toBe(false);
    expect(section.intents.some((intent) => intent.canonicalPath === fs.realpathSync(ledger))).toBe(true);

    const dated = evaluateToolCall(policy, tool("bash", { command: "sed -n '/2026-08-31/,$p' transactions/2026/08.bean" }), frontend);
    expect(dated).toMatchObject({ decision: "ask" });
    expect(dated.intents.some((intent) => intent.canonicalPath === "/2026-08-31/,$p")).toBe(false);

    expect(evaluateToolCall(policy, tool("bash", { command: "sed -e '/x/d' ./08.bean" }), frontend).decision).toBe("allow");
    expect(evaluateToolCall(policy, tool("bash", { command: "grep -m 5 '/etc/host/' ./08.bean" }), frontend).decision).toBe("allow");
    expect(evaluateToolCall(policy, tool("bash", { command: "grep -f /tmp/patterns.txt ./08.bean" }), frontend)).toMatchObject({ decision: "ask" });
  });

  it("applies the bash policy to background commands", () => {
    const { frontend, policy } = workspace();
    const foreground = evaluateToolCall(policy, tool("bash", { command: "git pull" }), frontend);
    const background = evaluateToolCall(policy, tool("bg_run", { name: "Pull changes", command: "git pull" }), frontend);
    expect(background).toEqual(foreground);
    expect(evaluateToolCall(policy, tool("bg_run", { name: "Unsafe", command: "rm -rf /" }), frontend)).toMatchObject({ decision: "deny" });
    expect(evaluateToolCall(policy, tool("bg_status", {}), frontend)).toMatchObject({
      decision: "allow", reason: "tool has no filesystem access intent",
    });
  });

  it("implements all four modes", () => {
    const { parent, frontend, policy } = workspace();
    const external = path.join(parent, "notes.txt");
    for (const mode of ["read-only", "safe", "ai", "relaxed"] as const) {
      const selected = { ...policy, mode };
      expect(evaluateToolCall(selected, tool("read", { path: "./file.txt" }), frontend).decision).toBe("allow");
      expect(evaluateToolCall(selected, tool("write", { path: "./file.txt" }), frontend).decision).toBe(mode === "read-only" ? "deny" : "allow");
      expect(evaluateToolCall(selected, tool("write", { path: external }), frontend).decision).toBe(mode === "read-only" ? "deny" : mode === "relaxed" ? "allow" : "ask");
      expect(evaluateToolCall(selected, tool("bash", { command: "cat ./file.txt" }), frontend).decision).toBe("allow");
      expect(evaluateToolCall(selected, tool("bash", { command: "rm ./file.txt" }), frontend).decision).toBe(mode === "read-only" ? "deny" : mode === "relaxed" ? "allow" : "ask");
      expect(evaluateToolCall(selected, tool("bash", { command: "rm -rf /" }), frontend).decision).toBe("deny");
      expect(evaluateToolCall(selected, tool("create_schedule", { name: "Later" }), frontend).decision).toBe(mode === "read-only" ? "deny" : mode === "relaxed" ? "allow" : "ask");
    }
    for (const command of ["git push --force origin main", "chmod 777 ./script.sh", "sed -i.bak 's/a/b/' /tmp/file", "sudo touch /tmp/file"]) {
      expect(evaluateToolCall({ ...policy, mode: "relaxed" }, tool("bash", { command }), frontend).decision).toBe("allow");
    }
    expect(evaluateToolCall({ ...policy, mode: "relaxed" }, tool("read", { path: "/tmp/.env" }), frontend).decision).toBe("allow");
  });

  it("asks for network, destructive, and opaque shell commands", () => {
    const { frontend, policy } = workspace();
    expect(evaluateToolCall(policy, tool("bash", { command: "curl https://example.com" }), frontend).decision).toBe("ask");
    expect(evaluateToolCall(policy, tool("bash", { command: "wget https://example.com" }), frontend).decision).toBe("ask");
    expect(evaluateToolCall(policy, tool("bash", { command: "rm ./file.txt" }), frontend).decision).toBe("ask");
    expect(evaluateToolCall(policy, tool("bash", { command: "rm -rf ./dist" }), frontend).decision).toBe("ask");
    expect(evaluateToolCall(policy, tool("bash", { command: "git pull" }), frontend).decision).toBe("ask");
    expect(evaluateToolCall(policy, tool("bash", { command: "bash -c 'cat /tmp/x'" }), frontend).decision).toBe("ask");
    expect(evaluateToolCall(policy, tool("bash", { command: "cat \"$FILE\"" }), frontend).decision).toBe("ask");
    expect(evaluateToolCall(policy, tool("bash", { command: "cd \"$DIR\" && cat file" }), frontend).decision).toBe("ask");
    expect(evaluateToolCall(policy, tool("bash", { command: "cat `printf /tmp/secret`" }), frontend).decision).toBe("ask");
  });

  it("allows scratch writes but asks before cleanup", () => {
    const { parent, frontend, policy } = workspace();
    const scratch = path.join(parent, "scratch");
    fs.mkdirSync(scratch);
    policy.roots.push({ id: "scratch", name: "session scratch", path: scratch, temporary: true });
    policy.shellEnvironment = { TMPDIR: scratch, SYLPH_SCRATCH_DIR: scratch };

    expect(evaluateToolCall(policy, tool("bash", { command: "printf data > \"$TMPDIR/result.txt\"" }), frontend).decision).toBe("allow");
    expect(evaluateToolCall(policy, tool("bash", { command: "rm -rf \"$SYLPH_SCRATCH_DIR/job\"" }), frontend).decision).toBe("ask");
    expect(evaluateToolCall(policy, tool("bash", { command: "rm -rf \"$SYLPH_SCRATCH_DIR\"" }), frontend).decision).toBe("ask");
    expect(evaluateToolCall(policy, tool("bash", { command: "rm -rf ./dist" }), frontend).decision).toBe("ask");
    expect(evaluateToolCall(policy, tool("bash", { command: "cat \"$UNKNOWN\"" }), frontend).decision).toBe("ask");
  });

  it("denies catastrophic commands but asks before non-catastrophic destructive actions", () => {
    const { frontend, policy } = workspace();
    expect(evaluateToolCall(policy, tool("bash", { command: "shutdown -h now" }), frontend).decision).toBe("deny");
    expect(evaluateToolCall(policy, tool("bash", { command: "rm -rf /" }), frontend).decision).toBe("deny");
    expect(evaluateToolCall(policy, tool("bash", { command: ":(){:|:&};:" }), frontend).decision).toBe("deny");
    expect(evaluateToolCall(policy, tool("bash", { command: "git push --force origin main" }), frontend).decision).toBe("ask");
    expect(evaluateToolCall(policy, tool("bash", { command: "dd if=/dev/zero of=/dev/disk0" }), frontend).decision).toBe("deny");
    expect(evaluateToolCall(policy, tool("bash", { command: "chmod 777 ./script.sh" }), frontend).decision).toBe("ask");
  });

  it("asks for unknown custom tools with input-scoped approval keys", () => {
    const { frontend, policy } = workspace();
    const production = evaluateToolCall(policy, tool("deploy", { target: "production" }), frontend);
    const staging = evaluateToolCall(policy, tool("deploy", { target: "staging" }), frontend);
    expect(production.decision).toBe("ask");
    expect(production.approvalKey).not.toBe(staging.approvalKey);
    expect(production.approvalKey).not.toContain("production");
  });

  it("parses command chains, newlines, control-flow bodies, and opaque expansions", () => {
    expect(parseCommandUnits("cd api && npm test").units).toHaveLength(2);
    expect(parseCommandUnits("echo one\necho two").units.map((unit) => unit.command)).toEqual(["echo", "echo"]);
    const loop = parseCommandUnits("for f in *.txt; do cat \"$f\"; done\necho complete");
    expect(loop.units.map((unit) => unit.command)).toEqual(["cat", "echo"]);
    expect(loop.opaque).toBe(true);

    const virtualenv = parseCommandUnits(`cd /workspace
.venv/bin/bean-check main.bean
for f in projection-*.bean; do .venv/bin/bean-check "$f"; done
.venv/bin/python -m beanquery.main`);
    expect(virtualenv.units.map((unit) => unit.command)).toEqual([
      "cd", ".venv/bin/bean-check", ".venv/bin/bean-check", ".venv/bin/python",
    ]);
    expect(parseCommandUnits("echo $(cat /tmp/secret)").opaque).toBe(true);
  });

});
