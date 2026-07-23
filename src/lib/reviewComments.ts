import { createId } from './id';
import type { ReviewCommentAttachment as ReviewComment } from '../types';

export type ReviewCommentInput = Omit<ReviewComment, 'id'>;
export type { ReviewComment };

const commentsBySession = new Map<string, ReviewComment[]>();

export function getReviewComments(sessionId?: string): ReviewComment[] {
  return sessionId ? [...(commentsBySession.get(sessionId) ?? [])] : [];
}

export function addReviewComment(sessionId: string, input: ReviewCommentInput): ReviewComment[] {
  const next = [...getReviewComments(sessionId), { id: createId(), ...input }];
  commentsBySession.set(sessionId, next);
  return [...next];
}

export function removeReviewComment(sessionId: string, commentId: string): ReviewComment[] {
  const next = getReviewComments(sessionId).filter((comment) => comment.id !== commentId);
  if (next.length) commentsBySession.set(sessionId, next);
  else commentsBySession.delete(sessionId);
  return [...next];
}

export function removeReviewComments(sessionId: string, commentIds: string[]): ReviewComment[] {
  const removed = new Set(commentIds);
  const next = getReviewComments(sessionId).filter((comment) => !removed.has(comment.id));
  if (next.length) commentsBySession.set(sessionId, next);
  else commentsBySession.delete(sessionId);
  return [...next];
}

function lineLabel(comment: ReviewComment): string {
  if (comment.lineStart === undefined) return '';
  const range = comment.lineEnd !== undefined && comment.lineEnd !== comment.lineStart
    ? `${comment.lineStart}-${comment.lineEnd}`
    : String(comment.lineStart);
  return `, ${comment.side ? `${comment.side} ` : ''}${range.includes('-') ? 'lines' : 'line'} ${range}`;
}

function quote(text: string): string {
  return text.split('\n').map((line) => `> ${line}`).join('\n');
}

export function formatReviewComments(comments: ReviewComment[]): string {
  const items = comments.map((comment, index) => {
    const source = comment.surface === 'artifact'
      ? `Artifact \`${comment.path}\``
      : `Git ${comment.changeSet ?? 'working tree'} diff \`${comment.path}\``;
    return [
      `${index + 1}. **${source}${lineLabel(comment)}**`,
      quote(comment.quote),
      `\n   **Comment:** ${comment.comment}`,
    ].join('\n');
  });

  return [
    'Please address these review comments:',
    '',
    ...items.flatMap((item, index) => index === items.length - 1 ? [item] : [item, '']),
  ].join('\n');
}
