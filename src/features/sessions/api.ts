import { api } from '../../lib/api';
import type { SessionStatus } from '../../types';

export interface SessionInfo {
  id: string;
  name?: string;
  modified: string;
  created?: string;
  messageCount: number;
  firstMessage: string;
  status?: SessionStatus;
  projectId?: string;
  projectName?: string;
  workspaceKind?: 'directories' | 'scratch';
  directoryId?: string;
  directoryName?: string;
  sourcePath?: string;
  cwd?: string;
  branch?: string;
  directoryNames?: string[];
  worktree?: boolean;
  worktreeMissing?: boolean;
}

export async function listSessions(): Promise<SessionInfo[]> {
  const data = await api<{ sessions?: SessionInfo[] }>(`/api/sessions?t=${Date.now()}`, {
    cache: 'no-store',
    headers: { 'Cache-Control': 'no-cache' },
  });
  return data.sessions || [];
}
