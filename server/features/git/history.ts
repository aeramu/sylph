import type { Project } from "../projects/projectTypes.ts";
import { getContext, runGit } from "./core.ts";
import type { GitCommitInfo, GitContext, GitRepositoryInfo } from "./types.ts";

async function getRepositoryInfo(context: GitContext): Promise<GitRepositoryInfo> {
  const symbolicBranch = await runGit(context.root, ["symbolic-ref", "--quiet", "--short", "HEAD"]).then((value) => value.trim(), () => null);
  const branch = symbolicBranch ?? await runGit(context.root, ["rev-parse", "--short", "HEAD"]).then((value) => value.trim(), () => "HEAD");
  const upstream = await runGit(context.root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]).then((value) => value.trim(), () => null);
  let ahead = 0, behind = 0;
  if (upstream) { const counts = (await runGit(context.root, ["rev-list", "--left-right", "--count", `HEAD...${upstream}`])).trim().split(/\s+/); ahead = Number(counts[0]) || 0; behind = Number(counts[1]) || 0; }
  return { branch, detached: symbolicBranch == null, upstream, ahead, behind };
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
