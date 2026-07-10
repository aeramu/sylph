import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import type { Project } from "./projects.ts";

export interface GitFileStatus {
  path: string;
  index: string;
  workingTree: string;
  unstagedPatch: string;
  stagedPatch: string;
  isUntracked: boolean;
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

async function getContext(project: Project): Promise<GitContext> {
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

export async function getGitStatus(project: Project) {
  const context = await getContext(project);
  const statusOutput = await runGit(context.root, [
    "status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames",
    "--", projectPathspec(context),
  ]);
  const files = parsePorcelainZ(statusOutput, context);
  const [unstaged, staged] = await Promise.all([batchDiff(context, false), batchDiff(context, true)]);

  await Promise.all(Array.from(files.values()).map(async (file) => {
    if (file.isUntracked) {
      file.unstagedPatch = await untrackedPatch(context, toRepoPath(context, file.path));
      return;
    }
    file.unstagedPatch = unstaged.get(file.path) ?? "";
    file.stagedPatch = staged.get(file.path) ?? "";
  }));

  return { files: Array.from(files.values()).sort((a, b) => a.path.localeCompare(b.path)) };
}

export async function stageFile(project: Project, filePath: string) {
  const context = await getContext(project);
  await runGit(context.root, ["add", "--", toRepoPath(context, filePath)]);
}

export async function stageAll(project: Project) {
  const context = await getContext(project);
  await runGit(context.root, ["add", "--all", "--", projectPathspec(context)]);
}

export async function unstageFile(project: Project, filePath: string) {
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

export async function unstageAll(project: Project) {
  const context = await getContext(project);
  const pathspec = projectPathspec(context);
  const hasHead = await runGit(context.root, ["rev-parse", "--verify", "--quiet", "HEAD"]).then(() => true, () => false);
  if (hasHead) {
    await runGit(context.root, ["restore", "--staged", "--", pathspec]);
  } else {
    await runGit(context.root, ["rm", "--cached", "--force", "-r", "--ignore-unmatch", "--", pathspec]);
  }
}

export async function applyToIndex(project: Project, filePath: string, patch: string, reverse = false) {
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

export async function commit(project: Project, message: string) {
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
