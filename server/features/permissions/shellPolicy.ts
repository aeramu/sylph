import path from "node:path";
import { catastrophicCommandReason } from "./catastrophicPolicy.ts";
import { createHash } from "node:crypto";
import { canonicalizeExistingPrefix, combineDecision, describeIntent, evaluatePath, expandHome, isWithin } from "./pathPolicy.ts";
import { commandName, parseCommandUnits, pathLooksExplicit } from "./shellParser.ts";
import type { AccessIntent, AccessOperation, PermissionDecision, PermissionEvaluation, PermissionPolicy } from "./permissionTypes.ts";

const NETWORK_COMMANDS = new Set(["wget", "ssh", "scp", "sftp", "rsync"]);
const ELEVATED_COMMANDS = new Set(["sudo", "su", "doas"]);
const DESTRUCTIVE_COMMANDS = new Set(["rm", "rmdir", "mv", "cp", "chmod", "chown", "install", "dd"]);
const WRITE_COMMANDS = new Set(["touch", "mkdir", "mktemp", "truncate", "tee", "ln"]);
const SCRIPT_INTERPRETERS = new Set(["sh", "bash", "zsh", "dash", "ksh", "node", "python", "python3", "ruby", "perl", "php"]);
const SAFE_DEVICES = new Set(["/dev/null", "/dev/stdin", "/dev/stdout", "/dev/stderr"]);
// Text-processing commands whose first non-flag argument is an inline script or search
// pattern rather than a filesystem path. Flag values are classified so that expression
// values are never mistaken for path operands, while file-valued flags stay checked.
const COMMAND_FLAG_KINDS: Record<string, Record<string, "expression" | "file" | "value">> = {
  sed: { "-e": "expression", "--expression": "expression", "-f": "file", "--file": "file", "-l": "value" },
  awk: {
    "-f": "file", "--file": "file", "-i": "file", "--include": "file", "-E": "file", "--exec": "file",
    "-e": "expression", "--source": "expression",
    "-F": "value", "--field-separator": "value", "-v": "value", "--assign": "value", "-W": "value",
  },
  grep: {
    "-e": "expression", "--regexp": "expression", "-f": "file", "--file": "file",
    "-m": "value", "--max-count": "value", "-A": "value", "-B": "value", "-C": "value",
    "--after-context": "value", "--before-context": "value", "--context": "value",
    "-d": "value", "--directories": "value", "-D": "value", "--devices": "value",
    "--include": "value", "--exclude": "value", "--exclude-dir": "value", "--label": "value",
    "--separator": "value", "--group-separator": "value", "--color": "value", "--colour": "value",
  },
};
COMMAND_FLAG_KINDS.gawk = COMMAND_FLAG_KINDS.awk;
COMMAND_FLAG_KINDS.mawk = COMMAND_FLAG_KINDS.awk;
COMMAND_FLAG_KINDS.egrep = COMMAND_FLAG_KINDS.grep;
COMMAND_FLAG_KINDS.fgrep = COMMAND_FLAG_KINDS.grep;

function gitSubcommand(args: string[]): string | undefined {
  const optionsWithValues = new Set([
    "-C", "-c", "--git-dir", "--work-tree", "--namespace", "--super-prefix", "--config-env",
  ]);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const option = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    if (optionsWithValues.has(option)) {
      if (arg === option) index++;
      continue;
    }
    if (arg.startsWith("-")) continue;
    return arg;
  }
  return undefined;
}

