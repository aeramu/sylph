import { createEffect, onCleanup, untrack } from 'solid-js';
import { ChangeSet, Compartment, EditorState, type Extension, type StateEffect } from '@codemirror/state';
import { EditorView, GutterMarker, gutter } from '@codemirror/view';
import { getOriginalDoc, MergeView, originalDocChangeEffect, unifiedMergeView } from '@codemirror/merge';
import { basicSetup } from 'codemirror';
import { sylphEditorTheme, sylphMergeTheme, sylphSyntaxHighlighting } from '../editor/codemirrorTheme';
import { languageExtensionForPath } from '../editor/languages';
import { diffMode } from '../lib/diffMode';

export type DiffLineAction = {
  line: number;
  label: string;
  title?: string;
  onClick: () => void;
};

const readOnlyExtensions: Extension[] = [
  EditorView.editable.of(false),
  EditorState.readOnly.of(true),
];

class LineActionMarker extends GutterMarker {
  readonly action: DiffLineAction;

  constructor(action: DiffLineAction) {
    super();
    this.action = action;
  }

  eq(other: LineActionMarker) {
    return other.action.line === this.action.line && other.action.label === this.action.label;
  }

  toDOM() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-diff-line-action';
    button.textContent = this.action.label;
    button.title = this.action.title ?? this.action.label;
    button.setAttribute('aria-label', this.action.title ?? this.action.label);
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.action.onClick();
    });
    return button;
  }
}

function lineActionGutter(actions: DiffLineAction[] | undefined): Extension[] {
  if (!actions?.length) return [];
  const byLine = new Map(actions.map((action) => [action.line, new LineActionMarker(action)]));
  return [gutter({
    class: 'cm-diff-actions-gutter',
    side: 'after',
    lineMarker: (view, block) => byLine.get(view.state.doc.lineAt(block.from).number) ?? null,
  })];
}

function diffEditorExtensions(
  languageCompartment: Compartment,
  actionCompartment: Compartment,
  actions?: DiffLineAction[],
): Extension[] {
  return [
    basicSetup,
    sylphEditorTheme,
    sylphMergeTheme,
    sylphSyntaxHighlighting,
    EditorView.lineWrapping,
    EditorState.tabSize.of(2),
    languageCompartment.of([]),
    actionCompartment.of(lineActionGutter(actions)),
    ...readOnlyExtensions,
  ];
}

function replaceDocument(view: EditorView, text: string, effects: StateEffect<unknown>[] = []) {
  if (view.state.doc.toString() === text && effects.length === 0) return;
  view.dispatch({
    changes: view.state.doc.toString() === text
      ? undefined
      : { from: 0, to: view.state.doc.length, insert: text },
    effects,
  });
}

export default function DiffView(props: {
  oldText: string;
  newText: string;
  path?: string;
  oldLineActions?: DiffLineAction[];
  newLineActions?: DiffLineAction[];
}) {
  let container!: HTMLDivElement;
  let mergeView: MergeView | undefined;
  let unifiedView: EditorView | undefined;
  let oldLanguage = new Compartment();
  let newLanguage = new Compartment();
  let oldActions = new Compartment();
  let newActions = new Compartment();
  let mountedMode: 'split' | 'unified' | undefined;

  const destroyViews = () => {
    mergeView?.destroy();
    mergeView = undefined;
    unifiedView?.destroy();
    unifiedView = undefined;
    mountedMode = undefined;
  };

  // Mount immediately without a language extension so opening a hunk never
  // flashes as an empty/collapsed block. Syntax highlighting is loaded and
  // applied in place afterward without rebuilding the editors.
  createEffect(() => {
    const path = props.path;
    const mode = diffMode();
    const oldText = untrack(() => props.oldText);
    const newText = untrack(() => props.newText);
    const oldLineActions = untrack(() => props.oldLineActions);
    const newLineActions = untrack(() => props.newLineActions);
    let cancelled = false;
    onCleanup(() => { cancelled = true; });

    destroyViews();
    container.replaceChildren();
    oldLanguage = new Compartment();
    newLanguage = new Compartment();
    oldActions = new Compartment();
    newActions = new Compartment();
    mountedMode = mode;

    if (mode === 'unified') {
      unifiedView = new EditorView({
        parent: container,
        doc: newText,
        extensions: [
          ...diffEditorExtensions(newLanguage, newActions, newLineActions),
          unifiedMergeView({
            original: oldText,
            mergeControls: false,
            highlightChanges: true,
            gutter: true,
            collapseUnchanged: { margin: 4, minSize: 12 },
          }),
        ],
      });
    } else {
      mergeView = new MergeView({
        a: { doc: oldText, extensions: diffEditorExtensions(oldLanguage, oldActions, oldLineActions) },
        b: { doc: newText, extensions: diffEditorExtensions(newLanguage, newActions, newLineActions) },
        parent: container,
        highlightChanges: true,
        gutter: true,
        collapseUnchanged: { margin: 4, minSize: 12 },
      });
    }

    void languageExtensionForPath(path).then((languageExtensions) => {
      if (cancelled) return;
      if (mountedMode === 'split' && mergeView) {
        mergeView.a.dispatch({ effects: oldLanguage.reconfigure(languageExtensions) });
        mergeView.b.dispatch({ effects: newLanguage.reconfigure(languageExtensions) });
      } else if (mountedMode === 'unified' && unifiedView) {
        unifiedView.dispatch({ effects: newLanguage.reconfigure(languageExtensions) });
      }
    });
  });

  createEffect(() => {
    const oldText = props.oldText;
    const newText = props.newText;
    const oldLineActions = props.oldLineActions;
    const newLineActions = props.newLineActions;

    if (mountedMode === 'split' && mergeView) {
      replaceDocument(mergeView.a, oldText, [oldActions.reconfigure(lineActionGutter(oldLineActions))]);
      replaceDocument(mergeView.b, newText, [newActions.reconfigure(lineActionGutter(newLineActions))]);
    } else if (mountedMode === 'unified' && unifiedView) {
      const currentOriginal = getOriginalDoc(unifiedView.state);
      const originalChanges = ChangeSet.of(
        { from: 0, to: currentOriginal.length, insert: oldText },
        currentOriginal.length,
      );
      const updateOriginal = originalDocChangeEffect(unifiedView.state, originalChanges);
      replaceDocument(unifiedView, newText, [
        updateOriginal,
        newActions.reconfigure(lineActionGutter(newLineActions)),
      ]);
    }
  });

  onCleanup(destroyViews);

  return <div ref={container} class="diff-view codemirror-diff-view" />;
}
