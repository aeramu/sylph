import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import type { Project } from "./projects.ts";

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
  // Session cwd. For a project rooted in a repository subdirectory, this is
  // the equivalent subdirectory in the new checkout.
  path: string;
  // Root passed to `git worktree add`; retain it for safe future cleanup.
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

type GitContext = {
  root: string;
  projectRoot: string;
  projectPrefix: string;
};

async function runGit(cwd: string, args: string[], input?: string) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn("git", args, { cwd });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error((stderr || stdout || "git command failed").trim()));
    });

    child.stdin.end(input);
  });
}

function toGitPath(filePath: string) {
  return filePath.split(path.sep).join("/");
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

function assertSafeBranch(branch: string, label: string) {
  if (!branch || branch.startsWith("-") || /[\0\r\n]/.test(branch)) throw new Error(`Invalid ${label}`);
}

function isPathInside(root: string, target: string) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
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

async function getContext(project: Pick<Project, "path">): Promise<GitContext> {
  const projectRoot = fs.realpathSync(path.resolve(project.path));
  const root = fs.realpathSync(path.resolve((await runGit(projectRoot, ["rev-parse", "--show-toplevel"])).trim()));
  const relative = path.relative(root, projectRoot);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Project is outside the Git repository");
  }
  return { root, projectRoot, projectPrefix: toGitPath(relative) };
}

function projectPathspec(context: GitContext) {
  return context.projectPrefix || ".";
}

function toProjectPath(context: GitContext, repoPath: string) {
  if (!context.projectPrefix) return repoPath;
  const prefix = `${context.projectPrefix}/`;
  return repoPath.startsWith(prefix) ? repoPath.slice(prefix.length) : null;
}

function toRepoPath(context: GitContext, filePath: string) {
  if (!filePath || path.isAbsolute(filePath)) throw new Error("Invalid project path");
  const normalized = path.posix.normalize(filePath);
  if (normalized === ".." || normalized.startsWith("../") || normalized === ".") {
    throw new Error("Path escapes project");
  }
  const repoPath = context.projectPrefix ? `${context.projectPrefix}/${normalized}` : normalized;
  const resolved = path.resolve(context.root, ...repoPath.split("/"));
  if (resolved !== context.projectRoot && !resolved.startsWith(`${context.projectRoot}${path.sep}`)) {
    throw new Error("Path escapes project");
  }
  return repoPath;
}

function parsePorcelainZ(output: string, context: GitContext) {
  const files = new Map<string, GitFileStatus>();
  for (const record of output.split("\0")) {
    if (!record) continue;
    const index = record[0] || " ";
    const workingTree = record[1] || " ";
    const repoPath = record.slice(3);
    const filePath = toProjectPath(context, repoPath);
    if (filePath == null || !filePath) continue;
    files.set(filePath, {
      path: filePath,
      index,
      workingTree,
      unstagedPatch: "",
      stagedPatch: "",
      isUntracked: index === "?" && workingTree === "?",
    });
  }
  return files;
}

function canRepresentInTextPatch(filePath: string, content: Buffer) {
  // Let whole-file `git add` handle names requiring Git's C quoting, binary
  // data, and invalid UTF-8. Synthesizing any of those can change bytes.
  if (!/^[\p{L}\p{N}._/@+-]+$/u.test(filePath)) return false;
  if (content.includes(0)) return false;
  const decoded = content.toString("utf-8");
  return Buffer.from(decoded, "utf-8").equals(content);
}

