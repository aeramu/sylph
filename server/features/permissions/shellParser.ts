import path from "node:path";
import { parse } from "shell-quote";
import { pathLooksExplicit } from "./pathPolicy.ts";

const SHELL_OPERATORS = new Set(["&&", "||", ";", "|", "&"]);
const SHELL_WRAPPERS = new Set(["sh", "bash", "zsh", "dash", "ksh", "eval"]);
const CONTROL_PREFIXES = new Set(["do", "then", "else", "elif", "if", "while", "until", "!", "time", "{"]);
const CONTROL_DECLARATIONS = new Set(["for", "select", "case", "function"]);
const CONTROL_TERMINATORS = new Set(["done", "fi", "esac", "}"]);

export interface CommandUnit {
  command: string;
  args: string[];
  redirections: Array<{ operation: "read" | "write"; path: string }>;
}

export function commandName(token: string) {
  return path.basename(token).toLowerCase();
}

/** shell-quote treats newlines as whitespace, so preserve unquoted shell line boundaries. */
function normalizeNewlines(command: string) {
  let source = "";
  let quote: "'" | '"' | "`" | undefined;
  let inComment = false;
  let wordStarted = false;
  let opaque = false;
  for (let index = 0; index < command.length; index++) {
    const char = command[index];
    if (inComment) {
      if (char === "\n") {
        source += " ; ";
        inComment = false;
        wordStarted = false;
      }
      continue;
    }
    if (quote) {
      source += char;
      if (char === quote) quote = undefined;
      else if (char === "\\" && quote !== "'" && index + 1 < command.length) source += command[++index];
      continue;
    }
    if (char === "\\" && index + 1 < command.length) {
      if (command[index + 1] === "\n") {
        index++;
      } else {
        source += char + command[++index];
        wordStarted = true;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      if (char === "`") opaque = true;
      source += char;
      wordStarted = true;
      continue;
    }
    if (char === "#" && !wordStarted) {
      inComment = true;
      continue;
    }
    if (char === "\n") {
      source += " ; ";
      wordStarted = false;
      continue;
    }
    source += char;
    if (/\s/.test(char) || /[;&|()<>]/.test(char)) wordStarted = false;
    else wordStarted = true;
  }
  return { source, opaque };
}

export function parseCommandUnits(command: string, trustedEnvironment: Record<string, string> = {}) {
  try {
    const dynamicPattern = /(^|[^\\])\$(?:([A-Za-z_][A-Za-z0-9_]*)|\{([A-Za-z_][A-Za-z0-9_]*)\}|\()|`/g;
    let hasDynamicExpansion = false;
    for (const match of command.matchAll(dynamicPattern)) {
      const variable = match[2] || match[3];
      if (!variable || trustedEnvironment[variable] === undefined) { hasDynamicExpansion = true; break; }
    }
    const normalized = normalizeNewlines(command);
    const tokens = parse(normalized.source, trustedEnvironment);
    const units: CommandUnit[] = [];
    let current: string[] = [];
    let redirections: CommandUnit["redirections"] = [];
    let pendingRedirection: "read" | "write" | undefined;
    let opaque = hasDynamicExpansion || normalized.opaque;
    const flush = () => {
      if (pendingRedirection) { opaque = true; pendingRedirection = undefined; }
      const words = [...current];
      while (words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words.shift();
      if (CONTROL_DECLARATIONS.has(words[0])) {
        opaque = true;
      } else {
        if (CONTROL_PREFIXES.has(words[0])) words.shift();
        while (words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words.shift();
        if (words.length && !CONTROL_TERMINATORS.has(words[0])) {
          units.push({ command: words[0], args: words.slice(1), redirections });
        }
      }
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
