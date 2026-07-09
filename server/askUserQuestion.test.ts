import { describe, it, expect } from 'vitest';
import { findDanglingQuestion, formatAnswersAsUserReply } from './askUserQuestion.ts';

const askCall = (id: string) => ({
  role: 'assistant',
  content: [{ type: 'toolCall', name: 'ask_user_question', id, arguments: { questions: [] } }],
});

describe('findDanglingQuestion', () => {
  it('finds an unanswered ask_user_question at the tail', () => {
    const found = findDanglingQuestion([{ role: 'user', content: 'go' }, askCall('q1')]);
    expect(found?.toolCallId).toBe('q1');
  });

  it('returns undefined once the question has a tool result', () => {
    expect(
      findDanglingQuestion([askCall('q1'), { role: 'toolResult', toolCallId: 'q1', content: 'ok' }]),
    ).toBeUndefined();
  });

  it('returns undefined when the conversation moved past the question', () => {
    // A later user message means the turn is over; nothing to restore.
    expect(
      findDanglingQuestion([askCall('q1'), { role: 'user', content: 'never mind' }]),
    ).toBeUndefined();
  });

  it('does not resurrect a question from an errored turn', () => {
    expect(
      findDanglingQuestion([{ ...askCall('q1'), stopReason: 'error' }]),
    ).toBeUndefined();
  });

  it('does not resurrect a question from an aborted turn', () => {
    expect(
      findDanglingQuestion([{ ...askCall('q1'), stopReason: 'aborted' }]),
    ).toBeUndefined();
  });

  it('ignores non-ask tool calls', () => {
    const msg = { role: 'assistant', content: [{ type: 'toolCall', name: 'bash', id: 'b1', arguments: {} }] };
    expect(findDanglingQuestion([msg])).toBeUndefined();
  });
});

describe('formatAnswersAsUserReply', () => {
  it('renders selections and custom text per question', () => {
    const params = {
      questions: [
        { question: 'Pick one', header: 'Choice', options: [] },
        { question: 'Another', header: 'Extra', options: [] },
      ],
    } as any;
    const reply = formatAnswersAsUserReply(params, [
      { selected: ['A'], customText: 'also this' },
      { selected: [] },
    ]);
    expect(reply).toContain('- Choice: A, "also this"');
    expect(reply).toContain('- Extra: (no selection)');
  });
});
