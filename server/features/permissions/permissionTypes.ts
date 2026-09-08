export type PermissionDecision = "allow" | "ask" | "deny";
export type PermissionMode = "read-only" | "safe" | "ai" | "relaxed";
export type AccessOperation = "read" | "write" | "execute" | "delete" | "network";

export const DEFAULT_PERMISSION_MODE: PermissionMode = "safe";

export function isPermissionMode(value: unknown): value is PermissionMode {
  return value === "read-only" || value === "safe" || value === "ai" || value === "relaxed";
}

export interface PermissionRoot {
  id: string;
  name: string;
  path: string;
  access?: "read-write" | "read-only";
  temporary?: boolean;
}

export interface PermissionPolicy {
  roots: PermissionRoot[];
  mode?: PermissionMode;
  externalAccess?: Exclude<PermissionDecision, "allow">;
  shellEnvironment?: Record<string, string>;
  allowedReadFiles?: Iterable<string>;
  allowedReadRoots?: Iterable<string>;
}

export interface AccessIntent {
  operation: AccessOperation;
  lexicalPath?: string;
  canonicalPath?: string;
  root?: PermissionRoot;
  reason?: string;
  decision: PermissionDecision;
}

export interface PermissionEvaluation {
  decision: PermissionDecision;
  reason: string;
  summary: string;
  approvalKey: string;
  intents: AccessIntent[];
}

export interface PermissionToolCall {
  toolName: string;
  input: unknown;
}

/** Legacy modes migrate without silently enabling model calls. */
export function normalizePermissionMode(value: unknown): PermissionMode | undefined {
  if (value === "strict" || value === "balanced") return "safe";
  return isPermissionMode(value) ? value : undefined;
}
