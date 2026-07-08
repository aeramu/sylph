import { createSignal, Show } from 'solid-js';
import type { DraftSession } from './types';
import ChatInterface from './components/ChatInterface';
import SessionSidebar from './components/SessionSidebar';
import SettingsModal from './components/SettingsModal';

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

  return (
    <div class="app-layout">
      <SessionSidebar
        activeSessionId={activeSessionId()}
        onSelectSession={setActiveSessionId}
        activeProjectId={activeProjectId()}
        onSelectProject={setActiveProjectId}
        refreshTrigger={refreshSidebar()}
        draftSessions={draftSessions()}
        onProjectsChanged={() => setProjectRefresh(r => r + 1)}
        onOpenSettings={() => setShowSettings(true)}
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
