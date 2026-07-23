import path from "path";
import { randomUUID } from "crypto";
import { PROJECTS_FILE } from "../../config.ts";
import { JsonFileStore } from "../../platform/filesystem/jsonFileStore.ts";
import type { Project, ProjectDirectory, ProjectDirectoryInput } from "./projectTypes.ts";

type StoredProject = Partial<Project> & Pick<Project, "id" | "name">;

function directoryId(projectId: string, index: number) {
  return `${projectId}-dir-${index + 1}`;
}

/** Normalize legacy `{ path }` projects and keep `path` equal to the first root. */
export function normalizeProject(value: StoredProject): Project | undefined {
  if (!value || typeof value.id !== "string" || typeof value.name !== "string") return undefined;

  const directories = Array.isArray(value.directories)
    ? value.directories
      .filter((entry): entry is ProjectDirectory => !!entry && typeof entry.path === "string")
      .map((entry, index) => ({
        id: typeof entry.id === "string" && entry.id ? entry.id : directoryId(value.id, index),
        name: typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : path.basename(path.resolve(entry.path)),
        path: path.resolve(entry.path),
      }))
    : [];

  if (directories.length === 0 && typeof value.path === "string" && value.path) {
    directories.push({
      id: directoryId(value.id, 0),
      name: path.basename(path.resolve(value.path)) || "root",
      path: path.resolve(value.path),
    });
  }
  const usedNames = new Set<string>();
  for (const directory of directories) {
    const baseName = directory.name || "root";
    let uniqueName = baseName;
    for (let suffix = 2; usedNames.has(uniqueName.toLowerCase()); suffix++) uniqueName = `${baseName}-${suffix}`;
    directory.name = uniqueName;
    usedNames.add(uniqueName.toLowerCase());
  }

  return {
    id: value.id,
    name: value.name,
    path: directories[0]?.path ?? "",
    directories,
  };
}

const projectStore = new JsonFileStore<Project[]>({
  filePath: PROJECTS_FILE,
  defaultValue: () => [],
  normalize: (value) => Array.isArray(value)
    ? value.map((entry) => normalizeProject(entry as StoredProject)).filter((project): project is Project => !!project)
    : [],
});

export function getProjects(): Project[] {
  return projectStore.read();
}

export function getProjectById(projectId: unknown): Project | undefined {
  if (typeof projectId !== "string") return undefined;
  return getProjects().find((project) => project.id === projectId);
}

export function getProjectDirectory(project: Project, directoryId: unknown): ProjectDirectory | undefined {
  if (typeof directoryId === "string") {
    const directory = project.directories.find((entry) => entry.id === directoryId);
    if (directory) return directory;
  }
  return project.directories.find((entry) => entry.id === project.activeDirectoryId) ?? project.directories[0];
}

export function findProjectDirectoryByPath(project: Project, directoryPath: string): ProjectDirectory | undefined {
  const resolved = path.resolve(directoryPath);
  return project.directories.find((entry) => path.resolve(entry.path) === resolved);
}

/**
 * Return a project view whose `path` represents the root used by one chat.
 * Other roots remain available for workspace mentions.
 */
export function projectAtDirectory(project: Project, directoryId: unknown, overridePath?: string): Project {
  const selected = getProjectDirectory(project, directoryId);
  if (!selected) throw new Error("Project has no directories");
  const selectedPath = path.resolve(overridePath ?? selected.path);
  return {
    ...project,
    path: selectedPath,
    activeDirectoryId: selected.id,
    directories: project.directories.map((entry) => entry.id === selected.id ? { ...entry, path: selectedPath } : entry),
  };
}

function buildProject(id: string, input: { name?: unknown; directories: ProjectDirectoryInput[] }, existing?: Project): Project {
  const usedNames = new Set<string>();
  const existingIds = new Set(existing?.directories.map((directory) => directory.id) ?? []);
  const directories = input.directories.map((entry, index) => {
    const resolvedPath = path.resolve(entry.path);
    const baseName = (typeof entry.name === "string" ? entry.name.trim() : "") || path.basename(resolvedPath) || `root-${index + 1}`;
    let name = baseName;
    for (let suffix = 2; usedNames.has(name.toLowerCase()); suffix++) name = `${baseName}-${suffix}`;
    usedNames.add(name.toLowerCase());
    const requestedId = typeof entry.id === "string" && existingIds.has(entry.id) ? entry.id : undefined;
    return { id: requestedId ?? `${id}-dir-${randomUUID()}`, name, path: resolvedPath };
  });
  const first = directories[0];
  const requestedName = typeof input.name === "string" ? input.name.trim() : "";
  if (!requestedName && !first) throw new Error("Project name is required when no directories are configured");
  return {
    id,
    name: requestedName || first.name,
    path: first?.path ?? "",
    directories,
  };
}

export function createProject(input: { name?: unknown; directories: ProjectDirectoryInput[] }): Project {
  return buildProject(`proj-${randomUUID()}`, input);
}

export function updateProject(existing: Project, input: { name?: unknown; directories: ProjectDirectoryInput[] }): Project {
  return buildProject(existing.id, input, existing);
}

export function saveProjects(projects: Project[]) {
  projectStore.write(projects);
}
