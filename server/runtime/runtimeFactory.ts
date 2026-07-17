import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  createAgentSessionRuntime, createAgentSessionServices, createAgentSessionFromServices, getAgentDir, loadProjectContextFiles,
  type CreateAgentSessionRuntimeFactory,
} from "@earendil-works/pi-coding-agent";
import { authStorage, modelRegistry } from "../auth.ts";
import type { Project } from "../projects.ts";
import { getSessionBinding, saveSessionBinding } from "../sessionBindings.ts";
import { createPermissionExtension, isThirdPartyPermissionExtension } from "../permissions.ts";
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
    const permissionRoots = (options.project?.directories ?? [{ id: "cwd", name: "workspace", path: cwd }]).map((directory) => ({
      id: directory.id, name: directory.name, path: directory.path, access: "read-write" as const,
    }));
    const boundSessionId = options.sessionId ?? sessionManager.getSessionId?.();
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
        extensionFactories: options.project ? [{
          name: "sylph-permissions",
          factory: createPermissionExtension(
            {
              roots: permissionRoots,
              externalAccess: "ask",
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
        extensionsOverride: (base) => options.project ? ({
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
          const workspace = workspacePrompt(options.project, options.directoryId, cwd);
          return workspace ? [...base, workspace] : base;
        },
      },
    });
    return {
      ...(await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent })),
      services,
      diagnostics: services.diagnostics,
    };
  };

  const runtime = await createAgentSessionRuntime(factory, { cwd, agentDir: getAgentDir(), sessionManager });
  await runtime.session.bindExtensions(options.uiContext ? { mode: "rpc", uiContext: options.uiContext } : {});
  return runtime;
}
