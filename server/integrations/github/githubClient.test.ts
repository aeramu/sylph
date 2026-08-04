import { describe, expect, it, vi } from "vitest";
import { createGitHubClient, GitHubApiError, parseGitHubRemote } from "./githubClient.ts";

describe("GitHub integration", () => {
  it.each([
    ["git@github.com:owner/repository.git", "owner", "repository"],
    ["ssh://git@github.com/owner/repository.git", "owner", "repository"],
    ["https://github.com/owner/repository.git", "owner", "repository"],
    ["https://github.com/owner/repository", "owner", "repository"],
  ])("parses GitHub remote %s", (remote, owner, name) => {
    expect(parseGitHubRemote(remote)).toEqual({
      host: "github.com", owner, name, webUrl: `https://github.com/${owner}/${name}`,
    });
  });

  it.each([
    "git@gitlab.com:owner/repository.git",
    "https://bitbucket.org/owner/repository.git",
    "https://github.com/owner/too/many/parts.git",
    "/local/repository.git",
    "not a remote",
  ])("rejects unsupported remote %s", (remote) => {
    expect(parseGitHubRemote(remote)).toBeNull();
  });

  it("creates and normalizes a pull request", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({ Authorization: "Bearer secret" });
      expect(JSON.parse(String(init?.body))).toMatchObject({ head: "feature", base: "main", draft: true });
      return new Response(JSON.stringify({ number: 42, title: "Feature", html_url: "https://github.com/o/r/pull/42", draft: true }), {
        status: 201, headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    const client = createGitHubClient("secret", fetchImpl);
    const repository = parseGitHubRemote("git@github.com:o/r.git")!;

    await expect(client.createPullRequest(repository, { title: "Feature", body: "Body", head: "feature", base: "main", draft: true }))
      .resolves.toEqual({ number: 42, title: "Feature", url: "https://github.com/o/r/pull/42", state: "open", draft: true });
  });

  it("preserves GitHub validation details", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      message: "Validation Failed", errors: [{ message: "No commits between main and feature" }],
    }), { status: 422, headers: { "Content-Type": "application/json" } })) as typeof fetch;
    const client = createGitHubClient("secret", fetchImpl);
    const repository = parseGitHubRemote("git@github.com:o/r.git")!;

    await expect(client.createPullRequest(repository, { title: "Feature", body: "", head: "feature", base: "main", draft: false }))
      .rejects.toMatchObject({ status: 422, message: "Validation Failed: No commits between main and feature" } satisfies Partial<GitHubApiError>);
  });
});
