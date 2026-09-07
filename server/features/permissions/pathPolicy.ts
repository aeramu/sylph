import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import type {
  AccessIntent, AccessOperation, PermissionDecision, PermissionPolicy, PermissionRoot,
} from "./permissionTypes.ts";

const SENSITIVE_BASENAMES = new Set([".netrc", ".npmrc", ".pypirc"]);
const SENSITIVE_PATH_PARTS = new Set([".ssh", ".aws", ".gnupg", ".kube"]);
const SENSITIVE_EXTENSIONS = new Set([".pem", ".key", ".p12", ".pfx"]);

/** Match the path syntax accepted by Pi file tools; shell paths keep shell semantics. */
export function resolveFileToolPath(value: string, cwd: string): string {
  let normalized = value.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " ");
  if (normalized.startsWith("@")) normalized = normalized.slice(1);
  if (process.platform === "win32" && !normalized.startsWith("//") && !normalized.includes("\\")) {
    const drive = normalized.match(/^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i);
    if (drive) normalized = `${drive[1].toUpperCase()}:\\${drive[2]?.replaceAll("/", "\\") ?? ""}`;
  }
  if (normalized === "~") normalized = homedir();
  else if (normalized.startsWith("~/") || (process.platform === "win32" && normalized.startsWith("~\\"))) {
    normalized = path.join(homedir(), normalized.slice(2));
  }
  if (normalized.startsWith("file://")) normalized = fileURLToPath(normalized);
  return path.resolve(cwd, normalized);
}

export function canonicalizeExistingPrefix(value: string): string {
  let links = 0;
  const resolve = (target: string): string => {
    const absolute = path.resolve(target);
    const root = path.parse(absolute).root;
    let current = root;
    for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      let stat: fs.Stats;
      try { stat = fs.lstatSync(current); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      if (stat.isSymbolicLink()) {
        if (++links > 40) throw new Error("too many symbolic links");
        current = resolve(path.resolve(path.dirname(current), fs.readlinkSync(current)));
      } else {
        current = fs.realpathSync(current);
      }
    }
    return current;
  };
  return resolve(value);
}

export function isWithin(root: string, target: string) {
  const relative = path.relative(root, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function rootForPath(roots: PermissionRoot[], target: string) {
  return roots
    .map((root) => ({ ...root, path: canonicalizeExistingPrefix(root.path) }))
    .filter((root) => isWithin(root.path, target))
    .sort((a, b) => b.path.length - a.path.length)[0];
}

function sensitivePathReason(filePath: string): string | undefined {
  const parts = filePath.split(path.sep).filter(Boolean);
  const basename = path.basename(filePath).toLowerCase();
  const extension = path.extname(basename).toLowerCase();
  if (basename === ".env" || basename.startsWith(".env.")) {
    if (basename === ".env.example" || basename === ".env.sample") return undefined;
    return "sensitive environment file";
  }
  if (SENSITIVE_BASENAMES.has(basename) || SENSITIVE_EXTENSIONS.has(extension)) return "sensitive credential file";
  if (/^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i.test(basename)) return "SSH key material";
  if (parts.some((part) => SENSITIVE_PATH_PARTS.has(part.toLowerCase()))) return "sensitive credential directory";
  return undefined;
}

export function evaluatePath(policy: PermissionPolicy, operation: AccessOperation, rawPath: string, cwd: string): AccessIntent {
  const lexicalPath = path.resolve(cwd, rawPath);
  let canonicalPath: string;
  let root: PermissionRoot | undefined;
  try {
    canonicalPath = canonicalizeExistingPrefix(lexicalPath);
    root = rootForPath(policy.roots, canonicalPath);
  } catch {
    return { operation, lexicalPath, decision: "deny", reason: "path could not be safely resolved" };
  }
  const withinAllowedReadRoot = Array.from(policy.allowedReadRoots ?? [])
    .some((allowedRoot) => isWithin(path.resolve(allowedRoot), canonicalPath));
  const explicitlyAllowedRead = operation === "read" && (
    Array.from(policy.allowedReadFiles ?? []).some((file) => path.resolve(file) === canonicalPath)
    || withinAllowedReadRoot
  );
  const sensitive = sensitivePathReason(canonicalPath);
  if (!root && !explicitlyAllowedRead) {
    const relaxedRead = policy.mode === "relaxed" && operation === "read" && !sensitive;
    return {
      operation, lexicalPath, canonicalPath,
      decision: relaxedRead ? "allow" : policy.externalAccess ?? "ask",
      reason: sensitive ?? (relaxedRead ? "external read allowed in Relaxed mode" : "path is outside every workspace root"),
    };
  }
  if (root?.access === "read-only" && operation !== "read") {
    return { operation, lexicalPath, canonicalPath, root, decision: "deny", reason: `workspace root ${root.name} is read-only` };
  }
  const strictMutation = policy.mode === "strict" && operation !== "read";
  return {
    operation, lexicalPath, canonicalPath, root,
    decision: sensitive || strictMutation ? "ask" : "allow",
    reason: sensitive ?? (strictMutation
      ? `${operation} requires confirmation in Strict mode`
      : explicitlyAllowedRead ? "path is explicitly allowed for reading" : undefined),
  };
}

export function combineDecision(intents: AccessIntent[]): PermissionDecision {
  return intents.some((intent) => intent.decision === "deny") ? "deny"
    : intents.some((intent) => intent.decision === "ask") ? "ask" : "allow";
}

export function describeIntent(intent: AccessIntent) {
  const operation = intent.operation.toUpperCase().padEnd(7);
  const root = intent.root ? `[${intent.root.name}] ` : "[external] ";
  return `${operation} ${root}${intent.lexicalPath ?? intent.reason ?? ""}`;
}

export function pathLooksExplicit(token: string) {
  if (!token || token === "-" || token.startsWith("--") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) return false;
  const basename = path.basename(token).toLowerCase();
  const sensitiveBareName = basename === ".env" || basename.startsWith(".env.")
    || SENSITIVE_BASENAMES.has(basename) || SENSITIVE_EXTENSIONS.has(path.extname(basename).toLowerCase())
    || /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i.test(basename);
  return sensitiveBareName || token.startsWith("/") || token.startsWith("./") || token.startsWith("../")
    || token === "." || token === ".." || token.includes("/") || token.startsWith("~");
}

export function expandHome(token: string) {
  if (token === "~") return process.env.HOME || token;
  if (token.startsWith("~/")) return path.join(process.env.HOME || "~", token.slice(2));
  return token;
}
