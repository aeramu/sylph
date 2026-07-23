import type { Project } from "../../projects/projectTypes.ts";
import {
  createSessionPermissionConfiguration, type SessionPermissionConfiguration,
} from "../../permissions/sessionPermissionService.ts";
import {
  createSessionEnvironment, sessionEnvironmentIsCwd, sessionEnvironmentPrompt, type SessionEnvironment,
} from "../scratch/sessionEnvironment.ts";
import { workspacePrompt } from "../workspace/workspacePrompt.ts";

export interface SessionRuntimeConfiguration {
  environment: SessionEnvironment;
  permission?: SessionPermissionConfiguration;
  promptAdditions: string[];
}

export function createSessionRuntimeConfiguration(input: {
  sessionId?: string;
  cwd: string;
  project?: Project;
  directoryId?: string;
  permissionAuditFile: string;
}): SessionRuntimeConfiguration {
  const environment = createSessionEnvironment(input.sessionId);
  const promptAdditions = [
    workspacePrompt(input.project, input.directoryId, input.cwd),
    sessionEnvironmentPrompt(environment),
  ].filter((value): value is string => !!value);
  const permission = input.sessionId
    ? createSessionPermissionConfiguration({
        sessionId: input.sessionId,
        cwd: input.cwd,
        project: input.project,
        environment,
        scratchIsCwd: sessionEnvironmentIsCwd(environment, input.cwd, input.project),
        auditFile: input.permissionAuditFile,
      })
    : undefined;
  return { environment, permission, promptAdditions };
}
