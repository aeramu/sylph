export interface SessionDirectoryBinding {
  directoryId: string;
  name: string;
  /** Original configured/source checkout. */
  sourcePath?: string;
  /** Actual checkout used by this session (source checkout or managed worktree). */
  path: string;
  branch?: string;
  baseBranch?: string;
  worktreeRoot?: string;
}

export interface SessionBinding {
  sessionId: string;
  /** Scratch sessions have no user-visible workspace roots. */
  workspaceKind?: "directories" | "scratch";
  /** Indexed project ownership. Missing means the virtual “No Project” group. */
  projectId?: string;
  /** Per-chat starting root; not the workspace authorization boundary. */
  directoryId?: string;
  cwd: string;
  directories?: SessionDirectoryBinding[];
  /** Physical Pi JSONL locator; machine-local and not embedded as metadata. */
  sessionFile?: string;
  branch?: string;
  baseBranch?: string;
  worktree?: boolean;
  managedWorktreeRoot?: string;
  /** Permission fingerprints approved for the lifetime of this session. */
  permissionApprovals?: string[];
}
