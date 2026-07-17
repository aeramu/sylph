import { api } from '../../lib/api';
import type { ProjectInfo } from '../../types';

export interface DirectorySuggestion {
  name: string;
  path: string;
}

export interface DirectoryListResponse {
  directories: DirectorySuggestion[];
  currentPath: string;
}

export interface ProjectDirectoryInput {
  id?: string;
  name?: string;
  path: string;
}

export function listDirectories(path?: string, signal?: AbortSignal): Promise<DirectoryListResponse> {
  const query = path?.trim() ? `?path=${encodeURIComponent(path.trim())}` : '';
  return api(`/api/fs/list${query}`, { signal });
}

export async function listProjects(): Promise<ProjectInfo[]> {
  const data = await api<{ projects?: ProjectInfo[] }>('/api/projects');
  return data.projects || [];
}

export function saveProject(input: { id?: string; name?: string; directories: ProjectDirectoryInput[] }): Promise<ProjectInfo> {
  return api(input.id ? `/api/projects/${encodeURIComponent(input.id)}` : '/api/projects', {
    method: input.id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: input.name, directories: input.directories }),
  });
}

export function deleteProject(id: string): Promise<{ success: boolean }> {
  return api(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
