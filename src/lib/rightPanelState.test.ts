import { describe, expect, it } from 'vitest';
import { getRightPanelState, setRightPanelState } from './rightPanelState';

describe('right panel state', () => {
  it('stores open state and active tab independently for each session', () => {
    setRightPanelState('panel-session-a', { open: true, tab: 'browser' });
    setRightPanelState('panel-session-b', { open: false, tab: 'git' });

    expect(getRightPanelState('panel-session-a')).toEqual({ open: true, tab: 'browser' });
    expect(getRightPanelState('panel-session-b')).toEqual({ open: false, tab: 'git' });
  });

  it('defaults new chats and unseen sessions to a closed Changes panel', () => {
    expect(getRightPanelState()).toEqual({ open: false, tab: 'changes' });
    expect(getRightPanelState('panel-unseen-session')).toEqual({ open: false, tab: 'changes' });
  });
});
