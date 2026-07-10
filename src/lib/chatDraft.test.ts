import { describe, expect, it } from 'vitest';
import { getChatDraft, setChatDraft } from './chatDraft';

describe('chat drafts', () => {
  it('stores independent drafts by session/project key and clears empty drafts', () => {
    setChatDraft('session:a', 'first');
    setChatDraft('session:b', 'second');
    expect(getChatDraft('session:a')).toBe('first');
    expect(getChatDraft('session:b')).toBe('second');
    setChatDraft('session:a', '');
    expect(getChatDraft('session:a')).toBe('');
    expect(getChatDraft('session:b')).toBe('second');
  });
});
