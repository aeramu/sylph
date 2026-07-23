import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import {
  evaluateToolCall, type PermissionDecision, type PermissionPolicy,
} from "../../../features/permissions/permissionPolicy.ts";

export interface PermissionExtensionOptions {
  initialApprovals?: string[];
  onApproval?: (approvalKey: string) => void;
  audit?: (event: {
    at: string;
    decision: PermissionDecision | "approved_for_session";
    tool: string;
    reason: string;
    summary: string;
    approvalKey: string;
  }) => void;
}

/** Translate Pi tool-call hooks and UI responses into Sylph policy decisions. */
export function createPermissionExtension(policy: PermissionPolicy, options: PermissionExtensionOptions = {}): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    const sessionApprovals = new Set(options.initialApprovals ?? []);
    pi.on("tool_call", async (event, ctx) => {
      const evaluation = evaluateToolCall(policy, event, ctx.cwd);
      const audit = (decision: PermissionDecision | "approved_for_session") => options.audit?.({
        at: new Date().toISOString(), decision, tool: event.toolName,
        reason: evaluation.reason, summary: evaluation.summary, approvalKey: evaluation.approvalKey,
      });
      // Routine allows are intentionally not logged because tool inputs can
      // contain secrets. The audit trail records reviewed or blocked access.
      if (evaluation.decision === "allow") return undefined;
      if (sessionApprovals.has(evaluation.approvalKey)) { audit("approved_for_session"); return undefined; }
      if (evaluation.decision === "deny") {
        audit("deny");
        return { block: true, reason: `[Sylph permission] ${evaluation.reason}` };
      }
      if (!ctx.hasUI) {
        audit("deny");
        return { block: true, reason: `[Sylph permission] Confirmation unavailable: ${evaluation.reason}` };
      }

      const sessionOption = "Allow matching access for this session";
      const choice = await ctx.ui.select(
        `Permission required\n${evaluation.summary}\n\nReason: ${evaluation.reason}`,
        ["Allow once", sessionOption, "Deny", "Deny with reason"],
      );
      if (choice === "Allow once") { audit("allow"); return undefined; }
      if (choice === sessionOption) {
        sessionApprovals.add(evaluation.approvalKey);
        options.onApproval?.(evaluation.approvalKey);
        audit("approved_for_session");
        return undefined;
      }
      if (choice === "Deny with reason") {
        const reason = await ctx.ui.input("Why should this operation be denied?", "Reason shown to the agent");
        audit("deny");
        return { block: true, reason: `[Sylph permission] Denied by user${reason?.trim() ? `: ${reason.trim()}` : ""}` };
      }
      audit("deny");
      return { block: true, reason: "[Sylph permission] Denied by user" };
    });
  };
}

export function isThirdPartyPermissionExtension(extension: { path?: string; resolvedPath?: string }) {
  const identity = `${extension.path ?? ""}\n${extension.resolvedPath ?? ""}`;
  return identity.includes("@gotgenes/pi-permission-system") || identity.includes("pi-permission-system/src/index.ts");
}