async function untrackedPatch(context: GitContext, repoPath: string) {
  const fullPath = path.resolve(context.root, ...repoPath.split("/"));
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(fullPath);
  } catch {
    return "";
  }
  if (!stat.isFile()) return "";

  const contentBuffer = fs.readFileSync(fullPath);
  if (!canRepresentInTextPatch(repoPath, contentBuffer)) return "";
  const content = contentBuffer.toString("utf-8");
  const lines = content.length ? content.split("\n") : [];
  const endsWithNewline = content.endsWith("\n");
  if (endsWithNewline) lines.pop();
  const body = lines.map((line) => `+${line}`).join("\n");
  const noNewline = !endsWithNewline && content.length ? "\n\\ No newline at end of file" : "";
  const mode = stat.mode & 0o111 ? "100755" : "100644";
  return [
    `diff --git a/${repoPath} b/${repoPath}`,
    `new file mode ${mode}`,
    "index 0000000..0000000",
    "--- /dev/null",
    `+++ b/${repoPath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    body + noNewline,
  ].filter(Boolean).join("\n");
}

function parseBatchDiff(output: string, context: GitContext) {
  const patches = new Map<string, string>();
  if (!output) return patches;
  const separator = output.indexOf("\0\0diff --git ");
  if (separator < 0) return patches;

  // --patch-with-raw -z emits machine-readable raw records first, then patch
  // bodies in the same order. --no-renames guarantees one path per record.
  const rawFields = output.slice(0, separator).split("\0").filter(Boolean);
  const repoPaths: string[] = [];
  for (let index = 0; index + 1 < rawFields.length; index += 2) {
    repoPaths.push(rawFields[index + 1]);
  }
  const patchText = output.slice(separator + 2);
  const starts = Array.from(patchText.matchAll(/^diff --git /gm), (match) => match.index);
  starts.forEach((start, index) => {
    const repoPath = repoPaths[index];
    const filePath = repoPath == null ? null : toProjectPath(context, repoPath);
    if (filePath) patches.set(filePath, patchText.slice(start, starts[index + 1] ?? patchText.length).trimEnd());
  });
  return patches;
}

async function batchDiff(context: GitContext, cached: boolean) {
  return parseBatchDiff(await runGit(context.root, [
    "-c", "core.quotepath=false", "diff", ...(cached ? ["--cached"] : []),
    "--no-ext-diff", "--no-color", "--no-renames", "--patch-with-raw", "-z",
    "--", projectPathspec(context),
  ]), context);
}

async function getRepositoryInfo(context: GitContext): Promise<GitRepositoryInfo> {
  const symbolicBranch = await runGit(context.root, ["symbolic-ref", "--quiet", "--short", "HEAD"])
    .then((value) => value.trim(), () => null);
  const branch = symbolicBranch
    ?? await runGit(context.root, ["rev-parse", "--short", "HEAD"]).then((value) => value.trim(), () => "HEAD");
  const upstream = await runGit(context.root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"])
    .then((value) => value.trim(), () => null);
  let ahead = 0;
  let behind = 0;
  if (upstream) {
    const counts = (await runGit(context.root, ["rev-list", "--left-right", "--count", `HEAD...${upstream}`])).trim().split(/\s+/);
    ahead = Number(counts[0]) || 0;
    behind = Number(counts[1]) || 0;
  }
  return { branch, detached: symbolicBranch == null, upstream, ahead, behind };
}

export async function getStagedDiff(project: Pick<Project, "path">) {
  const context = await getContext(project);
  return runGit(context.root, [
    "diff", "--cached", "--no-ext-diff", "--no-color", "--no-renames", "--patch",
    "--", projectPathspec(context),
  ]);
}

export async function getGitStatus(project: Pick<Project, "path">) {
  const context = await getContext(project);
  const statusOutput = await runGit(context.root, [
    "status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames",
    "--", projectPathspec(context),
  ]);
  const files = parsePorcelainZ(statusOutput, context);
  const [unstaged, staged, repository] = await Promise.all([
    batchDiff(context, false),
    batchDiff(context, true),
    getRepositoryInfo(context),
  ]);

  await Promise.all(Array.from(files.values()).map(async (file) => {
    if (file.isUntracked) {
      file.unstagedPatch = await untrackedPatch(context, toRepoPath(context, file.path));
      return;
    }
    file.unstagedPatch = unstaged.get(file.path) ?? "";
    file.stagedPatch = staged.get(file.path) ?? "";
  }));

  return { files: Array.from(files.values()).sort((a, b) => a.path.localeCompare(b.path)), repository };
}

function parseGitLog(output: string): GitCommitInfo[] {
  return output.split("\x1e").map((record) => record.replace(/^\n/, "")).filter(Boolean).map((record) => {
    const [hash, shortHash, author, authoredAt, subject] = record.split("\x1f");
    return { hash, shortHash, author, authoredAt, subject };
  });
}

async function gitLogRange(context: GitContext, revision: string, limit: number) {
  const output = await runGit(context.root, [
    "log", `-${limit}`, revision, "--date=iso-strict", "--pretty=format:%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e",
  ]).catch((error) => {
    if (/does not have any commits yet|unknown revision|bad default revision|ambiguous argument/i.test(error.message)) return "";
    throw error;
  });
  return parseGitLog(output);
}

export async function getGitLog(project: Pick<Project, "path">, limit = 30): Promise<GitCommitInfo[]> {
  const context = await getContext(project);
  return gitLogRange(context, "HEAD", Math.max(1, Math.min(100, Math.floor(limit))));
}

export async function getGitDivergence(project: Pick<Project, "path">, limit = 30) {
  const context = await getContext(project);
  const repository = await getRepositoryInfo(context);
  if (!repository.upstream) return { upstream: null, unpushed: [], unpulled: [] };
  const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const [unpushed, unpulled] = await Promise.all([
    gitLogRange(context, `${repository.upstream}..HEAD`, boundedLimit),
    gitLogRange(context, `HEAD..${repository.upstream}`, boundedLimit),
  ]);
  return { upstream: repository.upstream, unpushed, unpulled };
}

export async function fetchRemote(project: Pick<Project, "path">) {
  const context = await getContext(project);
  const upstream = await runGit(context.root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"])
    .then((value) => value.trim(), () => null);
  if (!upstream) return;
  await runGit(context.root, ["fetch"]);
}

export async function pull(project: Pick<Project, "path">) {
  const context = await getContext(project);
  await runGit(context.root, ["pull", "--ff-only"]);
}

export async function push(project: Pick<Project, "path">) {
  const context = await getContext(project);
  await runGit(context.root, ["push"]);
}

export async function stageFile(project: Pick<Project, "path">, filePath: string) {
  const context = await getContext(project);
  await runGit(context.root, ["add", "--", toRepoPath(context, filePath)]);
}

export async function stageAll(project: Pick<Project, "path">) {
  const context = await getContext(project);
  await runGit(context.root, ["add", "--all", "--", projectPathspec(context)]);
}

export async function unstageFile(project: Pick<Project, "path">, filePath: string) {
  const context = await getContext(project);
  const repoPath = toRepoPath(context, filePath);
  const hasHead = await runGit(context.root, ["rev-parse", "--verify", "--quiet", "HEAD"]).then(() => true, () => false);
  if (hasHead) {
    await runGit(context.root, ["restore", "--staged", "--", repoPath]);
  } else {
    await runGit(context.root, ["rm", "--cached", "--force", "--", repoPath]);
  }
}

function parsePatchPaths(output: string) {
  return output.split("\0").filter(Boolean).map((record) => {
    const fields = record.split("\t");
    return fields.slice(2).join("\t");
  });
}

export async function unstageAll(project: Pick<Project, "path">) {
  const context = await getContext(project);
  const pathspec = projectPathspec(context);
  const hasHead = await runGit(context.root, ["rev-parse", "--verify", "--quiet", "HEAD"]).then(() => true, () => false);
  if (hasHead) {
    await runGit(context.root, ["restore", "--staged", "--", pathspec]);
  } else {
    await runGit(context.root, ["rm", "--cached", "--force", "-r", "--ignore-unmatch", "--", pathspec]);
  }
}

export async function applyToIndex(project: Pick<Project, "path">, filePath: string, patch: string, reverse = false) {
  if (!patch.trim()) throw new Error("Patch is required");
  const context = await getContext(project);
  const repoPath = toRepoPath(context, filePath);
  const input = patch.endsWith("\n") ? patch : `${patch}\n`;
  const patchPaths = parsePatchPaths(await runGit(context.root, ["apply", "--numstat", "-z"], input));
  if (patchPaths.length !== 1 || patchPaths[0] !== repoPath) {
    throw new Error("Patch does not match the requested project file");
  }
  await runGit(context.root, [
    "apply", "--cached", "--recount", "--whitespace=nowarn", ...(reverse ? ["--reverse"] : []),
  ], input);
}

export async function commit(project: Pick<Project, "path">, message: string) {
  const trimmed = message.trim();
  if (!trimmed) throw new Error("Commit message is required");
  const context = await getContext(project);
  if (context.projectPrefix) {
    const stagedPaths = (await runGit(context.root, ["diff", "--cached", "--name-only", "-z"]))
      .split("\0")
      .filter(Boolean);
    const prefix = `${context.projectPrefix}/`;
    if (stagedPaths.some((filePath) => !filePath.startsWith(prefix))) {
      throw new Error("Cannot commit: the parent repository has staged changes outside this project");
    }
  }
  await runGit(context.root, ["commit", "-m", trimmed]);
}
