import { createEffect, onCleanup } from 'solid-js';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { MergeView } from '@codemirror/merge';
import { basicSetup } from 'codemirror';
import { sylphEditorTheme, sylphMergeTheme, sylphSyntaxHighlighting } from '../editor/codemirrorTheme';
import { languageExtensionForPath } from '../editor/languages';

const readOnlyExtensions: Extension[] = [
  EditorView.editable.of(false),
  EditorState.readOnly.of(true),
];

function diffEditorExtensions(languageExtensions: Extension[]): Extension[] {
  return [
    basicSetup,
    sylphEditorTheme,
    sylphMergeTheme,
    sylphSyntaxHighlighting,
    EditorView.lineWrapping,
    EditorState.tabSize.of(2),
    ...languageExtensions,
    ...readOnlyExtensions,
  ];
}

export default function DiffView(props: { oldText: string; newText: string; path?: string }) {
  let container!: HTMLDivElement;
  let mergeView: MergeView | undefined;

  createEffect(() => {
    const oldText = props.oldText;
    const newText = props.newText;
    const path = props.path;
    let cancelled = false;

    onCleanup(() => {
      cancelled = true;
    });

    void languageExtensionForPath(path).then((languageExtensions) => {
      if (cancelled || !container) return;

      mergeView?.destroy();
      container.replaceChildren();

      mergeView = new MergeView({
        a: {
          doc: oldText,
          extensions: diffEditorExtensions(languageExtensions),
        },
        b: {
          doc: newText,
          extensions: diffEditorExtensions(languageExtensions),
        },
        parent: container,
        highlightChanges: true,
        gutter: true,
        collapseUnchanged: {
          margin: 4,
          minSize: 12,
        },
      });
    });
  });

  onCleanup(() => mergeView?.destroy());

  return <div ref={container} class="diff-view codemirror-diff-view" />;
}
