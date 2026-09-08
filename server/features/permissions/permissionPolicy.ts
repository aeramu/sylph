import { createHash } from "node:crypto";
import { describeIntent, evaluatePath, resolveFileToolPath } from "./pathPolicy.ts";
import { evaluateBash } from "./shellPolicy.ts";
import type { PermissionEvaluation, PermissionPolicy, PermissionToolCall } from "./permissionTypes.ts";

const PATH_TOOLS = new Set(["read", "write", "edit", "grep", "find", "ls"]);
const READ_TOOLS = new Set(["read", "grep", "find", "ls"]);
const BACKGROUND_COMMAND_TOOLS = new Set(["bg_run"]);
const INTERNAL_TOOLS = new Set([
  "ask_user_question", "bg_status", "bg_logs", "bg_kill",
  "create_schedule", "list_schedules", "update_schedule", "delete_schedule",
]);

/** Evaluate one tool call against Sylph's vendor-neutral permission policy. */
export function evaluateToolCall(policy: PermissionPolicy, event: PermissionToolCall, cwd: string): PermissionEvaluation {
  if (event.toolName === "bash" || BACKGROUND_COMMAND_TOOLS.has(event.toolName)) {
    const input = event.input && typeof event.input === "object" ? event.input as Record<string, unknown> : {};
    return evaluateBash(policy, String(input.command ?? ""), cwd);
  }

  if (policy.mode === "relaxed") return {
    decision: "allow", reason: "Relaxed allows tool access", summary: `Tool: ${event.toolName}`,
    approvalKey: "relaxed", intents: [],
  };
  const input = event.input && typeof event.input === "object" ? event.input as Record<string, unknown> : {};
  const nested = input.arguments && typeof input.arguments === "object" ? input.arguments as Record<string, unknown> : {};
  const rawPath = PATH_TOOLS.has(event.toolName) ? input.path ?? "."
    : typeof input.path === "string" ? input.path
    : typeof nested.path === "string" ? nested.path
    : undefined;
  if (typeof rawPath !== "string") {
    const known = PATH_TOOLS.has(event.toolName) || INTERNAL_TOOLS.has(event.toolName);
    const serialized = JSON.stringify(event.input ?? {});
    const fingerprint = createHash("sha256").update(serialized).digest("hex").slice(0, 16);
    const preview = serialized.length > 300 ? `${serialized.slice(0, 300)}…` : serialized;
    const sideEffect = !["ask_user_question", "bg_status", "bg_logs", "list_schedules"].includes(event.toolName);
    const decision = sideEffect ? (policy.mode === "read-only" ? "deny" : "ask") : "allow";
    const reason = sideEffect ? "tool side effects require review" : "tool has no filesystem access intent";
    return {
      decision,
      reason,
      summary: `Tool: ${event.toolName}${known ? "" : `\nInput: ${preview}`}`,
      approvalKey: `${policy.mode ?? "safe"}:tool:${event.toolName}:${fingerprint}`,
      intents: [],
    };
  }

  let checkedPath = rawPath;
  if (PATH_TOOLS.has(event.toolName)) {
    try { checkedPath = resolveFileToolPath(rawPath, cwd); } catch {
      return {
        decision: "deny", reason: "invalid file tool path", summary: `Tool: ${event.toolName}\nPath: ${rawPath}`,
        approvalKey: "invalid-path", intents: [],
      };
    }
  }
  const intent = evaluatePath(policy, READ_TOOLS.has(event.toolName) ? "read" : "write", checkedPath, cwd);
  return {
    decision: intent.decision,
    reason: intent.reason || "allowed by workspace policy",
    summary: `Tool: ${event.toolName}\n${describeIntent(intent)}${intent.canonicalPath !== intent.lexicalPath ? `\nResolved: ${intent.canonicalPath}` : ""}`,
    approvalKey: `${policy.mode ?? "safe"}:${event.toolName}:${intent.root?.id ?? "external"}:${intent.canonicalPath}`,
    intents: [intent],
  };
}

export { parseCommandUnits } from "./shellParser.ts";
export type {
  AccessIntent, AccessOperation, PermissionDecision, PermissionEvaluation,
  PermissionMode, PermissionPolicy, PermissionRoot, PermissionToolCall,
} from "./permissionTypes.ts";
