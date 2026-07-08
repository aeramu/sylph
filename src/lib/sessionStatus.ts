import { createStore, produce } from 'solid-js/store';
import type { SessionStatus } from '../types';

// Dialog methods block the agent until the user responds; fire-and-forget
// methods (notify, setStatus, ...) don't and must not flag the session.
const DIALOG_METHODS = new Set(['select', 'confirm', 'input', 'editor', 'questions']);

// Module-level store so the sidebar and the chat view share one status map
// without threading props through App.
const [sessionStatuses, setSessionStatuses] = createStore<Record<string, SessionStatus>>({});

export { sessionStatuses };

export function setSessionStatus(sessionId: string, status?: SessionStatus) {
  if (status) setSessionStatuses(sessionId, status);
  else setSessionStatuses(produce((s) => { delete s[sessionId]; }));
}

// Feed every SSE event through here before any active-session filtering, so
// sessions the chat view isn't showing still get badged in the sidebar.
export function trackSessionEvent(event: any) {
  const id = event?.sessionId;
  if (!id) return;

  if (event.type === 'extension_ui_request') {
    if (DIALOG_METHODS.has(event.method)) setSessionStatus(id, 'needsInput');
    return;
  }

  switch (event.type) {
    case 'agent_start':
      setSessionStatus(id, 'working');
      break;
    case 'agent_end':
      // Keep an error badge visible after the turn ends; anything else is idle.
      if (sessionStatuses[id] !== 'error') setSessionStatus(id, undefined);
      break;
    case 'message_start':
    case 'message_end':
      if (event.message?.stopReason === 'error' && event.message?.errorMessage) {
        setSessionStatus(id, 'error');
      } else if (sessionStatuses[id] === 'needsInput') {
        // The dialog was answered (possibly in another tab) — agent resumed.
        setSessionStatus(id, 'working');
      }
      break;
    case 'message_update':
    case 'tool_execution_start':
    case 'tool_execution_update':
    case 'tool_execution_end':
      if (sessionStatuses[id] === 'needsInput') setSessionStatus(id, 'working');
      break;
  }
}
