import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { parse } from "shell-quote";
import type { ExtensionAPI, ExtensionFactory, ToolCallEvent } from "@earendil-works/pi-coding-agent";

export type PermissionDecision = "allow" | "ask" | "deny";
export type AccessOperation = "read" | "write" | "execute" | "delete" | "network";

export interface PermissionRoot {
  id: string;
  name: string;
  path: string;
  access?: "read-write" | "read-only";
  /** Ephemeral root where routine cleanup is safe without confirmation. */
  temporary?: boolean;
}

export interface PermissionPolicy {
  roots: PermissionRoot[];
  externalAccess?: Exclude<PermissionDecision, "allow">;
  /** Trusted variables injected into shell processes and safe to expand for path analysis. */
  shellEnvironment?: Record<string, string>;
}

interface AccessIntent {
  operation: AccessOperation;
  lexicalPath?: string;
  canonicalPath?: string;
  root?: PermissionRoot;
  reason?: string;
  decision: PermissionDecision;
}

interface Evaluation {
  decision: PermissionDecision;
  reason: string;
  summary: string;
  approvalKey: string;
  intents: AccessIntent[];
}

const PATH_TOOLS = new Set(["read", "write", "edit", "grep", "find", "ls"]);
const READ_TOOLS = new Set(["read", "grep", "find", "ls"]);
const SENSITIVE_BASENAMES = new Set([".netrc", ".npmrc", ".pypirc"]);
const SENSITIVE_PATH_PARTS = new Set([".ssh", ".aws", ".gnupg", ".kube"]);
const SENSITIVE_EXTENSIONS = new Set([".pem", ".key", ".p12", ".pfx"]);
const NETWORK_COMMANDS = new Set(["curl", "wget", "ssh", "scp", "sftp", "rsync"]);
const ELEVATED_COMMANDS = new Set(["sudo", "su", "doas"]);
const DESTRUCTIVE_COMMANDS = new Set(["rm", "rmdir", "mv", "cp", "chmod", "chown", "install", "dd"]);
const SHELL_WRAPPERS = new Set(["sh", "bash", "zsh", "dash", "ksh", "eval"]);
const SHELL_OPERATORS = new Set(["&&", "||", ";", "|", "&"]);
const SAFE_DEVICES = new Set(["/dev/null", "/dev/stdin", "/dev/stdout", "/dev/stderr"]);

function canonicalizeExistingPrefix(value: string): string {
  let current = path.resolve(value);
  const suffix: string[] = [];
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(value);
    suffix.unshift(path.basename(current));
    current = parent;
  }
  try { current = fs.realpathSync(current); } catch { /* lexical fallback */ }
  return path.resolve(current, ...suffix);
}

