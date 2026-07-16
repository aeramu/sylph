import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { resolveMentionsInPrompt, walkProject } from "./mentions.ts";
import type { Project } from "./projects.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function workspace(): Project {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "sylph-mentions-test-"));
  roots.push(parent);
  const web = path.join(parent, "web");
  const api = path.join(parent, "api");
  fs.mkdirSync(path.join(web, "src"), { recursive: true });
  fs.mkdirSync(path.join(api, "src"), { recursive: true });
  fs.writeFileSync(path.join(web, "src", "App.tsx"), "export const App = 'web';\n");
  fs.writeFileSync(path.join(api, "src", "routes.ts"), "export const routes = 'api';\n");
  return {
    id: "workspace",
    name: "Workspace",
    path: web,
    directories: [
      { id: "web", name: "web", path: web },
      { id: "api", name: "api", path: api },
    ],
    primaryDirectoryId: "web",
  };
}

describe("multi-directory mentions", () => {
  it("namespaces autocomplete entries by directory alias", async () => {
    const entries = await walkProject(workspace());
    expect(entries.map((entry) => entry.path)).toEqual(expect.arrayContaining([
      "web",
      "web/src/App.tsx",
      "api",
      "api/src/routes.ts",
    ]));
  });

  it("resolves files from active and secondary roots", async () => {
    const prompt = await resolveMentionsInPrompt(
      workspace(),
      "Compare @web/src/App.tsx and @api/src/routes.ts",
    );
    expect(prompt).toContain("export const App = 'web'");
    expect(prompt).toContain("export const routes = 'api'");
    expect(prompt).toContain('<file name="api/src/routes.ts">');
  });

  it("keeps unprefixed legacy mentions relative to the active root", async () => {
    const prompt = await resolveMentionsInPrompt(workspace(), "Read @src/App.tsx");
    expect(prompt).toContain("export const App = 'web'");
  });
});
