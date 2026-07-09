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
  ".sh", ".bash", ".zsh", ".sql", ".csv", ".log", ".vue", ".svelte",
]);
// Extensionless files that are still plain text and worth mentioning.
// Note ".env" is deliberately absent everywhere: env files hold secrets.
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

// Resolves a mention path to a real location, rejecting anything that ends up
// outside the project — both lexical `..` escapes and symlinks pointing out of
// the root. Returns the realpath'd root too so display names stay consistent
// on systems where the project path itself goes through a symlink.
async function resolveInsideProject(project: Project, relPath: string): Promise<{ abs: string; root: string } | undefined> {
  const root = path.resolve(project.path);
  const abs = path.resolve(root, relPath || ".");
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

// The walk runs on every autocomplete keystroke, so cache it briefly.
const mentionWalkCache = new Map<string, { at: number; entries: MentionEntry[] }>();

export async function walkProject(project: Project): Promise<MentionEntry[]> {
  const root = path.resolve(project.path);
  const cacheKey = `${project.id}:${root}`;
  const cached = mentionWalkCache.get(cacheKey);
  if (cached && Date.now() - cached.at < MENTION_WALK_CACHE_TTL_MS) return cached.entries;

  const out: MentionEntry[] = [];
  const queue = [root];
  for (let qi = 0; qi < queue.length && out.length < MENTION_MAX_SCAN_ENTRIES; qi++) {
    const dir = queue[qi];
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.isDirectory() && MENTION_IGNORED_DIRS.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs).split(path.sep).join("/");
      if (entry.isDirectory()) {
        out.push({ name: entry.name, path: rel, kind: "directory" });
        queue.push(abs);
      } else if (entry.isFile() && isProbablyTextFile(abs)) {
        // Only offer entries the mention resolver will actually inline, so the
        // dropdown never suggests a file that would silently drop from the prompt.
        out.push({ name: entry.name, path: rel, kind: "file" });
      }
      if (out.length >= MENTION_MAX_SCAN_ENTRIES) break;
    }
  }
  mentionWalkCache.set(cacheKey, { at: Date.now(), entries: out });
  return out;
}

function extractMentionPaths(text: string): string[] {
  const found = new Set<string>();
  const braced = /@\{([^}\n]+)\}/g;
  let match: RegExpExecArray | null;
  // Braced mentions carry an explicit boundary, so keep their content verbatim.
  while ((match = braced.exec(text))) found.add(match[1].trim());

  const bare = /(^|\s)@([^\s{}]+)/g;
  while ((match = bare.exec(text))) {
    // A bare mention that ends a sentence picks up trailing punctuation
    // ("see @src/app.ts.") that isn't part of the path; strip it so the file
    // still resolves. Keep a trailing slash — it's a meaningful directory hint.
    found.add(match[2].replace(/[.,;:!?)\]}'"]+$/, "").trim());
  }
  return [...found].filter(Boolean);
}

// Resolves @mentions found in `source` and appends their contents to `prompt`.
// `source` defaults to `prompt` but is passed separately when the prompt has
// extra machine-appended content (e.g. inlined file attachments) that must not
// be scanned for mentions.
export async function resolveMentionsInPrompt(project: Project | undefined, prompt: string, source: string = prompt): Promise<string> {
  if (!project || !/(^|\s)@(?:\{|[^\s{])/.test(source)) return prompt;
  const paths = extractMentionPaths(source);
  if (!paths.length) return prompt;

  const budget = { remaining: MENTION_MAX_TOTAL_BYTES };
  const blocks: string[] = [];
  for (const relPath of paths) {
    const block = await buildMentionBlock(project, relPath, budget);
    if (block) blocks.push(block);
  }

  return blocks.length ? `${prompt}\n\n${blocks.join("\n\n")}` : prompt;
}

// XML-escape a path for use in a name="" attribute of the mention wrapper tags.
function xmlAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function buildMentionBlock(project: Project, relPath: string, budget: { remaining: number }): Promise<string | null> {
  const resolved = await resolveInsideProject(project, relPath);
  if (!resolved) return null;
  const { abs, root } = resolved;
  let stat: fs.Stats;
  try { stat = await fs.promises.stat(abs); } catch { return null; }

  if (stat.isFile()) {
    if (!isProbablyTextFile(abs) || stat.size > MENTION_MAX_FILE_BYTES || stat.size > budget.remaining) return null;
    const text = await fs.promises.readFile(abs, "utf8");
    budget.remaining -= Buffer.byteLength(text, "utf8");
    return `<file name="${xmlAttr(relPath)}">\n${text}\n</file>`;
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

  const rel = (file: string) => path.relative(root, file).split(path.sep).join("/");
  const parts: string[] = [`<folder name="${xmlAttr(relPath)}">`];
  parts.push("<tree>");
  for (const file of files) parts.push(rel(file));
  if (truncated) parts.push("… (listing truncated)");
  parts.push("</tree>");
  for (const file of files) {
    let s: fs.Stats;
    try { s = await fs.promises.stat(file); } catch { continue; }
    if (s.size > MENTION_MAX_FILE_BYTES || s.size > budget.remaining) continue;
    const text = await fs.promises.readFile(file, "utf8");
    budget.remaining -= Buffer.byteLength(text, "utf8");
    parts.push(`<file name="${xmlAttr(rel(file))}">\n${text}\n</file>`);
  }
  parts.push("</folder>");
  return parts.join("\n");
}
