import { createEffect, onCleanup } from 'solid-js';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { MergeView, unifiedMergeView } from '@codemirror/merge';
import { basicSetup } from 'codemirror';
import { sylphEditorTheme, sylphMergeTheme, sylphSyntaxHighlighting } from '../editor/codemirrorTheme';
import { languageExtensionForPath } from '../editor/languages';
import { diffMode } from '../lib/diffMode';

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
  let unifiedView: EditorView | undefined;

  const destroyViews = () => {
    mergeView?.destroy();
    mergeView = undefined;
    unifiedView?.destroy();
    unifiedView = undefined;
  };

  createEffect(() => {
    const oldText = props.oldText;
    const newText = props.newText;
    const path = props.path;
    const mode = diffMode();
    let cancelled = false;

    onCleanup(() => {
      cancelled = true;
    });

    void languageExtensionForPath(path).then((languageExtensions) => {
      if (cancelled || !container) return;

      destroyViews();
      container.replaceChildren();

      if (mode === 'unified') {
        unifiedView = new EditorView({
          parent: container,
          doc: newText,
          extensions: [
            ...diffEditorExtensions(languageExtensions),
            unifiedMergeView({
              original: oldText,
              mergeControls: false,
              highlightChanges: true,
              gutter: true,
              collapseUnchanged: {
                margin: 4,
                minSize: 12,
              },
            }),
          ],
        });
        return;
      }

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

  onCleanup(destroyViews);

  return <div ref={container} class="diff-view codemirror-diff-view" />;
}
