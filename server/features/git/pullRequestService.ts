import type { Project } from "../projects/projectTypes.ts";
import { badRequest, conflict } from "../../platform/http/errors.ts";
import {
  createGitHubClient,
  GitHubApiError,
  parseGitHubRemote,
  resolveGitHubToken,
  type GitHubClient,
  type GitHubPullRequest,
  type GitHubRepositoryRef,
} from "../../integrations/github/githubClient.ts";
import { getContext, runGit } from "./core.ts";
import { listGitBranches } from "./worktrees.ts";

export interface PullRequestContext {
  provider: "github" | "unsupported";
  repository?: { owner: string; name: string; url: string };
  branch: string;
  detached: boolean;
  defaultBaseBranch?: string;
  baseBranches: string[];
  published: boolean;
  commitCount: number;
  suggestedTitle: string;
  dirtyFileCount: number;
  existingPullRequest?: GitHubPullRequest;
  authentication: { configured: boolean };
}

export interface CreatePullRequestInput {
  title: string;
  body: string;
  base: string;
  draft: boolean;
  publishBranch: boolean;
}

interface PullRequestDependencies {
  resolveToken: () => Promise<string | null>;
  createClient: (token: string) => GitHubClient;
  parseRemote: typeof parseGitHubRemote;
}

const defaultDependencies: PullRequestDependencies = {
  resolveToken: resolveGitHubToken,
  createClient: createGitHubClient,
  parseRemote: parseGitHubRemote,
};

function assertSafeRef(value: string, label: string) {
  if (!value || value.startsWith("-") || /[\0\r\n]/.test(value)) badRequest(`Invalid ${label}`);
}

function translateGitHubError(error: unknown): never {
  if (!(error instanceof GitHubApiError)) throw error;
  if (error.status === 401) badRequest("GitHub authentication failed. Set a valid GH_TOKEN or GITHUB_TOKEN.");
  if (error.status === 403) badRequest(`GitHub denied the request: ${error.message}`);
  if (error.status === 404) badRequest("GitHub repository not found or the token cannot access it.");
  if (error.status === 422) conflict(`GitHub could not create the pull request: ${error.message}`);
  throw error;
}

async function resolveBranch(root: string) {
  const branch = await runGit(root, ["symbolic-ref", "--quiet", "--short", "HEAD"])
    .then((value) => value.trim(), () => "");
  return { branch: branch || "HEAD", detached: !branch };
}

async function resolveRemote(root: string, branch: string) {
  const configured = branch !== "HEAD"
    ? await runGit(root, ["config", "--get", `branch.${branch}.remote`]).then((value) => value.trim(), () => "")
    : "";
  const remotes = (await runGit(root, ["remote"])).split("\n").map((value) => value.trim()).filter(Boolean);
  const name = configured && configured !== "." ? configured : remotes.includes("origin") ? "origin" : remotes[0];
  if (!name) return null;
  const url = (await runGit(root, ["remote", "get-url", "--push", name]).catch(() => runGit(root, ["remote", "get-url", name]))).trim();
  return { name, url };
}

