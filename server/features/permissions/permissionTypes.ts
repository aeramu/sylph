export type PermissionDecision = "allow" | "ask" | "deny";
export type PermissionMode = "relaxed" | "balanced" | "strict";
export type AccessOperation = "read" | "write" | "execute" | "delete" | "network";

export const DEFAULT_PERMISSION_MODE: PermissionMode = "balanced";

export function isPermissionMode(value: unknown): value is PermissionMode {
  return value === "relaxed" || value === "balanced" || value === "strict";
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
