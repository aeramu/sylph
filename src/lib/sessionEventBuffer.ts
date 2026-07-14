export interface SessionScopedEvent {
  type: string;
  sessionId?: string;
  eventSeq?: number;
}

export class SessionEventBuffer<T extends SessionScopedEvent> {
  private sessionId: string | null = null;
  private events: T[] = [];

  begin(sessionId: string) {
    this.sessionId = sessionId;
    this.events = [];
  }

  capture(event: T): boolean {
    if (event.sessionId !== this.sessionId || event.type === 'extension_ui_request') return false;
    this.events.push(event);
    return true;
  }

  finish(sessionId: string, afterEventSeq = -1): T[] {
    if (this.sessionId !== sessionId) return [];
    const events = this.events.filter((event) => (event.eventSeq ?? Number.POSITIVE_INFINITY) > afterEventSeq);
    this.sessionId = null;
    this.events = [];
    return events;
  }

  cancel() {
    this.sessionId = null;
    this.events = [];
  }
}