function isWithin(root: string, target: string) {
  const relative = path.relative(root, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function normalizeRoots(roots: PermissionRoot[]) {
  return roots.map((root) => ({ ...root, path: canonicalizeExistingPrefix(root.path) }));
}

function rootForPath(roots: PermissionRoot[], canonicalPath: string) {
  return roots
    .filter((root) => isWithin(root.path, canonicalPath))
    .sort((a, b) => b.path.length - a.path.length)[0];
}

function sensitivePathReason(filePath: string): string | undefined {
  const normalized = filePath.split(path.sep).filter(Boolean);
  const basename = path.basename(filePath).toLowerCase();
  const extension = path.extname(basename).toLowerCase();
  if (basename === ".env" || basename.startsWith(".env.")) {
    if (basename === ".env.example" || basename === ".env.sample") return undefined;
    return "sensitive environment file";
  }
  if (SENSITIVE_BASENAMES.has(basename) || SENSITIVE_EXTENSIONS.has(extension)) return "sensitive credential file";
  if (/^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i.test(basename)) return "SSH key material";
  if (normalized.some((part) => SENSITIVE_PATH_PARTS.has(part.toLowerCase()))) return "sensitive credential directory";
  return undefined;
}

function combineDecision(intents: AccessIntent[]): PermissionDecision {
  return intents.some((intent) => intent.decision === "deny")
    ? "deny"
    : intents.some((intent) => intent.decision === "ask")
      ? "ask"
      : "allow";
}

function describeIntent(intent: AccessIntent) {
  const operation = intent.operation.toUpperCase().padEnd(7);
  const root = intent.root ? `[${intent.root.name}] ` : "[external] ";
  return `${operation} ${root}${intent.lexicalPath ?? intent.reason ?? ""}`;
}

function evaluatePath(policy: PermissionPolicy, operation: AccessOperation, rawPath: string, cwd: string): AccessIntent {
  const lexicalPath = path.resolve(cwd, rawPath);
  const canonicalPath = canonicalizeExistingPrefix(lexicalPath);
  const roots = normalizeRoots(policy.roots);
  const root = rootForPath(roots, canonicalPath);
  if (!root) {
    return {
      operation, lexicalPath, canonicalPath,
      decision: policy.externalAccess ?? "ask",
      reason: "path is outside every workspace root",
    };
  }
  if (root.access === "read-only" && operation !== "read") {
    return { operation, lexicalPath, canonicalPath, root, decision: "deny", reason: `workspace root ${root.name} is read-only` };
  }
  const sensitive = sensitivePathReason(canonicalPath);
  return {
    operation, lexicalPath, canonicalPath, root,
    decision: sensitive ? "ask" : "allow",
    reason: sensitive,
  };
}

function pathLooksExplicit(token: string) {
  if (!token || token === "-" || token.startsWith("--") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) return false;
  const basename = path.basename(token).toLowerCase();
  const sensitiveBareName = basename === ".env" || basename.startsWith(".env.")
    || SENSITIVE_BASENAMES.has(basename) || SENSITIVE_EXTENSIONS.has(path.extname(basename).toLowerCase())
    || /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i.test(basename);
  return sensitiveBareName || token.startsWith("/") || token.startsWith("./") || token.startsWith("../") || token === "." || token === ".." || token.includes("/") || token.startsWith("~");
}

function expandHome(token: string) {
  if (token === "~") return process.env.HOME || token;
  if (token.startsWith("~/")) return path.join(process.env.HOME || "~", token.slice(2));
  return token;
}

function commandName(token: string) {
  return path.basename(token).toLowerCase();
}

interface CommandUnit {
  command: string;
  args: string[];
  redirections: Array<{ operation: "read" | "write"; path: string }>;
}

export function parseCommandUnits(command: string, trustedEnvironment: Record<string, string> = {}): { units: CommandUnit[]; opaque: boolean; unparseable: boolean } {
  try {
    // Expand only environment values injected by Sylph. Unknown variables and
    // command substitutions remain opaque so `cat "$FILE"` cannot disappear
    // from path analysis. Escaped dollars are literals.
    const dynamicPattern = /(^|[^\\])\$(?:([A-Za-z_][A-Za-z0-9_]*)|\{([A-Za-z_][A-Za-z0-9_]*)\}|\()|`/g;
    let hasDynamicExpansion = false;
    for (const match of command.matchAll(dynamicPattern)) {
      const variable = match[2] || match[3];
      if (!variable || trustedEnvironment[variable] === undefined) { hasDynamicExpansion = true; break; }
    }
    const tokens = parse(command, trustedEnvironment);
    const units: CommandUnit[] = [];
    let current: string[] = [];
    let redirections: CommandUnit["redirections"] = [];
    let pendingRedirection: "read" | "write" | undefined;
    let opaque = hasDynamicExpansion;
    const flush = () => {
      if (pendingRedirection) { opaque = true; pendingRedirection = undefined; }
      const words = [...current];
      // Environment assignments are prefixes only before the command; values
      // like dd's `of=/dev/disk0` are real arguments and must remain visible.
      while (words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words.shift();
      if (words.length) units.push({ command: words[0], args: words.slice(1), redirections });
      current = [];
      redirections = [];
    };
    for (const token of tokens) {
      if (typeof token === "string") {
        if (pendingRedirection) {
          redirections.push({ operation: pendingRedirection, path: token });
          pendingRedirection = undefined;
        } else if (SHELL_OPERATORS.has(token)) flush();
        else current.push(token);
      } else {
        const operator = typeof (token as any).op === "string" ? (token as any).op : "";
        if (SHELL_OPERATORS.has(operator)) flush();
        else if ([">", ">>", ">&"].includes(operator)) pendingRedirection = "write";
        else if (operator === "<") pendingRedirection = "read";
        else opaque = true;
      }
    }
    flush();
    for (const unit of units) {
      const name = commandName(unit.command);
      if (SHELL_WRAPPERS.has(name) && (name === "eval" || unit.args.includes("-c"))) opaque = true;
    }
    return { units, opaque, unparseable: command.trim().length > 0 && units.length === 0 };
  } catch {
    return { units: [], opaque: false, unparseable: command.trim().length > 0 };
  }
}

function evaluateBash(policy: PermissionPolicy, command: string, cwd: string): Evaluation {
  const parsed = parseCommandUnits(command, policy.shellEnvironment);
  const intents: AccessIntent[] = [];
  let effectiveCwd = cwd;
  let commandDecision: PermissionDecision = "allow";
  const commandReasons: string[] = [];

  if (command.replace(/\s+/g, "") === ":(){:|:&};:") {
    commandDecision = "deny";
    commandReasons.push("fork bomb is denied");
  }
  if (parsed.unparseable) {
    if (commandDecision !== "deny") commandDecision = "ask";
    commandReasons.push("shell command could not be safely parsed");
  }
  if (parsed.opaque) {
    if (commandDecision !== "deny") commandDecision = "ask";
    commandReasons.push("opaque shell expansion or wrapper requires confirmation");
  }

  for (const unit of parsed.units) {
    const name = commandName(unit.command);
    if (name === "cd") {
      const target = unit.args[0] || process.env.HOME;
      if (target) {
        const intent = evaluatePath(policy, "execute", expandHome(target), effectiveCwd);
        intents.push(intent);
        effectiveCwd = intent.lexicalPath || effectiveCwd;
      }
      continue;
    }
    if (ELEVATED_COMMANDS.has(name)) {
      if (commandDecision !== "deny") commandDecision = "ask";
      commandReasons.push(`elevated command ${name}`);
    }
    if (DESTRUCTIVE_COMMANDS.has(name) && commandDecision !== "deny") {
      const cleanupTargets = (name === "rm" || name === "rmdir")
        ? unit.args.filter((arg) => !arg.startsWith("-") && pathLooksExplicit(arg)).map((arg) =>
            evaluatePath(policy, "delete", expandHome(arg.replace(/^file:\/\//, "")), effectiveCwd))
        : [];
      const routineScratchCleanup = cleanupTargets.length > 0 && cleanupTargets.every((intent) =>
        intent.decision === "allow" && intent.root?.temporary === true && intent.canonicalPath !== intent.root.path);
      if (!routineScratchCleanup) {
        commandDecision = "ask";
        commandReasons.push(`destructive command ${name}`);
      }
    }
    if (NETWORK_COMMANDS.has(name)) {
      if (commandDecision !== "deny") commandDecision = "ask";
      commandReasons.push(`network command ${name}`);
    }
    if (name === "git") {
      const subcommand = unit.args.find((arg) => !arg.startsWith("-"));
      if (["fetch", "pull", "push", "clone"].includes(subcommand || "") && commandDecision !== "deny") {
        commandDecision = "ask";
        commandReasons.push(`networked Git operation ${subcommand}`);
      }
      if (["clean"].includes(subcommand || "") || (subcommand === "reset" && unit.args.includes("--hard"))) {
        if (commandDecision !== "deny") commandDecision = "ask";
        commandReasons.push(`destructive Git operation ${subcommand}`);
      }
      if (subcommand === "push" && unit.args.some((arg) => arg === "-f" || arg.startsWith("--force"))) {
        commandDecision = "deny";
        commandReasons.push("force-push is denied by default");
      }
    }
    if (["shutdown", "reboot", "halt", "poweroff", "mkfs"].some((dangerous) => name.startsWith(dangerous))) {
      commandDecision = "deny";
      commandReasons.push(`catastrophic command ${name}`);
    }
    if (name === "dd" && unit.args.some((arg) => /^of=\/dev\//.test(arg))) {
      commandDecision = "deny";
      commandReasons.push("raw device overwrite");
    }
    if ((name === "chmod" || name === "chown") && unit.args.some((arg) => arg === "777")) {
      commandDecision = "deny";
      commandReasons.push(`${name} 777 is denied by default`);
    }
    if (name === "rm" && unit.args.some((arg) => /^-[^-]*r/.test(arg) || arg === "--recursive")) {
      const targets = unit.args.filter((arg) => !arg.startsWith("-"));
      if (targets.some((target) => ["/", "~", "$HOME", "${HOME}"].includes(target))) {
        commandDecision = "deny";
        commandReasons.push("recursive deletion of a filesystem/home root is denied");
      } else {
        const targetIntents = targets.filter(pathLooksExplicit).map((target) =>
          evaluatePath(policy, "delete", expandHome(target.replace(/^file:\/\//, "")), effectiveCwd));
        const routineScratchCleanup = targetIntents.length > 0 && targetIntents.every((intent) =>
          intent.decision === "allow" && intent.root?.temporary === true && intent.canonicalPath !== intent.root.path);
        if (!routineScratchCleanup) {
          if (commandDecision !== "deny") commandDecision = "ask";
          commandReasons.push("recursive deletion");
        }
      }
    }

    for (const redirection of unit.redirections) {
      if (!pathLooksExplicit(redirection.path)) continue;
      const expanded = expandHome(redirection.path.replace(/^file:\/\//, ""));
      if (SAFE_DEVICES.has(expanded)) continue;
      intents.push(evaluatePath(policy, redirection.operation, expanded, effectiveCwd));
    }

    const operation: AccessOperation = DESTRUCTIVE_COMMANDS.has(name) ? (name === "rm" || name === "rmdir" ? "delete" : "write") : "read";
    for (const arg of unit.args) {
      if (!pathLooksExplicit(arg)) continue;
      const expanded = expandHome(arg.replace(/^file:\/\//, ""));
      if (SAFE_DEVICES.has(expanded)) continue;
      intents.push(evaluatePath(policy, operation, expanded, effectiveCwd));
    }
  }

  const pathDecision = combineDecision(intents);
  const decision: PermissionDecision = commandDecision === "deny" || pathDecision === "deny"
    ? "deny"
    : commandDecision === "ask" || pathDecision === "ask"
      ? "ask"
      : "allow";
  const reasons = [...commandReasons, ...intents.filter((intent) => intent.decision !== "allow").map((intent) => intent.reason!).filter(Boolean)];
  return {
    decision,
    reason: reasons.join("; ") || "allowed by workspace policy",
    summary: [`Command: ${command}`, ...intents.map(describeIntent)].join("\n"),
    approvalKey: `bash:${command}`,
    intents,
  };
}

export function evaluateToolCall(policy: PermissionPolicy, event: Pick<ToolCallEvent, "toolName" | "input">, cwd: string): Evaluation {
  if (event.toolName === "bash") return evaluateBash(policy, String((event.input as any).command ?? ""), cwd);

  let rawPath: unknown;
  if (PATH_TOOLS.has(event.toolName)) rawPath = (event.input as any).path ?? ".";
  else if (typeof (event.input as any).path === "string") rawPath = (event.input as any).path;
  else if (typeof (event.input as any).arguments?.path === "string") rawPath = (event.input as any).arguments.path;
  if (typeof rawPath !== "string") {
    const builtInOrKnown = PATH_TOOLS.has(event.toolName) || event.toolName === "ask_user_question";
    const serialized = JSON.stringify(event.input ?? {});
    const fingerprint = createHash("sha256").update(serialized).digest("hex").slice(0, 16);
    const preview = serialized.length > 300 ? `${serialized.slice(0, 300)}…` : serialized;
    return {
      decision: builtInOrKnown ? "allow" : "ask",
      reason: builtInOrKnown ? "tool has no filesystem access intent" : "custom tool access cannot be fully inspected",
      summary: `Tool: ${event.toolName}${builtInOrKnown ? "" : `\nInput: ${preview}`}`,
      // Input-specific and hashed: a session grant cannot authorize every
      // future invocation of a custom tool, and raw arguments are not persisted.
      approvalKey: `tool:${event.toolName}:${fingerprint}`,
      intents: [],
    };
  }

  const operation: AccessOperation = READ_TOOLS.has(event.toolName) ? "read" : "write";
  const intent = evaluatePath(policy, operation, rawPath, cwd);
  return {
    decision: intent.decision,
    reason: intent.reason || "allowed by workspace policy",
    summary: `Tool: ${event.toolName}\n${describeIntent(intent)}${intent.canonicalPath !== intent.lexicalPath ? `\nResolved: ${intent.canonicalPath}` : ""}`,
    approvalKey: `${event.toolName}:${intent.root?.id ?? "external"}:${intent.canonicalPath}`,
    intents: [intent],
  };
}

export interface PermissionExtensionOptions {
  initialApprovals?: string[];
  onApproval?: (approvalKey: string) => void;
  audit?: (event: { at: string; decision: PermissionDecision | "approved_for_session"; tool: string; reason: string; summary: string; approvalKey: string }) => void;
}

export function createPermissionExtension(policy: PermissionPolicy, options: PermissionExtensionOptions = {}): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    const sessionApprovals = new Set(options.initialApprovals ?? []);
    pi.on("tool_call", async (event, ctx) => {
      const evaluation = evaluateToolCall(policy, event, ctx.cwd);
      const audit = (decision: PermissionDecision | "approved_for_session") => options.audit?.({
        at: new Date().toISOString(), decision, tool: event.toolName,
        reason: evaluation.reason, summary: evaluation.summary, approvalKey: evaluation.approvalKey,
      });
      // Routine policy allows are intentionally not logged: tool inputs can
      // contain secrets and an audit trail should record reviewed/blocked
      // access, not become a second copy of every command and file path.
      if (evaluation.decision === "allow") return undefined;
      if (sessionApprovals.has(evaluation.approvalKey)) { audit("approved_for_session"); return undefined; }
      if (evaluation.decision === "deny") {
        audit("deny");
        return { block: true, reason: `[Sylph permission] ${evaluation.reason}` };
      }
      if (!ctx.hasUI) {
        audit("deny");
        return { block: true, reason: `[Sylph permission] Confirmation unavailable: ${evaluation.reason}` };
      }

      const sessionOption = `Allow matching access for this session`;
      const choice = await ctx.ui.select(
        `Permission required\n${evaluation.summary}\n\nReason: ${evaluation.reason}`,
        ["Allow once", sessionOption, "Deny", "Deny with reason"],
      );
      if (choice === "Allow once") { audit("allow"); return undefined; }
      if (choice === sessionOption) {
        sessionApprovals.add(evaluation.approvalKey);
        options.onApproval?.(evaluation.approvalKey);
        audit("approved_for_session");
        return undefined;
      }
      if (choice === "Deny with reason") {
        const reason = await ctx.ui.input("Why should this operation be denied?", "Reason shown to the agent");
        audit("deny");
        return { block: true, reason: `[Sylph permission] Denied by user${reason?.trim() ? `: ${reason.trim()}` : ""}` };
      }
      audit("deny");
      return { block: true, reason: "[Sylph permission] Denied by user" };
    });
  };
}

export function isThirdPartyPermissionExtension(extension: { path?: string; resolvedPath?: string }) {
  const identity = `${extension.path ?? ""}\n${extension.resolvedPath ?? ""}`;
  return identity.includes("@gotgenes/pi-permission-system") || identity.includes("pi-permission-system/src/index.ts");
}