/** Argument indexes that hold inline scripts or search patterns rather than filesystem paths. */
function inlineScriptExemptions(name: string, args: string[]): Set<number> {
  const flagKinds = COMMAND_FLAG_KINDS[name];
  const exempt = new Set<number>();
  if (!flagKinds) return exempt;
  const flagOf = (token: string): [string, string | undefined] => {
    if (token.startsWith("--")) {
      const equals = token.indexOf("=");
      if (equals > 0) return [token.slice(0, equals), token.slice(equals + 1)];
      return [token, undefined];
    }
    for (const flag of Object.keys(flagKinds)) {
      if (flag.length === 2 && token.startsWith(flag) && token.length > flag.length) return [flag, token.slice(2)];
    }
    return [token, undefined];
  };
  let operandsAreFiles = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--") break;
    if (!arg.startsWith("-") || arg === "-") {
      if (!operandsAreFiles) exempt.add(index);
      break;
    }
    const [flag, boundValue] = flagOf(arg);
    const kind = flagKinds[flag];
    if (!kind) continue;
    if (boundValue !== undefined) {
      if (kind !== "file") exempt.add(index);
    } else if (index + 1 < args.length) {
      if (kind !== "file") exempt.add(index + 1);
      index++;
    }
    if (kind !== "value") operandsAreFiles = true;
  }
  return exempt;
}

