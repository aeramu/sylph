import { createMemo, createResource, createSignal, For, Show, Switch, Match, createEffect, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';
import type { DraftSession, ProjectInfo } from '../../types';
import { sessionStatuses, setSessionStatus } from '../../lib/sessionStatus';
import AddProjectModal from '../projects/AddProjectModal';
import { deleteProject, listProjects } from '../projects/api';
import { listSessions, type SessionInfo } from './api';
import './SessionSidebar.css';

type GroupMode = 'project' | 'directory' | 'status' | 'none';
type SortMode = 'updated' | 'alphabetical' | 'created';
type SubtitleMode = 'directory' | 'project' | 'worktree' | 'none';

const SESSIONS_PER_GROUP_PAGE = 5;

function loadPinnedGroups(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem('sylph:pinned-session-groups') || '{}'); }
  catch { return {}; }
}

function loadCollapsedGroups(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem('sylph:collapsed-session-groups') || '{}'); }
  catch { return {}; }
}

function loadViewPreference<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const stored = localStorage.getItem(key);
  return allowed.includes(stored as T) ? (stored as T) : fallback;
}

function formatRelativeTime(dateStr: string) {
  const diffSecs = Math.max(0, Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000));
  if (diffSecs < 60) return `${diffSecs}s`;
  const mins = Math.floor(diffSecs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  return months < 12 ? `${months}mo` : `${Math.floor(months / 12)}y`;
}

function statusGroup(session: SessionInfo) {
  const status = sessionStatuses[session.id] || session.status;
  if (status === 'working') return 'Working';
  if (status === 'needsInput') return 'Needs input';
  if (status === 'error') return 'Errors';
  return 'Idle';
}

function SessionGroupIcon(props: { mode: GroupMode; expanded: boolean; statusKey?: string }) {
  if (props.mode === 'project') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h4l1.7 2h7.3A1.5 1.5 0 0 1 20 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
        <path d="M7 6V4.8A.8.8 0 0 1 7.8 4h8.4a.8.8 0 0 1 .8.8V8" />
        <Show when={props.expanded}><path d="M4 11h16" /></Show>
      </svg>
    );
  }
  if (props.mode === 'directory') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h5l2 2h8A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
        <Show when={props.expanded}><path d="M3 10h18" /></Show>
      </svg>
    );
  }
  if (props.mode === 'status') {
    if (props.statusKey === 'Idle') {
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="8.5" />
          <path d="m8.5 12 2.4 2.4 4.6-4.8" />
        </svg>
      );
    }
    if (props.statusKey === 'Needs input') {
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 8v4.5" /><path d="M12 15.5h.01" />
        </svg>
      );
    }
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M7.5 12h2.2l1.35-3.2 2.1 6.1 1.35-2.9h2" />
      </svg>
    );
  }
  return null;
}

