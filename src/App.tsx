import { createSignal, lazy, Show, Suspense } from 'solid-js';
import type { DraftSession } from './types';
import ChatInterface from './components/ChatInterface';
import SessionSidebar from './components/SessionSidebar';
import { startPointerResize } from './lib/resize';
import './App.css';

const SettingsModal = lazy(() => import('./components/SettingsModal'));

function App() {
  const [activeSessionId, setActiveSessionId] = createSignal<string | undefined>(undefined);
  const [activeProjectId, setActiveProjectId] = createSignal<string | undefined>(undefined);
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

  const toggleSidebar = () => {
    if (window.matchMedia('(max-width: 768px)').matches) {
      setSidebarOpen(o => !o);
      return;
    }
    setSidebarCollapsed(c => !c);
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
        refreshTrigger={refreshSidebar()}
        draftSessions={draftSessions()}
        onProjectsChanged={() => setProjectRefresh(r => r + 1)}
        onSessionDetached={(id) => {
          if (activeSessionId() === id) setActiveSessionId(undefined);
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
          <SettingsModal onClose={() => setShowSettings(false)} />
        </Suspense>
      </Show>
      <ChatInterface
        activeSessionId={activeSessionId()}
        activeProjectId={activeProjectId()}
        onSelectProject={setActiveProjectId}
        projectRefreshTrigger={projectRefresh()}
        onSessionCreated={(newId, newProjectId, firstMessage, sessionMeta) => {
          setDraftSessions((prev) => [...prev, {
            id: newId,
            projectId: newProjectId,
            branch: sessionMeta?.branch,
            worktree: sessionMeta?.worktree,
            firstMessage: firstMessage || '',
            createdAt: new Date().toISOString(),
          }]);
          setActiveSessionId(newId);
          if (newProjectId) {
            setActiveProjectId(newProjectId);
          }
        }}
        onTurnComplete={() => {
          setRefreshSidebar(r => r + 1);
        }}
      />
    </div>
  );
}

export default App;
