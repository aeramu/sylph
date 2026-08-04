import { spawn } from "child_process";

export interface GitHubRepositoryRef {
  host: "github.com";
  owner: string;
  name: string;
  webUrl: string;
}

export interface GitHubRepositoryMetadata {
  owner: string;
  name: string;
  webUrl: string;
  defaultBranch: string;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  url: string;
  state: "open";
  draft: boolean;
}

export interface CreateGitHubPullRequestInput {
  title: string;
  body: string;
  head: string;
  base: string;
  draft: boolean;
}

export interface GitHubClient {
  getRepository(repository: GitHubRepositoryRef): Promise<GitHubRepositoryMetadata>;
  findOpenPullRequest(repository: GitHubRepositoryRef, head: string, base?: string): Promise<GitHubPullRequest | undefined>;
  createPullRequest(repository: GitHubRepositoryRef, input: CreateGitHubPullRequestInput): Promise<GitHubPullRequest>;
}

export class GitHubApiError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "GitHubApiError";
    this.status = status;
    this.details = details;
  }
}

function normalizedRepository(owner: string, name: string): GitHubRepositoryRef | null {
  const cleanOwner = owner.trim();
  const cleanName = name.trim().replace(/\.git$/i, "");
  if (!cleanOwner || !cleanName || cleanOwner.includes("/") || cleanName.includes("/")) return null;
  return { host: "github.com", owner: cleanOwner, name: cleanName, webUrl: `https://github.com/${cleanOwner}/${cleanName}` };
}

export function parseGitHubRemote(remoteUrl: string): GitHubRepositoryRef | null {
  const value = remoteUrl.trim();
  const scp = value.match(/^(?:[^@/\s]+@)?github\.com:([^/\s]+)\/(.+)$/i);
  if (scp) return normalizedRepository(scp[1], scp[2]);

  try {
    const parsed = new URL(value);
    if (parsed.hostname.toLowerCase() !== "github.com") return null;
    const parts = parsed.pathname.replace(/^\/+|\/+$/g, "").split("/");
    if (parts.length !== 2) return null;
    return normalizedRepository(parts[0], parts[1]);
  } catch {
    return null;
  }
}

function readGhToken(): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn("gh", ["auth", "token"], { stdio: ["ignore", "pipe", "ignore"] });
    let stdout = "";
    child.stdout.setEncoding("utf-8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.on("error", () => resolve(null));
    child.on("close", (code) => resolve(code === 0 && stdout.trim() ? stdout.trim() : null));
  });
}

export async function resolveGitHubToken(): Promise<string | null> {
  const environmentToken = process.env.GH_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim();
  return environmentToken || await readGhToken();
}

function apiMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const record = payload as Record<string, unknown>;
  const message = typeof record.message === "string" ? record.message : fallback;
  const errors = Array.isArray(record.errors)
    ? record.errors.map((entry) => typeof entry === "string" ? entry : entry && typeof entry === "object" && typeof (entry as any).message === "string" ? (entry as any).message : "").filter(Boolean)
    : [];
  return errors.length ? `${message}: ${errors.join("; ")}` : message;
}

function normalizePullRequest(value: any): GitHubPullRequest {
  return {
    number: Number(value.number),
    title: String(value.title || "Pull request"),
    url: String(value.html_url),
    state: "open",
    draft: !!value.draft,
  };
}

export function createGitHubClient(token: string, fetchImpl: typeof fetch = fetch): GitHubClient {
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetchImpl(`https://api.github.com${path}`, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
    const payload = await response.json().catch(() => undefined);
    if (!response.ok) throw new GitHubApiError(apiMessage(payload, `GitHub request failed (${response.status})`), response.status, payload);
    return payload as T;
  };

  return {
    async getRepository(repository) {
      const data = await request<any>(`/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`);
      return {
        owner: String(data.owner?.login || repository.owner),
        name: String(data.name || repository.name),
        webUrl: String(data.html_url || repository.webUrl),
        defaultBranch: String(data.default_branch || "main"),
      };
    },
    async findOpenPullRequest(repository, head, base) {
      const query = new URLSearchParams({ state: "open", head, per_page: "10" });
      if (base) query.set("base", base);
      const data = await request<any[]>(`/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/pulls?${query}`);
      return data[0] ? normalizePullRequest(data[0]) : undefined;
    },
    async createPullRequest(repository, input) {
      const data = await request<any>(`/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/pulls`, {
        method: "POST",
        body: JSON.stringify(input),
      });
      return normalizePullRequest(data);
    },
  };
}
