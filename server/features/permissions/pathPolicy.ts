import fs from "node:fs";
import path from "node:path";
import type {
  AccessIntent, AccessOperation, PermissionDecision, PermissionPolicy, PermissionRoot,
} from "./permissionTypes.ts";

const SENSITIVE_BASENAMES = new Set([".netrc", ".npmrc", ".pypirc"]);
const SENSITIVE_PATH_PARTS = new Set([".ssh", ".aws", ".gnupg", ".kube"]);
const SENSITIVE_EXTENSIONS = new Set([".pem", ".key", ".p12", ".pfx"]);

export function canonicalizeExistingPrefix(value: string): string {
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
  const canonicalPath = canonicalizeExistingPrefix(lexicalPath);
  const root = rootForPath(policy.roots, canonicalPath);
  const withinAllowedReadRoot = Array.from(policy.allowedReadRoots ?? [])
    .some((allowedRoot) => isWithin(path.resolve(allowedRoot), canonicalPath));
  const explicitlyAllowedRead = operation === "read" && (
    Array.from(policy.allowedReadFiles ?? []).some((file) => path.resolve(file) === canonicalPath)
    || withinAllowedReadRoot
  );
  if (!root && !explicitlyAllowedRead) {
    return { operation, lexicalPath, canonicalPath, decision: policy.externalAccess ?? "ask", reason: "path is outside every workspace root" };
  }
  if (root?.access === "read-only" && operation !== "read") {
    return { operation, lexicalPath, canonicalPath, root, decision: "deny", reason: `workspace root ${root.name} is read-only` };
  }
  const sensitive = sensitivePathReason(canonicalPath);
  return {
    operation, lexicalPath, canonicalPath, root,
    decision: sensitive ? "ask" : "allow",
    reason: sensitive ?? (explicitlyAllowedRead ? "path is explicitly allowed for reading" : undefined),
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
