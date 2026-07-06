import { StringStream, type LRLanguage, type StreamParser } from '@codemirror/language';
import { highlightCode, classHighlighter } from '@lezer/highlight';

const highlightedBlocks = new WeakSet<HTMLElement>();

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function normalizeFenceLanguage(info = ''): string {
  return info.trim().split(/\s+/)[0]?.toLowerCase().replace(/^language-/, '') || '';
}

type HighlightLanguage =
  | { kind: 'lezer'; language: LRLanguage }
  | { kind: 'legacy'; parser: StreamParser<unknown> };

async function languageForFence(language: string): Promise<HighlightLanguage | undefined> {
  switch (language) {
    case 'js':
    case 'javascript':
    case 'mjs':
    case 'cjs': {
      const { javascriptLanguage } = await import('@codemirror/lang-javascript');
      return { kind: 'lezer', language: javascriptLanguage };
    }
    case 'jsx': {
      const { jsxLanguage } = await import('@codemirror/lang-javascript');
      return { kind: 'lezer', language: jsxLanguage };
    }
    case 'ts':
    case 'typescript':
    case 'mts':
    case 'cts': {
      const { typescriptLanguage } = await import('@codemirror/lang-javascript');
      return { kind: 'lezer', language: typescriptLanguage };
    }
    case 'tsx': {
      const { tsxLanguage } = await import('@codemirror/lang-javascript');
      return { kind: 'lezer', language: tsxLanguage };
    }
    case 'html':
    case 'htm': {
      const { htmlLanguage } = await import('@codemirror/lang-html');
      return { kind: 'lezer', language: htmlLanguage };
    }
    case 'css':
    case 'scss':
    case 'less': {
      const { cssLanguage } = await import('@codemirror/lang-css');
      return { kind: 'lezer', language: cssLanguage };
    }
    case 'json':
    case 'jsonc': {
      const { jsonLanguage } = await import('@codemirror/lang-json');
      return { kind: 'lezer', language: jsonLanguage };
    }
    case 'py':
    case 'python': {
      const { pythonLanguage } = await import('@codemirror/lang-python');
      return { kind: 'lezer', language: pythonLanguage };
    }
    case 'rs':
    case 'rust': {
      const { rustLanguage } = await import('@codemirror/lang-rust');
      return { kind: 'lezer', language: rustLanguage };
    }
    case 'go':
    case 'golang': {
      const { goLanguage } = await import('@codemirror/lang-go');
      return { kind: 'lezer', language: goLanguage };
    }
    case 'xml':
    case 'svg': {
      const { xmlLanguage } = await import('@codemirror/lang-xml');
      return { kind: 'lezer', language: xmlLanguage };
    }
    case 'yaml':
    case 'yml': {
      const { yamlLanguage } = await import('@codemirror/lang-yaml');
      return { kind: 'lezer', language: yamlLanguage };
    }
    case 'java': {
      const { javaLanguage } = await import('@codemirror/lang-java');
      return { kind: 'lezer', language: javaLanguage };
    }
    case 'cpp':
    case 'cxx':
    case 'cc':
    case 'c':
    case 'h':
    case 'hpp': {
      const { cppLanguage } = await import('@codemirror/lang-cpp');
      return { kind: 'lezer', language: cppLanguage };
    }
    case 'php': {
      const { phpLanguage } = await import('@codemirror/lang-php');
      return { kind: 'lezer', language: phpLanguage };
    }
    case 'vue': {
      const { vueLanguage } = await import('@codemirror/lang-vue');
      return { kind: 'lezer', language: vueLanguage };
    }
    case 'sql': {
      const { StandardSQL } = await import('@codemirror/lang-sql');
      return { kind: 'lezer', language: StandardSQL.language };
    }
    case 'bash':
    case 'sh':
    case 'shell':
    case 'zsh': {
      const { shell } = await import('@codemirror/legacy-modes/mode/shell');
      return { kind: 'legacy', parser: shell };
    }
    case 'dockerfile':
    case 'docker': {
      const { dockerFile } = await import('@codemirror/legacy-modes/mode/dockerfile');
      return { kind: 'legacy', parser: dockerFile };
    }
    case 'lua': {
      const { lua } = await import('@codemirror/legacy-modes/mode/lua');
      return { kind: 'legacy', parser: lua };
    }
    default:
      return undefined;
  }
}

