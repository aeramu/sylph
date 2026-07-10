import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { applyToIndex, commit, getGitStatus, stageAll, stageFile, unstageAll, unstageFile } from "./git.ts";
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

function repository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sylph-git-test-"));
  directories.push(root);
  git(root, "init", "-q");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test User");
  const project: Project = { id: "test", name: "test", path: root };
  return { root, project };
}

function write(root: string, filePath: string, content: string | Buffer) {
  const fullPath = path.join(root, filePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

describe("Git tab backend", () => {
  it("restricts a nested project to its own paths and stages them correctly", async () => {
    const { root } = repository();
    write(root, "root.txt", "root\n");
    write(root, "sub/file.txt", "sub\n");
    git(root, "add", ".");
    git(root, "commit", "-qm", "initial");
    write(root, "root.txt", "changed outside\n");
    write(root, "sub/file.txt", "changed inside\n");
    const project: Project = { id: "sub", name: "sub", path: path.join(root, "sub") };

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
    const project: Project = { id: "sub", name: "sub", path: path.join(root, "sub") };

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
    const project: Project = { id: "sub", name: "sub", path: path.join(root, "sub") };

    await stageAll(project);
    expect(git(root, "diff", "--cached", "--name-only", "-z").split("\0").filter(Boolean).sort())
      .toEqual(["sub/one.txt", "sub/two.txt"]);
    await unstageAll(project);
    expect(git(root, "diff", "--cached", "--name-only")).toBe("");
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
