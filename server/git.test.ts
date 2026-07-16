import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { applyToIndex, commit, createManagedWorktree, fetchRemote, getGitDivergence, getGitLog, getGitStatus, getManagedWorktreeRemovalStatus, listGitBranches, recreateManagedWorktree, removeManagedWorktree, pull, push, stageAll, stageFile, unstageAll, unstageFile, worktreeBranchName } from "./git.ts";
import type { Project } from "./projects.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf-8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout;
}

function testProject(id: string, projectPath: string): Project {
  const directoryId = `${id}-root`;
  return {
    id,
    name: id,
    path: projectPath,
    directories: [{ id: directoryId, name: id, path: projectPath }],
    primaryDirectoryId: directoryId,
  };
}

function repository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sylph-git-test-"));
  directories.push(root);
  git(root, "init", "-q");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test User");
  return { root, project: testProject("test", root) };
}

function write(root: string, filePath: string, content: string | Buffer) {
  const fullPath = path.join(root, filePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

describe("Git tab backend", () => {
  it("lists branches and creates an isolated managed worktree", async () => {
    const { root, project } = repository();
    write(root, "file.txt", "base\n");
    git(root, "add", ".");
    git(root, "commit", "-qm", "initial");
    git(root, "branch", "feature-base");

    const branches = await listGitBranches(project);
    expect(branches.map((branch) => branch.name)).toContain("feature-base");
    expect(branches.find((branch) => branch.current)?.name).toBe(git(root, "branch", "--show-current").trim());

    const worktreePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sylph-worktree-parent-")), "checkout");
    directories.push(path.dirname(worktreePath));
    const branch = worktreeBranchName("Fix auth callback!", "ABC-123-XYZ");
    const worktree = await createManagedWorktree(project, worktreePath, "feature-base", branch);
    expect(worktree.branch).toBe("sylph/fix-auth-callback-abc123xy");
    expect(worktree.worktreeRoot).toBe(worktreePath);
    expect(git(worktreePath, "branch", "--show-current").trim()).toBe(branch);
    write(worktreePath, "file.txt", "worktree\n");
    expect(fs.readFileSync(path.join(root, "file.txt"), "utf-8")).toBe("base\n");
  });

  it("refuses dirty worktree removal and can remove then recreate a clean worktree", async () => {
    const { root, project } = repository();
    write(root, "file.txt", "base\n");
    git(root, "add", ".");
    git(root, "commit", "-qm", "initial");
    const baseBranch = git(root, "branch", "--show-current").trim();
    const managedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sylph-managed-worktrees-"));
    directories.push(managedRoot);
    const worktreePath = path.join(managedRoot, "checkout");
    const branch = "sylph/remove-recreate-test";
    const worktree = await createManagedWorktree(project, worktreePath, baseBranch, branch);

    write(worktree.path, "dirty.txt", "dirty\n");
    await expect(removeManagedWorktree(project, worktree.worktreeRoot, branch, baseBranch, managedRoot))
      .rejects.toThrow(/uncommitted changes/);
    fs.rmSync(path.join(worktree.path, "dirty.txt"));
    expect(await getManagedWorktreeRemovalStatus(project, worktree.worktreeRoot, branch, baseBranch, managedRoot))
      .toMatchObject({ exists: true, dirty: false, merged: true });

    await removeManagedWorktree(project, worktree.worktreeRoot, branch, baseBranch, managedRoot);
    expect(fs.existsSync(worktree.worktreeRoot)).toBe(false);
    expect(git(root, "show-ref", "--verify", `refs/heads/${branch}`).trim()).not.toBe("");
    await recreateManagedWorktree(project, worktree.worktreeRoot, worktree.path, branch, managedRoot);
    expect(git(worktree.path, "branch", "--show-current").trim()).toBe(branch);
  });

  it("rejects managed worktree operations outside the configured root", async () => {
    const { root, project } = repository();
    write(root, "file.txt", "base\n");
    git(root, "add", ".");
    git(root, "commit", "-qm", "initial");
    const baseBranch = git(root, "branch", "--show-current").trim();
    await expect(getManagedWorktreeRemovalStatus(project, root, "sylph/nope", baseBranch, path.join(root, "managed")))
      .rejects.toThrow(/outside Sylph/);
  });

  it("treats fetching without a configured upstream as a no-op", async () => {
    const { project } = repository();
    await expect(fetchRemote(project)).resolves.toBeUndefined();
  });

  it("restricts a nested project to its own paths and stages them correctly", async () => {
    const { root } = repository();
    write(root, "root.txt", "root\n");
    write(root, "sub/file.txt", "sub\n");
    git(root, "add", ".");
    git(root, "commit", "-qm", "initial");
    write(root, "root.txt", "changed outside\n");
    write(root, "sub/file.txt", "changed inside\n");
    const project = testProject("sub", path.join(root, "sub"));

    const status = await getGitStatus(project);
    expect(status.files.map((file) => file.path)).toEqual(["file.txt"]);
    await stageFile(project, "file.txt");
    expect(git(root, "diff", "--cached", "--name-only").trim()).toBe("sub/file.txt");
  });

  it("refuses a nested-project commit when the parent has staged files outside it", async () => {
    const { root } = repository();
    write(root, "root.txt", "root\n");
    write(root, "sub/file.txt", "sub\n");
    git(root, "add", ".");
    git(root, "commit", "-qm", "initial");
    write(root, "root.txt", "outside\n");
    write(root, "sub/file.txt", "inside\n");
    git(root, "add", "root.txt", "sub/file.txt");
    const project = testProject("sub", path.join(root, "sub"));

    await expect(commit(project, "unsafe commit")).rejects.toThrow(/staged changes outside/);
    expect(git(root, "log", "-1", "--pretty=%s").trim()).toBe("initial");
  });

  it("lists individual files in untracked directories", async () => {
    const { root, project } = repository();
    write(root, "new/deep/file.txt", "hello\n");

    const status = await getGitStatus(project);
    expect(status.files.map((file) => file.path)).toEqual(["new/deep/file.txt"]);
    expect(status.files[0].unstagedPatch).toContain("+hello");
  });

  it("preserves unusual filenames and allows whole-file staging", async () => {
    const { root, project } = repository();
    const names = ["a -> b", "tab\tfile", "é.txt"];
    for (const name of names) write(root, name, name);

    const status = await getGitStatus(project);
    expect(status.files.map((file) => file.path).sort()).toEqual([...names].sort());
    for (const name of names) await stageFile(project, name);
    expect(git(root, "diff", "--cached", "--name-only", "-z").split("\0").filter(Boolean).sort()).toEqual([...names].sort());
  });

  it("collects batched patches for tracked unusual filenames", async () => {
    const { root, project } = repository();
    const names = ["a -> b", "é.txt"];
    for (const name of names) write(root, name, "before\n");
    git(root, "add", ".");
    git(root, "commit", "-qm", "initial");
    for (const name of names) write(root, name, "after\n");

    const status = await getGitStatus(project);
    for (const name of names) {
      const file = status.files.find((entry) => entry.path === name);
      expect(file?.unstagedPatch).toContain("-before");
      expect(file?.unstagedPatch).toContain("+after");
    }
  });

  it("does not synthesize lossy patches for binary files or symlinks", async () => {
    const { root, project } = repository();
    write(root, "blob.bin", Buffer.from([0, 255, 1, 128]));
    fs.symlinkSync("blob.bin", path.join(root, "link"));

    const status = await getGitStatus(project);
    expect(status.files.find((file) => file.path === "blob.bin")?.unstagedPatch).toBe("");
    expect(status.files.find((file) => file.path === "link")?.unstagedPatch).toBe("");
    await stageFile(project, "blob.bin");
    await stageFile(project, "link");
    expect(git(root, "ls-files", "-s", "link")).toMatch(/^120000 /);
    expect(git(root, "hash-object", "blob.bin").trim()).toBe(git(root, "rev-parse", ":blob.bin").trim());
  });

  it("stages and unstages all changes inside the selected project", async () => {
    const { root } = repository();
    write(root, "outside.txt", "outside\n");
    write(root, "sub/one.txt", "one\n");
    write(root, "sub/two.txt", "two\n");
    const project = testProject("sub", path.join(root, "sub"));

    await stageAll(project);
    expect(git(root, "diff", "--cached", "--name-only", "-z").split("\0").filter(Boolean).sort())
      .toEqual(["sub/one.txt", "sub/two.txt"]);
    await unstageAll(project);
    expect(git(root, "diff", "--cached", "--name-only")).toBe("");
  });

  it("lists commits and synchronizes with an upstream using fast-forward pull and push", async () => {
    const { root, project } = repository();
    write(root, "file.txt", "one\n");
    git(root, "add", ".");
    git(root, "commit", "-qm", "initial subject");
    const remote = fs.mkdtempSync(path.join(os.tmpdir(), "sylph-git-remote-"));
    directories.push(remote);
    git(remote, "init", "--bare", "-q");
    git(root, "remote", "add", "origin", remote);
    git(root, "push", "-qu", "origin", "HEAD");

    const log = await getGitLog(project);
    expect(log[0]).toMatchObject({ subject: "initial subject", author: "Test User" });
    expect((await getGitStatus(project)).repository).toMatchObject({ upstream: expect.any(String), ahead: 0, behind: 0 });

    write(root, "file.txt", "two\n");
    git(root, "add", ".");
    git(root, "commit", "-qm", "second");
    expect((await getGitDivergence(project)).unpushed.map((entry) => entry.subject)).toEqual(["second"]);
    await push(project);
    expect((await getGitStatus(project)).repository.ahead).toBe(0);

    const clone = fs.mkdtempSync(path.join(os.tmpdir(), "sylph-git-clone-"));
    directories.push(clone);
    git(clone, "clone", "-q", remote, ".");
    git(clone, "config", "user.email", "other@example.com");
    git(clone, "config", "user.name", "Other User");
    write(clone, "remote.txt", "remote\n");
    git(clone, "add", ".");
    git(clone, "commit", "-qm", "remote commit");
    git(clone, "push", "-q");
    expect((await getGitStatus(project)).repository.behind).toBe(0);
    await fetchRemote(project);
    expect((await getGitStatus(project)).repository.behind).toBe(1);
    expect((await getGitDivergence(project)).unpulled.map((entry) => entry.subject)).toEqual(["remote commit"]);
    await pull(project);
    expect(fs.readFileSync(path.join(root, "remote.txt"), "utf-8")).toBe("remote\n");
  });

  it("applies a patch only when it matches the requested file", async () => {
    const { root, project } = repository();
    write(root, "one.txt", "one\n");
    write(root, "two.txt", "two\n");
    git(root, "add", ".");
    git(root, "commit", "-qm", "initial");
    write(root, "one.txt", "ONE\n");
    const patch = git(root, "diff", "--", "one.txt");

    await expect(applyToIndex(project, "two.txt", patch)).rejects.toThrow(/does not match/);
    await applyToIndex(project, "one.txt", patch);
    expect(git(root, "show", ":one.txt")).toBe("ONE\n");
    await unstageFile(project, "one.txt");
    expect(git(root, "show", ":one.txt")).toBe("one\n");
  });
});
