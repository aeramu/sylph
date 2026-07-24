import { createSignal, onCleanup, onMount, lazy, Show, Suspense } from 'solid-js';
import type { DraftSession } from '../types';
import ChatInterface from '../features/chat/ChatInterface';
import SessionSidebar from '../features/sessions/SessionSidebar';
import { startPointerResize } from '../lib/resize';
import './App.css';

const SettingsModal = lazy(() => import('../features/settings/SettingsModal'));

function App() {
  const [activeSessionId, setActiveSessionId] = createSignal<string | undefined>(undefined);
  const [activeProjectId, setActiveProjectId] = createSignal<string | undefined>(undefined);
  const [newSessionRequest, setNewSessionRequest] = createSignal<{ id: number; standalonePath?: string }>({ id: 0 });
  const [refreshSidebar, setRefreshSidebar] = createSignal(0);
  // Bumped whenever projects are added/removed so both the sidebar and the
  // chat composer's project selector refetch from the same source of truth.
  const [projectRefresh, setProjectRefresh] = createSignal(0);
  // Freshly created sessions, kept (and shown in the sidebar) until the
  // fetched session list includes them — see DraftSession.
  const [draftSessions, setDraftSessions] = createSignal<DraftSession[]>([]);
  const [showSettings, setShowSettings] = createSignal(false);
  // Mobile: sidebarOpen controls the off-canvas drawer.
  // Desktop: sidebarCollapsed removes the sidebar column from the layout.
  const [sidebarOpen, setSidebarOpen] = createSignal(false);
  const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false);
  const [sidebarWidth, setSidebarWidth] = createSignal(260);

  // Mobile Safari can keep 100vh at the pre-keyboard height. Mirror the
  // visual viewport into CSS so the composer remains above the keyboard both
  // when typing and when the searchable model picker focuses its input.
  onMount(() => {
    const viewport = window.visualViewport;
    let frame = 0;

    const updateViewport = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const height = viewport?.height ?? window.innerHeight;
        const offsetTop = viewport?.offsetTop ?? 0;
        document.documentElement.style.setProperty('--app-viewport-height', `${height}px`);
        document.documentElement.style.setProperty('--app-viewport-offset-top', `${offsetTop}px`);
      });
    };

    updateViewport();
    window.addEventListener('resize', updateViewport);
    window.addEventListener('orientationchange', updateViewport);
    viewport?.addEventListener('resize', updateViewport);
    viewport?.addEventListener('scroll', updateViewport);

    onCleanup(() => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', updateViewport);
      window.removeEventListener('orientationchange', updateViewport);
      viewport?.removeEventListener('resize', updateViewport);
      viewport?.removeEventListener('scroll', updateViewport);
      document.documentElement.style.removeProperty('--app-viewport-height');
      document.documentElement.style.removeProperty('--app-viewport-offset-top');
    });
  });

  const toggleSidebar = () => {
    if (window.matchMedia('(max-width: 768px)').matches) {
      setSidebarOpen(o => !o);
      return;
    }
    setSidebarCollapsed(c => !c);
  };

  const startNewSession = (projectId?: string, standalonePath?: string) => {
    setActiveSessionId(undefined);
    setActiveProjectId(projectId);
    setNewSessionRequest((current) => ({ id: current.id + 1, standalonePath }));
    setSidebarOpen(false);
  };

  const startSidebarResize = (event: PointerEvent) => {
    if (window.matchMedia('(max-width: 768px)').matches) return;
    startPointerResize({
      event,
      startWidth: sidebarWidth(),
      min: 220,
      max: 460,
      direction: 1,
      bodyClass: 'resizing-sidebar',
      onWidth: setSidebarWidth,
    });
  };

  return (
    <div
      class={`app-layout ${sidebarOpen() ? 'sidebar-open' : ''} ${sidebarCollapsed() ? 'sidebar-collapsed' : ''}`}
      style={`--sidebar-width: ${sidebarWidth()}px`}
    >
      <button
        class="sidebar-toggle sidebar-toggle-external"
        onClick={toggleSidebar}
        title="Open sidebar"
        aria-label="Open sidebar"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="3" y1="6" x2="21" y2="6"></line>
          <line x1="3" y1="12" x2="21" y2="12"></line>
          <line x1="3" y1="18" x2="21" y2="18"></line>
        </svg>
      </button>
      <div class="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      <SessionSidebar
        activeSessionId={activeSessionId()}
        onSelectSession={(id) => {
          setActiveSessionId(id);
          setSidebarOpen(false);
        }}
        activeProjectId={activeProjectId()}
        onSelectProject={setActiveProjectId}
        onNewSession={startNewSession}
        refreshTrigger={refreshSidebar()}
        projectsRefreshTrigger={projectRefresh()}
        draftSessions={draftSessions()}
        onProjectsChanged={() => setProjectRefresh(r => r + 1)}
        onSessionDetached={(id) => {
          if (activeSessionId() === id) {
            setActiveSessionId(undefined);
            setActiveProjectId(undefined);
          }
          setDraftSessions((sessions) => sessions.filter((session) => session.id !== id));
          setRefreshSidebar((value) => value + 1);
        }}
        onOpenSettings={() => {
          setShowSettings(true);
          setSidebarOpen(false);
        }}
        onToggleSidebar={toggleSidebar}
      />
      <div
        class="sidebar-resize-handle"
        onPointerDown={startSidebarResize}
        title="Resize sidebar"
        aria-label="Resize sidebar"
      />
      <Show when={showSettings()}>
        <Suspense>
          <SettingsModal
            onClose={() => setShowSettings(false)}
            onProjectsChanged={(deletedProjectId) => {
              if (deletedProjectId && activeProjectId() === deletedProjectId) setActiveProjectId(undefined);
              setProjectRefresh((value) => value + 1);
            }}
          />
        </Suspense>
      </Show>
      <ChatInterface
        activeSessionId={activeSessionId()}
        activeProjectId={activeProjectId()}
        onSelectProject={setActiveProjectId}
        newSessionRequest={newSessionRequest()}
        projectRefreshTrigger={projectRefresh()}
        onSessionCreated={(newId, newProjectId, firstMessage, sessionMeta) => {
          setDraftSessions((prev) => [...prev, {
            id: newId,
            workspaceKind: sessionMeta?.workspaceKind,
            projectId: newProjectId,
            directoryId: sessionMeta?.directoryId,
            branch: sessionMeta?.branch,
            worktree: sessionMeta?.worktree,
            firstMessage: firstMessage || '',
            createdAt: new Date().toISOString(),
          }]);
          setActiveSessionId(newId);
          setActiveProjectId(newProjectId);
        }}
        onSessionRemoved={(id) => {
          if (activeSessionId() === id) setActiveSessionId(undefined);
          setRefreshSidebar((value) => value + 1);
        }}
        onTurnComplete={() => {
          setRefreshSidebar(r => r + 1);
        }}
      />
    </div>
  );
}

export default App;
