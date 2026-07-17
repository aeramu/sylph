import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { ApplicationError } from "./errors.ts";
import { validateProjectDirectories } from "./projectService.ts";

const temporary: string[] = [];
afterEach(() => {
  for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("project service validation", () => {
  it("normalizes valid directories", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sylph-project-service-"));
    temporary.push(directory);
    expect(validateProjectDirectories([{ id: "root", name: "Root", path: directory }])).toEqual({
      directories: [{ id: "root", name: "Root", path: path.resolve(directory) }],
      paths: new Set([path.resolve(directory)]),
    });
  });

  it("rejects duplicate roots", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sylph-project-service-"));
    temporary.push(directory);
    expect(() => validateProjectDirectories([{ path: directory }, { path: directory }]))
      .toThrowError(ApplicationError);
  });
});
