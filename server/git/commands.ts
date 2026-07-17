import type { Project } from "../projects.ts";
import { getContext, projectPathspec, runGit, toRepoPath } from "./core.ts";

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
