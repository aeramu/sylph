export interface SessionHistorySummary {
  id: string;
  path: string;
}

/** Structural subset of a persisted agent session used by Sylph features. */
export interface SessionHistoryHandle {
  getSessionId(): string;
  getCwd?(): string;
  getSessionFile?(): string | undefined;
  getEntries(): any[];
  appendCustomEntry(type: string, data: unknown): unknown;
  buildSessionContext(): { messages: any[] };
}

/** Vendor-neutral persistence operations needed by session workflows. */
export interface SessionHistoryPort {
  open(filePath: string): SessionHistoryHandle;
  create(cwd: string): SessionHistoryHandle;
  list(cwd: string): Promise<SessionHistorySummary[]>;
  listAll(): Promise<SessionHistorySummary[]>;
}
