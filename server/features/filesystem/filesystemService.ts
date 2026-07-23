import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ApplicationError, badRequest, conflict, notFound } from "../../platform/http/errors.ts";
import { artifactMimeType, isTextArtifact, resolveArtifactPath } from "../artifacts/artifactStore.ts";
import { getProjectById, projectAtDirectory } from "../projects/projectRepository.ts";
import { getSessionBinding } from "../sessions/workspace/workspaceBindingRepository.ts";
import { projectForSession, projectFromSessionBinding } from "../sessions/workspace/sessionWorkspace.ts";
import { fuzzyPathScore, MENTION_MAX_RESULTS, walkProject, type MentionEntry } from "./mentionService.ts";

const MAX_FILE_READ_BYTES = 10 * 1024 * 1024;

export async function readScopedFile(input: { scope?: unknown; sessionId?: unknown; path?: unknown }) {
  if (input.scope !== "artifacts") badRequest("Unsupported filesystem scope");
  const sessionId = typeof input.sessionId === "string" ? input.sessionId : "";
  if (!getSessionBinding(sessionId)) notFound("Session not found");
  let resolved: ReturnType<typeof resolveArtifactPath>;
  try { resolved = resolveArtifactPath(sessionId, typeof input.path === "string" ? input.path : ""); }
  catch (error) { badRequest(error instanceof Error ? error.message : "Invalid file path"); }
  if (!fs.existsSync(resolved.absolutePath) || !fs.statSync(resolved.absolutePath).isFile()) notFound("File not found");
  const stat = await fs.promises.stat(resolved.absolutePath);
  if (stat.size > MAX_FILE_READ_BYTES) throw new ApplicationError("File is too large to preview", 413);
  const mimeType = artifactMimeType(resolved.absolutePath);
  const text = isTextArtifact(resolved.absolutePath, mimeType);
  return {
    path: resolved.relativePath,
    mimeType,
    size: stat.size,
    encoding: text ? "utf8" as const : "base64" as const,
    content: await fs.promises.readFile(resolved.absolutePath, text ? "utf8" : "base64"),
  };
}

export async function searchWorkspaceFiles(input: { sessionId?: unknown; projectId?: unknown; directoryId?: unknown; query?: unknown }) {
  const binding = getSessionBinding(input.sessionId);
  if (binding?.workspaceKind === "scratch") return [];
  const project = binding ? projectFromSessionBinding(binding) : getProjectById(input.projectId);
  if (!project) notFound("Project not found");
  if (binding && input.projectId && binding.projectId && binding.projectId !== input.projectId) badRequest("Session does not belong to this project");
  if (!binding && typeof input.directoryId === "string" && !project.directories.some((directory) => directory.id === input.directoryId)) {
    badRequest("Project directory not found");
  }
  const mentionProject = binding ? projectForSession(project, binding) : projectAtDirectory(project, input.directoryId);
  if (!fs.existsSync(mentionProject.path)) notFound("Project path not found");
  const query = typeof input.query === "string" ? input.query : "";
  const entries = await walkProject(mentionProject);
  return entries
    .map((entry) => ({ entry, score: fuzzyPathScore(query, entry.path) }))
    .filter((value): value is { entry: MentionEntry; score: number } => value.score !== null)
    .sort((a, b) => a.entry.kind !== b.entry.kind ? (a.entry.kind === "directory" ? -1 : 1) : b.score - a.score || a.entry.path.localeCompare(b.entry.path))
    .slice(0, MENTION_MAX_RESULTS)
    .map(({ entry }) => entry);
}

export async function listDirectories(requestedPath: unknown) {
  const requested = typeof requestedPath === "string" && requestedPath.trim() ? path.resolve(requestedPath.trim()) : os.homedir();
  let directoryPath = requested;
  let prefix = "";
  let createCandidate: { name: string; path: string; parentPath: string } | undefined;
  try {
    if (!fs.statSync(requested).isDirectory()) { directoryPath = path.dirname(requested); prefix = path.basename(requested).toLowerCase(); }
  } catch {
    directoryPath = path.dirname(requested);
    const name = path.basename(requested);
    prefix = name.toLowerCase();
    if (name && name !== "." && name !== "..") createCandidate = { name, path: requested, parentPath: directoryPath };
  }
  if (!fs.existsSync(directoryPath) || !fs.statSync(directoryPath).isDirectory()) notFound("Directory not found");
  const entries = await fs.promises.readdir(directoryPath, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && (!prefix || entry.name.toLowerCase().startsWith(prefix)))
    .map((entry) => ({ name: entry.name, path: path.join(directoryPath, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { directories, currentPath: directoryPath, createCandidate };
}

export async function createDirectory(input: { parentPath?: unknown; name?: unknown }) {
  if (typeof input.parentPath !== "string" || !input.parentPath.trim()) badRequest("Parent folder is required");
  if (typeof input.name !== "string" || !input.name.trim()) badRequest("Folder name is required");
  const parentPath = path.resolve(input.parentPath.trim());
  const name = input.name.trim();
  if (name === "." || name === ".." || name.includes("/") || name.includes("\\") || name.includes("\0")) badRequest("Folder name cannot contain path separators");
  let parentStats: fs.Stats;
  try { parentStats = await fs.promises.stat(parentPath); } catch { badRequest("Parent folder not found"); }
  if (!parentStats.isDirectory()) badRequest("Parent path is not a folder");
  const directoryPath = path.join(parentPath, name);
  try { await fs.promises.mkdir(directoryPath); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") conflict("A folder with this name already exists");
    throw error;
  }
  return { name, path: directoryPath };
}
