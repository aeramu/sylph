export interface SessionScopedEvent {
  type: string;
  sessionId?: string;
  [key: string]: unknown;
}

export class PendingSessionEvents<T extends { sessionId?: string }> {
  private awaiting = false;
  private events: T[] = [];

  begin(): void {
    this.awaiting = true;
    this.events = [];
  }

  capture(event: T): boolean {
    if (!this.awaiting) return false;
    this.events.push(event);
    return true;
  }

  commit(sessionId: string): T[] {
    const matching = this.events.filter((event) => event.sessionId === sessionId);
    this.cancel();
    return matching;
  }

  cancel(): void {
    this.awaiting = false;
    this.events = [];
  }

  get isAwaiting(): boolean {
    return this.awaiting;
  }
}

interface EventSourceLike {
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent<string>) => void) | null;
  close(): void;
}

export interface SessionStreamOptions<T extends SessionScopedEvent> {
  createSource?: (url: string) => EventSourceLike;
  onConnectionChange: (connected: boolean) => void;
  onEvent: (event: T) => void;
  onReconnect: () => void;
}

export function connectSessionStream<T extends SessionScopedEvent>(options: SessionStreamOptions<T>): () => void {
  const source = (options.createSource ?? ((url) => new EventSource(url)))('/api/stream');
  let connected = false;
  let connectedOnce = false;

  source.onopen = () => undefined;
  source.onerror = () => {
    connected = false;
    options.onConnectionChange(false);
  };
  source.onmessage = (message) => {
    const event = JSON.parse(message.data) as T;
    if (event.type === 'connection_established') {
      const reconnect = connectedOnce && !connected;
      connected = true;
      connectedOnce = true;
      options.onConnectionChange(true);
      if (reconnect) options.onReconnect();
      return;
    }
    options.onEvent(event);
  };

  return () => source.close();
}
