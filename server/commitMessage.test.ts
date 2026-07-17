import { describe, expect, it } from "vitest";
import type { AssistantMessage } from "@earendil-works/pi-ai/compat";
import { commitMessagePrompt, textFromAssistantMessage } from "./commitMessage.ts";

function response(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "test",
    provider: "test",
    model: "test",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason,
    timestamp: Date.now(),
  };
}

describe("commit message generation", () => {
  it("builds a constrained prompt from the staged diff", () => {
    const prompt = commitMessagePrompt("diff --git a/file b/file\n+hello");
    expect(prompt).toContain("Return only the commit message");
    expect(prompt).toContain("STAGED DIFF:\ndiff --git");
  });

  it("extracts text and removes accidental code fences", () => {
    expect(textFromAssistantMessage(response([
      { type: "thinking", thinking: "hmm" },
      { type: "text", text: "```text\nadd generated commit messages\n```" },
    ]))).toBe("add generated commit messages");
  });

  it("rejects empty and errored responses", () => {
    expect(() => textFromAssistantMessage(response([]))).toThrow(/empty/);
    expect(() => textFromAssistantMessage({ ...response([], "error"), errorMessage: "provider failed" })).toThrow(/provider failed/);
  });
});
