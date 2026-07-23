import type { Extension } from '@codemirror/state';
import { EditorView, GutterMarker, gutter } from '@codemirror/view';

export interface CodeCommentSelection {
  quote: string;
  lineStart: number;
  lineEnd: number;
  side?: 'old' | 'new';
}

export interface CodeCommentRequest {
  selection: CodeCommentSelection;
  anchor: { top: number; right: number; bottom: number; left: number };
}

class CommentMarker extends GutterMarker {
  readonly open: (anchor: CodeCommentRequest['anchor']) => void;

  constructor(open: (anchor: CodeCommentRequest['anchor']) => void) {
    super();
    this.open = open;
  }

  eq(other: CommentMarker): boolean {
    return other.open === this.open;
  }

  toDOM(): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-add-comment';
    button.title = 'Add comment';
    button.setAttribute('aria-label', 'Add comment');
    button.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"></path><line x1="12" y1="8" x2="12" y2="14"></line><line x1="9" y1="11" x2="15" y2="11"></line></svg>';
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const rect = button.getBoundingClientRect();
      this.open({ top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left });
    });
    return button;
  }
}

export function codeCommentGutter(options: {
  lineOffset?: number;
  side?: 'old' | 'new';
  onOpen?: (request: CodeCommentRequest) => void;
}): Extension[] {
  if (!options.onOpen) return [];
  const lineOffset = options.lineOffset ?? 1;
  return [gutter({
    class: 'cm-comment-gutter',
    side: 'after',
    lineMarker: (view: EditorView, block) => {
      const clickedLine = view.state.doc.lineAt(block.from);
      return new CommentMarker((anchor) => {
        const selection = view.state.selection.main;
        const selectionStartLine = view.state.doc.lineAt(selection.from);
        const selectionEndLine = view.state.doc.lineAt(Math.max(selection.from, selection.to - 1));
        const clickedInsideSelection = !selection.empty
          && clickedLine.number >= selectionStartLine.number
          && clickedLine.number <= selectionEndLine.number;
        const from = clickedInsideSelection ? selection.from : clickedLine.from;
        const to = clickedInsideSelection ? selection.to : clickedLine.to;
        const first = view.state.doc.lineAt(from).number;
        const last = view.state.doc.lineAt(Math.max(from, to - 1)).number;
        options.onOpen?.({
          anchor,
          selection: {
            quote: view.state.sliceDoc(from, to),
            lineStart: lineOffset + first - 1,
            lineEnd: lineOffset + last - 1,
            ...(options.side ? { side: options.side } : {}),
          },
        });
      });
    },
  })];
}
