import fs from "fs";
import path from "path";
import type { Project, ProjectDirectory } from "../projects/projectTypes.ts";
import { getProjectDirectory } from "../projects/projectRepository.ts";

// @mention resolution: multi-root projects expose paths as @root-name/path.
// An unprefixed path remains valid relative to the chat's active directory for
// backward compatibility and quick references from that root.

const MENTION_IGNORED_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", ".vite", "coverage"]);
const MENTION_TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".markdown", ".json", ".js", ".jsx", ".ts", ".tsx",
  ".py", ".rb", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".hpp",
  ".css", ".html", ".xml", ".yml", ".yaml", ".toml", ".ini", ".cfg",
  ".sh", ".bash", ".zsh", ".sql", ".csv", ".log", ".vue", ".svelte",
]);
const MENTION_TEXT_BASENAMES = new Set([
  "makefile", "dockerfile", "license", "readme", "changelog", "notice",
  "gemfile", "rakefile", "procfile", "justfile",
]);
export const MENTION_MAX_RESULTS = 50;
const MENTION_MAX_SCAN_ENTRIES = 5000;
const MENTION_MAX_DIR_SCAN = 400;
const MENTION_MAX_FILE_BYTES = 512 * 1024;
const MENTION_MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const MENTION_WALK_CACHE_TTL_MS = 3000;

export type MentionEntry = { name: string; path: string; kind: "file" | "directory" };

type MentionRoot = { directory: ProjectDirectory; path: string; prefix: string };

function mentionRoots(project: Project): MentionRoot[] {
  const active = getProjectDirectory(project, project.activeDirectoryId);
  if (!active) return [];
  return project.directories.map((directory) => ({
    directory,
    // project.path may be a session worktree checkout for the active root.
    path: directory.id === active.id ? path.resolve(project.path) : path.resolve(directory.path),
    prefix: project.directories.length > 1 ? `${directory.name}/` : "",
  }));
}

function parseMentionRoot(project: Project, mentionPath: string): { root: MentionRoot; relPath: string } {
  const roots = mentionRoots(project);
  if (project.directories.length > 1) {
    const slash = mentionPath.indexOf("/");
    const alias = slash < 0 ? mentionPath : mentionPath.slice(0, slash);
    const matched = roots.find((entry) => entry.directory.name.toLowerCase() === alias.toLowerCase());
    if (matched) return { root: matched, relPath: slash < 0 ? "" : mentionPath.slice(slash + 1) };
  }
  const active = roots.find((entry) => entry.directory.id === project.activeDirectoryId) ?? roots[0];
  return { root: active, relPath: mentionPath };
}

async function resolveInsideProject(project: Project, mentionPath: string): Promise<{ abs: string; root: string } | undefined> {
  const parsed = parseMentionRoot(project, mentionPath);
  const root = path.resolve(parsed.root.path);
  const abs = path.resolve(root, parsed.relPath || ".");
  if (abs !== root && !abs.startsWith(root + path.sep)) return undefined;
  let realAbs: string;
  let realRoot: string;
  try {
    [realAbs, realRoot] = await Promise.all([fs.promises.realpath(abs), fs.promises.realpath(root)]);
  } catch {
    return undefined;
  }
  if (realAbs !== realRoot && !realAbs.startsWith(realRoot + path.sep)) return undefined;
  return { abs: realAbs, root: realRoot };
}

function isProbablyTextFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (ext) return MENTION_TEXT_EXTENSIONS.has(ext);
  return MENTION_TEXT_BASENAMES.has(path.basename(filePath).toLowerCase());
}

export function fuzzyPathScore(query: string, target: string): number | null {
  const q = query.trim().toLowerCase();
  const t = target.toLowerCase();
  if (!q) return 0;
  if (t.includes(q)) return 1000 - t.indexOf(q) - t.length * 0.01;
  let qi = 0;
  let score = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue;
    score += 1;
    if (ti === 0 || "/-_ .".includes(t[ti - 1])) score += 3;
    qi++;
  }
  return qi === q.length ? score - t.length * 0.01 : null;
}

const mentionWalkCache = new Map<string, { at: number; entries: MentionEntry[] }>();

