import fs from "node:fs";
import { resolveArtifactPath } from "./artifactStore.ts";

export interface ArtifactPresentation {
  shown: boolean;
  path?: string;
  message: string;
}

/** Validate an artifact and ask the supplied presentation port to open it. */
export function presentArtifact(
  sessionId: string,
  requestedPath: string,
  show?: (path: string) => void,
): ArtifactPresentation {
  let resolved: ReturnType<typeof resolveArtifactPath>;
  try {
    resolved = resolveArtifactPath(sessionId, requestedPath);
  } catch (error) {
    return { shown: false, message: error instanceof Error ? error.message : "Invalid artifact path" };
  }
  if (!fs.existsSync(resolved.absolutePath) || !fs.statSync(resolved.absolutePath).isFile()) {
    return { shown: false, path: resolved.relativePath, message: `Artifact not found: ${resolved.relativePath}` };
  }
  if (!show) {
    return { shown: false, path: resolved.relativePath, message: `Artifact created: ${resolved.relativePath}` };
  }
  show(resolved.relativePath);
  return { shown: true, path: resolved.relativePath, message: `Showing artifact: ${resolved.relativePath}` };
}
