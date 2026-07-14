import type { PanelTabId } from '../components/RightPanel';

export interface RightPanelState {
  open: boolean;
  tab: PanelTabId;
}

const states = new Map<string, RightPanelState>();
const defaultState: RightPanelState = { open: false, tab: 'changes' };

export function getRightPanelState(sessionId?: string): RightPanelState {
  if (!sessionId) return defaultState;
  return states.get(sessionId) ?? defaultState;
}

export function setRightPanelState(sessionId: string, state: RightPanelState) {
  states.set(sessionId, state);
}
