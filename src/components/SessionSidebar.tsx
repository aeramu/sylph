import { createResource, createSignal, For, createEffect, Show, Switch, Match } from 'solid-js';
import type { DraftSession, SessionStatus } from '../types';
import { sessionStatuses, setSessionStatus } from '../lib/sessionStatus';
import AddProjectModal from './AddProjectModal';

interface ProjectInfo {
  id: string;
  name: string;
  path: string;
}

interface SessionInfo {
  id: string;
  name?: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
  status?: SessionStatus;
}

const SESSION_PREVIEW_COUNT = 5;

const fetchProjects = async () => {
  const res = await fetch('/api/projects');
  const data = await res.json();
  return data.projects as ProjectInfo[];
};

function formatRelativeTime(dateStr: string) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffSecs = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return `${diffSecs}s`;
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 30) return `${diffDays}d`;

  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths}mo`;
  return `${Math.floor(diffMonths / 12)}y`;
}

function FolderIcon(props: { open?: boolean }) {
  return (
    <Show
      when={props.open}
      fallback={
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
        </svg>
      }
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M2 5v14a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-8.5l-2-3H4a2 2 0 0 0-2 2z"></path>
        <path d="M2 12h20"></path>
      </svg>
    </Show>
  );
}

function ProjectItem(props: {
  project: ProjectInfo,
  activeSessionId?: string,
  activeProjectId?: string,
  onSelectSession: (id?: string) => void,
  onSelectProject: (id?: string) => void,
  onNewChat: () => void,
  onDelete: () => void,
  refreshTrigger: number,
  draftSessions: DraftSession[]
}) {
  const [expanded, setExpanded] = createSignal(false);
  const [showAll, setShowAll] = createSignal(false);

  const fetchSessions = async () => {
    const res = await fetch(`/api/sessions?project_id=${props.project.id}&t=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' }
    });
    const data = await res.json();
    const list = data.sessions as SessionInfo[];
    // Seed live statuses the SSE stream can't tell us about (sessions that
    // were already mid-turn or blocked on a dialog before this page loaded).
    // Set-only: clearing is the SSE tracker's job, and the server never
    // reports 'error' (only the client sees error events).
    for (const s of list) {
      if (s.status) setSessionStatus(s.id, s.status);
    }
    return list;
  };

  const [sessions, { refetch }] = createResource(fetchSessions);

  createEffect(() => {
    const trigger = props.refreshTrigger;
    if (trigger > 0 && expanded()) {
      refetch();
    }
  });

  createEffect(() => {
    if (props.activeSessionId) {
      if (sessions()?.some(s => s.id === props.activeSessionId)) {
        setExpanded(true);
      } else if (props.activeProjectId === props.project.id) {
        setExpanded(true);
      }
    }
  });

  // Fetched sessions plus locally created ones the server list doesn't
  // include yet (fresh chats still on their first turn). Titled with the
  // first prompt so they don't vanish or read "New Chat" while streaming.
  const mergedSessions = () => {
    const list = sessions() ? [...sessions()!] : [];
    for (const draft of props.draftSessions) {
      if (!list.some(s => s.id === draft.id)) {
        list.unshift({
          id: draft.id,
          name: draft.firstMessage || 'New Chat',
          modified: draft.createdAt,
          messageCount: 1,
          firstMessage: draft.firstMessage,
        });
      }
    }
    return list;
  };

  const visibleSessions = () => {
    const list = mergedSessions();
    if (!showAll()) return list.slice(0, SESSION_PREVIEW_COUNT);
    return list;
  };

  return (
    <div class="project-group">
      <div class="project-header" onClick={() => setExpanded(!expanded())}>
        <div class="project-header-title">
          <span class="project-header-icon"><FolderIcon open={expanded()} /></span>
          <span class="project-header-name" title={props.project.path}>{props.project.name}</span>
        </div>

        <div class="project-header-actions">
          <button
            class="icon-button"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm('Are you sure you want to remove this project?')) {
                props.onDelete();
              }
            }}
            title="Remove Project"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
          </button>
          <button
            class="icon-button"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(true);
              props.onNewChat();
            }}
            title="New Chat"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
        </div>
      </div>

      <Show when={expanded()}>
        <div class="project-sessions">
          <For each={visibleSessions()}>
            {(session) => (
              <div
                class={`session-item ${props.activeSessionId === session.id ? 'active' : ''}`}
                onClick={() => {
                  // Opening an errored session acknowledges the error badge.
                  if (sessionStatuses[session.id] === 'error') {
                    setSessionStatus(session.id, undefined);
                  }
                  props.onSelectProject(props.project.id);
                  props.onSelectSession(session.id);
                }}
              >
                <div class="session-title">
                  {session.name || session.firstMessage || 'Empty Chat'}
                </div>
                <div class="session-meta">
                  <Switch fallback={formatRelativeTime(session.modified)}>
                    <Match when={sessionStatuses[session.id] === 'working'}>
                      <span class="session-typing" title="Working…">
                        <span class="session-typing-dot" />
                        <span class="session-typing-dot" />
                        <span class="session-typing-dot" />
                      </span>
                    </Match>
                    <Match when={sessionStatuses[session.id] === 'needsInput'}>
                      <span class="session-status-icon needs-input" title="Waiting for your input">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                          <polyline points="14 2 14 8 20 8"></polyline>
                        </svg>
                        <span class="session-status-dot" />
                      </span>
                    </Match>
                    <Match when={sessionStatuses[session.id] === 'error'}>
                      <span class="session-status-icon error" title="Ended with an error">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <circle cx="12" cy="12" r="10"></circle>
                          <line x1="12" y1="8" x2="12" y2="12"></line>
                          <line x1="12" y1="16" x2="12.01" y2="16"></line>
                        </svg>
                      </span>
                    </Match>
                  </Switch>
                </div>
              </div>
            )}
          </For>
          <Show when={mergedSessions().length > SESSION_PREVIEW_COUNT}>
            <div class="session-list-toggle" onClick={() => setShowAll(!showAll())}>
              {showAll() ? 'See less' : `See all (${mergedSessions().length})`}
            </div>
          </Show>
          <Show when={mergedSessions().length === 0}>
            <div class="session-list-empty">No chats yet.</div>
          </Show>
        </div>
      </Show>
    </div>
  );
}

