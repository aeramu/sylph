import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import type { ReviewCommentInput } from '../../lib/reviewComments';
import './ReviewCommentPopover.css';

export interface ReviewCommentRequest extends Omit<ReviewCommentInput, 'comment'> {
  anchor: { top: number; right: number; bottom: number; left: number };
}

export default function ReviewCommentPopover(props: {
  request?: ReviewCommentRequest;
  onCancel: () => void;
  onSave: (comment: ReviewCommentInput) => void;
}) {
  const [text, setText] = createSignal('');
  let popover!: HTMLDivElement;
  let textarea!: HTMLTextAreaElement;

  createEffect(() => {
    if (!props.request) return;
    setText('');
    requestAnimationFrame(() => textarea?.focus());
  });

  createEffect(() => {
    if (!props.request) return;
    const close = (event: MouseEvent) => {
      if (!popover?.contains(event.target as Node)) props.onCancel();
    };
    document.addEventListener('mousedown', close);
    onCleanup(() => document.removeEventListener('mousedown', close));
  });

  const save = () => {
    const request = props.request;
    const comment = text().trim();
    if (!request || !comment) return;
    const { anchor: _anchor, ...selection } = request;
    props.onSave({ ...selection, comment });
  };

  const style = () => {
    const request = props.request;
    if (!request) return '';
    const width = Math.min(360, window.innerWidth - 24);
    const left = Math.max(12, Math.min(request.anchor.right + 8, window.innerWidth - width - 12));
    const top = Math.max(12, Math.min(request.anchor.top - 8, window.innerHeight - 240));
    return `left:${left}px;top:${top}px;width:${width}px`;
  };

  return <Show when={props.request} keyed>{(request) =>
    <div ref={popover} class="review-comment-popover" style={style()} role="dialog" aria-label="Add review comment">
      <div class="review-comment-popover-meta">
        <strong>{request.path}</strong>
        <span>{request.lineStart !== undefined ? `Lines ${request.lineStart}${request.lineEnd !== request.lineStart ? `–${request.lineEnd}` : ''}` : 'Selection'}</span>
      </div>
      <blockquote>{request.quote}</blockquote>
      <textarea
        ref={textarea}
        value={text()}
        rows={3}
        placeholder="Add a comment…"
        onInput={(event) => setText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') props.onCancel();
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') save();
        }}
      />
      <div class="review-comment-popover-actions">
        <button type="button" onClick={props.onCancel}>Cancel</button>
        <button type="button" class="primary" disabled={!text().trim()} onClick={save}>Comment</button>
      </div>
    </div>
  }</Show>;
}
