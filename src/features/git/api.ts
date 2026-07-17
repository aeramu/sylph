import { api } from '../../lib/api';
import type { GitCommit, GitDivergence, GitFile, GitRepositoryInfo } from '../../lib/gitPatch';

export interface GitScope { projectId: string; sessionId?: string; directoryId?: string }

function scoped(path: string, scope: GitScope) {
  const query = new URLSearchParams();
  if (scope.sessionId) query.set('sessionId', scope.sessionId);
  if (scope.directoryId) query.set('directoryId', scope.directoryId);
  const separator = path.includes('?') ? '&' : '?';
  return query.size ? `${path}${separator}${query}` : path;
}

export async function refreshGit(scope: GitScope, fetchRemote = false) {
  const base = `/api/projects/${encodeURIComponent(scope.projectId)}/git`;
  if (fetchRemote) await api(scoped(`${base}/fetch`, scope), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const [status, log, divergence] = await Promise.all([
    api<{ files?: GitFile[]; repository?: GitRepositoryInfo }>(scoped(`${base}/status`, scope), { cache: 'no-store' }),
    api<{ commits?: GitCommit[] }>(scoped(`${base}/log?limit=30`, scope), { cache: 'no-store' }),
    api<GitDivergence>(scoped(`${base}/divergence?limit=30`, scope), { cache: 'no-store' }),
  ]);
  return { files: status.files || [], repository: status.repository, commits: log.commits || [], divergence };
}

export function runGitOperation(scope: GitScope, operation: string, body: unknown): Promise<unknown> {
  return api(scoped(`/api/projects/${encodeURIComponent(scope.projectId)}/git/${operation}`, scope), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

export async function generateCommitMessage(scope: GitScope): Promise<string> {
  const data = await api<{ message?: string }>(scoped(`/api/projects/${encodeURIComponent(scope.projectId)}/git/generate-commit-message`, scope), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  return data.message || '';
}
