import fs from "fs";
import path from "path";
import type { Project } from "../projects/projectTypes.ts";
import { getContext, projectPathspec, runGit, toProjectPath, toRepoPath } from "./core.ts";
import type { GitContext, GitFileStatus, GitRepositoryInfo } from "./types.ts";

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
