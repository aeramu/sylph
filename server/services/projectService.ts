import fs from "fs";
import path from "path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createProject, getProjects, saveProjects, getProjectById, updateProject, type ProjectDirectoryInput } from "../projects.ts";
import { getProjectSessionBindings, saveSessionBinding } from "../sessionBindings.ts";
import { recoverSessionBindingsFromPi } from "../piSessionMetadata.ts";
import { badRequest, conflict, notFound } from "./errors.ts";

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
  if (!Array.isArray(requested) || requested.length === 0) badRequest("At least one directory is required");
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

export async function deleteProject(id: string): Promise<void> {
  const project = getProjectById(id);
  if (!project) notFound("Project not found");
  await recoverSessionBindingsFromPi(project.id);
  for (const binding of getProjectSessionBindings(project.id)) {
    const detached = { ...binding, projectId: undefined };
    if (binding.sessionFile && fs.existsSync(binding.sessionFile)) {
      const manager = SessionManager.open(binding.sessionFile);
      manager.appendCustomEntry("sylph.workspace", {
        version: 1,
        directoryId: detached.directoryId,
        cwd: detached.cwd,
        directories: detached.directories,
        branch: detached.branch,
        baseBranch: detached.baseBranch,
        worktree: detached.worktree,
        managedWorktreeRoot: detached.managedWorktreeRoot,
      });
    }
    saveSessionBinding(detached);
  }
  saveProjects(getProjects().filter((entry) => entry.id !== project.id));
}
