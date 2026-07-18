import fs from "fs";
import path from "path";
import { ensureSessionScratch } from "./sessionScratch.ts";

export interface ArtifactInfo {
  path: string;
  name: string;
  size: number;
  modifiedAt: string;
  mimeType: string;
}

const MIME_TYPES: Record<string, string> = {
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".csv": "text/csv",
  ".gif": "image/gif",
  ".htm": "text/html",
  ".html": "text/html",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript",
  ".json": "application/json",
  ".jsx": "text/javascript",
  ".md": "text/markdown",
  ".mdx": "text/markdown",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".toml": "application/toml",
  ".ts": "text/typescript",
  ".tsx": "text/typescript",
  ".txt": "text/plain",
  ".webp": "image/webp",
  ".xml": "application/xml",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
};

export function artifactMimeType(filePath: string): string {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

export function isTextArtifact(filePath: string, mimeType = artifactMimeType(filePath)): boolean {
  return mimeType.startsWith("text/")
    || mimeType === "application/json"
    || mimeType === "application/toml"
    || mimeType === "application/xml"
    || mimeType === "application/yaml"
    || [".c", ".cc", ".cpp", ".css", ".env", ".go", ".h", ".java", ".php", ".py", ".rb", ".rs", ".sh", ".sql"].includes(path.extname(filePath).toLowerCase());
}

export function ensureSessionArtifacts(sessionId: string): string {
  const artifactsPath = path.join(ensureSessionScratch(sessionId), "artifacts");
  fs.mkdirSync(artifactsPath, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(artifactsPath, 0o700); } catch { /* best effort on filesystems without Unix modes */ }
  return artifactsPath;
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

/** Resolve a model/user supplied artifact path and reject traversal and escaping symlinks. */
export function resolveArtifactPath(sessionId: string, requestedPath: string): { root: string; absolutePath: string; relativePath: string } {
  if (typeof requestedPath !== "string" || !requestedPath.trim()) throw new Error("Artifact path is required");
  const root = ensureSessionArtifacts(sessionId);
  const absolutePath = path.resolve(root, requestedPath.trim());
  if (!isInside(root, absolutePath) || absolutePath === root) throw new Error("Artifact path must be a file inside the artifact directory");

  // Existing targets must also remain beneath the root after symlinks resolve.
  if (fs.existsSync(absolutePath)) {
    const realRoot = fs.realpathSync(root);
    const realTarget = fs.realpathSync(absolutePath);
    if (!isInside(realRoot, realTarget)) throw new Error("Artifact path escapes the artifact directory");
  }

  return {
    root,
    absolutePath,
    relativePath: path.relative(root, absolutePath).split(path.sep).join("/"),
  };
}

export async function listSessionArtifacts(sessionId: string): Promise<ArtifactInfo[]> {
  const root = ensureSessionArtifacts(sessionId);
  const artifacts: ArtifactInfo[] = [];

  const walk = async (directory: string): Promise<void> => {
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      // Never follow links: an artifact listing must not expose files outside
      // the private per-session artifact directory.
      if (entry.isSymbolicLink()) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else if (entry.isFile()) {
        const stat = await fs.promises.stat(absolutePath);
        artifacts.push({
          path: path.relative(root, absolutePath).split(path.sep).join("/"),
          name: entry.name,
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          mimeType: artifactMimeType(absolutePath),
        });
      }
    }
  };

  await walk(root);
  return artifacts.sort((a, b) => a.path.localeCompare(b.path));
}
