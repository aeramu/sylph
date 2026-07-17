import { describe, expect, it } from 'vitest';
import { detectActiveMention, filterCommands, formatMention, highlightMentions } from './createAutocomplete';

describe('composer autocomplete', () => {
  it('detects the active mention at the caret', () => {
    expect(detectActiveMention('read @src/App', 13)).toEqual({ query: 'src/App', start: 5, end: 13 });
    expect(detectActiveMention('plain text', 10)).toBeNull();
  });

  it('formats paths with explicit boundaries only when needed', () => {
    expect(formatMention('src/App.tsx')).toBe('@src/App.tsx');
    expect(formatMention('docs/my note.md')).toBe('@{docs/my note.md}');
  });

  it('fuzzy-filters slash commands', () => {
    const commands = [{ name: 'model', source: 'built-in' }, { name: 'thinking', source: 'built-in' }];
    expect(filterCommands('/mdl', commands)?.[0].name).toBe('model');
    expect(filterCommands('hello', commands)).toBeNull();
  });

  it('escapes mention highlights and excludes sentence punctuation', () => {
    expect(highlightMentions('see @src/a.ts.')).toContain('<span class="input-mention-highlight">@src/a.ts</span>.');
  });
});
