import type { SessionInfo } from './api';

export type SessionGroupMode = 'project' | 'directory' | 'status' | 'none';

export function isNeutralSessionGroup(mode: SessionGroupMode, key: string): boolean {
  return (mode === 'project' && key === '__none__') || (mode === 'directory' && key === '__temporary__');
}

export function compareSessionGroups(
  mode: SessionGroupMode,
  pinned: (key: string) => boolean,
  statusOrder: Record<string, number>,
  a: { key: string; label: string },
  b: { key: string; label: string },
): number {
  // No Project and Temporary are catch-all groups rather than configured
  // workspaces. Keep them below every named group even if they were pinned.
  const neutralDifference = Number(isNeutralSessionGroup(mode, a.key)) - Number(isNeutralSessionGroup(mode, b.key));
  if (neutralDifference) return neutralDifference;
  const pinDifference = Number(pinned(b.key)) - Number(pinned(a.key));
  if (pinDifference) return pinDifference;
  if (mode === 'status') return (statusOrder[a.key] ?? 99) - (statusOrder[b.key] ?? 99);
  return a.label.localeCompare(b.label);
}

export function directoryGroupStartingPath(group: { key: string; sessions: SessionInfo[] }): string | undefined {
  // Scratch paths are runtime implementation details, never user-selected
  // workspace roots. The Temporary group must start another scratch session.
  if (group.key === '__temporary__' || group.sessions.some((session) => session.workspaceKind === 'scratch')) return undefined;
  const session = group.sessions.find((entry) => entry.sourcePath || entry.cwd);
  return session?.sourcePath || session?.cwd;
}
