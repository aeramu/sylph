import { createSignal } from 'solid-js';
import ChatInterface from './components/ChatInterface';
import SessionSidebar from './components/SessionSidebar';
import './index.css';

function App() {
  const [activeSessionId, setActiveSessionId] = createSignal<string | undefined>(undefined);
  const [activeProjectId, setActiveProjectId] = createSignal<string | undefined>(undefined);
  const [refreshSidebar, setRefreshSidebar] = createSignal(0);

  return (
    <div class="app-layout">
      <SessionSidebar 
        activeSessionId={activeSessionId()} 
        onSelectSession={setActiveSessionId} 
        activeProjectId={activeProjectId()}
        onSelectProject={setActiveProjectId}
        refreshTrigger={refreshSidebar()}
      />
      <ChatInterface 
        activeSessionId={activeSessionId()} 
        activeProjectId={activeProjectId()}
        onSelectProject={setActiveProjectId}
        onSessionCreated={(newId, newProjectId) => {
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