export default function SessionSidebar(props: {
  activeSessionId?: string,
  activeProjectId?: string,
  onSelectSession: (id?: string) => void,
  onSelectProject: (id?: string) => void,
  onNewSession: (projectId?: string, standalonePath?: string) => void,
  refreshTrigger: number,
  draftSessions: DraftSession[],
  onProjectsChanged?: () => void,
  onSessionDetached: (id: string) => void,
  onOpenSettings: () => void,
  onToggleSidebar: () => void,
}) {
  const [projects, { refetch: refetchProjects }] = createResource(listProjects);
  const [groupMode, setGroupMode] = createSignal<GroupMode>(loadViewPreference('sylph:session-group-mode', ['project', 'directory', 'status', 'none'] as const, 'project'));
  const [sortMode, setSortMode] = createSignal<SortMode>(loadViewPreference('sylph:session-sort-mode', ['updated', 'alphabetical', 'created'] as const, 'updated'));
  const [subtitleMode, setSubtitleMode] = createSignal<SubtitleMode>(loadViewPreference('sylph:session-subtitle-mode', ['directory', 'project', 'worktree', 'none'] as const, 'none'));

  createEffect(() => localStorage.setItem('sylph:session-group-mode', groupMode()));
  createEffect(() => localStorage.setItem('sylph:session-sort-mode', sortMode()));
  createEffect(() => localStorage.setItem('sylph:session-subtitle-mode', subtitleMode()));
  const [viewMenuOpen, setViewMenuOpen] = createSignal(false);
  const [viewMenuPosition, setViewMenuPosition] = createSignal({ top: 0, left: 0 });
  const [showAddProject, setShowAddProject] = createSignal(false);
  const [editingProject, setEditingProject] = createSignal<ProjectInfo | null>(null);
  const [pinnedGroups, setPinnedGroups] = createSignal<Record<string, boolean>>(loadPinnedGroups());
  const [collapsedGroups, setCollapsedGroups] = createSignal<Record<string, boolean>>(loadCollapsedGroups());
  const [groupPages, setGroupPages] = createSignal<Record<string, number>>({});
  let viewMenuRef: HTMLDivElement | undefined;
  let viewMenuTriggerRef: HTMLButtonElement | undefined;
  let viewMenuPopoverRef: HTMLDivElement | undefined;

  const closeViewMenu = (event: MouseEvent) => {
    const target = event.target as Node;
    if (!viewMenuRef?.contains(target) && !viewMenuPopoverRef?.contains(target)) setViewMenuOpen(false);
  };

  const toggleViewMenu = () => {
    if (viewMenuOpen()) {
      setViewMenuOpen(false);
      return;
    }
    const rect = viewMenuTriggerRef?.getBoundingClientRect();
    if (rect) {
      const popoverWidth = 190;
      setViewMenuPosition({
        top: Math.min(rect.bottom + 6, window.innerHeight - 430),
        // Align left edges so the menu opens below and expands rightward.
        left: Math.min(rect.left, window.innerWidth - popoverWidth - 8),
      });
    }
    setViewMenuOpen(true);
  };
  document.addEventListener('mousedown', closeViewMenu);
  onCleanup(() => document.removeEventListener('mousedown', closeViewMenu));

  const fetchSessionList = async () => {
    const list = await listSessions();
    for (const session of list) if (session.status) setSessionStatus(session.id, session.status);
    return list;
  };
  const [sessions, { refetch: refetchSessions }] = createResource(fetchSessionList);

  createEffect(() => {
    void props.refreshTrigger;
    void refetchSessions();
  });

  const mergedSessions = createMemo(() => {
    const list = sessions() ? [...sessions()!] : [];
    const projectById = new Map((projects() || []).map((project) => [project.id, project]));
    for (const draft of props.draftSessions) {
      if (list.some((session) => session.id === draft.id)) continue;
      const project = draft.projectId ? projectById.get(draft.projectId) : undefined;
      const directory = project?.directories.find((entry) => entry.id === draft.directoryId) || project?.directories[0];
      list.unshift({
        id: draft.id,
        projectId: draft.projectId,
        projectName: project?.name,
        directoryId: draft.directoryId,
        directoryName: directory?.name || 'Workspace',
        sourcePath: directory?.path,
        cwd: directory?.path,
        name: draft.firstMessage || 'New Chat',
        firstMessage: draft.firstMessage,
        modified: draft.createdAt,
        messageCount: 1,
        branch: draft.branch,
        directoryNames: project?.directories.map((entry) => entry.name),
        worktree: draft.worktree,
      });
    }
    return list.sort((a, b) => {
      if (sortMode() === 'alphabetical') {
        const aTitle = a.name || a.firstMessage || 'Empty Chat';
        const bTitle = b.name || b.firstMessage || 'Empty Chat';
        return aTitle.localeCompare(bTitle);
      }
      if (sortMode() === 'created') {
        return new Date(b.created || b.modified).getTime() - new Date(a.created || a.modified).getTime();
      }
      return new Date(b.modified).getTime() - new Date(a.modified).getTime();
    });
  });

  const groups = createMemo(() => {
    const byKey = new Map<string, { key: string; label: string; sessions: SessionInfo[] }>();
    for (const session of mergedSessions()) {
      let key: string;
      let label: string;
      if (groupMode() === 'project') {
        key = session.projectId || '__none__';
        label = session.projectName || 'No Project';
      } else if (groupMode() === 'directory') {
        key = session.sourcePath || session.cwd || session.directoryName || '__unknown__';
        label = session.directoryName || session.sourcePath || session.cwd || 'Unknown directory';
      } else if (groupMode() === 'status') {
        key = statusGroup(session);
        label = key;
      } else {
        key = '__all__';
        label = 'All Chats';
      }
      const group = byKey.get(key) || { key, label, sessions: [] };
      group.sessions.push(session);
      byKey.set(key, group);
    }
    const statusOrder: Record<string, number> = { 'Needs input': 0, 'Errors': 1, 'Working': 2, 'Idle': 3 };
    return Array.from(byKey.values()).sort((a, b) => {
      const pinDifference = Number(groupPinned(b.key)) - Number(groupPinned(a.key));
      if (pinDifference) return pinDifference;
      if (groupMode() === 'status') return (statusOrder[a.key] ?? 99) - (statusOrder[b.key] ?? 99);
      if (groupMode() === 'project' && a.label === 'No Project') return -1;
      if (groupMode() === 'project' && b.label === 'No Project') return 1;
      return a.label.localeCompare(b.label);
    });
  });

  const groupPage = (group: { key: string; sessions: SessionInfo[] }) => {
    const lastPage = Math.max(0, Math.ceil(group.sessions.length / SESSIONS_PER_GROUP_PAGE) - 1);
    return Math.min(groupPages()[group.key] || 0, lastPage);
  };

  const visibleGroupSessions = (group: { key: string; sessions: SessionInfo[] }) =>
    group.sessions.slice(0, (groupPage(group) + 1) * SESSIONS_PER_GROUP_PAGE);

  const setGroupPage = (key: string, page: number) => {
    setGroupPages((current) => ({ ...current, [key]: Math.max(0, page) }));
  };

  const projectForGroup = (key: string) => groupMode() === 'project' ? projects()?.find((project) => project.id === key) : undefined;
  const startSessionForGroup = (group: { key: string; sessions: SessionInfo[] }) => {
    if (groupMode() === 'project') {
      props.onNewSession(group.key === '__none__' ? undefined : group.key);
      return;
    }
    if (groupMode() === 'directory') {
      const directoryPath = group.sessions.find((session) => session.sourcePath || session.cwd);
      props.onNewSession(undefined, directoryPath?.sourcePath || directoryPath?.cwd);
    }
  };
  const groupPinKey = (key: string) => `${groupMode()}:${key}`;
  const groupPinned = (key: string) => !!pinnedGroups()[groupPinKey(key)];
  const togglePinnedGroup = (key: string) => {
    setPinnedGroups((current) => {
      const next = { ...current, [groupPinKey(key)]: !current[groupPinKey(key)] };
      localStorage.setItem('sylph:pinned-session-groups', JSON.stringify(next));
      return next;
    });
  };

  const groupCollapseKey = (key: string) => `${groupMode()}:${key}`;
  const groupCollapsed = (key: string) => !!collapsedGroups()[groupCollapseKey(key)];
  const toggleGroup = (key: string) => {
    setCollapsedGroups((current) => {
      const collapseKey = groupCollapseKey(key);
      const next = { ...current, [collapseKey]: !current[collapseKey] };
      localStorage.setItem('sylph:collapsed-session-groups', JSON.stringify(next));
      return next;
    });
  };

  const sessionSubtitle = (session: SessionInfo) => {
    if (subtitleMode() === 'none') return '';
    if (subtitleMode() === 'project') return session.projectName || 'No Project';
    if (subtitleMode() === 'worktree') return session.worktree ? (session.branch || 'Worktree') : '';
    return session.directoryName || session.cwd || 'Workspace';
  };

  const chooseViewOption = <T,>(setter: (value: T) => void, value: T) => {
    setter(value);
    setViewMenuOpen(false);
  };

  const openSession = (session: SessionInfo) => {
    if (sessionStatuses[session.id] === 'error') setSessionStatus(session.id, undefined);
    props.onSelectProject(session.projectId);
    props.onSelectSession(session.id);
  };

  const handleDeleteProject = async (id: string) => {
    await deleteProject(id);
    if (props.activeProjectId === id) props.onSelectProject(undefined);
    setEditingProject(null);
    await Promise.all([refetchProjects(), refetchSessions()]);
    props.onProjectsChanged?.();
  };

  const handleProjectSaved = async () => {
    setShowAddProject(false);
    setEditingProject(null);
    await refetchProjects();
    props.onProjectsChanged?.();
  };

  return (
    <div class="sidebar">
      <div class="sidebar-header">
        <button class="icon-button sidebar-toggle-inside" onClick={props.onToggleSidebar} title="Hide sidebar" aria-label="Hide sidebar">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>
      </div>

      <section class="sidebar-section">
        <div class="sidebar-section-header session-list-header">
          <div class="sidebar-title">Chats</div>
          <div class="session-list-header-actions">
          <div class="session-view-menu" ref={viewMenuRef}>
            <button ref={viewMenuTriggerRef} class="session-view-menu-trigger" onClick={toggleViewMenu} title="Group, sort, and subtitles" aria-label="Group, sort, and subtitles" aria-expanded={viewMenuOpen()}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M5 7h14M8 12h8m-5 5h2"/></svg>
            </button>
            <Show when={viewMenuOpen()}>
              <Portal>
              <div ref={viewMenuPopoverRef} class="session-view-menu-popover" style={{ top: `${viewMenuPosition().top}px`, left: `${viewMenuPosition().left}px` }}>
                <div class="session-view-menu-section">
                  <div class="session-view-menu-heading">Group By</div>
                  <For each={[
                    ['project', 'Project'],
                    ['directory', 'Directory'],
                    ['status', 'Status'],
                    ['none', 'None'],
                  ] as const}>{([value, label]) => <button class={groupMode() === value ? 'active' : ''} onClick={() => chooseViewOption(setGroupMode, value)}>{label}</button>}</For>
                </div>
                <div class="session-view-menu-section">
                  <div class="session-view-menu-heading">Sort Conversations</div>
                  <For each={[
                    ['updated', 'Last Updated'],
                    ['alphabetical', 'Alphabetical (A–Z)'],
                    ['created', 'Date Added'],
                  ] as const}>{([value, label]) => <button class={sortMode() === value ? 'active' : ''} onClick={() => chooseViewOption(setSortMode, value)}>{label}</button>}</For>
                </div>
                <div class="session-view-menu-section">
                  <div class="session-view-menu-heading">Subtitles</div>
                  <For each={[
                    ['directory', 'Directory'],
                    ['project', 'Project'],
                    ['worktree', 'Worktree'],
                    ['none', 'No Subtitle'],
                  ] as const}>{([value, label]) => <button class={subtitleMode() === value ? 'active' : ''} onClick={() => chooseViewOption(setSubtitleMode, value)}>{label}</button>}</For>
                </div>
              </div>
              </Portal>
            </Show>
          </div>
            <button class="session-header-action" onClick={() => setShowAddProject(true)} title="Add project" aria-label="Add project">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v5m-2.5-2.5h5"/></svg>
            </button>
            <button class="session-header-action" onClick={() => props.onNewSession()} title="New chat" aria-label="New chat">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
            </button>
          </div>
        </div>

        <div class="session-list grouped-session-list">
          <For each={groups()}>
            {(group) => (
              <div class={`session-group ${groupCollapsed(group.key) ? 'collapsed' : ''}`}>
                <div class="session-group-header" onClick={() => toggleGroup(group.key)} role="button" aria-expanded={!groupCollapsed(group.key)}>
                  <div class="session-group-title">
                    <span class="session-group-label">
                      <Show when={groupMode() !== 'none'}>
                        <span class={`session-group-icon ${groupMode()}`} aria-hidden="true">
                          <SessionGroupIcon mode={groupMode()} expanded={!groupCollapsed(group.key)} statusKey={group.key} />
                        </span>
                      </Show>
                      <span class="session-group-name">{group.label}</span>
                    </span>
                  </div>
                  <Show when={groupMode() === 'project' || groupMode() === 'directory'}>
                    <button class={`session-group-action pin inline ${groupPinned(group.key) ? 'active' : ''}`} onClick={(event) => { event.stopPropagation(); togglePinnedGroup(group.key); }} title={groupPinned(group.key) ? 'Unpin group' : 'Pin group'} aria-label={groupPinned(group.key) ? 'Unpin group' : 'Pin group'}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M9 3h6l-1 5 3 3v2H7v-2l3-3z" />
                        <path d="M12 13v8" />
                      </svg>
                    </button>
                  </Show>
                  <Show when={groupMode() === 'project' || groupMode() === 'directory'}>
                    <div class="session-group-actions">
                      <Show when={projectForGroup(group.key)} keyed>
                        {(project) => (
                          <button class="session-group-action settings" onClick={(event) => { event.stopPropagation(); setEditingProject(project); }} title={`Project settings for ${project.name}`} aria-label={`Project settings for ${project.name}`}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                              <circle cx="12" cy="12" r="3" />
                              <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21h-4v-.05A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3v-4h.05A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06L7.06 4.2l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3h4v.05A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.55 1H21v4h-.05A1.7 1.7 0 0 0 19.4 15z" />
                            </svg>
                          </button>
                        )}
                      </Show>
                      <button
                        class="session-group-action new-chat"
                        onClick={(event) => { event.stopPropagation(); startSessionForGroup(group); }}
                        title={groupMode() === 'project' ? `New chat in ${group.label}` : `New No Project chat in ${group.label}`}
                        aria-label={groupMode() === 'project' ? `New chat in ${group.label}` : `New No Project chat in ${group.label}`}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
                      </button>
                    </div>
                  </Show>
                </div>
                <Show when={!groupCollapsed(group.key)}>
                <div class="session-group-content">
                <For each={visibleGroupSessions(group)}>
                  {(session) => (
                    <div class={`session-item ${props.activeSessionId === session.id ? 'active' : ''} ${sessionSubtitle(session) ? '' : 'without-subtitle'}`} onClick={() => openSession(session)}>
                      <div class="session-main">
                        <div class="session-title">{session.name || session.firstMessage || 'Empty Chat'}</div>
                        <Show when={sessionSubtitle(session)}>
                          <div class="session-subtitle">
                            {sessionSubtitle(session)}<Show when={(session.directoryNames?.length || 0) > 1}> · {session.directoryNames!.join(' + ')}</Show>
                          </div>
                        </Show>
                      </div>
                      <div class="session-meta">
                        <Switch fallback={formatRelativeTime(session.modified)}>
                          <Match when={sessionStatuses[session.id] === 'working'}>
                            <span class="session-live-status working" title="Working…" aria-label="Working">
                              <span class="session-typing"><span class="session-typing-dot"/><span class="session-typing-dot"/><span class="session-typing-dot"/></span>
                            </span>
                          </Match>
                          <Match when={sessionStatuses[session.id] === 'needsInput'}>
                            <span class="session-live-status needs-input" title="Waiting for your input" aria-label="Waiting for your input">
                              <span class="session-live-status-dot" />
                            </span>
                          </Match>
                          <Match when={sessionStatuses[session.id] === 'error'}><span class="session-status-icon error" title="Ended with an error">!</span></Match>
                        </Switch>
                      </div>
                    </div>
                  )}
                </For>
                <Show when={group.sessions.length > SESSIONS_PER_GROUP_PAGE}>
                  <div class="session-group-pagination">
                    <Show when={visibleGroupSessions(group).length < group.sessions.length}>
                      <button class="session-group-more" onClick={() => setGroupPage(group.key, groupPage(group) + 1)}>
                        See more ({group.sessions.length - visibleGroupSessions(group).length})
                      </button>
                    </Show>
                    <Show when={groupPage(group) > 0}>
                      <button class="session-group-less" onClick={() => setGroupPage(group.key, 0)}>See less</button>
                    </Show>
                  </div>
                </Show>
                </div>
                </Show>
              </div>
            )}
          </For>
          <Show when={!sessions.loading && mergedSessions().length === 0}><div class="sidebar-empty">No chats yet.</div></Show>
        </div>
      </section>

      <div class="sidebar-footer">
        <button class="sidebar-settings-button" onClick={props.onOpenSettings} aria-label="Settings">
          <svg class="sidebar-settings-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21h-4v-.05A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3v-4h.05A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06L7.06 4.2l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3h4v.05A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.55 1H21v4h-.05A1.7 1.7 0 0 0 19.4 15z" />
          </svg>
          <span>Settings</span>
        </button>
      </div>

      <Show when={showAddProject()}><AddProjectModal onClose={() => setShowAddProject(false)} onSaved={() => void handleProjectSaved()}/></Show>
      <Show when={editingProject()} keyed>
        {(project) => <AddProjectModal project={project} onClose={() => setEditingProject(null)} onSaved={() => void handleProjectSaved()} onDelete={() => handleDeleteProject(project.id)}/>}
      </Show>
    </div>
  );
}
