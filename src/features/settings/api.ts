import { api } from '../../lib/api';
import type { ResourceInfo, ThinkingLevel } from '../../types';

export interface AppSettings { commitMessageModel: string; commitMessageThinkingLevel: ThinkingLevel; commitMessagePrompt: string }
export interface ProviderInfo {
  id: string; name: string; authType: 'api_key' | 'oauth'; configured: boolean; source?: string; label?: string; stored: boolean; storedType?: 'api_key' | 'oauth';
}
export interface ModelsResponse { models?: Array<{ id: string; provider?: string; value?: string; thinkingLevels?: unknown[] }> }
export type OAuthStep =
  | { type: 'auth_url'; url: string; instructions?: string; progress: string[] }
  | { type: 'device_code'; userCode: string; verificationUri: string; intervalSeconds?: number; expiresInSeconds?: number; progress: string[] }
  | { type: 'prompt'; message: string; placeholder?: string; allowEmpty?: boolean; progress: string[] }
  | { type: 'manual_code'; message: string; progress: string[] }
  | { type: 'select'; message: string; options: Array<{ id: string; label: string }>; progress: string[] }
  | { type: 'waiting'; message: string; progress: string[] };
export interface OAuthFlowInfo {
  id: string; provider: string; status: 'pending' | 'success' | 'error' | 'cancelled'; step?: OAuthStep;
  authUrl?: string; authInstructions?: string; error?: string; progress: string[];
}
export interface SkillDetail { name: string; description?: string; content: string; path: string }
export interface ExtensionDetail {
  name: string; path: string; resolvedPath?: string; sourceInfo?: Record<string, unknown>;
  tools: Array<{ name: string; label?: string; description?: string; promptSnippet?: string; promptGuidelines?: string[]; parameters?: unknown }>;
  commands: Array<{ name: string; description?: string }>;
  flags: Array<{ name: string; description?: string; type?: string; default?: unknown }>;
  shortcuts: Array<{ shortcut: string; description?: string }>;
  events: Array<{ name: string; count: number }>;
  messageRenderers: string[];
}

export async function listResources(kind: 'skills' | 'extensions'): Promise<ResourceInfo[]> {
  try { return (await api<{ resources?: ResourceInfo[] }>(`/api/resources/${kind}`)).resources || []; } catch { return []; }
}
export const getSettings = () => api<AppSettings>('/api/settings');
export const getModels = () => api<ModelsResponse>('/api/models');
export async function getProviders(): Promise<ProviderInfo[]> { try { return (await api<{ providers?: ProviderInfo[] }>('/api/auth/providers')).providers || []; } catch { return []; } }
export const getSkill = (name: string) => api<SkillDetail>(`/api/resources/skills/${encodeURIComponent(name)}`);
export const getExtension = (name: string) => api<ExtensionDetail>(`/api/resources/extensions/${encodeURIComponent(name)}`);
export const updateSettings = (patch: Partial<AppSettings>) => api<AppSettings>('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
export const createProvider = (body: unknown) => api<{ provider?: string }>('/api/auth/providers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export const saveProviderKey = (id: string, apiKey: string) => api(`/api/auth/${encodeURIComponent(id)}/api-key`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey }) });
export const logoutProvider = (id: string) => api(`/api/auth/${encodeURIComponent(id)}/logout`, { method: 'POST' });
export const startOAuth = (id: string) => api<{ id: string }>(`/api/auth/${encodeURIComponent(id)}/oauth/start`, { method: 'POST' });
export const getOAuthFlow = <T>(id: string) => api<T>(`/api/auth/oauth/flows/${encodeURIComponent(id)}`);
export const respondOAuthFlow = (id: string, value?: string, cancelled = false) => api(`/api/auth/oauth/flows/${encodeURIComponent(id)}/respond`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value, cancelled }) });
export const cancelOAuthFlow = (id: string) => api(`/api/auth/oauth/flows/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
