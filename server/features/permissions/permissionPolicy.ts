import { createHash } from "node:crypto";
import { describeIntent, evaluatePath } from "./pathPolicy.ts";
import { evaluateBash } from "./shellPolicy.ts";
import type { PermissionEvaluation, PermissionPolicy, PermissionToolCall } from "./permissionTypes.ts";

const PATH_TOOLS = new Set(["read", "write", "edit", "grep", "find", "ls"]);
const READ_TOOLS = new Set(["read", "grep", "find", "ls"]);

/** Evaluate one tool call against Sylph's vendor-neutral permission policy. */
export function evaluateToolCall(policy: PermissionPolicy, event: PermissionToolCall, cwd: string): PermissionEvaluation {
  if (event.toolName === "bash") {
    const input = event.input && typeof event.input === "object" ? event.input as Record<string, unknown> : {};
    return evaluateBash(policy, String(input.command ?? ""), cwd);
  }

  const input = event.input && typeof event.input === "object" ? event.input as Record<string, unknown> : {};
  const nested = input.arguments && typeof input.arguments === "object" ? input.arguments as Record<string, unknown> : {};
  const rawPath = PATH_TOOLS.has(event.toolName) ? input.path ?? "."
    : typeof input.path === "string" ? input.path
    : typeof nested.path === "string" ? nested.path
    : undefined;
  if (typeof rawPath !== "string") {
    const known = PATH_TOOLS.has(event.toolName) || event.toolName === "ask_user_question";
    const serialized = JSON.stringify(event.input ?? {});
    const fingerprint = createHash("sha256").update(serialized).digest("hex").slice(0, 16);
    const preview = serialized.length > 300 ? `${serialized.slice(0, 300)}…` : serialized;
    return {
      decision: "allow",
      reason: known ? "tool has no filesystem access intent" : "custom tool access cannot be fully inspected",
      summary: `Tool: ${event.toolName}${known ? "" : `\nInput: ${preview}`}`,
      approvalKey: `tool:${event.toolName}:${fingerprint}`,
      intents: [],
    };
  }

  const intent = evaluatePath(policy, READ_TOOLS.has(event.toolName) ? "read" : "write", rawPath, cwd);
  return {
    decision: intent.decision,
    reason: intent.reason || "allowed by workspace policy",
    summary: `Tool: ${event.toolName}\n${describeIntent(intent)}${intent.canonicalPath !== intent.lexicalPath ? `\nResolved: ${intent.canonicalPath}` : ""}`,
    approvalKey: `${event.toolName}:${intent.root?.id ?? "external"}:${intent.canonicalPath}`,
    intents: [intent],
  };
}

export { parseCommandUnits } from "./shellParser.ts";
export type {
  AccessIntent, AccessOperation, PermissionDecision, PermissionEvaluation,
  PermissionPolicy, PermissionRoot, PermissionToolCall,
} from "./permissionTypes.ts";
