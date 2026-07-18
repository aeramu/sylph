import { describe, expect, it } from 'vitest';
import type { SessionInfo } from './api';
import { compareSessionGroups, directoryGroupStartingPath, isNeutralSessionGroup } from './sessionGroupActions';

const session = (value: Partial<SessionInfo>): SessionInfo => ({
  id: 'session', modified: new Date(0).toISOString(), messageCount: 1, firstMessage: 'hello', ...value,
});

describe('session group actions', () => {
  it('identifies only No Project and Temporary as neutral groups', () => {
    expect(isNeutralSessionGroup('project', '__none__')).toBe(true);
    expect(isNeutralSessionGroup('directory', '__temporary__')).toBe(true);
    expect(isNeutralSessionGroup('project', 'project-a')).toBe(false);
    expect(isNeutralSessionGroup('none', '__all__')).toBe(false);
  });

  it('sorts neutral groups below named groups even when pinned', () => {
    const pinned = () => true;
    const statusOrder = {};
    expect(compareSessionGroups('project', pinned, statusOrder,
      { key: '__none__', label: 'Chats' }, { key: 'z', label: 'Zeta' })).toBeGreaterThan(0);
    expect(compareSessionGroups('directory', pinned, statusOrder,
      { key: '__temporary__', label: 'Chats' }, { key: '/z', label: 'Zeta' })).toBeGreaterThan(0);
  });

  it('starts Temporary group chats without exposing scratch as a folder', () => {
    expect(directoryGroupStartingPath({
      key: '__temporary__',
      sessions: [session({ workspaceKind: 'scratch', cwd: '/home/user/.sylph/scratch/session' })],
    })).toBeUndefined();
  });

  it('reuses a real directory group source path', () => {
    expect(directoryGroupStartingPath({
      key: '/repo',
      sessions: [session({ workspaceKind: 'directories', sourcePath: '/repo', cwd: '/worktree/repo' })],
    })).toBe('/repo');
  });
});