export async function walkProject(project: Project): Promise<MentionEntry[]> {
  const roots = mentionRoots(project);
  const cacheKey = `${project.id}:${roots.map((entry) => `${entry.directory.id}:${entry.path}`).join("|")}`;
  const cached = mentionWalkCache.get(cacheKey);
  if (cached && Date.now() - cached.at < MENTION_WALK_CACHE_TTL_MS) return cached.entries;

  const out: MentionEntry[] = [];
  for (const mentionRoot of roots) {
    if (out.length >= MENTION_MAX_SCAN_ENTRIES) break;
    const root = mentionRoot.path;
    if (mentionRoot.prefix) {
      out.push({ name: mentionRoot.directory.name, path: mentionRoot.prefix.slice(0, -1), kind: "directory" });
    }
    const queue = [root];
    for (let qi = 0; qi < queue.length && out.length < MENTION_MAX_SCAN_ENTRIES; qi++) {
      const dir = queue[qi];
      let entries: fs.Dirent[];
      try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { continue; }
      entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        if (entry.isDirectory() && MENTION_IGNORED_DIRS.has(entry.name)) continue;
        const abs = path.join(dir, entry.name);
        const relative = path.relative(root, abs).split(path.sep).join("/");
        const displayPath = `${mentionRoot.prefix}${relative}`;
        if (entry.isDirectory()) {
          out.push({ name: entry.name, path: displayPath, kind: "directory" });
          queue.push(abs);
        } else if (entry.isFile() && isProbablyTextFile(abs)) {
          out.push({ name: entry.name, path: displayPath, kind: "file" });
        }
        if (out.length >= MENTION_MAX_SCAN_ENTRIES) break;
      }
    }
  }
  mentionWalkCache.set(cacheKey, { at: Date.now(), entries: out });
  return out;
}

function extractMentionPaths(text: string): string[] {
  const found = new Set<string>();
  const braced = /@\{([^}\n]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = braced.exec(text))) found.add(match[1].trim());
  const bare = /(^|\s)@([^\s{}]+)/g;
  while ((match = bare.exec(text))) {
    found.add(match[2].replace(/[.,;:!?)\]}'"]+$/, "").trim());
  }
  return [...found].filter(Boolean);
}

export async function resolveMentionsInPrompt(project: Project | undefined, prompt: string, source: string = prompt): Promise<string> {
  if (!project || !/(^|\s)@(?:\{|[^\s{])/.test(source)) return prompt;
  const paths = extractMentionPaths(source);
  if (!paths.length) return prompt;

  const budget = { remaining: MENTION_MAX_TOTAL_BYTES };
  const blocks: string[] = [];
  for (const mentionPath of paths) {
    const block = await buildMentionBlock(project, mentionPath, budget);
    if (block) blocks.push(block);
  }
  return blocks.length ? `${prompt}\n\n${blocks.join("\n\n")}` : prompt;
}

function xmlAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function buildMentionBlock(project: Project, mentionPath: string, budget: { remaining: number }): Promise<string | null> {
  const resolved = await resolveInsideProject(project, mentionPath);
  if (!resolved) return null;
  const { abs, root } = resolved;
  let stat: fs.Stats;
  try { stat = await fs.promises.stat(abs); } catch { return null; }

  if (stat.isFile()) {
    if (!isProbablyTextFile(abs) || stat.size > MENTION_MAX_FILE_BYTES || stat.size > budget.remaining) return null;
    const text = await fs.promises.readFile(abs, "utf8");
    budget.remaining -= Buffer.byteLength(text, "utf8");
    return `<file name="${xmlAttr(mentionPath)}">\n${text}\n</file>`;
  }

  if (!stat.isDirectory()) return null;
  const files: string[] = [];
  const dirs = [abs];
  let dirsScanned = 0;
  let truncated = false;
  while (dirs.length && budget.remaining > 0) {
    if (files.length >= 80 || dirsScanned >= MENTION_MAX_DIR_SCAN) { truncated = true; break; }
    const dir = dirs.shift()!;
    dirsScanned++;
    let entries: fs.Dirent[];
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { continue; }
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.isDirectory() && MENTION_IGNORED_DIRS.has(entry.name)) continue;
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) dirs.push(child);
      else if (entry.isFile() && isProbablyTextFile(child)) files.push(child);
    }
  }

  const parsed = parseMentionRoot(project, mentionPath);
  const prefix = project.directories.length > 1 ? `${parsed.root.directory.name}/` : "";
  const rel = (file: string) => `${prefix}${path.relative(root, file).split(path.sep).join("/")}`;
  const parts: string[] = [`<folder name="${xmlAttr(mentionPath)}">`, "<tree>"];
  for (const file of files) parts.push(rel(file));
  if (truncated) parts.push("… (listing truncated)");
  parts.push("</tree>");
  for (const file of files) {
    let fileStat: fs.Stats;
    try { fileStat = await fs.promises.stat(file); } catch { continue; }
    if (fileStat.size > MENTION_MAX_FILE_BYTES || fileStat.size > budget.remaining) continue;
    const text = await fs.promises.readFile(file, "utf8");
    budget.remaining -= Buffer.byteLength(text, "utf8");
    parts.push(`<file name="${xmlAttr(rel(file))}">\n${text}\n</file>`);
  }
  parts.push("</folder>");
  return parts.join("\n");
}
