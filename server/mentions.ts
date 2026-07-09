import fs from "fs";
import path from "path";
import type { Project } from "./projects.ts";

// @mention resolution: the composer lets the user reference project files with
// @path or @{path with spaces}. On send, those references are expanded inline
// into the prompt so the model receives the file (or folder) contents. The
// same walk also powers the /api/fs/files autocomplete.

const MENTION_IGNORED_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", ".vite", "coverage"]);
const MENTION_TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".markdown", ".json", ".js", ".jsx", ".ts", ".tsx",
  ".py", ".rb", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".hpp",
  ".css", ".html", ".xml", ".yml", ".yaml", ".toml", ".ini", ".cfg",
  ".sh", ".bash", ".zsh", ".sql", ".csv", ".log", ".env", ".vue", ".svelte",
]);
export const MENTION_MAX_RESULTS = 50;
const MENTION_MAX_SCAN_ENTRIES = 5000;
const MENTION_MAX_FILE_BYTES = 512 * 1024;
const MENTION_MAX_TOTAL_BYTES = 2 * 1024 * 1024;

export interface MentionEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
}

function resolveInsideProject(project: Project, relPath: string): string | undefined {
  const root = path.resolve(project.path);
  const abs = path.resolve(root, relPath || ".");
  if (abs !== root && !abs.startsWith(root + path.sep)) return undefined;
  return abs;
}

function isProbablyTextFile(filePath: string): boolean {
  return MENTION_TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
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

export async function walkProject(project: Project): Promise<MentionEntry[]> {
  const root = path.resolve(project.path);
  const out: MentionEntry[] = [];
  const queue = [root];
  while (queue.length && out.length < MENTION_MAX_SCAN_ENTRIES) {
    const dir = queue.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".env") continue;
      if (entry.isDirectory() && MENTION_IGNORED_DIRS.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs).split(path.sep).join("/");
      if (entry.isDirectory()) {
        out.push({ name: entry.name, path: rel, kind: "directory" });
        queue.push(abs);
      } else if (entry.isFile()) {
        out.push({ name: entry.name, path: rel, kind: "file" });
      }
      if (out.length >= MENTION_MAX_SCAN_ENTRIES) break;
    }
  }
  return out;
}

function extractMentionPaths(text: string): string[] {
  const found = new Set<string>();
  const braced = /@\{([^}\n]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = braced.exec(text))) found.add(match[1].trim());

  const bare = /(^|\s)@([^\s{}]+)/g;
  while ((match = bare.exec(text))) found.add(match[2].trim());
  return [...found].filter(Boolean);
}

export async function resolveMentionsInPrompt(project: Project | undefined, text: string): Promise<string> {
  if (!project || !/(^|\s)@(?:\{|[^\s{])/.test(text)) return text;
  const paths = extractMentionPaths(text);
  if (!paths.length) return text;

  const budget = { remaining: MENTION_MAX_TOTAL_BYTES };
  const blocks: string[] = [];
  for (const relPath of paths) {
    const block = await buildMentionBlock(project, relPath, budget);
    if (block) blocks.push(block);
  }

  return blocks.length ? `${text}\n\n${blocks.join("\n\n")}` : text;
}

async function buildMentionBlock(project: Project, relPath: string, budget: { remaining: number }): Promise<string | null> {
  const abs = resolveInsideProject(project, relPath);
  if (!abs) return null;
  let stat: fs.Stats;
  try { stat = await fs.promises.stat(abs); } catch { return null; }

  if (stat.isFile()) {
    if (!isProbablyTextFile(abs) || stat.size > MENTION_MAX_FILE_BYTES || stat.size > budget.remaining) return null;
    const text = await fs.promises.readFile(abs, "utf8");
    budget.remaining -= Buffer.byteLength(text, "utf8");
    return `<file name="${relPath}">\n${text}\n</file>`;
  }

  if (!stat.isDirectory()) return null;
  const root = path.resolve(project.path);
  const files: string[] = [];
  const dirs = [abs];
  while (dirs.length && files.length < 80 && budget.remaining > 0) {
    const dir = dirs.shift()!;
    let entries: fs.Dirent[];
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { continue; }
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".env") continue;
      if (entry.isDirectory() && MENTION_IGNORED_DIRS.has(entry.name)) continue;
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) dirs.push(child);
      else if (entry.isFile() && isProbablyTextFile(child)) files.push(child);
    }
  }

  const parts: string[] = [`<folder name="${relPath}">`];
  parts.push("<tree>");
  for (const file of files) parts.push(path.relative(root, file).split(path.sep).join("/"));
  parts.push("</tree>");
  for (const file of files) {
    let s: fs.Stats;
    try { s = await fs.promises.stat(file); } catch { continue; }
    if (s.size > MENTION_MAX_FILE_BYTES || s.size > budget.remaining) continue;
    const text = await fs.promises.readFile(file, "utf8");
    budget.remaining -= Buffer.byteLength(text, "utf8");
    parts.push(`<file name="${path.relative(root, file).split(path.sep).join("/")}">\n${text}\n</file>`);
  }
  parts.push("</folder>");
  return parts.join("\n");
}