async function resolvePublished(root: string, branch: string, remote: string) {
  const upstream = await runGit(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"])
    .then((value) => value.trim(), () => "");
  // A new feature branch can track origin/main when it is created from a
  // remote base. That does not mean origin/feature exists.
  if (upstream === `${remote}/${branch}`) return true;
  return runGit(root, ["show-ref", "--verify", "--quiet", `refs/remotes/${remote}/${branch}`]).then(() => true, () => false);
}

async function localContext(project: Pick<Project, "path">, dependencies: PullRequestDependencies) {
  const context = await getContext(project);
  const { branch, detached } = await resolveBranch(context.root);
  const remote = await resolveRemote(context.root, branch);
  let repository = remote ? dependencies.parseRemote(remote.url) : null;
  // Git permits a separate push URL. Prefer it for transport, but fall back
  // to the fetch URL for provider identity (common with read-only HTTPS fetch
  // plus SSH push setups).
  if (!repository && remote) {
    const fetchUrl = await runGit(context.root, ["remote", "get-url", remote.name]).then((value) => value.trim(), () => "");
    if (fetchUrl) repository = dependencies.parseRemote(fetchUrl);
  }
  const [suggestedTitle, dirtyFileCount] = await Promise.all([
    runGit(context.root, ["log", "-1", "--pretty=%s"]).then((value) => value.trim(), () => ""),
    runGit(context.root, ["status", "--porcelain", "--untracked-files=all"]).then((value) => value.split("\n").filter(Boolean).length),
  ]);
  return { context, branch, detached, remote, repository, suggestedTitle, dirtyFileCount };
}

async function countCommits(root: string, remote: string, base: string) {
  assertSafeRef(base, "base branch");
  await runGit(root, ["check-ref-format", "--branch", base]).catch(() => badRequest("Invalid base branch"));
  const remoteRef = `refs/remotes/${remote}/${base}`;
  const revision = await runGit(root, ["rev-parse", "--verify", `${remoteRef}^{commit}`]).then(() => remoteRef, () => base);
  return Number((await runGit(root, ["rev-list", "--count", `${revision}..HEAD`])).trim()) || 0;
}

function localBaseBranches(branches: Awaited<ReturnType<typeof listGitBranches>>, remote: string) {
  const prefix = `${remote}/`;
  return Array.from(new Set(branches
    .filter((entry) => entry.name !== "HEAD")
    .map((entry) => entry.remote && entry.name.startsWith(prefix) ? entry.name.slice(prefix.length) : entry.name)
    .filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

async function fallbackBaseBranch(root: string, remote: string, currentBranch: string) {
  const remoteHead = await runGit(root, ["symbolic-ref", "--quiet", "--short", `refs/remotes/${remote}/HEAD`])
    .then((value) => value.trim().replace(new RegExp(`^${remote.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`), ""), () => "");
  if (remoteHead && remoteHead !== currentBranch) return remoteHead;
  for (const candidate of ["main", "master", "develop"]) {
    if (candidate !== currentBranch && await runGit(root, ["show-ref", "--verify", "--quiet", `refs/remotes/${remote}/${candidate}`]).then(() => true, () => false)) return candidate;
  }
  return "main";
}

async function authenticatedRepository(repository: GitHubRepositoryRef, dependencies: PullRequestDependencies) {
  const token = await dependencies.resolveToken();
  if (!token) return { token: null, client: null, metadata: null };
  const client = dependencies.createClient(token);
  try {
    return { token, client, metadata: await client.getRepository(repository) };
  } catch (error) {
    translateGitHubError(error);
  }
}

export async function getPullRequestContext(
  project: Pick<Project, "path">,
  dependencies: PullRequestDependencies = defaultDependencies,
): Promise<PullRequestContext> {
  const local = await localContext(project, dependencies);
  if (!local.repository || !local.remote) {
    return {
      provider: "unsupported", branch: local.branch, detached: local.detached, baseBranches: [], published: false,
      commitCount: 0, suggestedTitle: local.suggestedTitle, dirtyFileCount: local.dirtyFileCount,
      authentication: { configured: false },
    };
  }

  const authentication = await authenticatedRepository(local.repository, dependencies);
  const defaultBaseBranch = authentication.metadata?.defaultBranch
    || await fallbackBaseBranch(local.context.root, local.remote.name, local.branch);
  const branches = localBaseBranches(await listGitBranches(project), local.remote.name);
  if (!branches.includes(defaultBaseBranch)) branches.unshift(defaultBaseBranch);
  const published = await resolvePublished(local.context.root, local.branch, local.remote.name);
  const commitCount = local.detached ? 0 : await countCommits(local.context.root, local.remote.name, defaultBaseBranch).catch(() => 0);
  let existingPullRequest: GitHubPullRequest | undefined;
  if (authentication.client && !local.detached) {
    try {
      existingPullRequest = await authentication.client.findOpenPullRequest(local.repository, `${local.repository.owner}:${local.branch}`);
    } catch (error) {
      translateGitHubError(error);
    }
  }

  return {
    provider: "github",
    repository: {
      owner: authentication.metadata?.owner || local.repository.owner,
      name: authentication.metadata?.name || local.repository.name,
      url: authentication.metadata?.webUrl || local.repository.webUrl,
    },
    branch: local.branch,
    detached: local.detached,
    defaultBaseBranch,
    baseBranches: branches,
    published,
    commitCount,
    suggestedTitle: local.suggestedTitle,
    dirtyFileCount: local.dirtyFileCount,
    existingPullRequest,
    authentication: { configured: !!authentication.token },
  };
}

export async function createPullRequest(
  project: Pick<Project, "path">,
  input: CreatePullRequestInput,
  dependencies: PullRequestDependencies = defaultDependencies,
): Promise<GitHubPullRequest> {
  const title = input.title?.trim();
  const body = typeof input.body === "string" ? input.body.trim() : "";
  const base = input.base?.trim();
  if (!title) badRequest("title is required");
  if (title.length > 256) badRequest("title must be 256 characters or fewer");
  if (!base) badRequest("base is required");
  assertSafeRef(base, "base branch");

  const local = await localContext(project, dependencies);
  if (local.detached) conflict("Cannot create a pull request from detached HEAD");
  if (!local.remote) badRequest("No Git remote is configured");
  if (!local.repository) badRequest("Pull request creation currently supports GitHub.com remotes only");
  if (local.branch === base) conflict("The source and base branches must be different");
  await runGit(local.context.root, ["check-ref-format", "--branch", base]).catch(() => badRequest("Invalid base branch"));

  const token = await dependencies.resolveToken();
  if (!token) badRequest("GitHub authentication is not configured. Set GH_TOKEN or GITHUB_TOKEN, or sign in with the gh CLI.");
  const client = dependencies.createClient(token);
  try {
    await client.getRepository(local.repository);
    const existing = await client.findOpenPullRequest(local.repository, `${local.repository.owner}:${local.branch}`, base);
    if (existing) return existing;

    await runGit(local.context.root, ["fetch", local.remote.name, base]);
    const commitCount = await countCommits(local.context.root, local.remote.name, base);
    if (commitCount === 0) conflict(`Branch ${local.branch} has no commits ahead of ${base}`);

    const published = await resolvePublished(local.context.root, local.branch, local.remote.name);
    if (!published && !input.publishBranch) conflict("Publish the branch before creating the pull request");
    if (input.publishBranch) {
      await runGit(local.context.root, ["push", "--set-upstream", local.remote.name, `HEAD:refs/heads/${local.branch}`]);
    }

    return await client.createPullRequest(local.repository, {
      title,
      body,
      head: local.branch,
      base,
      draft: !!input.draft,
    });
  } catch (error) {
    translateGitHubError(error);
  }
}
