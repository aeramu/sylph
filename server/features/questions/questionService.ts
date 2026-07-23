import type { DanglingQuestion, QuestionAnswer, QuestionParams } from "./questionTypes.ts";

function answerLines(params: QuestionParams, answers: QuestionAnswer[]) {
  return params.questions.map((question, index) => {
    const answer = answers[index] ?? { selected: [] };
    const parts = [...(answer.selected ?? [])];
    if (answer.customText) parts.push(`"${answer.customText}"`);
    return `- ${question.header || question.question}: ${parts.length ? parts.join(", ") : "(no selection)"}`;
  });
}

export function formatAnswers(params: QuestionParams, answers: QuestionAnswer[]): string {
  return `The user answered:\n${answerLines(params, answers).join("\n")}`;
}

// A reconstructed question cannot complete its old tool call, so answers are
// sent back to the model as a normal user prompt.
export function formatAnswersAsUserReply(params: QuestionParams, answers: QuestionAnswer[]): string {
  return `My answers to your questions:\n${answerLines(params, answers).join("\n")}`;
}

/** Find an unanswered question at the conversation tail after runtime loss. */
export function findDanglingQuestion(messages: any[]): DanglingQuestion | undefined {
  const answered = new Set<string>();
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role === "toolResult") {
      answered.add(message.toolCallId);
      continue;
    }
    if (message.role === "assistant") {
      if (message.stopReason === "error" || message.stopReason === "aborted") return undefined;
      const calls = Array.isArray(message.content)
        ? message.content.filter((entry: any) => entry.type === "toolCall")
        : [];
      const question = calls.find((entry: any) => entry.name === "ask_user_question" && !answered.has(entry.id));
      return question ? { toolCallId: question.id, params: question.arguments as QuestionParams } : undefined;
    }
    return undefined;
  }
  return undefined;
}
