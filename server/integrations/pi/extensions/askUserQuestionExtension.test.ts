import { describe, expect, it, vi } from "vitest";
import { askUserQuestionExtension } from "./askUserQuestionExtension.ts";

function definition() {
  let tool: any;
  askUserQuestionExtension({ registerTool: (value: any) => { tool = value; } } as any);
  return tool;
}

const params = {
  questions: [{
    question: "Choose a mode",
    header: "Mode",
    options: [
      { label: "Fast", description: "Finish quickly" },
      { label: "Safe", description: "Run more checks" },
    ],
  }],
};

describe("Pi ask-user-question extension", () => {
  it("registers the tool and formats UI answers through the question feature", async () => {
    const questions = vi.fn().mockResolvedValue({ cancelled: false, answers: [{ selected: ["Safe"] }] });
    const result = await definition().execute("call-1", params, undefined, undefined, { hasUI: true, ui: { questions } });
    expect(questions).toHaveBeenCalledWith(params);
    expect(result.content[0].text).toContain("- Mode: Safe");
    expect(result.details).toEqual({ cancelled: false, answers: [{ selected: ["Safe"] }] });
  });

  it("reports cancellation when no interactive UI is available", async () => {
    const result = await definition().execute("call-1", params, undefined, undefined, { hasUI: false, ui: {} });
    expect(result.details).toEqual({ cancelled: true, answers: [] });
    expect(result.content[0].text).toMatch(/unavailable/);
  });
});
