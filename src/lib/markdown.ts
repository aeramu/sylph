import { marked } from 'marked';
import DOMPurify from 'dompurify';

// Strip ANSI terminal escape sequences (colors, cursor moves, etc.). Models
// sometimes emit reasoning/output that quotes colorized terminal text; the
// browser can't interpret those codes, so they'd otherwise show as literal
// garbage like "[38;2;128;128;128m".
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE = /[\x1b\u009b][[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-PR-TZcf-nqry=><]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE, '');
}

export function renderMarkdown(content: string): string {
  if (!content) return '';

  // Process <thinking> and <think> tags into collapsible <details>
  let processed = stripAnsi(content);
  const openCount = (processed.match(/<thinking>|<think>/g) || []).length;
  const closeCount = (processed.match(/<\/thinking>|<\/think>/g) || []).length;

  processed = processed
    .replace(/<thinking>|<think>/g, '<details class="thinking-block" open><summary>Thinking process</summary><div class="thinking-content">\n\n')
    .replace(/<\/thinking>|<\/think>/g, '\n\n</div></details>');

  if (openCount > closeCount) {
    processed += '\n\n</div></details>';
  }

  try {
    const rawHtml = marked.parse(processed, { async: false }) as string;
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
