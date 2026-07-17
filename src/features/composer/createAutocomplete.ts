import type { CommandInfo } from '../../types';
import type { ActiveMention } from '../../lib/mentionSearch';
import { escapeHtml } from '../../lib/html';
import { fuzzyScore } from '../../lib/fuzzyScore';

export function detectActiveMention(text: string, rawPosition: number): ActiveMention | null {
  const position = Math.min(rawPosition, text.length);
  const match = text.slice(0, position).match(/(^|\s)@([^\s{}]*)$/);
  return match ? { query: match[2], start: position - match[2].length - 1, end: position } : null;
}

export function formatMention(path: string): string {
  return /[\s{}]/.test(path) ? `@{${path}}` : `@${path}`;
}

export function filterCommands(input: string, commands: CommandInfo[]): CommandInfo[] | null {
  const match = input.match(/^\/([^\s]*)$/);
  if (!match) return null;
  const query = match[1].toLowerCase();
  if (!query) return commands.length ? commands : null;
  return commands
    .map((command) => ({ command, score: fuzzyScore(query, command.name.toLowerCase()) }))
    .filter((entry): entry is { command: CommandInfo; score: number } => entry.score !== null)
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.command);
}

export function highlightMentions(text: string): string {
  if (!text) return '';
  const pattern = /@\{[^}\n]+\}|(^|\s)@[^\s{}]+/g;
  let output = '', last = 0, match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const leading = match[1] || '';
    let mention = leading ? match[0].slice(leading.length) : match[0];
    if (!mention.startsWith('@{')) {
      const stripped = mention.replace(/[.,;:!?)\]}'"]+$/, '');
      if (stripped.length > 1) mention = stripped;
    }
    const start = match.index + leading.length;
    output += escapeHtml(text.slice(last, start));
    output += `<span class="input-mention-highlight">${escapeHtml(mention)}</span>`;
    last = start + mention.length;
  }
  output += escapeHtml(text.slice(last));
  if (text.endsWith('\n')) output += ' ';
  return output;
}
