import { beforeEach, describe, expect, it, vi } from "vitest";

const listAll = vi.fn();
const list = vi.fn();

vi.mock("../../../integrations/pi/sessionSdk.ts", () => ({
  SessionManager: {
    listAll,
    list,
    open: vi.fn(),
  },
}));

const { collectSessionSummaries } = await import("./sessionRepository.ts");

describe("collectSessionSummaries", () => {
  beforeEach(() => {
    listAll.mockReset();
    list.mockReset();
    listAll.mockResolvedValue([]);
    list.mockResolvedValue([]);
  });

  it("does not reread directory session stores after a global listing", async () => {
    listAll.mockResolvedValue([{ id: "global-session" }]);

    const result = await collectSessionSummaries([], [process.cwd()], true);

    expect(Array.from(result.keys())).toEqual(["global-session"]);
    expect(listAll).toHaveBeenCalledOnce();
    expect(list).not.toHaveBeenCalled();
  });

  it("uses directory listings for scoped requests", async () => {
    list.mockResolvedValue([{ id: "project-session" }]);

    const result = await collectSessionSummaries([], [process.cwd()], false);

    expect(Array.from(result.keys())).toEqual(["project-session"]);
    expect(listAll).not.toHaveBeenCalled();
    expect(list).toHaveBeenCalledOnce();
  });
});
