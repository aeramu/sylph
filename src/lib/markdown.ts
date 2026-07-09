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

export function stripThinkingBlocks(text: string): string {
  return text
    // Remove complete <think>...</think> / <thinking>...</thinking> blocks.
    .replace(/<(?:think|thinking)>[\s\S]*?<\/(?:think|thinking)>/gi, '')
    // During malformed/partial streams, remove an opening tag through EOF.
    .replace(/<(?:think|thinking)>[\s\S]*$/gi, '')
    // Remove stray tags without deleting surrounding answer text.
    .replace(/<\/?(?:think|thinking)>/gi, '')
    .trimStart();
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
