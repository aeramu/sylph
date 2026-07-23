export interface DisposableRuntime {
  session?: { isStreaming?: boolean };
  dispose?: () => void;
}

interface RuntimeEntry<T extends DisposableRuntime> {
  promise: Promise<T>;
  runtime?: T;
  lastUsed: number;
}

export class RuntimeRegistry<T extends DisposableRuntime> {
  private readonly entries = new Map<string, RuntimeEntry<T>>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  get(sessionId: string): T | undefined {
    return this.entries.get(sessionId)?.runtime;
  }

  settled(sessionId: string): Promise<T | undefined> {
    const entry = this.entries.get(sessionId);
    if (!entry) return Promise.resolve(undefined);
    entry.lastUsed = this.now();
    return entry.promise.catch(() => undefined);
  }

  touch(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (entry) entry.lastUsed = this.now();
  }

  getOrBuild(sessionId: string, build: () => Promise<T>): Promise<T> {
    const existing = this.entries.get(sessionId);
    if (existing) { existing.lastUsed = this.now(); return existing.promise; }
    const entry = { lastUsed: this.now() } as RuntimeEntry<T>;
    entry.promise = build().then((runtime) => { entry.runtime = runtime; return runtime; }).catch((error) => {
      if (this.entries.get(sessionId) === entry) this.entries.delete(sessionId);
      throw error;
    });
    this.entries.set(sessionId, entry);
    return entry.promise;
  }

  register(sessionId: string, runtime: T): void {
    this.entries.set(sessionId, { promise: Promise.resolve(runtime), runtime, lastUsed: this.now() });
  }

  dispose(sessionId: string): boolean {
    const entry = this.entries.get(sessionId);
    if (!entry) return false;
    this.entries.delete(sessionId);
    if (entry.runtime) entry.runtime.dispose?.();
    else void entry.promise.then((runtime) => runtime.dispose?.()).catch(() => {});
    return true;
  }

  evictIdle(maxIdleMs: number, onEvict?: (sessionId: string) => void): string[] {
    const now = this.now();
    const evicted: string[] = [];
    for (const [sessionId, entry] of this.entries) {
      if (!entry.runtime || entry.runtime.session?.isStreaming || now - entry.lastUsed <= maxIdleMs) continue;
      this.entries.delete(sessionId);
      entry.runtime.dispose?.();
      onEvict?.(sessionId);
      evicted.push(sessionId);
    }
    return evicted;
  }
}