function legacyStyleToClasses(style: string): string {
  const classes = new Set<string>();

  for (const raw of style.split(/\s+/)) {
    for (const part of raw.split('.')) {
      switch (part) {
        case 'keyword': classes.add('tok-keyword'); break;
        case 'comment': classes.add('tok-comment'); break;
        case 'string': classes.add('tok-string'); break;
        case 'number': classes.add('tok-number'); break;
        case 'atom': classes.add('tok-atom'); break;
        case 'bool': classes.add('tok-bool'); break;
        case 'operator': classes.add('tok-operator'); break;
        case 'variable':
        case 'variableName':
        case 'variable-2': classes.add('tok-variableName'); break;
        case 'property':
        case 'propertyName':
        case 'attribute': classes.add('tok-propertyName'); break;
        case 'def':
        case 'definition': classes.add('tok-definition'); break;
        case 'builtin':
        case 'special': classes.add('tok-variableName2'); break;
        case 'type':
        case 'typeName':
        case 'tag': classes.add('tok-typeName'); break;
        case 'meta': classes.add('tok-meta'); break;
        case 'invalid':
        case 'error': classes.add('tok-invalid'); break;
        default:
          if (part) classes.add(`cm-${part.replace(/[^a-zA-Z0-9_-]/g, '-')}`);
      }
    }
  }

  return [...classes].join(' ');
}

function highlightLegacyCode(code: string, parser: StreamParser<unknown>): string {
  const indentUnit = 2;
  const tabSize = 4;
  const state = parser.startState?.(indentUnit) ?? {};
  const lines = code.split('\n');
  let html = '';

  lines.forEach((line, lineIndex) => {
    if (line.length === 0) {
      parser.blankLine?.(state, indentUnit);
    } else {
      const stream = new StringStream(line, tabSize, indentUnit);

      while (!stream.eol()) {
        stream.start = stream.pos;
        const before = stream.pos;
        const style = parser.token(stream, state);

        if (stream.pos === before) stream.next();

        const tokenText = line.slice(before, stream.pos);
        const classes = style ? legacyStyleToClasses(style) : '';
        html += classes
          ? `<span class="${escapeHtml(classes)}">${escapeHtml(tokenText)}</span>`
          : escapeHtml(tokenText);
      }
    }

    if (lineIndex < lines.length - 1) html += '\n';
  });

  return html;
}

function highlightLezerCode(code: string, parserLanguage: LRLanguage): string {
  const tree = parserLanguage.parser.parse(code);
  let html = '';

  highlightCode(
    code,
    tree,
    classHighlighter,
    (text, classes) => {
      html += classes
        ? `<span class="${escapeHtml(classes)}">${escapeHtml(text)}</span>`
        : escapeHtml(text);
    },
    () => {
      html += '\n';
    },
  );

  return html;
}

export async function highlightCodeToHtml(code: string, language: string): Promise<string | null> {
  const parserLanguage = await languageForFence(normalizeFenceLanguage(language));
  if (!parserLanguage) return null;

  return parserLanguage.kind === 'lezer'
    ? highlightLezerCode(code, parserLanguage.language)
    : highlightLegacyCode(code, parserLanguage.parser);
}

async function highlightCodeElement(codeEl: HTMLElement) {
  if (highlightedBlocks.has(codeEl)) return;

  const language = normalizeFenceLanguage(codeEl.dataset.lang || '');
  if (!language) return;

  highlightedBlocks.add(codeEl);

  try {
    const code = codeEl.textContent || '';
    const html = await highlightCodeToHtml(code, language);
    if (!html) return;

    codeEl.innerHTML = html;
    codeEl.classList.add('cm-highlighted');
  } catch (error) {
    highlightedBlocks.delete(codeEl);
    console.warn('Failed to highlight fenced code block', error);
  }
}

export function highlightMarkdownCodeBlocks(root: ParentNode | undefined) {
  if (!root) return;

  const blocks = root.querySelectorAll<HTMLElement>('pre code[data-lang]:not(.cm-highlighted)');
  for (const block of blocks) {
    void highlightCodeElement(block);
  }
}
