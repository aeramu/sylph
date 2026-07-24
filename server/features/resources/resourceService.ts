import fs from "node:fs";
import { getIntrospectionRuntime } from "../../integrations/pi/runtime/runtimeManager.ts";
import { notFound } from "../../platform/http/errors.ts";
import { extensionPackageInfo } from "./extensionInstallationService.ts";
import { extensionDisplayName, getLoadedExtensions, getLoadedSkills } from "./resourceIntrospection.ts";

export async function getSkillDetail(name: string) {
  const runtime = await getIntrospectionRuntime();
  const skill = getLoadedSkills(runtime.session).find((entry: any) => entry.name === name);
  if (!skill?.filePath) notFound("Skill not found");
  return { name: skill.name, description: skill.description, content: await fs.promises.readFile(skill.filePath, "utf8"), path: skill.filePath };
}

function mapValues(map: Map<string, any> | undefined, mapper: (name: string, value: any) => any) {
  return Array.from(map?.entries() ?? []).map(([name, value]) => mapper(name, value));
}

export async function getExtensionDetail(name: string) {
  const runtime = await getIntrospectionRuntime();
  const extensions = getLoadedExtensions(runtime.session);
  const extension = extensions.find((entry: any) => extensionDisplayName(entry) === name);
  if (!extension) notFound("Extension not found");
  return {
    name: extensionDisplayName(extension), path: extension.path, resolvedPath: extension.resolvedPath, sourceInfo: extension.sourceInfo,
    package: extensionPackageInfo(extension, extensions),
    tools: mapValues(extension.tools, (toolName, registered) => ({
      name: toolName, label: registered.definition?.label, description: registered.definition?.description,
      promptSnippet: registered.definition?.promptSnippet, promptGuidelines: registered.definition?.promptGuidelines,
      parameters: registered.definition?.parameters, sourceInfo: registered.sourceInfo,
    })),
    commands: mapValues(extension.commands, (commandName, command) => ({ name: commandName, description: command.description, sourceInfo: command.sourceInfo })),
    flags: mapValues(extension.flags, (flagName, flag) => ({ name: flagName, description: flag.description, type: flag.type, default: flag.default })),
    shortcuts: mapValues(extension.shortcuts, (shortcut, definition) => ({ shortcut, description: definition.description })),
    events: mapValues(extension.handlers, (event, handlers) => ({ name: event, count: Array.isArray(handlers) ? handlers.length : 0 })),
    messageRenderers: Array.from(extension.messageRenderers?.keys() ?? []),
  };
}
