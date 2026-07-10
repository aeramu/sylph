const drafts = new Map<string, string>();

export function getChatDraft(key: string) {
  return drafts.get(key) ?? '';
}

export function setChatDraft(key: string, text: string) {
  if (text) drafts.set(key, text);
  else drafts.delete(key);
}
