import { describe, expect, it } from "vitest";
import type { Project } from "./projects.ts";
import type { SessionBinding } from "./sessionBindings.ts";
import { getRawManagedDirectories, getSessionDirectories, getSessionDirectory, hasManagedWorktrees, projectForSession } from "./sessionWorkspace.ts";

const project: Project = {
  id: "project",
  name: "Product",
  path: "/source/frontend",
  primaryDirectoryId: "frontend",
  directories: [
    { id: "frontend", name: "frontend", path: "/source/frontend" },
    { id: "api", name: "api", path: "/source/api" },
  ],
};

describe("session workspace roots", () => {
  it("maps every root to its session-specific checkout", () => {
    const binding: SessionBinding = {
      sessionId: "session",
      projectId: "project",
      directoryId: "frontend",
      cwd: "/worktrees/frontend",
      directories: [
        { directoryId: "frontend", name: "frontend", path: "/worktrees/frontend", worktreeRoot: "/worktrees/frontend", branch: "sylph/task", baseBranch: "main" },
        { directoryId: "api", name: "api", path: "/worktrees/api", worktreeRoot: "/worktrees/api", branch: "sylph/task", baseBranch: "develop" },
      ],
      worktree: true,
    };
    const view = projectForSession(project, binding);
    expect(view.directories.map((directory) => directory.path)).toEqual(["/worktrees/frontend", "/worktrees/api"]);
    expect(getSessionDirectory(project, binding, "api").path).toBe("/worktrees/api");
    expect(hasManagedWorktrees(binding)).toBe(true);
    expect(getRawManagedDirectories(binding)).toHaveLength(2);
  });

  it("normalizes legacy singular bindings without losing secondary roots", () => {
    const binding: SessionBinding = {
      sessionId: "legacy",
      projectId: "project",
      directoryId: "frontend",
      cwd: "/legacy/frontend-worktree",
      worktree: true,
      branch: "sylph/legacy",
      baseBranch: "main",
      managedWorktreeRoot: "/legacy/frontend-worktree",
    };
    expect(getSessionDirectories(project, binding)).toEqual([
      expect.objectContaining({ directoryId: "frontend", path: "/legacy/frontend-worktree" }),
      expect.objectContaining({ directoryId: "api", path: "/source/api" }),
    ]);
    expect(getRawManagedDirectories(binding)).toHaveLength(1);
  });

  it("rejects unknown requested roots instead of falling back silently", () => {
    const binding: SessionBinding = { sessionId: "session", projectId: "project", cwd: "/source/frontend" };
    expect(() => getSessionDirectory(project, binding, "missing")).toThrow(/not found in session/);
  });
});
