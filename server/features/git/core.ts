import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import type { Project } from "../projects/projectTypes.ts";
import type { GitContext } from "./types.ts";

export async function runGit(cwd: string, args: string[], input?: string) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn("git", args, { cwd });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf-8"); child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error((stderr || stdout || "git command failed").trim())));
    child.stdin.end(input);
  });
}

export function toGitPath(filePath: string) { return filePath.split(path.sep).join("/"); }

export async function getContext(project: Pick<Project, "path">): Promise<GitContext> {
  const projectRoot = fs.realpathSync(path.resolve(project.path));
  const root = fs.realpathSync(path.resolve((await runGit(projectRoot, ["rev-parse", "--show-toplevel"])).trim()));
  const relative = path.relative(root, projectRoot);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("Project is outside the Git repository");
  return { root, projectRoot, projectPrefix: toGitPath(relative) };
}

export function projectPathspec(context: GitContext) { return context.projectPrefix || "."; }
export function toProjectPath(context: GitContext, repoPath: string) {
  if (!context.projectPrefix) return repoPath;
  const prefix = `${context.projectPrefix}/`;
  return repoPath.startsWith(prefix) ? repoPath.slice(prefix.length) : null;
}
export function toRepoPath(context: GitContext, filePath: string) {
  if (!filePath || path.isAbsolute(filePath)) throw new Error("Invalid project path");
  const normalized = path.posix.normalize(filePath);
  if (normalized === ".." || normalized.startsWith("../") || normalized === ".") throw new Error("Path escapes project");
  const repoPath = context.projectPrefix ? `${context.projectPrefix}/${normalized}` : normalized;
  const resolved = path.resolve(context.root, ...repoPath.split("/"));
  if (resolved !== context.projectRoot && !resolved.startsWith(`${context.projectRoot}${path.sep}`)) throw new Error("Path escapes project");
  return repoPath;
}
