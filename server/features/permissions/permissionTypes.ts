export type PermissionDecision = "allow" | "ask" | "deny";
export type AccessOperation = "read" | "write" | "execute" | "delete" | "network";

export interface PermissionRoot {
  id: string;
  name: string;
  path: string;
  access?: "read-write" | "read-only";
  temporary?: boolean;
}

export interface PermissionPolicy {
  roots: PermissionRoot[];
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
