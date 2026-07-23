import { Type, type Static } from "typebox";
import type { AgentToolResult, ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { formatAnswers } from "../../../features/questions/questionService.ts";
import type { QuestionParams, QuestionnaireResult } from "../../../features/questions/questionTypes.ts";

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
type SchemaQuestionParams = Static<typeof QuestionParamsSchema>;

function textResult(text: string, details: Record<string, unknown>): AgentToolResult<Record<string, unknown>> {
  return { content: [{ type: "text", text }], details };
}

const DESCRIPTION = `Ask the user one or more structured questions during execution and get their answers. Use when the request is ambiguous and you need concrete decisions.

Usage notes:
- Up to 4 questions per call; each question needs 2-4 options.
- Every option needs a short label (1-5 words) and a description explaining the choice or its trade-offs.
- Set multiSelect: true when several answers are valid.
- Optional per-option preview (markdown) renders in a side pane for richer comparisons (single-select only).
- If you recommend an option, make it first and append "(Recommended)" to its label.
- The user can always type a custom answer or dismiss the questions to keep talking freely.`;

/** Pi tool adapter for Sylph's structured-question feature. */
export const askUserQuestionExtension: ExtensionFactory = (pi: ExtensionAPI) => {
  pi.registerTool({
    name: "ask_user_question",
    label: "Ask User Question",
    description: DESCRIPTION,
    parameters: QuestionParamsSchema,
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      const questionParams = params as SchemaQuestionParams as QuestionParams;
      const ask = (ctx.ui as any)?.questions;
      if (!ctx.hasUI || typeof ask !== "function") {
        return textResult(
          "ask_user_question is unavailable: no interactive UI in this session. Ask in plain conversation or proceed with a reasonable default.",
          { cancelled: true, answers: [] },
        );
      }
      const result: QuestionnaireResult = await ask(questionParams);
      if (result?.cancelled) {
        return textResult(
          "The user dismissed the questions without answering. Continue in plain conversation or proceed with a reasonable default.",
          { cancelled: true, answers: [] },
        );
      }
      const answers = result?.answers ?? [];
      return textResult(formatAnswers(questionParams, answers), { cancelled: false, answers });
    },
  });
};

export default askUserQuestionExtension;
