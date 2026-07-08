import { createSignal, Show } from 'solid-js';
import type { DraftSession } from './types';
import ChatInterface from './components/ChatInterface';
import SessionSidebar from './components/SessionSidebar';
import SettingsModal from './components/SettingsModal';
import './App.css';

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
  // Mobile only: the sidebar renders as an off-canvas drawer (see App.css);
  // picking a session closes it so the chat is immediately visible.
  const [sidebarOpen, setSidebarOpen] = createSignal(false);

  return (
    <div class={`app-layout ${sidebarOpen() ? 'sidebar-open' : ''}`}>
      <button
        class="sidebar-toggle"
        onClick={() => setSidebarOpen(o => !o)}
        title="Toggle sidebar"
        aria-label="Toggle sidebar"
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
        onOpenSettings={() => {
          setShowSettings(true);
          setSidebarOpen(false);
        }}
      />
      <Show when={showSettings()}>
        <SettingsModal onClose={() => setShowSettings(false)} />
      </Show>
      <ChatInterface
        activeSessionId={activeSessionId()}
        activeProjectId={activeProjectId()}
        onSelectProject={setActiveProjectId}
        projectRefreshTrigger={projectRefresh()}
        onSessionCreated={(newId, newProjectId, firstMessage) => {
          setDraftSessions((prev) => [...prev, {
            id: newId,
            projectId: newProjectId,
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
