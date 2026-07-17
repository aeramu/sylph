import { describe, expect, it, vi } from 'vitest';
import { connectSessionStream, PendingSessionEvents } from './createSessionStream';

describe('pending session events', () => {
  it('buffers only while a new session is awaiting commit', () => {
    const buffer = new PendingSessionEvents<{ sessionId?: string; value: number }>();
    expect(buffer.capture({ sessionId: 'a', value: 0 })).toBe(false);
    buffer.begin();
    expect(buffer.capture({ sessionId: 'a', value: 1 })).toBe(true);
    buffer.capture({ sessionId: 'b', value: 2 });
    expect(buffer.commit('a')).toEqual([{ sessionId: 'a', value: 1 }]);
    expect(buffer.isAwaiting).toBe(false);
  });
});

describe('session stream', () => {
  it('reports reconnection and dispatches ordinary events', () => {
    const source = { onopen: null, onerror: null, onmessage: null, close: vi.fn() } as any;
    const changes: boolean[] = [];
    const events: unknown[] = [];
    const reconnect = vi.fn();
    const dispose = connectSessionStream({
      createSource: () => source,
      onConnectionChange: (connected) => changes.push(connected),
      onEvent: (event) => events.push(event),
      onReconnect: reconnect,
    });
    source.onmessage({ data: JSON.stringify({ type: 'connection_established' }) });
    source.onmessage({ data: JSON.stringify({ type: 'message_start', sessionId: 'a' }) });
    source.onerror(new Event('error'));
    source.onmessage({ data: JSON.stringify({ type: 'connection_established' }) });
    expect(changes).toEqual([true, false, true]);
    expect(events).toEqual([{ type: 'message_start', sessionId: 'a' }]);
    expect(reconnect).toHaveBeenCalledOnce();
    dispose();
    expect(source.close).toHaveBeenCalledOnce();
  });
});
