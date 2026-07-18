import { api } from '../../lib/api';

export interface ArtifactInfo {
  path: string;
  name: string;
  size: number;
  modifiedAt: string;
  mimeType: string;
}

export interface ArtifactContent {
  path: string;
  mimeType: string;
  size: number;
  encoding: 'utf8' | 'base64';
  content: string;
}

export async function listArtifacts(sessionId: string): Promise<ArtifactInfo[]> {
  const data = await api<{ artifacts?: ArtifactInfo[] }>(`/api/sessions/${encodeURIComponent(sessionId)}/artifacts`, { cache: 'no-store' });
  return data.artifacts ?? [];
}

export function readArtifact(sessionId: string, path: string): Promise<ArtifactContent> {
  const query = new URLSearchParams({ scope: 'artifacts', sessionId, path });
  return api(`/api/fs/read?${query}`, { cache: 'no-store' });
}