export default function SessionSidebar(props: {
  activeSessionId?: string,
  activeProjectId?: string,
  onSelectSession: (id?: string) => void,
  onSelectProject: (id?: string) => void,
  refreshTrigger: number,
  draftSessions: DraftSession[]
  onProjectsChanged?: () => void,
  onOpenSettings: () => void,
}) {
  const [projects, { refetch }] = createResource(fetchProjects);
  const [showAddProject, setShowAddProject] = createSignal(false);

  const handleDeleteProject = async (id: string) => {
    try {
      await fetch(`/api/projects/${id}`, { method: 'DELETE' });
      if (props.activeProjectId === id) {
        props.onSelectProject(undefined);
        props.onSelectSession(undefined);
      }
      refetch();
      props.onProjectsChanged?.();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div class="sidebar">
      <div class="sidebar-header">
        <div class="sidebar-title">Projects</div>
        <div class="sidebar-actions">
          <button class="icon-button" onClick={() => setShowAddProject(true)} title="Add Project">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
              <line x1="12" y1="11" x2="12" y2="17"></line>
              <line x1="9" y1="14" x2="15" y2="14"></line>
            </svg>
          </button>
        </div>
      </div>

      <div class="session-list">
        <For each={projects()}>
          {(proj) => (
            <ProjectItem
              project={proj}
              activeSessionId={props.activeSessionId}
              activeProjectId={props.activeProjectId}
              onSelectSession={props.onSelectSession}
              onSelectProject={props.onSelectProject}
              onNewChat={() => {
                props.onSelectProject(proj.id);
                props.onSelectSession(undefined);
              }}
              onDelete={() => handleDeleteProject(proj.id)}
              refreshTrigger={props.refreshTrigger}
              draftSessions={props.draftSessions.filter(d => d.projectId === proj.id)}
            />
          )}
        </For>

        <Show when={projects() && projects()!.length === 0}>
          <div class="sidebar-empty">
            No projects added yet. <br /><br /> Click the folder icon to add one.
          </div>
        </Show>
      </div>

      <div class="sidebar-footer">
        <button class="sidebar-settings-button" onClick={props.onOpenSettings}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.31.22.65.22 1H21a2 2 0 0 1 0 4h-1.38c0 .35-.08.69-.22 1z"></path>
          </svg>
          <span>Settings</span>
        </button>
      </div>

      {showAddProject() && (
        <AddProjectModal
          onClose={() => setShowAddProject(false)}
          onAdded={() => {
            setShowAddProject(false);
            refetch();
            props.onProjectsChanged?.();
          }}
        />
      )}
    </div>
  );
}
