import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installExtensionPackage } from "./extensionPackageInstaller.ts";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

describe("Pi extension package installer", () => {
  it("persists a local package in global Pi settings", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sylph-extension-install-test-"));
    roots.push(root);
    const agentDir = path.join(root, "agent");
    const packageDir = path.join(root, "example-package");
    fs.mkdirSync(path.join(packageDir, "extensions"), { recursive: true });
    fs.writeFileSync(path.join(packageDir, "extensions", "example.ts"), "export default () => {};");

    await installExtensionPackage(packageDir, { cwd: root, agentDir });

    const settings = JSON.parse(fs.readFileSync(path.join(agentDir, "settings.json"), "utf8"));
    expect(settings.packages).toEqual([path.relative(agentDir, packageDir)]);
  });
});
