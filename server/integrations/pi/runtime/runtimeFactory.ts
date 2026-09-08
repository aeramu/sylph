import path from "path";
import { fileURLToPath } from "url";
import {
  createAgentSessionRuntime, createAgentSessionServices, createAgentSessionFromServices, createBashToolDefinition, getAgentDir, loadProjectContextFiles,
  type CreateAgentSessionRuntimeFactory,
} from "@earendil-works/pi-coding-agent";
import { getModelRuntime } from "../auth.ts";
import type { Project } from "../../../features/projects/projectTypes.ts";
import { mergeProjectContextFiles } from "../../../features/sessions/workspace/projectContextService.ts";
import { createSessionRuntimeConfiguration } from "../../../features/sessions/runtime/sessionRuntimeConfiguration.ts";
import { createAiPermissionReviewer } from "../../../features/permissions/aiPermissionReview.ts";
import { updateAllowedSkills } from "../../../features/permissions/sessionPermissionService.ts";
import { createPermissionExtension } from "../extensions/permissionExtension.ts";
import { createBackgroundJobTools } from "../extensions/backgroundJobsExtension.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const askUserQuestionExtensionPath = path.join(__dirname, "../extensions/askUserQuestionExtension.ts");
export const schedulerExtensionPath = path.join(__dirname, "../extensions/schedulerExtension.ts");
export const showArtifactExtensionPath = path.join(__dirname, "../extensions/showArtifactExtension.ts");

export interface RuntimeFactoryOptions {
  uiContext?: any;
  project?: Project;
  directoryId?: string;
  sessionId?: string;
}

export async function buildRuntime(sessionManager: any, cwd: string, options: RuntimeFactoryOptions = {}) {
  const factory: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
    const modelRuntime = await getModelRuntime();
    const configuration = createSessionRuntimeConfiguration({
      sessionId: options.sessionId,
      cwd,
      project: options.project,
      directoryId: options.directoryId,
      permissionAuditFile: path.join(getAgentDir(), "logs", "sylph-permissions.jsonl"),
    });
    const services = await createAgentSessionServices({
      cwd,
      modelRuntime,
      resourceLoaderOptions: {
        additionalExtensionPaths: [askUserQuestionExtensionPath, schedulerExtensionPath, showArtifactExtensionPath],
        skillsOverride: (base) => {
          if (configuration.permission) updateAllowedSkills(configuration.permission, base.skills);
          return base;
        },
        extensionFactories: configuration.permission ? [{
          name: "sylph-permissions",
          factory: createPermissionExtension(configuration.permission.policy, { ...configuration.permission, review: createAiPermissionReviewer(modelRuntime) }),
        }] : [],
        agentsFilesOverride: (base) => ({
          agentsFiles: mergeProjectContextFiles(base.agentsFiles, options.project, (directoryPath) =>
            loadProjectContextFiles({ cwd: directoryPath, agentDir: getAgentDir() })),
        }),
        appendSystemPromptOverride: (base) => configuration.promptAdditions.length
          ? [...base, ...configuration.promptAdditions]
          : base,
      },
    });
    const commandPrefix = services.settingsManager.getShellCommandPrefix();
    const shellPath = services.settingsManager.getShellPath();
    const scratchBash = configuration.environment.scratchPath ? createBashToolDefinition(cwd, {
      commandPrefix,
      shellPath,
      spawnHook: (context) => ({ ...context, env: { ...context.env, ...configuration.environment.variables } }),
    }) : undefined;
    const backgroundJobTools = options.sessionId ? createBackgroundJobTools({
      sessionId: options.sessionId,
      cwd,
      environment: configuration.environment.variables,
      commandPrefix,
      shellPath,
    }) : [];
    const customTools = [...(scratchBash ? [scratchBash as any] : []), ...backgroundJobTools];
    return {
      ...(await createAgentSessionFromServices({
        services,
        sessionManager,
        sessionStartEvent,
        // The SDK's broad ToolDefinition default is invariant under TS 6;
        // concrete custom definitions nevertheless have the expected runtime shape.
        ...(customTools.length ? { customTools } : {}),
      })),
      services,
      diagnostics: services.diagnostics,
    };
  };

  const runtime = await createAgentSessionRuntime(factory, { cwd, agentDir: getAgentDir(), sessionManager });
  await runtime.session.bindExtensions(options.uiContext ? { mode: "rpc", uiContext: options.uiContext } : {});
  return runtime;
}
