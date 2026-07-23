import path from "node:path";
import { parse } from "shell-quote";
import { pathLooksExplicit } from "./pathPolicy.ts";

const SHELL_OPERATORS = new Set(["&&", "||", ";", "|", "&"]);
const SHELL_WRAPPERS = new Set(["sh", "bash", "zsh", "dash", "ksh", "eval"]);

export interface CommandUnit {
  command: string;
  args: string[];
  redirections: Array<{ operation: "read" | "write"; path: string }>;
}

export function commandName(token: string) {
  return path.basename(token).toLowerCase();
}

export function parseCommandUnits(command: string, trustedEnvironment: Record<string, string> = {}) {
  try {
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
        const record = token as { op?: unknown };
        const operator = typeof record.op === "string" ? record.op : "";
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
    return { units: [] as CommandUnit[], opaque: false, unparseable: command.trim().length > 0 };
  }
}

export { pathLooksExplicit };
