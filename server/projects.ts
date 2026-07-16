import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { SYLPH_DIR, PROJECTS_FILE } from "./config.ts";

export interface ProjectDirectory {
  id: string;
  name: string;
  path: string;
}

export interface Project {
  id: string;
  name: string;
  /** Primary directory path, retained for compatibility with older callers and stores. */
  path: string;
  directories: ProjectDirectory[];
  primaryDirectoryId: string;
}

type StoredProject = Partial<Project> & Pick<Project, "id" | "name">;

if (!fs.existsSync(SYLPH_DIR)) {
  fs.mkdirSync(SYLPH_DIR, { recursive: true });
}
if (!fs.existsSync(PROJECTS_FILE)) {
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify([]));
}

function directoryId(projectId: string, index: number) {
  return `${projectId}-dir-${index + 1}`;
}

/** Normalize legacy `{ path }` projects and keep `path` equal to the primary root. */
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
  if (directories.length === 0) return undefined;

  const usedNames = new Set<string>();
  for (const directory of directories) {
    const baseName = directory.name || "root";
    let uniqueName = baseName;
    for (let suffix = 2; usedNames.has(uniqueName.toLowerCase()); suffix++) uniqueName = `${baseName}-${suffix}`;
    directory.name = uniqueName;
    usedNames.add(uniqueName.toLowerCase());
  }

  const requestedPrimary = typeof value.primaryDirectoryId === "string" ? value.primaryDirectoryId : undefined;
  const primary = directories.find((entry) => entry.id === requestedPrimary) ?? directories[0];
  return {
    id: value.id,
    name: value.name,
    path: primary.path,
    directories,
    primaryDirectoryId: primary.id,
  };
}

export function getProjects(): Project[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(PROJECTS_FILE, "utf-8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeProject).filter((project): project is Project => !!project);
  } catch {
    return [];
  }
}

export function getProjectById(projectId: unknown): Project | undefined {
  if (typeof projectId !== "string") return undefined;
  return getProjects().find((project) => project.id === projectId);
}

export function getProjectDirectory(project: Project, directoryId: unknown): ProjectDirectory {
  if (typeof directoryId === "string") {
    const directory = project.directories.find((entry) => entry.id === directoryId);
    if (directory) return directory;
  }
  return project.directories.find((entry) => entry.id === project.primaryDirectoryId) ?? project.directories[0];
}

export function findProjectDirectoryByPath(project: Project, directoryPath: string): ProjectDirectory | undefined {
  const resolved = path.resolve(directoryPath);
  return project.directories.find((entry) => path.resolve(entry.path) === resolved);
}

/**
 * Return a project view whose `path` and primary directory represent the root
 * used by one chat. Other roots remain available for workspace mentions.
 */
export function projectAtDirectory(project: Project, directoryId: unknown, overridePath?: string): Project {
  const selected = getProjectDirectory(project, directoryId);
  const selectedPath = path.resolve(overridePath ?? selected.path);
  return {
    ...project,
    path: selectedPath,
    primaryDirectoryId: selected.id,
    directories: project.directories.map((entry) => entry.id === selected.id ? { ...entry, path: selectedPath } : entry),
  };
}

export function createProject(input: { name?: unknown; directories: Array<{ name?: unknown; path: string; primary?: boolean }> }): Project {
  const id = `proj-${randomUUID()}`;
  const usedNames = new Set<string>();
  const directories = input.directories.map((entry, index) => {
    const resolvedPath = path.resolve(entry.path);
    const baseName = (typeof entry.name === "string" ? entry.name.trim() : "") || path.basename(resolvedPath) || `root-${index + 1}`;
    let name = baseName;
    for (let suffix = 2; usedNames.has(name.toLowerCase()); suffix++) name = `${baseName}-${suffix}`;
    usedNames.add(name.toLowerCase());
    return { id: directoryId(id, index), name, path: resolvedPath };
  });
  const primaryIndex = Math.max(0, input.directories.findIndex((entry) => entry.primary));
  const primary = directories[primaryIndex] ?? directories[0];
  return {
    id,
    name: typeof input.name === "string" && input.name.trim() ? input.name.trim() : primary.name,
    path: primary.path,
    directories,
    primaryDirectoryId: primary.id,
  };
}

export function saveProjects(projects: Project[]) {
  const normalized = projects.map(normalizeProject).filter((project): project is Project => !!project);
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(normalized, null, 2));
}
