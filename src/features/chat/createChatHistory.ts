import { SessionEventBuffer } from '../../lib/sessionEventBuffer';
import { getSession, type SessionSnapshot } from './api';

export class ChatHistoryController<T extends { type: string; sessionId?: string; eventSeq?: number }> {
  private requestSequence = 0;
  readonly eventBuffer = new SessionEventBuffer<T>();

  async load(sessionId: string): Promise<{ snapshot: SessionSnapshot; events: T[] } | undefined> {
    const sequence = ++this.requestSequence;
    this.eventBuffer.begin(sessionId);
    try {
      const snapshot = await getSession(sessionId);
      if (sequence !== this.requestSequence) return undefined;
      return { snapshot, events: this.eventBuffer.finish(sessionId, snapshot.eventSeq) };
    } catch (error) {
      if (sequence === this.requestSequence) this.eventBuffer.cancel();
      throw error;
    }
  }

  cancel(): void {
    this.requestSequence++;
    this.eventBuffer.cancel();
  }

  capture(event: T): boolean {
    return this.eventBuffer.capture(event);
  }
}
