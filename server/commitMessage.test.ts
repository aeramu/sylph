import { describe, expect, it } from "vitest";
import type { AssistantMessage } from "@earendil-works/pi-ai/compat";
import { commitMessagePrompt, textFromAssistantMessage } from "./commitMessage.ts";
import { DEFAULT_COMMIT_MESSAGE_PROMPT } from "./settings.ts";

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
  it("inserts the staged diff into the default prompt", () => {
    const prompt = commitMessagePrompt(DEFAULT_COMMIT_MESSAGE_PROMPT, "diff --git a/file b/file\n+hello");
    expect(prompt).toContain("Return only the commit message");
    expect(prompt).toContain("STAGED DIFF:\ndiff --git");
    expect(prompt).not.toContain("{{diff}}");
  });

  it("replaces every diff placeholder in a custom prompt", () => {
    const prompt = commitMessagePrompt("First {{diff}}\nAgain {{diff}}", "PATCH");
    expect(prompt).toBe("First PATCH\nAgain PATCH");
  });

  it("appends the staged diff when a custom prompt omits the placeholder", () => {
    expect(commitMessagePrompt("Use conventional commits.", "PATCH"))
      .toBe("Use conventional commits.\n\nSTAGED DIFF:\nPATCH");
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
