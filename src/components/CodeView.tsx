import { createEffect, onCleanup } from 'solid-js';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { sylphEditorTheme, sylphSyntaxHighlighting } from '../editor/codemirrorTheme';
import { languageExtensionForPath } from '../editor/languages';

const readOnlyExtensions: Extension[] = [
  EditorView.editable.of(false),
  EditorState.readOnly.of(true),
];

function codeViewExtensions(path?: string): Extension[] {
  return [
    basicSetup,
    sylphEditorTheme,
    sylphSyntaxHighlighting,
    EditorView.lineWrapping,
    EditorState.tabSize.of(2),
    ...languageExtensionForPath(path),
    ...readOnlyExtensions,
  ];
}

export default function CodeView(props: { code: string; path?: string; class?: string }) {
  let container!: HTMLDivElement;
  let view: EditorView | undefined;

  createEffect(() => {
    const code = props.code;
    const path = props.path;

    if (!container) return;

    view?.destroy();
    container.replaceChildren();

    view = new EditorView({
      parent: container,
      doc: code,
      extensions: codeViewExtensions(path),
    });
  });

  onCleanup(() => view?.destroy());

  return <div ref={container} class={`code-view ${props.class ?? ''}`} />;
}
