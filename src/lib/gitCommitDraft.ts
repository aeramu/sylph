const drafts = new Map<string, string>();

export function getGitCommitDraft(projectId: string | undefined) {
  return projectId ? drafts.get(projectId) ?? '' : '';
}

export function setGitCommitDraft(projectId: string | undefined, message: string) {
  if (!projectId) return;
  if (message) drafts.set(projectId, message);
  else drafts.delete(projectId);
}
