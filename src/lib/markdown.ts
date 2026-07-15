import { marked, Renderer } from 'marked';
import DOMPurify from 'dompurify';
import { normalizeFenceLanguage } from './codeHighlight';
import { escapeHtml } from './html';

// Strip ANSI terminal escape sequences (colors, cursor moves, etc.). Models
// sometimes emit reasoning/output that quotes colorized terminal text; the
// browser can't interpret those codes, so they'd otherwise show as literal
// garbage like "[38;2;128;128;128m".
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE = /[\x1b\u009b][[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-PR-TZcf-nqry=><]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE, '');
}

export interface ExtractedThinking {
  content: string;
  thinking: string;
  /** True when the stream has opened a thinking block but not closed it yet. */
  isThinking: boolean;
}

// Some providers expose reasoning as ordinary text wrapped in <think> or
// <thinking> instead of emitting structured thinking events. Split those
// blocks out so callers can render them with the same UI as structured
// reasoning. A tiny scanner is used rather than a single regex so an unclosed
// block can still be displayed while its contents stream in.
function fencedCodeRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const lines = text.match(/.*(?:\n|$)/g) ?? [];
  let offset = 0;
  let fenceStart: number | undefined;
  let fenceCharacter = '';
  let fenceLength = 0;

  for (const line of lines) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/i)?.[1];
    if (marker && fenceStart === undefined) {
      fenceStart = offset;
      fenceCharacter = marker[0];
      fenceLength = marker.length;
    } else if (marker && fenceStart !== undefined && marker[0] === fenceCharacter && marker.length >= fenceLength) {
      ranges.push([fenceStart, offset + line.length]);
      fenceStart = undefined;
    }
    offset += line.length;
  }

  if (fenceStart !== undefined) ranges.push([fenceStart, text.length]);
  return ranges;
}

function containsOffset(ranges: Array<[number, number]>, offset: number): boolean {
  return ranges.some(([start, end]) => offset >= start && offset < end);
}

// Markdown code spans use matching runs of backticks as delimiters. Protect
// their contents as well as fenced blocks: literal examples such as `<think>`
// must remain answer text rather than being mistaken for provider reasoning.
function inlineCodeRanges(text: string, fencedRanges: Array<[number, number]>): Array<[number, number]> {
  const runs = Array.from(text.matchAll(/`+/g))
    .filter((match) => !containsOffset(fencedRanges, match.index))
    .map((match) => ({ start: match.index, end: match.index + match[0].length, length: match[0].length }));
  const ranges: Array<[number, number]> = [];

  for (let i = 0; i < runs.length; i++) {
    const opener = runs[i];
    let precedingBackslashes = 0;
    for (let offset = opener.start - 1; offset >= 0 && text[offset] === '\\'; offset--) precedingBackslashes++;
    if (precedingBackslashes % 2 === 1) continue;

    const closingIndex = runs.findIndex((candidate, index) => index > i && candidate.length === opener.length);
    if (closingIndex < 0) continue;
    ranges.push([opener.start, runs[closingIndex].end]);
    i = closingIndex;
  }

  return ranges;
}

function markdownCodeRanges(text: string): Array<[number, number]> {
  const fencedRanges = fencedCodeRanges(text);
  return [...fencedRanges, ...inlineCodeRanges(text, fencedRanges)];
}

export function extractThinkingBlocks(text: string): ExtractedThinking {
  const tagPattern = /<\/?(?:think|thinking)>/gi;
  const codeRanges = markdownCodeRanges(text);
  const contentParts: string[] = [];
  const thinkingBlocks: string[] = [];
  let thinkingPart = '';
  let segmentStart = 0;
  let insideThinking = false;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(text)) !== null) {
    if (containsOffset(codeRanges, match.index)) continue;
    const segment = text.slice(segmentStart, match.index);
    if (insideThinking) thinkingPart += segment;
    else contentParts.push(segment);

    const closing = match[0].startsWith('</');
    if (closing) {
      if (insideThinking) {
        thinkingBlocks.push(thinkingPart);
        thinkingPart = '';
        insideThinking = false;
      }
      // Stray closing tags are omitted from visible answer text too.
    } else if (insideThinking) {
      // Nested thinking tags are redundant; keep collecting into this block.
    } else {
      insideThinking = true;
      thinkingPart = '';
    }
    segmentStart = tagPattern.lastIndex;
  }

  const tail = text.slice(segmentStart);
  if (insideThinking) {
    thinkingPart += tail;
    thinkingBlocks.push(thinkingPart);
  } else {
    contentParts.push(tail);
  }

  return {
    content: contentParts.join('').trimStart(),
    thinking: thinkingBlocks.join('\n\n'),
    isThinking: insideThinking,
  };
}

// Kept as a convenience for non-chat callers that only need the answer.
export function stripThinkingBlocks(text: string): string {
  return extractThinkingBlocks(text).content;
}

export function renderMarkdown(content: string, options: { processThinkingTags?: boolean } = {}): string {
  if (!content) return '';

  const { processThinkingTags = true } = options;
  let processed = stripAnsi(content);

  // Process <thinking> and <think> tags into collapsible <details> for normal
  // assistant content. Dedicated thinking panels already provide their own
  // collapsible UI, so callers can disable this to avoid nested accordions.
  if (processThinkingTags) {
    const openCount = (processed.match(/<thinking>|<think>/g) || []).length;
    const closeCount = (processed.match(/<\/thinking>|<\/think>/g) || []).length;

    processed = processed
      .replace(/<thinking>|<think>/g, '<details class="thinking-block" open><summary>Thinking process</summary><div class="thinking-content">\n\n')
      .replace(/<\/thinking>|<\/think>/g, '\n\n</div></details>');

    if (openCount > closeCount) {
      processed += '\n\n</div></details>';
    }
  }

  try {
    const renderer = new Renderer();
    renderer.code = ({ text, lang }) => {
      const language = normalizeFenceLanguage(lang || '');
      const languageClass = language ? ` language-${escapeHtml(language)}` : '';
      const languageAttr = language ? ` data-lang="${escapeHtml(language)}"` : '';
      const languageLabel = language
        ? `<div class="code-block-header">${escapeHtml(language)}</div>`
        : '';

      return `<div class="code-block">${languageLabel}<pre><code class="${languageClass}"${languageAttr}>${escapeHtml(text)}</code></pre></div>`;
    };

    const rawHtml = marked.parse(processed, { async: false, renderer }) as string;
    // Note: deliberately NOT allowing iframe or style attributes — model
    // output is untrusted and those defeat the point of sanitizing.
    return DOMPurify.sanitize(rawHtml, {
      USE_PROFILES: { html: true, svg: true },
      ADD_ATTR: ['class', 'target', 'viewBox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'id', 'name', 'type', 'checked', 'disabled'],
      ADD_TAGS: ['svg', 'path', 'g', 'circle', 'rect', 'line', 'polygon', 'polyline', 'defs', 'clipPath', 'text', 'details', 'summary', 'input', 'kbd', 'del']
    });
  } catch {
    return content;
  }
}
