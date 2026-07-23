import path from "node:path";
import type { Project } from "../../projects/projectTypes.ts";
import { ensureSessionArtifacts } from "../../artifacts/artifactStore.ts";
import { ensureSessionScratch } from "./sessionScratch.ts";

export interface SessionEnvironment {
  scratchPath?: string;
  artifactsPath?: string;
  variables: Record<string, string>;
}

export function createSessionEnvironment(sessionId?: string): SessionEnvironment {
  if (!sessionId) return { variables: {} };
  const scratchPath = ensureSessionScratch(sessionId);
  const artifactsPath = ensureSessionArtifacts(sessionId);
  return {
    scratchPath,
    artifactsPath,
    variables: {
      TMPDIR: scratchPath,
      TMP: scratchPath,
      TEMP: scratchPath,
      SYLPH_SCRATCH_DIR: scratchPath,
      SYLPH_ARTIFACTS_DIR: artifactsPath,
    },
  };
}

export function sessionEnvironmentPrompt(environment: SessionEnvironment): string | undefined {
  if (!environment.scratchPath || !environment.artifactsPath) return undefined;
  return [
    `A private temporary directory is available at ${environment.scratchPath}.`,
    "For temporary/intermediate files, use $TMPDIR or $SYLPH_SCRATCH_DIR instead of /tmp. They point to that directory and are already authorized for this session.",
    `User-facing artifacts belong in ${environment.artifactsPath} (also available as $SYLPH_ARTIFACTS_DIR). After completing an artifact there, call show_artifact with its path relative to the artifact directory to display it to the user. Keep intermediate files outside the artifacts directory.`,
    "Scratch files and artifacts are not project files and may be cleaned up later; put durable user-requested project changes in the workspace.",
  ].join("\n");
}

export function sessionEnvironmentIsCwd(environment: SessionEnvironment, cwd: string, project?: Project): boolean {
  return !!environment.scratchPath
    && path.resolve(environment.scratchPath) === path.resolve(cwd)
    && !project?.directories.length;
}
