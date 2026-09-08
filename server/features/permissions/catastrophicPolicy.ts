import path from "node:path";
import { homedir } from "node:os";
import { canonicalizeExistingPrefix, expandHome } from "./pathPolicy.ts";
import { commandName, parseCommandUnits } from "./shellParser.ts";

/** Recognize catastrophic operations, including common command and shell wrappers. */
export function catastrophicCommandReason(command: string, cwd: string, environment: Record<string, string> = {}, depth = 0): string | undefined {
  if (depth > 8) return undefined;
  if (command.replace(/\s+/g, "") === ":(){:|:&};:") return "fork bomb is denied";
  for (const unit of parseCommandUnits(command, { HOME: homedir(), ...environment }).units) {
    let name = commandName(unit.command);
    let args = unit.args;
    while (["env", "command", "exec", "sudo", "doas", "nohup"].includes(name)) {
      let index = 0;
      while (index < args.length && (args[index].startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(args[index]))) {
        if (["-u", "--unset", "-C", "--chdir", "-g"].includes(args[index])) index++;
        index++;
      }
      if (index >= args.length) break;
      name = commandName(args[index]);
      args = args.slice(index + 1);
    }
    if (["sh", "bash", "zsh", "dash", "ksh"].includes(name)) {
      const flag = args.findIndex((arg) => /^-[^-]*c/.test(arg));
      if (flag >= 0 && args[flag + 1]) {
        const reason = catastrophicCommandReason(args[flag + 1], cwd, environment, depth + 1);
        if (reason) return reason;
      }
    }
    if (name === "eval") {
      const reason = catastrophicCommandReason(args.join(" "), cwd, environment, depth + 1);
      if (reason) return reason;
    }
    if (["shutdown", "reboot", "halt", "poweroff", "mkfs"].some((prefix) => name.startsWith(prefix))) return `catastrophic command ${name}`;
    if (name === "dd" && args.some((arg) => /^of=\/dev\//.test(arg))) return "raw device overwrite";
    if (name === "rm" && args.some((arg) => /^-[^-]*[rR]/.test(arg) || arg === "--recursive")) {
      for (const target of args.filter((arg) => !arg.startsWith("-"))) {
        try {
          const resolved = canonicalizeExistingPrefix(path.resolve(cwd, expandHome(target)));
          if (resolved === path.parse(resolved).root || resolved === canonicalizeExistingPrefix(homedir())) {
            return "recursive deletion of a filesystem/home root is denied";
          }
        } catch { /* Unresolvable targets cannot be executed as a recursive deletion. */ }
      }
    }
  }
  return undefined;
}
