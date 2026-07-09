import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

export default defineConfig({
  plugins: [solid()],
  optimizeDeps: {
    // Pre-bundle every CodeMirror entry point up front. The language packages
    // are loaded via dynamic import (src/editor/languages.ts); when the dep
    // optimizer discovers one mid-session it re-optimizes, and modules loaded
    // before/after then reference @codemirror/state under different ?v=
    // hashes — two instances, and every editor dies with "Unrecognized
    // extension value in extension set".
    include: [
      'codemirror',
      '@codemirror/state',
      '@codemirror/view',
      '@codemirror/language',
      '@codemirror/merge',
      '@lezer/highlight',
      '@codemirror/lang-cpp',
      '@codemirror/lang-css',
      '@codemirror/lang-go',
      '@codemirror/lang-html',
      '@codemirror/lang-java',
      '@codemirror/lang-javascript',
      '@codemirror/lang-json',
      '@codemirror/lang-markdown',
      '@codemirror/lang-php',
      '@codemirror/lang-python',
      '@codemirror/lang-rust',
      '@codemirror/lang-sql',
      '@codemirror/lang-vue',
      '@codemirror/lang-xml',
      '@codemirror/lang-yaml',
      '@codemirror/legacy-modes/mode/clike',
      '@codemirror/legacy-modes/mode/clojure',
      '@codemirror/legacy-modes/mode/diff',
      '@codemirror/legacy-modes/mode/dockerfile',
      '@codemirror/legacy-modes/mode/erlang',
      '@codemirror/legacy-modes/mode/go',
      '@codemirror/legacy-modes/mode/haskell',
      '@codemirror/legacy-modes/mode/lua',
      '@codemirror/legacy-modes/mode/mllike',
      '@codemirror/legacy-modes/mode/perl',
      '@codemirror/legacy-modes/mode/properties',
      '@codemirror/legacy-modes/mode/r',
      '@codemirror/legacy-modes/mode/ruby',
      '@codemirror/legacy-modes/mode/shell',
      '@codemirror/legacy-modes/mode/swift',
      '@codemirror/legacy-modes/mode/toml',
    ],
  },
  server: {
    proxy: {
      '/api': {
        // API_PORT lets a second instance (e.g. a worktree copy) run
        // alongside the default one without port collisions.
        target: `http://localhost:${process.env.API_PORT || 3001}`,
        changeOrigin: true,
      }
    }
  }
})
