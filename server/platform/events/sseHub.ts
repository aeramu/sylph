import type express from "express";

const clients: Set<express.Response> = new Set();

export function addClient(res: express.Response) {
  clients.add(res);
}

export function removeClient(res: express.Response) {
  clients.delete(res);
}

export function broadcast(payload: any) {
  const data = JSON.stringify(payload);
  for (const client of clients) {
    client.write(`data: ${data}\n\n`);
  }
}
