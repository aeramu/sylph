export interface GitBranchInfo {
  name: string;
  current: boolean;
  remote: boolean;
}

export interface WorktreeRemovalStatus {
  exists: boolean;
  dirty: boolean;
  merged: boolean;
  branch: string;
}

export interface CreatedWorktree {
  path: string;
  worktreeRoot: string;
  branch: string;
  baseBranch: string;
}

export interface GitFileStatus {
  path: string;
  index: string;
  workingTree: string;
  unstagedPatch: string;
  stagedPatch: string;
  isUntracked: boolean;
}

export interface GitRepositoryInfo {
  branch: string;
  detached: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
}

export interface GitCommitInfo {
  hash: string;
  shortHash: string;
  author: string;
  authoredAt: string;
  subject: string;
}

export interface GitContext {
  root: string;
  projectRoot: string;
  projectPrefix: string;
}
