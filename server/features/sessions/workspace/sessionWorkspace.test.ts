import { describe, expect, it } from "vitest";
import type { Project } from "../../projects/projectTypes.ts";
import type { SessionBinding } from "./workspaceTypes.ts";
import { getRawManagedDirectories, getSessionDirectories, getSessionDirectory, hasManagedWorktrees, projectForSession, sourceProjectForSession } from "./sessionWorkspace.ts";

const project: Project = {
  id: "project",
  name: "Product",
  path: "/source/frontend",
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

  it("keeps roots attached only to the session", () => {
    const binding: SessionBinding = {
      sessionId: "session",
      projectId: "project",
      directoryId: "frontend",
      cwd: "/source/frontend",
      directories: [
        { directoryId: "frontend", name: "frontend", sourcePath: "/source/frontend", path: "/source/frontend" },
        { directoryId: "api", name: "api", sourcePath: "/source/api", path: "/source/api" },
        { directoryId: "docs", name: "docs", sourcePath: "/source/docs", path: "/worktrees/docs" },
      ],
    };
    const view = projectForSession(project, binding);
    expect(view.directories.map((directory) => directory.name)).toEqual(["frontend", "api", "docs"]);
    expect(view.directories[2].path).toBe("/worktrees/docs");
    expect(sourceProjectForSession(project, binding).directories[2].path).toBe("/source/docs");
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

  it("does not expose scratch as a fake workspace directory", () => {
    const binding: SessionBinding = { sessionId: "scratch", workspaceKind: "scratch", cwd: "/private/scratch", directories: [] };
    expect(getSessionDirectories(project, binding)).toEqual([]);
    expect(projectForSession(project, binding).directories).toEqual([]);
    expect(() => getSessionDirectory(project, binding, undefined)).toThrow(/no workspace directories/i);
  });

  it("rejects unknown requested roots instead of falling back silently", () => {
    const binding: SessionBinding = { sessionId: "session", projectId: "project", cwd: "/source/frontend" };
    expect(() => getSessionDirectory(project, binding, "missing")).toThrow(/not found in session/);
  });
});
