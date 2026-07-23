import fs from "fs";
import path from "path";
import type { Project } from "../projects/projectTypes.ts";
import { runGit } from "./core.ts";
import type { CreatedWorktree, GitBranchInfo, WorktreeRemovalStatus } from "./types.ts";

function assertSafeBranch(branch: string, label: string) {
  if (!branch || branch.startsWith("-") || /[\0\r\n]/.test(branch)) throw new Error(`Invalid ${label}`);
}
function isPathInside(root: string, target: string) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export async function listGitBranches(project: Pick<Project, "path">): Promise<GitBranchInfo[]> {
  const cwd = fs.realpathSync(path.resolve(project.path));
  const output = await runGit(cwd, [
    "for-each-ref",
    "--format=%(refname)%00%(HEAD)",
    "refs/heads",
    "refs/remotes",
  ]);
  const branches: GitBranchInfo[] = [];
  const seen = new Set<string>();
  for (const line of output.split("\n")) {
    if (!line) continue;
    const [ref, head] = line.split("\0");
    if (!ref || ref.endsWith("/HEAD")) continue;
    const remote = ref.startsWith("refs/remotes/");
    const name = ref.replace(remote ? "refs/remotes/" : "refs/heads/", "");
    if (seen.has(name)) continue;
    seen.add(name);
    branches.push({ name, current: head === "*", remote });
  }
  return branches.sort((a, b) => Number(b.current) - Number(a.current) || Number(a.remote) - Number(b.remote) || a.name.localeCompare(b.name));
}

export function worktreeBranchName(prompt: string, sessionId: string) {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "chat";
  const shortId = sessionId.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 8) || "session";
  return `sylph/${slug}-${shortId}`;
}

export async function createManagedWorktree(
  project: Pick<Project, "path">,
  worktreePath: string,
  baseBranch: string,
  branchName: string,
): Promise<CreatedWorktree> {
  assertSafeBranch(baseBranch, "base branch");
  assertSafeBranch(branchName, "worktree branch");
  const cwd = fs.realpathSync(path.resolve(project.path));
  const repositoryRoot = fs.realpathSync(path.resolve((await runGit(cwd, ["rev-parse", "--show-toplevel"])).trim()));
  const projectPrefix = path.relative(repositoryRoot, cwd);
  if (projectPrefix === ".." || projectPrefix.startsWith(`..${path.sep}`) || path.isAbsolute(projectPrefix)) {
    throw new Error("Project is outside the Git repository");
  }
  await runGit(repositoryRoot, ["rev-parse", "--verify", `${baseBranch}^{commit}`]);
  const branch = branchName;
  const target = path.resolve(worktreePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    await runGit(repositoryRoot, ["worktree", "add", "-b", branch, target, baseBranch]);
  } catch (error) {
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
    await runGit(repositoryRoot, ["worktree", "prune"]).catch(() => {});
    // `git worktree add -b` can create the branch before a later checkout
    // failure. This name was generated uniquely for this attempt, so remove it.
    await runGit(repositoryRoot, ["branch", "-D", branch]).catch(() => {});
    throw error;
  }
  // A Sylph project may point at a subdirectory of a larger repository. Keep
  // the session at the equivalent subdirectory inside the new checkout rather
  // than silently broadening its cwd to the repository root.
  return { path: path.join(target, projectPrefix), worktreeRoot: target, branch, baseBranch };
}

export async function getManagedWorktreeRemovalStatus(
  project: Pick<Project, "path">,
  worktreeRoot: string,
  branch: string,
  baseBranch: string,
  managedRoot: string,
): Promise<WorktreeRemovalStatus> {
  assertSafeBranch(branch, "worktree branch");
  assertSafeBranch(baseBranch, "base branch");
  if (!isPathInside(managedRoot, worktreeRoot) || path.resolve(worktreeRoot) === path.resolve(managedRoot)) {
    throw new Error("Refusing to manage a worktree outside Sylph's worktree directory");
  }
  const projectCwd = fs.realpathSync(path.resolve(project.path));
  const repositoryRoot = fs.realpathSync(path.resolve((await runGit(projectCwd, ["rev-parse", "--show-toplevel"])).trim()));
  const exists = fs.existsSync(worktreeRoot);
  let dirty = false;
  if (exists) {
    dirty = (await runGit(worktreeRoot, ["status", "--porcelain", "--untracked-files=all"])).trim().length > 0;
  }
  const branchExists = await runGit(repositoryRoot, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])
    .then(() => true, () => false);
  const merged = !branchExists || await runGit(repositoryRoot, ["merge-base", "--is-ancestor", branch, baseBranch])
    .then(() => true, () => false);
  return { exists, dirty, merged, branch };
}

