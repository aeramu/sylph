import { beforeEach, describe, expect, it, vi } from "vitest";

const installExtensionPackage = vi.fn();
const reload = vi.fn();
const session: any = { _resourceLoader: { getExtensions: () => ({ extensions: [] }) }, reload };

vi.mock("../../integrations/pi/packages/extensionPackageInstaller.ts", () => ({ installExtensionPackage }));
vi.mock("../../integrations/pi/runtime/runtimeManager.ts", () => ({ getIntrospectionRuntime: async () => ({ session }) }));

const { installExtension } = await import("./extensionInstallationService.ts");

describe("extension installation", () => {
  beforeEach(() => {
    installExtensionPackage.mockReset();
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
});
