import express from "express";
import { handleError } from "./routeHelpers.ts";
import fs from "fs";
import { getIntrospectionRuntime } from "../runtime/index.ts";
import { extensionDisplayName, getLoadedExtensions, getLoadedSkills, introspectionRoute } from "./routeHelpers.ts";

export function registerResourceRoutes(router: express.Router): void {
  router.get("/api/commands", introspectionRoute((session) => ({
    commands: [
      ...session.extensionRunner.getRegisteredCommands().map((c: any) => ({
        name: c.invocationName,
        description: c.description,
        source: "extension",
      })),
      ...(session.promptTemplates || []).map((t: any) => ({
        name: t.name,
        description: t.description,
        source: "prompt",
      })),
      ...getLoadedSkills(session).map((s: any) => ({
        name: `skill:${s.name}`,
        description: s.description,
        source: "skill",
      })),
    ],
  })));

  router.get("/api/resources/skills", introspectionRoute((session) => ({
    resources: getLoadedSkills(session).map((s: any) => ({
      name: s.name,
      description: s.description,
    })),
  })));

  router.get("/api/resources/extensions", introspectionRoute((session) => ({
    resources: getLoadedExtensions(session).map((e: any) => ({
      name: extensionDisplayName(e),
    })),
  })));

  router.get("/api/resources/skills/:name", async (req, res) => {
    try {
      const runtime = await getIntrospectionRuntime();
      const session = runtime.session as any;
      const skill = getLoadedSkills(session).find((s: any) => s.name === req.params.name);

      if (!skill?.filePath) {
        return res.status(404).json({ error: "Skill not found" });
      }

      const content = await fs.promises.readFile(skill.filePath, "utf8");
      res.json({
        name: skill.name,
        description: skill.description,
        content,
        path: skill.filePath,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.get("/api/resources/extensions/:name", async (req, res) => {
    try {
      const runtime = await getIntrospectionRuntime();
      const session = runtime.session as any;
      const extension = getLoadedExtensions(session).find((e: any) => extensionDisplayName(e) === req.params.name);

      if (!extension) {
        return res.status(404).json({ error: "Extension not found" });
      }

      const mapValues = (map: Map<string, any> | undefined, mapper: (name: string, value: any) => any) =>
        Array.from(map?.entries() ?? []).map(([name, value]) => mapper(name, value));

      res.json({
        name: extensionDisplayName(extension),
        path: extension.path,
        resolvedPath: extension.resolvedPath,
        sourceInfo: extension.sourceInfo,
        tools: mapValues(extension.tools, (name, registered) => ({
          name,
          label: registered.definition?.label,
          description: registered.definition?.description,
          promptSnippet: registered.definition?.promptSnippet,
          promptGuidelines: registered.definition?.promptGuidelines,
          parameters: registered.definition?.parameters,
          sourceInfo: registered.sourceInfo,
        })),
        commands: mapValues(extension.commands, (name, command) => ({
          name,
          description: command.description,
          sourceInfo: command.sourceInfo,
        })),
        flags: mapValues(extension.flags, (name, flag) => ({
          name,
          description: flag.description,
          type: flag.type,
          default: flag.default,
        })),
        shortcuts: mapValues(extension.shortcuts, (shortcut, shortcutDef) => ({
          shortcut,
          description: shortcutDef.description,
        })),
        events: mapValues(extension.handlers, (event, handlers) => ({
          name: event,
          count: Array.isArray(handlers) ? handlers.length : 0,
        })),
        messageRenderers: Array.from(extension.messageRenderers?.keys() ?? []),
      });
    } catch (err) {
      handleError(res, err);
    }
  });

}