export async function removeManagedWorktree(
  project: Pick<Project, "path">,
  worktreeRoot: string,
  branch: string,
  baseBranch: string,
  managedRoot: string,
): Promise<WorktreeRemovalStatus> {
  const status = await getManagedWorktreeRemovalStatus(project, worktreeRoot, branch, baseBranch, managedRoot);
  if (status.dirty) throw new Error("Worktree has uncommitted changes; commit or discard them before removal");
  const projectCwd = fs.realpathSync(path.resolve(project.path));
  const repositoryRoot = fs.realpathSync(path.resolve((await runGit(projectCwd, ["rev-parse", "--show-toplevel"])).trim()));
  if (status.exists) await runGit(repositoryRoot, ["worktree", "remove", worktreeRoot]);
  await runGit(repositoryRoot, ["worktree", "prune"]);
  return status;
}

// Creation rollback is intentionally stronger than user-requested removal:
// no session can refer to this branch yet, so discard both checkout and branch.
export async function discardManagedWorktree(
  project: Pick<Project, "path">,
  worktree: CreatedWorktree,
  managedRoot: string,
) {
  await removeManagedWorktree(project, worktree.worktreeRoot, worktree.branch, worktree.baseBranch, managedRoot)
    .catch(async () => {
      // A partially-created checkout may not be registered. Keep the path
      // guard, then remove the filesystem remnant before pruning.
      if (!isPathInside(managedRoot, worktree.worktreeRoot) || path.resolve(worktree.worktreeRoot) === path.resolve(managedRoot)) throw new Error("Unsafe worktree rollback path");
      fs.rmSync(worktree.worktreeRoot, { recursive: true, force: true });
    });
  const projectCwd = fs.realpathSync(path.resolve(project.path));
  const repositoryRoot = fs.realpathSync(path.resolve((await runGit(projectCwd, ["rev-parse", "--show-toplevel"])).trim()));
  await runGit(repositoryRoot, ["worktree", "prune"]);
  await runGit(repositoryRoot, ["branch", "-D", worktree.branch]).catch(() => {});
}

export async function recreateManagedWorktree(
  project: Pick<Project, "path">,
  worktreeRoot: string,
  sessionCwd: string,
  branch: string,
  managedRoot: string,
) {
  assertSafeBranch(branch, "worktree branch");
  if (!isPathInside(managedRoot, worktreeRoot) || path.resolve(worktreeRoot) === path.resolve(managedRoot)) {
    throw new Error("Refusing to create a worktree outside Sylph's worktree directory");
  }
  if (fs.existsSync(worktreeRoot)) throw new Error("Worktree already exists");
  const relativeCwd = path.relative(path.resolve(worktreeRoot), path.resolve(sessionCwd));
  if (relativeCwd === ".." || relativeCwd.startsWith(`..${path.sep}`) || path.isAbsolute(relativeCwd)) {
    throw new Error("Session cwd is outside its managed worktree");
  }
  const projectCwd = fs.realpathSync(path.resolve(project.path));
  const repositoryRoot = fs.realpathSync(path.resolve((await runGit(projectCwd, ["rev-parse", "--show-toplevel"])).trim()));
  await runGit(repositoryRoot, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
  // A manually deleted checkout stays registered with Git, which makes
  // `worktree add` at the same path fail with "missing but already
  // registered" and keeps the branch marked as checked out.
  await runGit(repositoryRoot, ["worktree", "prune"]);
  fs.mkdirSync(path.dirname(worktreeRoot), { recursive: true });
  try {
    await runGit(repositoryRoot, ["worktree", "add", worktreeRoot, branch]);
    if (!fs.existsSync(sessionCwd)) throw new Error("The project subdirectory does not exist on this branch");
  } catch (error) {
    if (fs.existsSync(worktreeRoot)) fs.rmSync(worktreeRoot, { recursive: true, force: true });
    await runGit(repositoryRoot, ["worktree", "prune"]).catch(() => {});
    throw error;
  }
}
