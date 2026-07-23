import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { askUserQuestionExtensionPath, showArtifactExtensionPath } from "./runtimeFactory.ts";

describe("runtime extension locations", () => {
  it("points to existing built-in extension modules", () => {
    expect(fs.existsSync(askUserQuestionExtensionPath)).toBe(true);
    expect(fs.existsSync(showArtifactExtensionPath)).toBe(true);
  });
});
