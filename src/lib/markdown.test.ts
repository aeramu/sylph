import { describe, expect, it } from 'vitest';
import { extractThinkingBlocks, stripThinkingBlocks } from './markdown';

describe('extractThinkingBlocks', () => {
  it('extracts a complete thinking block from the answer', () => {
    expect(extractThinkingBlocks('<thinking>Consider this.</thinking>Final answer.')).toEqual({
      content: 'Final answer.',
      thinking: 'Consider this.',
      isThinking: false,
    });
  });

  it('supports the short think tag case-insensitively', () => {
    expect(extractThinkingBlocks('Before<THINK>Reasoning</THINK>After')).toEqual({
      content: 'BeforeAfter',
      thinking: 'Reasoning',
      isThinking: false,
    });
  });

  it('returns partial reasoning as active while an opening tag is unclosed', () => {
    expect(extractThinkingBlocks('<think>Still considering')).toEqual({
      content: '',
      thinking: 'Still considering',
      isThinking: true,
    });
  });

  it('collects multiple thinking blocks without removing answer text', () => {
    expect(extractThinkingBlocks('<think>One</think>First. <thinking>Two</thinking>Second.')).toEqual({
      content: 'First. Second.',
      thinking: 'One\n\nTwo',
      isThinking: false,
    });
  });

  it('omits stray closing tags but preserves surrounding content', () => {
    expect(extractThinkingBlocks('Answer</thinking> continues')).toEqual({
      content: 'Answer continues',
      thinking: '',
      isThinking: false,
    });
  });

  it('preserves literal thinking tags inside fenced code', () => {
    const text = '```xml\n<think>example</think>\n```\n\nAnswer';
    expect(extractThinkingBlocks(text)).toEqual({
      content: text,
      thinking: '',
      isThinking: false,
    });
  });

  it('accepts equivalent long and short closing tags', () => {
    expect(extractThinkingBlocks('<think>Reasoning</thinking>Answer')).toEqual({
      content: 'Answer',
      thinking: 'Reasoning',
      isThinking: false,
    });
  });

  it('keeps stripThinkingBlocks compatible with answer-only callers', () => {
    expect(stripThinkingBlocks('<thinking>Hidden before</thinking>Visible')).toBe('Visible');
    expect(stripThinkingBlocks('<thinking>Still streaming')).toBe('');
  });
});
