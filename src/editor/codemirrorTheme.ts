import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

export const sylphEditorTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'transparent',
      color: 'var(--text-primary)',
      fontSize: '0.76rem',
    },
    '.cm-content': {
      caretColor: 'var(--text-primary)',
      fontFamily: 'var(--font-mono)',
      padding: '0.35rem 0',
    },
    '.cm-scroller': {
      fontFamily: 'var(--font-mono)',
      lineHeight: '1.5',
    },
    '.cm-gutters': {
      backgroundColor: 'rgba(0, 0, 0, 0.18)',
      color: 'var(--text-secondary)',
      borderRight: '1px solid var(--border-color)',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      padding: '0 0.55rem 0 0.4rem',
    },
    '.cm-activeLine': {
      backgroundColor: 'rgba(255, 255, 255, 0.035)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'rgba(255, 255, 255, 0.045)',
      color: 'var(--text-primary)',
    },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
      backgroundColor: 'rgba(99, 102, 241, 0.35)',
    },
    '&.cm-focused': {
      outline: 'none',
    },
  },
  { dark: true },
);

export const sylphMergeTheme = EditorView.theme(
  {
    '&.cm-merge-a .cm-changedLine, .cm-deletedChunk': {
      backgroundColor: 'rgba(239, 68, 68, 0.13)',
    },
    '&.cm-merge-b .cm-changedLine, .cm-inlineChangedLine': {
      backgroundColor: 'rgba(34, 197, 94, 0.13)',
    },
    '&.cm-merge-a .cm-changedText, .cm-deletedChunk .cm-deletedText': {
      background: 'rgba(239, 68, 68, 0.28)',
    },
    '&.cm-merge-b .cm-changedText': {
      background: 'rgba(34, 197, 94, 0.28)',
    },
    '&.cm-merge-b .cm-deletedText': {
      background: 'rgba(239, 68, 68, 0.22)',
    },
    '.cm-insertedLine, .cm-deletedLine, .cm-deletedLine del': {
      textDecoration: 'none',
    },
    '&.cm-merge-a .cm-changedLineGutter, .cm-deletedLineGutter': {
      background: 'var(--danger)',
    },
    '&.cm-merge-b .cm-changedLineGutter': {
      background: 'var(--success)',
    },
    '.cm-inlineChangedLineGutter': {
      background: 'var(--accent)',
    },
    '.cm-collapsedLines': {
      color: 'var(--text-secondary)',
      background:
        'linear-gradient(to bottom, transparent 0, rgba(255,255,255,0.055) 30%, rgba(255,255,255,0.055) 70%, transparent 100%)',
    },
  },
  { dark: true },
);

const sylphHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: '#c084fc' },
  { tag: [tags.name, tags.deleted, tags.character, tags.macroName], color: '#e2e8f0' },
  { tag: [tags.propertyName, tags.attributeName], color: '#93c5fd' },
  { tag: [tags.variableName, tags.definition(tags.variableName)], color: '#bfdbfe' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.labelName], color: '#60a5fa' },
  { tag: [tags.string, tags.special(tags.string)], color: '#86efac' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: '#fbbf24' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: '#64748b', fontStyle: 'italic' },
  { tag: [tags.operator, tags.punctuation, tags.separator], color: '#94a3b8' },
  { tag: [tags.className, tags.typeName, tags.namespace], color: '#67e8f9' },
  { tag: [tags.heading, tags.strong], color: '#f8fafc', fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.link, color: '#93c5fd', textDecoration: 'underline' },
  { tag: tags.invalid, color: '#fecaca', backgroundColor: 'rgba(239, 68, 68, 0.22)' },
]);

export const sylphSyntaxHighlighting = syntaxHighlighting(sylphHighlightStyle);
