import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import type { Project } from "./projects.ts";
import { createProjectWorktrees, discardProjectWorktrees } from "./projectWorktrees.ts";

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

function repository(name: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `sylph-${name}-repo-`));
  temporaryDirectories.push(root);
  git(root, "init", "-q");
  git(root, "config", "user.name", "Test User");
  git(root, "config", "user.email", "test@example.com");
  fs.writeFileSync(path.join(root, "README.md"), name);
  git(root, "add", ".");
  git(root, "commit", "-qm", "initial");
  return root;
}

function multiProject(): Project {
  const frontend = repository("frontend");
  const api = repository("api");
  return {
    id: "product",
    name: "Product",
    path: frontend,
    primaryDirectoryId: "frontend",
    directories: [
      { id: "frontend", name: "frontend", path: frontend },
      { id: "api", name: "api", path: api },
    ],
  };
}

describe("project worktrees", () => {
  it("creates and discards an isolated worktree for every repository", async () => {
    const project = multiProject();
    const managedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sylph-project-worktrees-"));
    temporaryDirectories.push(managedRoot);
    const branch = git(project.path, "branch", "--show-current");
    const created = await createProjectWorktrees(project, {
      managedRoot,
      baseBranches: { frontend: branch, api: branch },
      branchPrompt: "Update contract",
      key: "abcdef12",
    });
    expect(created.directories).toHaveLength(2);
    expect(new Set(created.directories.map((directory) => directory.branch))).toEqual(new Set([created.branch]));
    for (const directory of created.directories) {
      expect(fs.existsSync(directory.path)).toBe(true);
      expect(git(directory.path, "branch", "--show-current")).toBe(created.branch);
    }
    await discardProjectWorktrees(project, created.directories, managedRoot);
    for (const directory of created.directories) expect(fs.existsSync(directory.worktreeRoot!)).toBe(false);
  });

  it("rolls back earlier roots when a later repository cannot create", async () => {
    const project = multiProject();
    const managedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sylph-project-worktrees-"));
    temporaryDirectories.push(managedRoot);
    const branch = git(project.path, "branch", "--show-current");
    await expect(createProjectWorktrees(project, {
      managedRoot,
      baseBranches: { frontend: branch, api: "missing-branch" },
      branchPrompt: "Atomic failure",
      key: "deadbeef",
    })).rejects.toThrow();
    expect(fs.existsSync(path.join(managedRoot, project.id, "deadbeef", "frontend"))).toBe(false);
    expect(git(project.directories[0].path, "branch", "--list", "sylph/atomic-failure-deadbeef")).toBe("");
  });
});
