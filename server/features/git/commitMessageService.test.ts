import { describe, expect, it, vi } from "vitest";
import type { AssistantMessage } from "../../integrations/pi/modelSdk.ts";
import { commitMessagePrompt, generateCommitMessage, textFromAssistantMessage } from "./commitMessageService.ts";
import { DEFAULT_COMMIT_MESSAGE_PROMPT } from "../settings/settingsTypes.ts";

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

  it("uses the asynchronous ModelRuntime surface for model selection and completion", async () => {
    const model = {
      id: "commit-model", provider: "test", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000, maxTokens: 256,
    } as any;
    const runtime = {
      getAvailable: vi.fn(async () => [model]),
      completeSimple: vi.fn(async () => response([{ type: "text", text: "test: cover model runtime" }])),
    };

    await expect(generateCommitMessage(runtime, {
      model: "test/commit-model", thinkingLevel: "off", prompt: "Write a commit message for {{diff}}",
    }, "+updated")).resolves.toBe("test: cover model runtime");

    expect(runtime.getAvailable).toHaveBeenCalledOnce();
    expect(runtime.completeSimple).toHaveBeenCalledWith(
      model,
      expect.objectContaining({ messages: [expect.objectContaining({ role: "user", content: expect.stringContaining("+updated") })] }),
      { maxTokens: 256 },
    );
  });
});
