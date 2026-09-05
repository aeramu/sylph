import type express from "express";

const MAX_QUEUED_BYTES = 1024 * 1024;

interface ClientState {
  blocked: boolean;
  queue: string[];
  queuedBytes: number;
}

const clients = new Map<express.Response, ClientState>();

export function addClient(res: express.Response) {
  clients.set(res, { blocked: false, queue: [], queuedBytes: 0 });
}

export function removeClient(res: express.Response) {
  clients.delete(res);
}

function disconnect(client: express.Response): void {
  clients.delete(client);
  try { client.destroy(); } catch { /* already closed */ }
}

function write(client: express.Response, data: string): void {
  const state = clients.get(client);
  if (!state) return;
  try {
    if (client.write(data)) return;
    state.blocked = true;
    client.once("drain", () => flush(client));
  } catch {
    disconnect(client);
  }
}

function flush(client: express.Response): void {
  const state = clients.get(client);
  if (!state) return;
  state.blocked = false;
  while (!state.blocked && state.queue.length > 0) {
    const data = state.queue.shift()!;
    state.queuedBytes -= Buffer.byteLength(data);
    write(client, data);
  }
}

export function broadcast(payload: any) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  const bytes = Buffer.byteLength(data);
  for (const [client, state] of clients) {
    if (!state.blocked) {
      write(client, data);
      continue;
    }
    if (state.queuedBytes + bytes > MAX_QUEUED_BYTES) {
      // Force EventSource to reconnect rather than retaining unbounded output.
      // The active-session snapshot repairs events missed during reconnection.
      disconnect(client);
      continue;
    }
    state.queue.push(data);
    state.queuedBytes += bytes;
  }
}
