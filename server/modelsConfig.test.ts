import { describe, it, expect } from 'vitest';
import { stripJsonComments } from './modelsConfig.ts';

describe('stripJsonComments', () => {
  it('parses cleanly after stripping line comments', () => {
    const input = `{
      // a provider
      "providers": {} // trailing
    }`;
    expect(JSON.parse(stripJsonComments(input))).toEqual({ providers: {} });
  });

  it('removes trailing commas before } and ]', () => {
    const input = `{ "a": [1, 2, 3,], "b": 4, }`;
    expect(JSON.parse(stripJsonComments(input))).toEqual({ a: [1, 2, 3], b: 4 });
  });

  it('leaves // and commas inside string literals untouched', () => {
    const input = `{ "url": "https://example.com/path", "note": "a, b, c" }`;
    expect(JSON.parse(stripJsonComments(input))).toEqual({
      url: 'https://example.com/path',
      note: 'a, b, c',
    });
  });

  it('does not treat an escaped quote as a string boundary', () => {
    const input = `{ "quote": "she said \\"hi\\" // not a comment" }`;
    expect(JSON.parse(stripJsonComments(input))).toEqual({
      quote: 'she said "hi" // not a comment',
    });
  });
});
