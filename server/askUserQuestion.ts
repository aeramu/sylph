// Native `ask_user_question` tool for sylph.
//
// Extensions like @juicesharp/rpiv-ask-user-question render their questionnaire
// through ctx.ui.custom() — a pi-tui terminal overlay that sylph's browser UI
// can't display. Instead of bridging the terminal, we register our own tool
// (same shape) whose UI runs natively in the browser: execute() hands the
// structured params to ctx.ui.askQuestions(), which sylph's uiBridge turns into
// an SSE dialog request and resolves with the user's answers.
//
// Registered as an inline extensionFactory (see runtimes.ts) so it loads into
// every sylph runtime without a file or npm package.

import { Type, type Static } from "typebox";
import type { ExtensionAPI, ExtensionFactory, AgentToolResult } from "@earendil-works/pi-coding-agent";

const OptionSchema = Type.Object({
  label: Type.String({ description: "Concise choice text shown to the user (1-5 words)." }),
  description: Type.String({ description: "One line explaining what this choice means or its trade-offs." }),
  preview: Type.Optional(Type.String({
    description: "Optional richer content (markdown: mockups, code, configs) shown in a side pane when this option is focused. Single-select only.",
  })),
});

const QuestionSchema = Type.Object({
  question: Type.String({ description: "The full question text." }),
  header: Type.String({ description: "Short label/chip for the question (max ~12 chars)." }),
  multiSelect: Type.Optional(Type.Boolean({ description: "Allow selecting multiple options. Default false." })),
  options: Type.Array(OptionSchema, { minItems: 2, maxItems: 4 }),
});

export const QuestionParamsSchema = Type.Object({
  questions: Type.Array(QuestionSchema, { minItems: 1, maxItems: 4 }),
});

export type QuestionParams = Static<typeof QuestionParamsSchema>;

// One entry per question, index-aligned with params.questions.
export interface QuestionAnswer {
  selected: string[];
  customText?: string;
}
export interface QuestionnaireResult {
  cancelled: boolean;
  answers: QuestionAnswer[];
}

function textResult(text: string, details: Record<string, unknown>): AgentToolResult<Record<string, unknown>> {
  return { content: [{ type: "text", text }], details };
}

function formatAnswers(params: QuestionParams, answers: QuestionAnswer[]): string {
  const lines = params.questions.map((q, i) => {
    const a = answers[i] ?? { selected: [] };
    const parts = [...(a.selected ?? [])];
    if (a.customText) parts.push(`"${a.customText}"`);
    const ans = parts.length ? parts.join(", ") : "(no selection)";
    return `- ${q.header || q.question}: ${ans}`;
  });
  return "The user answered:\n" + lines.join("\n");
}

const DESCRIPTION = `Ask the user one or more structured questions during execution and get their answers. Use when the request is ambiguous and you need concrete decisions.

Usage notes:
- Up to 4 questions per call; each question needs 2-4 options.
- Every option needs a short label (1-5 words) and a description explaining the choice or its trade-offs.
- Set multiSelect: true when several answers are valid.
- Optional per-option preview (markdown) renders in a side pane for richer comparisons (single-select only).
- If you recommend an option, make it first and append "(Recommended)" to its label.
- The user can always type a custom answer or dismiss the questions to keep talking freely.`;

export const askUserQuestionExtension: ExtensionFactory = (pi: ExtensionAPI) => {
  pi.registerTool({
    name: "ask_user_question",
    label: "Ask User Question",
    description: DESCRIPTION,
    parameters: QuestionParamsSchema,
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      const p = params as QuestionParams;
      const ask = (ctx.ui as any)?.askQuestions;
      if (!ctx.hasUI || typeof ask !== "function") {
        return textResult(
          "ask_user_question is unavailable: no interactive UI in this session. Ask in plain conversation or proceed with a reasonable default.",
          { cancelled: true, answers: [] },
        );
      }
      const result: QuestionnaireResult = await ask(p);
      if (result?.cancelled) {
        return textResult(
          "The user dismissed the questions without answering. Continue in plain conversation or proceed with a reasonable default.",
          { cancelled: true, answers: [] },
        );
      }
      const answers = result?.answers ?? [];
      return textResult(formatAnswers(p, answers), { cancelled: false, answers });
    },
  });
};
