import { describe, expect, it, vi } from "vitest";
import { createAiPermissionReviewer, type PermissionReviewRequest } from "./aiPermissionReview.ts";

const request: PermissionReviewRequest = {
  cwd: "/workspace", policy: { mode: "ai", roots: [{ id: "w", name: "workspace", path: "/workspace" }] },
  event: { toolName: "bash", input: { command: "npm test" } },
  evaluation: { decision: "ask", reason: "review", summary: "npm test", approvalKey: "test", intents: [] },
};
const model = { id: "reviewer", provider: "provider" } as any;
const reply = (text: string, stopReason = "stop") => ({ content: [{ type: "text", text }], stopReason }) as any;

describe("AI permission review", () => {
  it("uses the configured model and includes the full command and workspace context", async () => {
    const completeSimple = vi.fn().mockResolvedValue(reply('{"decision":"allow","reason":"Safe tests"}'));
    const review = createAiPermissionReviewer({ getAvailable: async () => [model], completeSimple }, () => ({ permissionReviewModel: "provider/reviewer" }));
    await expect(review(request)).resolves.toEqual({ decision: "allow", reason: "Safe tests" });
    expect(completeSimple.mock.calls[0][0]).toBe(model);
    const context = completeSimple.mock.calls[0][1];
    expect(context.systemPrompt).toContain("untrusted data");
    expect(JSON.parse(context.messages[0].content)).toMatchObject({ tool: request.event, cwd: "/workspace", roots: request.policy.roots });
    expect(completeSimple.mock.calls[0][2].signal).toBeInstanceOf(AbortSignal);
  });

  it.each(['not json', '{}', '{"decision":"allow"}', '{"decision":"yes","reason":"ok"}'])("asks on malformed review: %s", async (text) => {
    const review = createAiPermissionReviewer({ getAvailable: async () => [model], completeSimple: async () => reply(text) }, () => ({ permissionReviewModel: "provider/reviewer" }));
    expect((await review(request)).decision).toBe("ask");
  });

  it("asks for missing models, failed requests, and incomplete output", async () => {
    const completeSimple = vi.fn().mockRejectedValue(new Error("timeout"));
    const runtime = { getAvailable: async () => [model], completeSimple };
    const configured = () => ({ permissionReviewModel: "provider/reviewer" });
    expect((await createAiPermissionReviewer(runtime, () => ({ permissionReviewModel: "" }))(request)).decision).toBe("ask");
    expect(completeSimple).not.toHaveBeenCalled();
    expect((await createAiPermissionReviewer({ ...runtime, getAvailable: async () => [] }, configured)(request)).decision).toBe("ask");
    expect((await createAiPermissionReviewer(runtime, configured)(request)).decision).toBe("ask");
    completeSimple.mockResolvedValue(reply('{"decision":"allow","reason":"ok"}', 'length'));
    expect((await createAiPermissionReviewer(runtime, configured)(request)).decision).toBe("ask");
  });

  it("returns denials and rereads the selected model for each review", async () => {
    const other = { id: "other", provider: "provider" } as any;
    let selected = "provider/reviewer";
    const completeSimple = vi.fn().mockResolvedValue(reply('{"decision":"deny","reason":"Destructive"}'));
    const review = createAiPermissionReviewer({ getAvailable: async () => [model, other], completeSimple }, () => ({ permissionReviewModel: selected }));
    expect((await review(request)).decision).toBe("deny");
    selected = "provider/other";
    await review(request);
    expect(completeSimple.mock.calls[1][0]).toBe(other);
  });
});
