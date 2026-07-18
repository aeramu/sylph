import { api } from '../../lib/api';
import type { ContextInfo, ProjectInfo } from '../../types';

export interface GitBranchOption { name: string; current: boolean; remote: boolean }
export interface DirectorySuggestion { name: string; path: string }
export interface SessionDirectoryInfo {
  directoryId: string;
  name: string;
  sourcePath?: string;
  path: string;
  branch?: string;
  baseBranch?: string;
  worktreeRoot?: string;
}
export interface SessionBindingInfo {
  workspaceKind?: 'directories' | 'scratch';
  cwd: string;
  directoryId?: string;
  directories?: SessionDirectoryInfo[];
  branch?: string;
  baseBranch?: string;
  worktree?: boolean;
  worktreeMissing?: boolean;
}

export interface SessionSnapshot {
  messages?: unknown[];
  context?: ContextInfo;
  binding?: SessionBindingInfo;
  statuses?: Record<string, string>;
  eventSeq?: number;
  isStreaming?: boolean;
  pendingUiRequests?: any[];
}

export interface SendChatInput {
  prompt: string;
  mentionText: string;
  sessionId?: string;
  projectId?: string;
  directoryId?: string;
  standalonePath?: string;
  modelId?: string;
  thinkingLevel: string;
  images?: unknown[];
  useWorktree: boolean;
  baseBranches?: Record<string, string>;
}

export interface SendChatResult {
  sessionId: string;
  workspaceKind?: 'directories' | 'scratch';
  projectId?: string;
  directoryId?: string;
  branch?: string;
  worktree?: boolean;
}

export async function listProjects(): Promise<ProjectInfo[]> {
  const data = await api<{ projects?: ProjectInfo[] }>('/api/projects');
  return data.projects || [];
}

export async function listDirectories(value: string, signal?: AbortSignal) {
  const query = value.trim() ? `?path=${encodeURIComponent(value.trim())}` : '';
  return api<{ directories?: DirectorySuggestion[]; currentPath?: string }>(`/api/fs/list${query}`, { signal });
}

export async function listBranches(projectId: string, directoryId: string): Promise<GitBranchOption[]> {
  const query = new URLSearchParams({ directoryId });
  const data = await api<{ branches?: GitBranchOption[] }>(`/api/projects/${encodeURIComponent(projectId)}/git/branches?${query}`, { cache: 'no-store' });
  return data.branches || [];
}

export async function listCommands() {
  const data = await api<{ commands?: Array<{ name: string; source: string; description?: string }> }>('/api/commands');
  return data.commands || [];
}

export function getSession(sessionId: string): Promise<SessionSnapshot> {
  return api(`/api/sessions/${encodeURIComponent(sessionId)}`);
}

export function respondToUi(sessionId: string, response: unknown): Promise<void> {
  return api(`/api/sessions/${encodeURIComponent(sessionId)}/ui-response`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(response),
  });
}

export function sendChat(input: SendChatInput): Promise<SendChatResult> {
  return api('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
}

export function abortSession(sessionId: string): Promise<void> {
  return api(`/api/sessions/${encodeURIComponent(sessionId)}/abort`, { method: 'POST' });
}

export function recreateWorktree(sessionId: string): Promise<void> {
  return api(`/api/sessions/${encodeURIComponent(sessionId)}/worktree/recreate`, { method: 'POST' });
}

export function removeWorktree(sessionId: string, confirmUnmerged = false): Promise<void> {
  const query = confirmUnmerged ? '?confirmUnmerged=true' : '';
  return api(`/api/sessions/${encodeURIComponent(sessionId)}/worktree${query}`, { method: 'DELETE' });
}

export async function listAttachFolderBranches(sessionId: string, folderPath: string): Promise<GitBranchOption[]> {
  const data = await api<{ branches?: GitBranchOption[] }>(`/api/sessions/${encodeURIComponent(sessionId)}/folders/branches`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: folderPath }),
  });
  return data.branches || [];
}

export function attachFolder(sessionId: string, input: { path: string; name?: string; baseBranch?: string }): Promise<{ binding: SessionBindingInfo; directory: SessionDirectoryInfo }> {
  return api(`/api/sessions/${encodeURIComponent(sessionId)}/folders`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
}
