import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import type { Project } from "../projects/projectTypes.ts";
import type { GitHubClient, GitHubPullRequest } from "../../integrations/github/githubClient.ts";
import { createPullRequest, getPullRequestContext } from "./pullRequestService.ts";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf-8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout;
}

function write(root: string, filePath: string, content: string) {
  const fullPath = path.join(root, filePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

function repository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sylph-pr-test-"));
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), "sylph-pr-remote-"));
  directories.push(root, remote);
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test User");
  write(root, "file.txt", "base\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "initial");
  git(remote, "init", "--bare", "-q");
  git(root, "remote", "add", "origin", remote);
  git(root, "push", "-qu", "origin", "main");
  // Provider parsing is injected in these service tests so fetch/push can use
  // this local bare repository without touching the network.
  const project: Project = {
    id: "test", name: "test", path: root,
    directories: [{ id: "root", name: "test", path: root }],
  };
  return { root, remote, project };
}

const pullRequest: GitHubPullRequest = {
  number: 7, title: "Feature", url: "https://github.com/owner/repository/pull/7", state: "open", draft: false,
};

function fakeClient(overrides: Partial<GitHubClient> = {}): GitHubClient {
  return {
    getRepository: vi.fn(async () => ({ owner: "owner", name: "repository", webUrl: "https://github.com/owner/repository", defaultBranch: "main" })),
    findOpenPullRequest: vi.fn(async () => undefined),
    createPullRequest: vi.fn(async () => pullRequest),
    ...overrides,
  };
}

function dependencies(client: GitHubClient, token: string | null = "token") {
  return {
    resolveToken: vi.fn(async () => token),
    createClient: vi.fn(() => client),
    parseRemote: vi.fn(() => ({
      host: "github.com" as const, owner: "owner", name: "repository", webUrl: "https://github.com/owner/repository",
    })),
  };
}

describe("pull request service", () => {
  it("reports branch, repository, dirty files, and missing authentication", async () => {
    const { root, project } = repository();
    git(root, "switch", "-qc", "feature");
    write(root, "dirty.txt", "dirty\n");

    const context = await getPullRequestContext(project, dependencies(fakeClient(), null));

    expect(context).toMatchObject({
      provider: "github",
      repository: { owner: "owner", name: "repository" },
      branch: "feature",
      detached: false,
      defaultBaseBranch: "main",
      published: false,
      commitCount: 0,
      dirtyFileCount: 1,
      authentication: { configured: false },
    });
  });

  it("publishes a branch and creates a pull request", async () => {
    const { root, remote, project } = repository();
    git(root, "switch", "-qc", "feature");
    write(root, "feature.txt", "feature\n");
    git(root, "add", ".");
    git(root, "commit", "-qm", "Add feature");
    const client = fakeClient();

    const created = await createPullRequest(project, {
      title: "Add feature", body: "Details", base: "main", draft: false, publishBranch: true,
    }, dependencies(client));

    expect(created).toEqual(pullRequest);
    expect(git(remote, "show-ref", "--verify", "refs/heads/feature")).not.toBe("");
    expect(client.createPullRequest).toHaveBeenCalledWith(expect.objectContaining({ owner: "owner", name: "repository" }), {
      title: "Add feature", body: "Details", head: "feature", base: "main", draft: false,
    });
  });

  it("returns an existing open pull request without pushing or creating", async () => {
    const { root, remote, project } = repository();
    git(root, "switch", "-qc", "feature");
    write(root, "feature.txt", "feature\n");
    git(root, "add", ".");
    git(root, "commit", "-qm", "Add feature");
    const client = fakeClient({ findOpenPullRequest: vi.fn(async () => pullRequest) });

    await expect(createPullRequest(project, {
      title: "Duplicate", body: "", base: "main", draft: false, publishBranch: true,
    }, dependencies(client))).resolves.toEqual(pullRequest);
    expect(spawnSync("git", ["show-ref", "--verify", "--quiet", "refs/heads/feature"], { cwd: remote }).status).not.toBe(0);
    expect(client.createPullRequest).not.toHaveBeenCalled();
  });

  it("rejects a branch with no commits beyond the base", async () => {
    const { root, project } = repository();
    git(root, "switch", "-qc", "feature");

    await expect(createPullRequest(project, {
      title: "Empty", body: "", base: "main", draft: false, publishBranch: true,
    }, dependencies(fakeClient()))).rejects.toThrow(/no commits ahead/i);
  });

  it("requires GitHub authentication", async () => {
    const { root, project } = repository();
    git(root, "switch", "-qc", "feature");

    await expect(createPullRequest(project, {
      title: "Feature", body: "", base: "main", draft: false, publishBranch: true,
    }, dependencies(fakeClient(), null))).rejects.toThrow(/authentication is not configured/i);
  });
});
