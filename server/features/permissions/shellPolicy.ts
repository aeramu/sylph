import path from "node:path";
import { canonicalizeExistingPrefix, combineDecision, describeIntent, evaluatePath, expandHome, isWithin } from "./pathPolicy.ts";
import { commandName, parseCommandUnits, pathLooksExplicit } from "./shellParser.ts";
import type { AccessIntent, AccessOperation, PermissionDecision, PermissionEvaluation, PermissionPolicy } from "./permissionTypes.ts";

const NETWORK_COMMANDS = new Set(["wget", "ssh", "scp", "sftp", "rsync"]);
const ELEVATED_COMMANDS = new Set(["sudo", "su", "doas"]);
const DESTRUCTIVE_COMMANDS = new Set(["rm", "rmdir", "mv", "cp", "chmod", "chown", "install", "dd"]);
const SCRIPT_INTERPRETERS = new Set(["sh", "bash", "zsh", "dash", "ksh", "node", "python", "python3", "ruby", "perl", "php"]);
const SAFE_DEVICES = new Set(["/dev/null", "/dev/stdin", "/dev/stdout", "/dev/stderr"]);

export function evaluateBash(policy: PermissionPolicy, command: string, cwd: string): PermissionEvaluation {
  const parsed = parseCommandUnits(command, policy.shellEnvironment);
  const intents: AccessIntent[] = [];
  let effectiveCwd = cwd;
  let commandDecision: PermissionDecision = "allow";
  const commandReasons: string[] = [];
  let denied = false;
  let asked = false;
  const ask = (reason: string) => { if (!denied) asked = true; commandReasons.push(reason); };
  const deny = (reason: string) => { denied = true; commandReasons.push(reason); };

  if (command.replace(/\s+/g, "") === ":(){:|:&};:") deny("fork bomb is denied");
  if (parsed.unparseable) ask("shell command could not be safely parsed");

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
    if (pathLooksExplicit(unit.command)) {
      const commandPath = expandHome(unit.command.replace(/^file:\/\//, ""));
      const absolute = canonicalizeExistingPrefix(path.resolve(effectiveCwd, commandPath));
      const inReadRoot = Array.from(policy.allowedReadRoots ?? []).some((root) => isWithin(path.resolve(root), absolute));
      if (inReadRoot) intents.push(evaluatePath(policy, "execute", commandPath, effectiveCwd));
    }
    if (ELEVATED_COMMANDS.has(name)) ask(`elevated command ${name}`);
    if (DESTRUCTIVE_COMMANDS.has(name)) {
      const cleanupTargets = (name === "rm" || name === "rmdir")
        ? unit.args.filter((arg) => !arg.startsWith("-") && pathLooksExplicit(arg))
          .map((arg) => evaluatePath(policy, "delete", expandHome(arg.replace(/^file:\/\//, "")), effectiveCwd))
        : [];
      const scratchCleanup = cleanupTargets.length > 0 && cleanupTargets.every((intent) =>
        intent.decision === "allow" && intent.root?.temporary && intent.canonicalPath !== intent.root.path);
      if (!scratchCleanup) ask(`destructive command ${name}`);
    }
    if (NETWORK_COMMANDS.has(name)) ask(`network command ${name}`);
    if (name === "git") {
      const subcommand = unit.args.find((arg) => !arg.startsWith("-"));
      if (["fetch", "pull", "push", "clone"].includes(subcommand || "")) ask(`networked Git operation ${subcommand}`);
      if (subcommand === "clean" || (subcommand === "reset" && unit.args.includes("--hard"))) ask(`destructive Git operation ${subcommand}`);
      if (subcommand === "push" && unit.args.some((arg) => arg === "-f" || arg.startsWith("--force"))) deny("force-push is denied by default");
    }
    if (["shutdown", "reboot", "halt", "poweroff", "mkfs"].some((dangerous) => name.startsWith(dangerous))) deny(`catastrophic command ${name}`);
    if (name === "dd" && unit.args.some((arg) => /^of=\/dev\//.test(arg))) deny("raw device overwrite");
    if ((name === "chmod" || name === "chown") && unit.args.includes("777")) deny(`${name} 777 is denied by default`);
    if (name === "rm" && unit.args.some((arg) => /^-[^-]*r/.test(arg) || arg === "--recursive")) {
      const targets = unit.args.filter((arg) => !arg.startsWith("-"));
      if (targets.some((target) => ["/", "~", "$HOME", "${HOME}"].includes(target))) deny("recursive deletion of a filesystem/home root is denied");
      else {
        const targetIntents = targets.filter(pathLooksExplicit)
          .map((target) => evaluatePath(policy, "delete", expandHome(target.replace(/^file:\/\//, "")), effectiveCwd));
        const scratchCleanup = targetIntents.length > 0 && targetIntents.every((intent) =>
          intent.decision === "allow" && intent.root?.temporary && intent.canonicalPath !== intent.root.path);
        if (!scratchCleanup) ask("recursive deletion");
      }
    }
    for (const redirection of unit.redirections) {
      if (!pathLooksExplicit(redirection.path)) continue;
      const expanded = expandHome(redirection.path.replace(/^file:\/\//, ""));
      if (!SAFE_DEVICES.has(expanded)) intents.push(evaluatePath(policy, redirection.operation, expanded, effectiveCwd));
    }
    const operation: AccessOperation = DESTRUCTIVE_COMMANDS.has(name) ? (name === "rm" || name === "rmdir" ? "delete" : "write") : "read";
    for (const arg of unit.args) {
      if (!pathLooksExplicit(arg)) continue;
      const expanded = expandHome(arg.replace(/^file:\/\//, ""));
      if (SAFE_DEVICES.has(expanded)) continue;
      intents.push(evaluatePath(policy, operation === "read" && SCRIPT_INTERPRETERS.has(name) ? "execute" : operation, expanded, effectiveCwd));
    }
  }

  const pathDecision = combineDecision(intents);
  commandDecision = denied ? "deny" : asked ? "ask" : "allow";
  const decision = commandDecision === "deny" || pathDecision === "deny" ? "deny"
    : commandDecision === "ask" || pathDecision === "ask" ? "ask" : "allow";
  const reasons = [...commandReasons, ...intents.filter((intent) => intent.decision !== "allow").map((intent) => intent.reason!).filter(Boolean)];
  return {
    decision,
    reason: reasons.join("; ") || "allowed by workspace policy",
    summary: [`Command: ${command}`, ...intents.map(describeIntent)].join("\n"),
    approvalKey: `bash:${command}`,
    intents,
  };
}
