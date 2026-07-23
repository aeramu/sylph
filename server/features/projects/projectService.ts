import fs from "fs";
import path from "path";
import { SessionManager } from "../../integrations/pi/sessionSdk.ts";
import { createProject, getProjects, saveProjects, getProjectById, updateProject } from "./projectRepository.ts";
import type { ProjectDirectoryInput } from "./projectTypes.ts";
import { getProjectSessionBindings, saveSessionBinding } from "../sessions/workspace/workspaceBindingRepository.ts";
import { appendWorkspaceMetadata, recoverSessionBindingsFromPi } from "../sessions/workspace/piSessionMetadata.ts";
import { disposeRuntime, getSettledRuntime } from "../../integrations/pi/runtime/runtimeManager.ts";
import { badRequest, conflict, notFound } from "../../platform/http/errors.ts";

export interface ProjectMutationInput {
  name?: unknown;
  path?: unknown;
  directories?: unknown;
}

interface ValidatedDirectories {
  directories: ProjectDirectoryInput[];
  paths: Set<string>;
}

export function validateProjectDirectories(requested: unknown): ValidatedDirectories {
  if (!Array.isArray(requested)) badRequest("directories must be an array");
  const directories: ProjectDirectoryInput[] = [];
  const paths = new Set<string>();
  for (const value of requested) {
    const entry = value as { id?: string; name?: string; path?: unknown } | null;
    if (!entry || typeof entry.path !== "string") badRequest("Invalid directory path");
    const normalized = path.resolve(entry.path);
    let stat: fs.Stats;
    try { stat = fs.statSync(normalized); } catch { badRequest(`Directory not found: ${normalized}`); }
    if (!stat.isDirectory()) badRequest(`Not a directory: ${normalized}`);
    if (paths.has(normalized)) badRequest(`Duplicate directory: ${normalized}`);
    paths.add(normalized);
    directories.push({ id: entry.id, name: entry.name, path: normalized });
  }
  return { directories, paths };
}

export function createProjectFromInput(input: ProjectMutationInput) {
  const requested = Array.isArray(input.directories)
    ? input.directories
    : typeof input.path === "string" ? [{ path: input.path }] : [];
  const validated = validateProjectDirectories(requested);
  if (validated.directories.length === 0 && (typeof input.name !== "string" || !input.name.trim())) badRequest("Project name is required without a directory");
  const projects = getProjects();
  const existing = projects.find((project) => project.directories.some((directory) => validated.paths.has(path.resolve(directory.path))));
  if (existing) conflict("A directory is already part of another project", { project: existing });
  const project = createProject({ name: input.name, directories: validated.directories });
  saveProjects([...projects, project]);
  return project;
}

export function updateProjectFromInput(id: string, input: ProjectMutationInput) {
  const projects = getProjects();
  const index = projects.findIndex((project) => project.id === id);
  if (index < 0) notFound("Project not found");
  const existing = projects[index];
  const validated = validateProjectDirectories(input.directories);
  if (validated.directories.length === 0 && (typeof input.name !== "string" || !input.name.trim())) badRequest("Project name is required without a directory");
  const duplicate = projects.find((project) => project.id !== existing.id
    && project.directories.some((directory) => validated.paths.has(path.resolve(directory.path))));
  if (duplicate) conflict(`A directory is already part of ${duplicate.name}`, { project: duplicate });

  const retainedIds = new Set(validated.directories.map((directory) => directory.id).filter((value): value is string => typeof value === "string"));
  const removedIds = existing.directories.filter((directory) => !retainedIds.has(directory.id)).map((directory) => directory.id);
  const blocking = getProjectSessionBindings(existing.id).find((binding) =>
    (binding.directoryId ? removedIds.includes(binding.directoryId) : false)
    || binding.directories?.some((directory) => removedIds.includes(directory.directoryId)));
  if (blocking) conflict("Cannot remove a directory while a saved session still references it");

  const updated = updateProject(existing, { name: input.name, directories: validated.directories });
  projects[index] = updated;
  saveProjects(projects);
  return updated;
}

export interface DeleteProjectDependencies {
  recover?: typeof recoverSessionBindingsFromPi;
  getRuntime?: typeof getSettledRuntime;
  dispose?: typeof disposeRuntime;
}

export async function deleteProject(id: string, dependencies: DeleteProjectDependencies = {}): Promise<void> {
  const project = getProjectById(id);
  if (!project) notFound("Project not found");
  await (dependencies.recover ?? recoverSessionBindingsFromPi)(project.id);
  const bindings = getProjectSessionBindings(project.id);

  // Do not detach permissions/context underneath an active agent turn. Check
  // every runtime before mutating any binding so project deletion is atomic
  // from the user's perspective.
  for (const binding of bindings) {
    const runtime = await (dependencies.getRuntime ?? getSettledRuntime)(binding.sessionId);
    if (runtime?.session?.isStreaming) conflict("Stop project sessions before deleting the project");
  }

  for (const binding of bindings) {
    const detached = { ...binding, projectId: undefined };
    // Dispose before updating ownership. A later open/turn rebuilds permission
    // roots, context files, and system prompt from the detached metadata.
    (dependencies.dispose ?? disposeRuntime)(binding.sessionId, "project deleted");
    if (binding.sessionFile && fs.existsSync(binding.sessionFile)) {
      appendWorkspaceMetadata(SessionManager.open(binding.sessionFile), detached);
    }
    saveSessionBinding(detached);
  }
  saveProjects(getProjects().filter((entry) => entry.id !== project.id));
}
