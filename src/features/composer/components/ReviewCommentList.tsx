import { For, Show } from 'solid-js';
import type { ReviewCommentAttachment } from '../../../types';

function label(comment: ReviewCommentAttachment): string {
  const lines = comment.lineStart === undefined
    ? ''
    : `:${comment.lineStart}${comment.lineEnd !== undefined && comment.lineEnd !== comment.lineStart ? `-${comment.lineEnd}` : ''}`;
  return `${comment.surface === 'artifact' ? 'Artifact' : 'Git'} · ${comment.path}${lines}`;
}

export default function ReviewCommentList(props: {
  comments: ReviewCommentAttachment[];
  onRemove: (id: string) => void;
}) {
  return <Show when={props.comments.length > 0}>
    <div class="review-comment-attachments">
      <For each={props.comments}>{(comment) =>
        <div class="review-comment-chip" title={`${label(comment)}\n${comment.comment}`}>
          <span class="review-comment-chip-icon">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg>
          </span>
          <span class="review-comment-chip-text">
            <strong>{label(comment)}</strong>
            <span>{comment.comment}</span>
          </span>
          <button type="button" class="attachment-chip-remove" onClick={() => props.onRemove(comment.id)} title="Remove comment" aria-label={`Remove comment on ${comment.path}`}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      }</For>
    </div>
  </Show>;
}
