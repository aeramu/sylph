import type { Project } from "../../projects/projectTypes.ts";
import type { SessionHistoryHandle } from "./sessionHistoryPort.ts";

export interface NewSessionOptions {
  directoryId?: string;
  /** Standalone cwd when creating a session without a project. */
  standalonePath?: string;
  useWorktree?: boolean;
  /** Base branch per project directory; legacy baseBranch applies to all roots. */
  baseBranches?: Record<string, string>;
  baseBranch?: string;
  branchPrompt?: string;
}

export interface ResolvedSessionRuntime {
  sessionManager: SessionHistoryHandle;
  targetCwd: string;
  runtimeProject?: Project;
  runtimeDirectoryId?: string;
  /** False for a resumed session and true for a newly-created session. */
  created: boolean;
}
