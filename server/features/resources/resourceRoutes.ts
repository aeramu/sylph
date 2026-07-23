import express from "express";
import { asyncRoute } from "../../platform/http/routeError.ts";
import { extensionDisplayName, getLoadedExtensions, getLoadedSkills, introspectionRoute } from "./resourceIntrospection.ts";
import { getExtensionDetail, getSkillDetail } from "./resourceService.ts";

export function registerResourceRoutes(router: express.Router): void {
  router.get("/api/commands", introspectionRoute((session) => ({
    commands: [
      ...session.extensionRunner.getRegisteredCommands().map((command: any) => ({ name: command.invocationName, description: command.description, source: "extension" })),
      ...(session.promptTemplates || []).map((template: any) => ({ name: template.name, description: template.description, source: "prompt" })),
      ...getLoadedSkills(session).map((skill: any) => ({ name: `skill:${skill.name}`, description: skill.description, source: "skill" })),
    ],
  })));
  router.get("/api/resources/skills", introspectionRoute((session) => ({
    resources: getLoadedSkills(session).map((skill: any) => ({ name: skill.name, description: skill.description })),
  })));
  router.get("/api/resources/extensions", introspectionRoute((session) => ({
    resources: getLoadedExtensions(session).map((extension: any) => ({ name: extensionDisplayName(extension) })),
  })));
  router.get("/api/resources/skills/:name", asyncRoute(async (req, res) => res.json(await getSkillDetail(String(req.params.name)))));
  router.get("/api/resources/extensions/:name", asyncRoute(async (req, res) => res.json(await getExtensionDetail(String(req.params.name)))));
}
