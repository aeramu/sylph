import fs from "node:fs";
import path from "node:path";
import type { Project } from "../projects/projectTypes.ts";
import type { SessionEnvironment } from "../sessions/scratch/sessionEnvironment.ts";
import { getSessionBinding, saveSessionBinding } from "../sessions/workspace/workspaceBindingRepository.ts";
import type { PermissionDecision, PermissionPolicy } from "./permissionPolicy.ts";

export interface PermissionAuditEvent {
  at: string;
  decision: PermissionDecision | "approved_for_session";
  tool: string;
  reason: string;
  summary: string;
  approvalKey: string;
}

export interface SessionPermissionConfiguration {
  policy: PermissionPolicy;
  initialApprovals: string[];
  onApproval: (approvalKey: string) => void;
  audit: (event: PermissionAuditEvent) => void;
  allowedSkillFiles: Set<string>;
  allowedSkillRoots: Set<string>;
}

export interface SessionPermissionInput {
  sessionId: string;
  cwd: string;
  project?: Project;
  environment: SessionEnvironment;
  scratchIsCwd: boolean;
  auditFile: string;
}

/** Build session-specific permission policy and persistence callbacks. */
export function createSessionPermissionConfiguration(input: SessionPermissionInput): SessionPermissionConfiguration {
  const allowedSkillFiles = new Set<string>();
  const allowedSkillRoots = new Set<string>();
  const roots = [
    ...(!input.scratchIsCwd
      ? (input.project?.directories ?? [{ id: "cwd", name: "workspace", path: input.cwd }]).map((directory) => ({
          id: directory.id, name: directory.name, path: directory.path, access: "read-write" as const,
        }))
      : []),
    ...(input.environment.scratchPath ? [{
      id: "sylph-scratch", name: "session scratch", path: input.environment.scratchPath,
      access: "read-write" as const, temporary: true,
    }] : []),
  ];
  return {
    policy: {
      roots,
      externalAccess: "ask",
      shellEnvironment: input.environment.variables,
      allowedReadFiles: allowedSkillFiles,
      allowedReadRoots: allowedSkillRoots,
    },
    initialApprovals: getSessionBinding(input.sessionId)?.permissionApprovals ?? [],
    onApproval: (approvalKey) => {
      const binding = getSessionBinding(input.sessionId);
      if (!binding) return;
      saveSessionBinding({
        ...binding,
        permissionApprovals: Array.from(new Set([...(binding.permissionApprovals ?? []), approvalKey])),
      });
    },
    audit: (event) => {
      try {
        fs.mkdirSync(path.dirname(input.auditFile), { recursive: true });
        fs.appendFileSync(input.auditFile, `${JSON.stringify({ sessionId: input.sessionId, ...event })}\n`, { mode: 0o600 });
        fs.chmodSync(input.auditFile, 0o600);
      } catch (error) {
        console.error("Failed to write Sylph permission audit:", error);
      }
    },
    allowedSkillFiles,
    allowedSkillRoots,
  };
}

export function updateAllowedSkills(
  configuration: Pick<SessionPermissionConfiguration, "allowedSkillFiles" | "allowedSkillRoots">,
  skills: Array<{ filePath: string; baseDir: string }>,
) {
  configuration.allowedSkillFiles.clear();
  configuration.allowedSkillRoots.clear();
  for (const skill of skills) {
    if (path.basename(skill.filePath) === "SKILL.md") configuration.allowedSkillRoots.add(fs.realpathSync(skill.baseDir));
    else configuration.allowedSkillFiles.add(fs.realpathSync(skill.filePath));
  }
}
