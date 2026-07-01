import { createResource, createSignal, For, createEffect, Show } from 'solid-js';
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
}

const fetchProjects = async () => {
  const res = await fetch('/api/projects');
  const data = await res.json();
  return data.projects as ProjectInfo[];
};

function formatRelativeTime(dateStr: string) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
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

function ProjectItem(props: { 
  project: ProjectInfo, 
  activeSessionId?: string, 
  onSelectSession: (id?: string) => void,
  onSelectProject: (id?: string) => void,
  onNewChat: () => void,
  onDelete: () => void,
  refreshTrigger: number
}) {
  const [expanded, setExpanded] = createSignal(false);
  const [showAll, setShowAll] = createSignal(false);
  const [hovered, setHovered] = createSignal(false);
  
  const fetchSessions = async () => {
    const res = await fetch(`/api/sessions?project_id=${props.project.id}&t=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' }
    });
    const data = await res.json();
    return data.sessions as SessionInfo[];
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

  const visibleSessions = () => {
    let list = sessions() ? [...sessions()!] : [];
    
    // Optimistically inject the active session if it hasn't been fetched yet
    if (props.activeSessionId && props.activeProjectId === props.project.id) {
      if (!list.some(s => s.id === props.activeSessionId)) {
        list.unshift({
          id: props.activeSessionId,
          name: 'New Chat',
          modified: new Date().toISOString(),
          messageCount: 1,
          firstMessage: ''
        });
      }
    }

    if (!showAll()) return list.slice(0, 5);
    return list;
  };

  return (
    <div class="project-group" style="margin-bottom: 0.5rem;">
      <div 
        class="project-header" 
        style={`display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 0; cursor: pointer; border-radius: 6px; transition: background 0.2s; ${hovered() ? 'background: rgba(255,255,255,0.03);' : ''}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => setExpanded(!expanded())}
      >
        <div style="font-weight: 600; font-size: 1rem; color: #d4d4d4; display: flex; align-items: center; gap: 0.6rem; overflow: hidden; padding-left: 0.25rem;">
          {expanded() ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color: #8c8c8c;">
              <path d="M2 5v14a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-8.5l-2-3H4a2 2 0 0 0-2 2z"></path>
              <path d="M2 12h20"></path>
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color: #8c8c8c;">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
            </svg>
          )}
          <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; letter-spacing: 0.02em;" title={props.project.path}>{props.project.name}</span>
        </div>
        
        <div style={`display: flex; gap: 0.5rem; opacity: ${hovered() ? 1 : 0}; transition: opacity 0.2s; padding-right: 0.5rem;`}>
          <button 
            onClick={(e) => {
              e.stopPropagation();
              if (confirm('Are you sure you want to remove this project?')) {
                props.onDelete();
              }
            }}
            style="background: none; border: none; color: #8c8c8c; cursor: pointer; padding: 0.25rem; display: flex; align-items: center; justify-content: center; border-radius: 4px;"
            title="Project Settings / Remove"
            onMouseEnter={(e) => e.currentTarget.style.color = '#d4d4d4'}
            onMouseLeave={(e) => e.currentTarget.style.color = '#8c8c8c'}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
          </button>
          <button 
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(true);
              props.onNewChat();
            }}
            style="background: none; border: none; color: #8c8c8c; cursor: pointer; padding: 0.25rem; display: flex; align-items: center; justify-content: center; border-radius: 4px;"
            title="New Chat"
            onMouseEnter={(e) => e.currentTarget.style.color = '#d4d4d4'}
            onMouseLeave={(e) => e.currentTarget.style.color = '#8c8c8c'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
        </div>
      </div>
      
      <Show when={expanded()}>
        <div class="project-sessions" style="padding-left: 1.8rem; display: flex; flex-direction: column; gap: 0.4rem; margin-top: 0.5rem; margin-bottom: 1rem;">
          <Show when={props.activeProjectId === props.project.id && !props.activeSessionId}>
             <div class="session-item active" style="display: flex; justify-content: space-between; align-items: center; padding: 0.4rem 0.5rem; border-radius: 6px; cursor: pointer; transition: background 0.2s;">
                <div class="session-title" style="font-size: 0.9rem; color: #d4d4d4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 80%;">
                  New Chat
                </div>
                <div class="session-meta" style="font-size: 0.8rem; color: #5f5f5f;">
                  Just now
                </div>
             </div>
          </Show>
          <For each={visibleSessions()}>
            {(session) => (
              <div 
                class={`session-item ${props.activeSessionId === session.id ? 'active' : ''}`}
                style="display: flex; justify-content: space-between; align-items: center; padding: 0.4rem 0.5rem; border-radius: 6px; cursor: pointer; transition: background 0.2s;"
                onClick={() => {
                  props.onSelectProject(props.project.id);
                  props.onSelectSession(session.id);
                }}
              >
                <div class="session-title" style="font-size: 0.9rem; color: #a3a3a3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 80%;">
                  {session.name || session.firstMessage || 'Empty Chat'}
                </div>
                <div class="session-meta" style="font-size: 0.8rem; color: #5f5f5f;">
                  {formatRelativeTime(session.modified)}
                </div>
              </div>
            )}
          </For>
          <Show when={sessions() && sessions()!.length > 5 && !showAll()}>
            <div 
              style="font-size: 0.9rem; color: #5f5f5f; padding: 0.4rem 0.5rem; cursor: pointer;"
              onClick={() => setShowAll(true)}
              onMouseEnter={(e) => e.currentTarget.style.color = '#a3a3a3'}
              onMouseLeave={(e) => e.currentTarget.style.color = '#5f5f5f'}
            >
              See all ({sessions()!.length})
            </div>
          </Show>
          <Show when={sessions() && sessions()!.length > 5 && showAll()}>
            <div 
              style="font-size: 0.9rem; color: #5f5f5f; padding: 0.4rem 0.5rem; cursor: pointer;"
              onClick={() => setShowAll(false)}
              onMouseEnter={(e) => e.currentTarget.style.color = '#a3a3a3'}
              onMouseLeave={(e) => e.currentTarget.style.color = '#5f5f5f'}
            >
              See less
            </div>
          </Show>
          <Show when={!sessions() || sessions()!.length === 0}>
            <div style="font-size: 0.875rem; color: #5f5f5f; padding: 0.4rem 0.5rem;">
              No chats yet.
            </div>
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
  refreshTrigger: number
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
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div class="sidebar" style="background: #1e1e1e; border-right: 1px solid #2e2e2e;">
      <div class="sidebar-header" style="display: flex; justify-content: space-between; align-items: center; padding: 1.25rem 1rem; border-bottom: none;">
        <div style="font-weight: 600; color: #8c8c8c; font-size: 1rem; letter-spacing: 0.02em;">Projects</div>
        <div style="display: flex; gap: 0.5rem;">
          <button 
            style="background: none; border: none; color: #8c8c8c; cursor: pointer; padding: 0.25rem; display: flex; align-items: center; justify-content: center; border-radius: 4px;"
            title="Filter / Sort"
            onMouseEnter={(e) => e.currentTarget.style.color = '#d4d4d4'}
            onMouseLeave={(e) => e.currentTarget.style.color = '#8c8c8c'}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="4" y1="6" x2="20" y2="6"></line>
              <line x1="8" y1="12" x2="20" y2="12"></line>
              <line x1="12" y1="18" x2="20" y2="18"></line>
            </svg>
          </button>
          <button 
            style="background: none; border: none; color: #8c8c8c; cursor: pointer; padding: 0.25rem; display: flex; align-items: center; justify-content: center; border-radius: 4px;"
            onClick={() => setShowAddProject(true)}
            title="Add Project"
            onMouseEnter={(e) => e.currentTarget.style.color = '#d4d4d4'}
            onMouseLeave={(e) => e.currentTarget.style.color = '#8c8c8c'}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
              <line x1="12" y1="11" x2="12" y2="17"></line>
              <line x1="9" y1="14" x2="15" y2="14"></line>
            </svg>
          </button>
        </div>
      </div>
      
      <div class="session-list" style="padding: 0.5rem 1rem;">
        <For each={projects()}>
          {(proj) => (
            <ProjectItem 
              project={proj}
              activeSessionId={props.activeSessionId}
              onSelectSession={props.onSelectSession}
              onSelectProject={props.onSelectProject}
              onNewChat={() => {
                props.onSelectProject(proj.id);
                props.onSelectSession(undefined);
              }}
              onDelete={() => handleDeleteProject(proj.id)}
              refreshTrigger={props.refreshTrigger}
            />
          )}
        </For>
        
        <Show when={projects() && projects()!.length === 0}>
          <div style="text-align: center; padding: 2rem 1rem; color: #5f5f5f; font-size: 0.875rem;">
            No projects added yet. <br/><br/> Click the folder icon to add one.
          </div>
        </Show>
      </div>
      
      {showAddProject() && (
        <AddProjectModal 
          onClose={() => setShowAddProject(false)} 
          onAdded={() => {
            setShowAddProject(false);
            refetch();
          }} 
        />
      )}
    </div>
  );
}
