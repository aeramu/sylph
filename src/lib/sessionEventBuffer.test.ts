import { describe, expect, it } from 'vitest';
import { SessionEventBuffer } from './sessionEventBuffer';

describe('SessionEventBuffer', () => {
  it('replays events that arrive after a history snapshot starts', () => {
    const buffer = new SessionEventBuffer<{ type: string; sessionId?: string; delta?: string }>();
    buffer.begin('session-1');

    expect(buffer.capture({ type: 'message_update', sessionId: 'session-1', delta: 'late' })).toBe(true);
    expect(buffer.finish('session-1')).toEqual([
      { type: 'message_update', sessionId: 'session-1', delta: 'late' },
    ]);
  });

  it('skips buffered events already represented by the snapshot', () => {
    const buffer = new SessionEventBuffer();
    buffer.begin('session-1');
    buffer.capture({ type: 'message_update', sessionId: 'session-1', eventSeq: 4 });
    buffer.capture({ type: 'message_update', sessionId: 'session-1', eventSeq: 6 });

    expect(buffer.finish('session-1', 5)).toEqual([
      { type: 'message_update', sessionId: 'session-1', eventSeq: 6 },
    ]);
  });

  it('does not capture another session or blocking UI requests', () => {
    const buffer = new SessionEventBuffer();
    buffer.begin('session-1');

    expect(buffer.capture({ type: 'message_update', sessionId: 'session-2' })).toBe(false);
    expect(buffer.capture({ type: 'extension_ui_request', sessionId: 'session-1' })).toBe(false);
    expect(buffer.finish('session-1')).toEqual([]);
  });

  it('discards an obsolete load when the active session changes', () => {
    const buffer = new SessionEventBuffer();
    buffer.begin('session-1');
    buffer.capture({ type: 'message_update', sessionId: 'session-1' });

    expect(buffer.finish('session-2')).toEqual([]);
    buffer.cancel();
    expect(buffer.finish('session-1')).toEqual([]);
  });
});
