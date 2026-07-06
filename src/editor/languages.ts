import type { Extension } from '@codemirror/state';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';

function extensionFromPath(path: string): string {
  const withoutQuery = path.split(/[?#]/)[0] ?? '';
  const last = withoutQuery.split('/').pop() ?? '';
  const parts = last.toLowerCase().split('.');
  return parts.length > 1 ? parts.at(-1) ?? '' : '';
}

export function languageExtensionForPath(path?: string): Extension[] {
  if (!path) return [];

  switch (extensionFromPath(path)) {
    case 'js':
    case 'mjs':
    case 'cjs':
      return [javascript({ jsx: false, typescript: false })];
    case 'jsx':
      return [javascript({ jsx: true, typescript: false })];
    case 'ts':
    case 'mts':
    case 'cts':
      return [javascript({ jsx: false, typescript: true })];
    case 'tsx':
      return [javascript({ jsx: true, typescript: true })];
    case 'css':
      return [css()];
    case 'html':
    case 'htm':
      return [html()];
    case 'json':
    case 'jsonc':
      return [json()];
    case 'md':
    case 'markdown':
      return [markdown()];
    case 'py':
    case 'pyw':
      return [python()];
    default:
      return [];
  }
}
