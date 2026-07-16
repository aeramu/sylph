import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sylph-projects-test-"));
const storeFile = path.join(storeRoot, "projects.json");

vi.mock("./config.ts", () => ({
  SYLPH_DIR: storeRoot,
  PROJECTS_FILE: storeFile,
}));

const projects = await import("./projects.ts");

describe("multi-directory projects", () => {
  beforeEach(() => fs.writeFileSync(storeFile, "[]"));

  afterEach(() => {
    for (const entry of fs.readdirSync(storeRoot)) {
      if (entry !== "projects.json") fs.rmSync(path.join(storeRoot, entry), { recursive: true, force: true });
    }
  });

  it("migrates a legacy single-path project in memory", () => {
    fs.writeFileSync(storeFile, JSON.stringify([{ id: "legacy", name: "Legacy", path: "/tmp/legacy" }]));
    const project = projects.getProjects()[0];
    expect(project.path).toBe(path.resolve("/tmp/legacy"));
    expect(project.directories).toEqual([{
      id: "legacy-dir-1",
      name: "legacy",
      path: path.resolve("/tmp/legacy"),
    }]);
    expect(project.primaryDirectoryId).toBe("legacy-dir-1");
  });

  it("creates unique aliases and preserves the selected primary directory", () => {
    const project = projects.createProject({
      name: "Product",
      directories: [
        { name: "app", path: "/tmp/frontend" },
        { name: "app", path: "/tmp/backend", primary: true },
      ],
    });
    expect(project.name).toBe("Product");
    expect(project.directories.map((directory) => directory.name)).toEqual(["app", "app-2"]);
    expect(project.primaryDirectoryId).toBe(project.directories[1].id);
    expect(project.path).toBe(path.resolve("/tmp/backend"));
  });

  it("updates a project while preserving existing directory ids", () => {
    const existing = projects.createProject({
      name: "Product",
      directories: [
        { name: "web", path: "/tmp/web", primary: true },
        { name: "api", path: "/tmp/api" },
      ],
    });
    const updated = projects.updateProject(existing, {
      name: "Product 2",
      directories: [
        { id: existing.directories[1].id, name: "backend", path: "/tmp/api", primary: true },
        { name: "docs", path: "/tmp/docs" },
      ],
    });
    expect(updated.name).toBe("Product 2");
    expect(updated.directories[0].id).toBe(existing.directories[1].id);
    expect(updated.directories[0].name).toBe("backend");
    expect(updated.directories[1].id).not.toBe(existing.directories[0].id);
    expect(updated.primaryDirectoryId).toBe(updated.directories[0].id);
    expect(updated.path).toBe(path.resolve("/tmp/api"));
  });

  it("creates an active-directory project view without losing other roots", () => {
    const project = projects.createProject({
      directories: [
        { name: "web", path: "/tmp/web", primary: true },
        { name: "api", path: "/tmp/api" },
      ],
    });
    const view = projects.projectAtDirectory(project, project.directories[1].id, "/tmp/api-worktree");
    expect(view.path).toBe(path.resolve("/tmp/api-worktree"));
    expect(view.primaryDirectoryId).toBe(project.directories[1].id);
    expect(view.directories[0].path).toBe(path.resolve("/tmp/web"));
    expect(view.directories[1].path).toBe(path.resolve("/tmp/api-worktree"));
  });
});
