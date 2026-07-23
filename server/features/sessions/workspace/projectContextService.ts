import path from "node:path";
import type { Project } from "../../projects/projectTypes.ts";

export interface ContextFile {
  path: string;
  content: string;
}

/** Merge context files from every root and namespace their displayed paths. */
export function mergeProjectContextFiles(
  existing: ContextFile[],
  project: Project | undefined,
  loadDirectory: (directoryPath: string) => ContextFile[],
): ContextFile[] {
  if (!project || project.directories.length < 2) return existing;
  const files = [...existing];
  const seen = new Set(files.map((file) => path.resolve(file.path)));
  for (const directory of project.directories) {
    for (const file of loadDirectory(directory.path)) {
      const resolved = path.resolve(file.path);
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      files.push({ path: `${directory.name}:${file.path}`, content: file.content });
    }
  }
  return files;
}
