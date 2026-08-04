import { beforeEach, describe, expect, it } from 'vitest';
import { notificationForSessionEvent } from './browserNotifications';

describe('browser notifications', () => {
  beforeEach(() => {
    // Event mapping is deliberately independent of browser permission so it
    // can be tested in the fast Node suite.
  });

  it('maps turn completion to a session-scoped notification', () => {
    expect(notificationForSessionEvent(
      { type: 'agent_end', sessionId: 'session-1' },
      'Add notifications',
    )).toEqual({
      title: 'Sylph finished',
      body: 'Add notifications is ready.',
      tag: 'sylph-complete-session-1',
      sessionId: 'session-1',
    });
  });

  it('maps blocking UI requests but ignores fire-and-forget extension UI', () => {
    expect(notificationForSessionEvent(
      { type: 'extension_ui_request', method: 'confirm', sessionId: 'session-1' },
      'Deploy app',
    )).toMatchObject({ title: 'Sylph needs your input', sessionId: 'session-1' });
    expect(notificationForSessionEvent(
      { type: 'extension_ui_request', method: 'notify', sessionId: 'session-1' },
    )).toBeNull();
  });

  it('uses an error-specific completion notification', () => {
    expect(notificationForSessionEvent(
      { type: 'agent_end', sessionId: 'broken' },
      undefined,
      true,
    )).toMatchObject({ title: 'Sylph hit a problem', body: 'Your task ended with an error.' });
  });
});
