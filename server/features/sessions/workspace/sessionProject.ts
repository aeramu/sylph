import path from "node:path";
import type { Project } from "../../projects/projectTypes.ts";
import type { SessionBinding } from "./workspaceTypes.ts";
import { projectForSession } from "./sessionWorkspace.ts";

export function workspaceProject(binding: SessionBinding, configured?: Project): Project | undefined {
  if (binding.workspaceKind === "scratch") return undefined;
  return projectForSession(configured ?? {
    id: binding.projectId || `standalone:${binding.sessionId}`,
    name: "No Project",
    path: binding.cwd,
    directories: [{
      id: binding.directoryId || "root",
      name: path.basename(binding.cwd) || "workspace",
      path: binding.cwd,
    }],
  }, binding);
}