export function evaluateBash(policy: PermissionPolicy, command: string, cwd: string): PermissionEvaluation {
  const catastrophic = catastrophicCommandReason(command, cwd, policy.shellEnvironment);
  if (catastrophic || policy.mode === "relaxed") return {
    decision: catastrophic ? "deny" : "allow", reason: catastrophic ?? "Relaxed allows non-catastrophic commands",
    summary: `Command: ${command}`, approvalKey: `relaxed:${command}`, intents: [],
  };
  const parsed = parseCommandUnits(command, policy.shellEnvironment);
  const mode = policy.mode ?? "safe";
  const intents: AccessIntent[] = [];
  let effectiveCwd = cwd;
  let commandDecision: PermissionDecision = "allow";
  const commandReasons: string[] = [];
  let denied = false;
  let asked = false;
  const ask = (reason: string) => { if (!denied) asked = true; commandReasons.push(reason); };
  const deny = (reason: string) => { denied = true; commandReasons.push(reason); };

  if (command.replace(/\s+/g, "") === ":(){:|:&};:") deny("fork bomb is denied");
  if (mode === "read-only" && (parsed.opaque || parsed.unparseable)) deny("Read only blocks uninspectable shell execution");
  if (parsed.opaque) ask("shell behavior cannot be fully inspected");
  if (parsed.unparseable) ask("shell command could not be safely parsed");

  for (const unit of parsed.units) {
    const name = commandName(unit.command);
    for (const redirection of unit.redirections) {
      const expanded = expandHome(redirection.path.replace(/^file:\/\//, ""));
      if (!SAFE_DEVICES.has(expanded)) intents.push(evaluatePath(policy, redirection.operation, expanded, effectiveCwd));
    }
    if (name === "cd") {
      const target = unit.args[0] || process.env.HOME;
      if (target) {
        const intent = evaluatePath(policy, mode === "read-only" ? "read" : "execute", expandHome(target), effectiveCwd);
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
    const readCommand = !pathLooksExplicit(unit.command) && (["cat", "head", "tail", "wc", "ls", "pwd", "stat", "file", "grep", "rg", "echo", "printf"].includes(name)
      || (name === "git" && ["status", "diff", "log", "show", "rev-parse", "ls-files"].includes(gitSubcommand(unit.args) ?? "")
        && !unit.args.some((arg) => arg.startsWith("--output") || arg === "--ext-diff" || arg === "--textconv" || arg === "-c")));
    if (mode === "read-only" && (unit.args.some((arg) => /^--(?:pre|pre-glob|hostname-bin)(?:=|$)/.test(arg)))) deny("Read only blocks external search helpers");
    if (mode === "read-only" && (!readCommand || parsed.opaque)) deny("Read only blocks commands that may change files or have side effects");
    if (!readCommand && ![...DESTRUCTIVE_COMMANDS, ...WRITE_COMMANDS, "sed"].includes(name)) ask("command requires safety review");
    if (DESTRUCTIVE_COMMANDS.has(name)) {
      ask(`destructive command ${name}`);
    }
    if (NETWORK_COMMANDS.has(name) || name === "curl") ask(`network command ${name}`);
    if (name === "git") {
      const subcommand = gitSubcommand(unit.args);
      if (subcommand === "push" || ["fetch", "pull", "clone"].includes(subcommand || "")) {
        ask(`networked Git operation ${subcommand}`);
      }
      if (subcommand === "clean" || (subcommand === "reset" && unit.args.includes("--hard"))) ask(`destructive Git operation ${subcommand}`);
      if (subcommand === "push" && unit.args.some((arg) => arg === "-f" || arg.startsWith("--force"))) ask("force-push requires review");
    }
    if (["shutdown", "reboot", "halt", "poweroff", "mkfs"].some((dangerous) => name.startsWith(dangerous))) deny(`catastrophic command ${name}`);
    if (name === "dd" && unit.args.some((arg) => /^of=\/dev\//.test(arg))) deny("raw device overwrite");
    if ((name === "chmod" || name === "chown") && unit.args.includes("777")) ask(`${name} 777 requires review`);
    if (name === "rm" && unit.args.some((arg) => /^-[^-]*r/.test(arg) || arg === "--recursive")) {
      const targets = unit.args.filter((arg) => !arg.startsWith("-"));
      if (targets.some((target) => ["/", "~", "$HOME", "${HOME}"].includes(target))) deny("recursive deletion of a filesystem/home root is denied");
      else ask("recursive deletion");
    }

    const exemptArguments = inlineScriptExemptions(name, unit.args);
    const inPlaceEdit = name === "sed" && unit.args.some((arg, index) =>
      !exemptArguments.has(index) && (arg === "--in-place" || arg.startsWith("--in-place=") || /^-[^-]*i/.test(arg)));
    // In-place suffixes and clustered options vary across sed implementations.
    // Require review even when an operand cannot be confidently identified.
    if (inPlaceEdit) ask("in-place edit requires confirmation");
    const operation: AccessOperation = DESTRUCTIVE_COMMANDS.has(name)
      ? (name === "rm" || name === "rmdir" ? "delete" : "write")
      : WRITE_COMMANDS.has(name) || inPlaceEdit ? "write" : "read";
    const scriptArgumentIndex = SCRIPT_INTERPRETERS.has(name)
      ? unit.args.findIndex((arg) => !arg.startsWith("-"))
      : -1;
    for (const [argumentIndex, arg] of unit.args.entries()) {
      if (exemptArguments.has(argumentIndex)) continue;
      // Numeric route arguments such as `/1000` are commonly passed to scripts and
      // are not filesystem paths. Keep checking the interpreter's script operand.
      if (scriptArgumentIndex >= 0 && argumentIndex > scriptArgumentIndex && /^\/\d+$/.test(arg)) continue;
      const fileOperand = ["cat", "head", "tail", "wc", "ls", "stat", "file", "grep", "rg"].includes(name);
      if (!pathLooksExplicit(arg) && !((inPlaceEdit || fileOperand) && arg && !arg.startsWith("-"))) continue;
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
  const intentSummaries = intents.map((intent) => {
    const description = describeIntent(intent);
    return intent.canonicalPath && intent.lexicalPath && intent.canonicalPath !== intent.lexicalPath
      ? `${description}\nResolved: ${intent.canonicalPath}`
      : description;
  });
  return {
    decision,
    reason: reasons.join("; ") || "allowed by workspace policy",
    summary: [`Command: ${command}`, ...intentSummaries].join("\n"),
    approvalKey: `${mode}:bash:v2:${createHash("sha256").update(JSON.stringify({
      command,
      cwd: canonicalizeExistingPrefix(cwd),
      environment: Object.entries(policy.shellEnvironment ?? {}).sort(([a], [b]) => a.localeCompare(b)),
      intents: intents.map(({ operation, canonicalPath, root, decision }) => ({
        operation, canonicalPath, rootId: root?.id, access: root?.access, decision,
      })),
    })).digest("hex")}`,
    intents,
  };
}
