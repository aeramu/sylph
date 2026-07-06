import type { Extension } from '@codemirror/state';
import { StreamLanguage } from '@codemirror/language';
import type { StreamParser } from '@codemirror/language';

function extensionFromPath(path: string): string {
  const withoutQuery = path.split(/[?#]/)[0] ?? '';
  const last = withoutQuery.split('/').pop() ?? '';
  const parts = last.toLowerCase().split('.');
  return parts.length > 1 ? parts.at(-1) ?? '' : last.toLowerCase();
}

function legacyLanguage(parser: StreamParser<unknown>): Extension[] {
  return [StreamLanguage.define(parser)];
}

export async function languageExtensionForPath(path?: string): Promise<Extension[]> {
  if (!path) return [];

  switch (extensionFromPath(path)) {
    case 'js':
    case 'mjs':
    case 'cjs': {
      const { javascript } = await import('@codemirror/lang-javascript');
      return [javascript({ jsx: false, typescript: false })];
    }
    case 'jsx': {
      const { javascript } = await import('@codemirror/lang-javascript');
      return [javascript({ jsx: true, typescript: false })];
    }
    case 'ts':
    case 'mts':
    case 'cts': {
      const { javascript } = await import('@codemirror/lang-javascript');
      return [javascript({ jsx: false, typescript: true })];
    }
    case 'tsx': {
      const { javascript } = await import('@codemirror/lang-javascript');
      return [javascript({ jsx: true, typescript: true })];
    }
    case 'css':
    case 'scss':
    case 'sass':
    case 'less': {
      const { css } = await import('@codemirror/lang-css');
      return [css()];
    }
    case 'html':
    case 'htm': {
      const { html } = await import('@codemirror/lang-html');
      return [html()];
    }
    case 'json':
    case 'jsonc':
    case 'map': {
      const { json } = await import('@codemirror/lang-json');
      return [json()];
    }
    case 'md':
    case 'mdx':
    case 'markdown': {
      const { markdown } = await import('@codemirror/lang-markdown');
      return [markdown()];
    }
    case 'py':
    case 'pyw': {
      const { python } = await import('@codemirror/lang-python');
      return [python()];
    }
    case 'c':
    case 'cc':
    case 'cpp':
    case 'cxx':
    case 'h':
    case 'hh':
    case 'hpp':
    case 'hxx': {
      const { cpp } = await import('@codemirror/lang-cpp');
      return [cpp()];
    }
    case 'java': {
      const { java } = await import('@codemirror/lang-java');
      return [java()];
    }
    case 'php':
    case 'phtml': {
      const { php } = await import('@codemirror/lang-php');
      return [php()];
    }
    case 'rs': {
      const { rust } = await import('@codemirror/lang-rust');
      return [rust()];
    }
    case 'sql': {
      const { sql } = await import('@codemirror/lang-sql');
      return [sql()];
    }
    case 'vue': {
      const { vue } = await import('@codemirror/lang-vue');
      return [vue()];
    }
    case 'xml':
    case 'svg': {
      const { xml } = await import('@codemirror/lang-xml');
      return [xml()];
    }
    case 'yml':
    case 'yaml': {
      const { yaml } = await import('@codemirror/lang-yaml');
      return [yaml()];
    }
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'fish':
    case 'env':
    case '.env': {
      const { shell } = await import('@codemirror/legacy-modes/mode/shell');
      return legacyLanguage(shell);
    }
    case 'dockerfile': {
      const { dockerFile } = await import('@codemirror/legacy-modes/mode/dockerfile');
      return legacyLanguage(dockerFile);
    }
    case 'go': {
      const { go } = await import('@codemirror/legacy-modes/mode/go');
      return legacyLanguage(go);
    }
    case 'rb':
    case 'ruby': {
      const { ruby } = await import('@codemirror/legacy-modes/mode/ruby');
      return legacyLanguage(ruby);
    }
    case 'lua': {
      const { lua } = await import('@codemirror/legacy-modes/mode/lua');
      return legacyLanguage(lua);
    }
    case 'pl':
    case 'pm': {
      const { perl } = await import('@codemirror/legacy-modes/mode/perl');
      return legacyLanguage(perl);
    }
    case 'r': {
      const { r } = await import('@codemirror/legacy-modes/mode/r');
      return legacyLanguage(r);
    }
    case 'swift': {
      const { swift } = await import('@codemirror/legacy-modes/mode/swift');
      return legacyLanguage(swift);
    }
    case 'kt':
    case 'kts': {
      const { kotlin } = await import('@codemirror/legacy-modes/mode/clike');
      return legacyLanguage(kotlin);
    }
    case 'scala':
    case 'sc': {
      const { scala } = await import('@codemirror/legacy-modes/mode/clike');
      return legacyLanguage(scala);
    }
    case 'cs': {
      const { csharp } = await import('@codemirror/legacy-modes/mode/clike');
      return legacyLanguage(csharp);
    }
    case 'clj':
    case 'cljs':
    case 'cljc': {
      const { clojure } = await import('@codemirror/legacy-modes/mode/clojure');
      return legacyLanguage(clojure);
    }
    case 'erl':
    case 'hrl': {
      const { erlang } = await import('@codemirror/legacy-modes/mode/erlang');
      return legacyLanguage(erlang);
    }
    case 'hs': {
      const { haskell } = await import('@codemirror/legacy-modes/mode/haskell');
      return legacyLanguage(haskell);
    }
    case 'ml':
    case 'mli':
    case 'fs':
    case 'fsx': {
      const { oCaml, fSharp } = await import('@codemirror/legacy-modes/mode/mllike');
      return legacyLanguage(extensionFromPath(path) === 'fs' || extensionFromPath(path) === 'fsx' ? fSharp : oCaml);
    }
    case 'toml': {
      const { toml } = await import('@codemirror/legacy-modes/mode/toml');
      return legacyLanguage(toml);
    }
    case 'ini':
    case 'properties': {
      const { properties } = await import('@codemirror/legacy-modes/mode/properties');
      return legacyLanguage(properties);
    }
    case 'diff':
    case 'patch': {
      const { diff } = await import('@codemirror/legacy-modes/mode/diff');
      return legacyLanguage(diff);
    }
    default:
      return [];
  }
}
