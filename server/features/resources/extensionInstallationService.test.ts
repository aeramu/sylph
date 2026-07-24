import { beforeEach, describe, expect, it, vi } from "vitest";

const installExtensionPackage = vi.fn();
const uninstallExtensionPackage = vi.fn();
const reload = vi.fn();
const session: any = { _resourceLoader: { getExtensions: () => ({ extensions: [] }) }, reload };

vi.mock("../../integrations/pi/packages/extensionPackageInstaller.ts", () => ({ installExtensionPackage, uninstallExtensionPackage }));
vi.mock("../../integrations/pi/runtime/runtimeManager.ts", () => ({ getIntrospectionRuntime: async () => ({ session }) }));

const { installExtension, uninstallExtension } = await import("./extensionInstallationService.ts");

describe("extension installation", () => {
  beforeEach(() => {
    installExtensionPackage.mockReset();
    uninstallExtensionPackage.mockReset();
    reload.mockReset();
    session._resourceLoader.getExtensions = () => ({ extensions: [] });
  });

  it("rejects an empty source", async () => {
    await expect(installExtension("  ")).rejects.toMatchObject({ status: 400, message: "source is required" });
    expect(installExtensionPackage).not.toHaveBeenCalled();
  });

  it("rejects multi-line input", async () => {
    await expect(installExtension("npm:package\nother")).rejects.toMatchObject({ status: 400 });
    expect(installExtensionPackage).not.toHaveBeenCalled();
  });

  it("installs globally, reloads introspection, and returns the loaded extensions", async () => {
    session._resourceLoader.getExtensions = () => ({
      extensions: [{ path: "/agent/npm/node_modules/example-extension/index.js" }],
    });

    await expect(installExtension("  npm:example-extension  ")).resolves.toEqual({
      source: "npm:example-extension",
      extensions: ["example-extension"],
    });
    expect(installExtensionPackage).toHaveBeenCalledWith("npm:example-extension");
    expect(reload).toHaveBeenCalledOnce();
  });

  it("uninstalls the owning user package and reports every removed extension", async () => {
    let loaded = [
      { path: "/agent/npm/node_modules/example/one.js", sourceInfo: { source: "npm:example", scope: "user", origin: "package" } },
      { path: "/agent/npm/node_modules/example/two.js", sourceInfo: { source: "npm:example", scope: "user", origin: "package" } },
    ];
    session._resourceLoader.getExtensions = () => ({ extensions: loaded });
    uninstallExtensionPackage.mockResolvedValue(true);
    reload.mockImplementation(() => { loaded = []; });

    await expect(uninstallExtension("example:one.js")).resolves.toEqual({
      source: "npm:example",
      removedExtensions: ["example:one.js", "example:two.js"],
      extensions: [],
    });
    expect(uninstallExtensionPackage).toHaveBeenCalledWith("npm:example");
    expect(reload).toHaveBeenCalledOnce();
  });

  it("does not offer uninstall semantics for built-in or project extensions", async () => {
    session._resourceLoader.getExtensions = () => ({
      extensions: [{ path: "/app/extensions/builtin.ts", sourceInfo: { source: "local", scope: "temporary", origin: "top-level" } }],
    });
    await expect(uninstallExtension("builtin.ts")).rejects.toMatchObject({ status: 400 });
    expect(uninstallExtensionPackage).not.toHaveBeenCalled();
  });
});
