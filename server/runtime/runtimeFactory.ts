import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  createAgentSessionRuntime, createAgentSessionServices, createAgentSessionFromServices, createBashToolDefinition, getAgentDir, loadProjectContextFiles,
  type CreateAgentSessionRuntimeFactory,
} from "@earendil-works/pi-coding-agent";
import { authStorage, modelRegistry } from "../auth.ts";
import type { Project } from "../projects.ts";
import { getSessionBinding, saveSessionBinding } from "../sessionBindings.ts";
import { createPermissionExtension, isThirdPartyPermissionExtension } from "../permissions.ts";
import { ensureSessionScratch } from "../sessionScratch.ts";
import { workspacePrompt } from "./workspacePrompt.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const askUserQuestionExtensionPath = path.join(__dirname, "../askUserQuestion.ts");

export interface RuntimeFactoryOptions {
  uiContext?: any;
  project?: Project;
  directoryId?: string;
  sessionId?: string;
}

export async function buildRuntime(sessionManager: any, cwd: string, options: RuntimeFactoryOptions = {}) {
  const factory: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
    const boundSessionId = options.sessionId ?? sessionManager.getSessionId?.();
    // Introspection uses an in-memory runtime without a sessionId and should
    // not leave behind a fake session directory merely for listing resources.
    const scratchPath = typeof options.sessionId === "string" ? ensureSessionScratch(options.sessionId) : undefined;
    const scratchIsCwd = !!scratchPath && path.resolve(scratchPath) === path.resolve(cwd) && !options.project?.directories.length;
    const permissionRoots = [
      ...(!scratchIsCwd ? (options.project?.directories ?? [{ id: "cwd", name: "workspace", path: cwd }]).map((directory) => ({
        id: directory.id, name: directory.name, path: directory.path, access: "read-write" as const,
      })) : []),
      ...(scratchPath ? [{ id: "sylph-scratch", name: "session scratch", path: scratchPath, access: "read-write" as const, temporary: true }] : []),
    ];
    const scratchEnvironment: Record<string, string> = scratchPath
      ? { TMPDIR: scratchPath, TMP: scratchPath, TEMP: scratchPath, SYLPH_SCRATCH_DIR: scratchPath }
      : {};
    const initialApprovals = getSessionBinding(boundSessionId)?.permissionApprovals ?? [];
    const auditFile = path.join(getAgentDir(), "logs", "sylph-permissions.jsonl");
    // The loader discovers trusted skills before extension factories are bound.
    // Keep these sets live so reloads update the exact loose skill files and
    // structured skill directories that the permission gate permits reading.
    const allowedSkillFiles = new Set<string>();
    const allowedSkillRoots = new Set<string>();
    const services = await createAgentSessionServices({
      cwd,
      authStorage,
      modelRegistry,
      resourceLoaderOptions: {
        additionalExtensionPaths: [askUserQuestionExtensionPath],
        skillsOverride: (base) => {
          allowedSkillFiles.clear();
          allowedSkillRoots.clear();
          for (const skill of base.skills) {
            if (path.basename(skill.filePath) === "SKILL.md") allowedSkillRoots.add(fs.realpathSync(skill.baseDir));
            else allowedSkillFiles.add(fs.realpathSync(skill.filePath));
          }
          return base;
        },
        extensionFactories: options.sessionId ? [{
          name: "sylph-permissions",
          factory: createPermissionExtension(
            {
              roots: permissionRoots,
              externalAccess: "ask",
              shellEnvironment: scratchEnvironment,
              allowedReadFiles: allowedSkillFiles,
              allowedReadRoots: allowedSkillRoots,
            },
            {
              initialApprovals,
              onApproval: (approvalKey) => {
                const binding = getSessionBinding(boundSessionId);
                if (!binding) return;
                saveSessionBinding({ ...binding, permissionApprovals: Array.from(new Set([...(binding.permissionApprovals ?? []), approvalKey])) });
              },
              audit: (event) => {
                try {
                  fs.mkdirSync(path.dirname(auditFile), { recursive: true });
                  fs.appendFileSync(auditFile, JSON.stringify({ sessionId: boundSessionId, ...event }) + "\n", { mode: 0o600 });
                  fs.chmodSync(auditFile, 0o600);
                } catch (error) { console.error("Failed to write Sylph permission audit:", error); }
              },
            },
          ),
        }] : [],
        extensionsOverride: (base) => options.sessionId ? ({
          ...base,
          extensions: base.extensions.filter((extension) => !isThirdPartyPermissionExtension(extension)),
        }) : base,
        agentsFilesOverride: (base) => {
          if (!options.project || options.project.directories.length < 2) return base;
          const files = [...base.agentsFiles];
          const seen = new Set(files.map((file) => path.resolve(file.path)));
          for (const directory of options.project.directories) {
            for (const file of loadProjectContextFiles({ cwd: directory.path, agentDir: getAgentDir() })) {
              const resolved = path.resolve(file.path);
              if (seen.has(resolved)) continue;
              seen.add(resolved);
              files.push({ path: `${directory.name}:${file.path}`, content: file.content });
            }
          }
          return { agentsFiles: files };
        },
        appendSystemPromptOverride: (base) => {
          const additions: string[] = [];
          const workspace = workspacePrompt(options.project, options.directoryId, cwd);
          if (workspace) additions.push(workspace);
          if (scratchPath) additions.push([
            `A private temporary directory is available at ${scratchPath}.`,
            "For temporary/intermediate files, use $TMPDIR or $SYLPH_SCRATCH_DIR instead of /tmp. They point to that directory and are already authorized for this session.",
            "Scratch files are not project files and may be cleaned up later; put durable user-requested changes in the workspace.",
          ].join("\n"));
          return additions.length ? [...base, ...additions] : base;
        },
      },
    });
    const scratchBash = scratchPath ? createBashToolDefinition(cwd, {
      commandPrefix: services.settingsManager.getShellCommandPrefix(),
      shellPath: services.settingsManager.getShellPath(),
      spawnHook: (context) => ({ ...context, env: { ...context.env, ...scratchEnvironment } }),
    }) : undefined;
    return {
      ...(await createAgentSessionFromServices({
        services,
        sessionManager,
        sessionStartEvent,
        // The SDK's broad ToolDefinition default is invariant under TS 6;
        // the concrete bash definition is nevertheless the expected runtime shape.
        ...(scratchBash ? { customTools: [scratchBash as any] } : {}),
      })),
      services,
      diagnostics: services.diagnostics,
    };
  };

  const runtime = await createAgentSessionRuntime(factory, { cwd, agentDir: getAgentDir(), sessionManager });
  await runtime.session.bindExtensions(options.uiContext ? { mode: "rpc", uiContext: options.uiContext } : {});
  return runtime;
}
