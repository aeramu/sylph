import { createEffect, onCleanup } from 'solid-js';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { sylphEditorTheme, sylphSyntaxHighlighting } from '../../editor/codemirrorTheme';
import { languageExtensionForPath } from '../../editor/languages';
import { codeCommentGutter, type CodeCommentRequest } from './codeCommentGutter';
import './CodeComment.css';

const readOnlyExtensions: Extension[] = [
  EditorView.editable.of(false),
  EditorState.readOnly.of(true),
];

function codeViewExtensions(languageExtensions: Extension[]): Extension[] {
  return [
    basicSetup,
    sylphEditorTheme,
    sylphSyntaxHighlighting,
    EditorView.lineWrapping,
    EditorState.tabSize.of(2),
    ...languageExtensions,
    ...readOnlyExtensions,
  ];
}

export default function CodeView(props: { code: string; path?: string; class?: string; onComment?: (request: CodeCommentRequest) => void }) {
  let container!: HTMLDivElement;
  let view: EditorView | undefined;

  createEffect(() => {
    const code = props.code;
    const path = props.path;
    let cancelled = false;

    onCleanup(() => {
      cancelled = true;
    });

    void languageExtensionForPath(path).then((languageExtensions) => {
      if (cancelled || !container) return;

      view?.destroy();
      container.replaceChildren();

      view = new EditorView({
        parent: container,
        doc: code,
        extensions: [
          ...codeViewExtensions(languageExtensions),
          ...codeCommentGutter({ onOpen: props.onComment }),
        ],
      });
    });
  });

  onCleanup(() => view?.destroy());

  return <div ref={container} class={`code-view ${props.class ?? ''}`} />;
}
