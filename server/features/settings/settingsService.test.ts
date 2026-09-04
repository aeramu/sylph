import { beforeEach, describe, expect, it, vi } from "vitest";

const getAvailable = vi.hoisted(() => vi.fn());
vi.mock("../../integrations/pi/runtime/runtimeManager.ts", () => ({
  getIntrospectionRuntime: async () => ({ session: { modelRuntime: { getAvailable } } }),
}));

const { listModels } = await import("./settingsService.ts");

describe("settings model listing", () => {
  beforeEach(() => getAvailable.mockReset());

  it("reads available models through the asynchronous ModelRuntime API", async () => {
    getAvailable.mockResolvedValue([{
      id: "model-a", provider: "provider-a", reasoning: false,
    }]);

    await expect(listModels()).resolves.toEqual([{
      id: "model-a",
      provider: "provider-a",
      value: "provider-a/model-a",
      label: "model-a",
      reasoning: false,
      thinkingLevels: ["off"],
    }]);
    expect(getAvailable).toHaveBeenCalledOnce();
  });
});
